// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mensagem } from "../../../nucleo/erros.ts";
import { ConfiguracaoAgente, type Modelo } from "../../../nucleo/configuracao_agente.ts";
import { EtapaTicket } from "../../../nucleo/primitivos.ts";
import { ComandosDePreparacao, Hospedagem, Projeto } from "../../../nucleo/projeto.ts";
import { HarnessPi } from "../../../infra/agente/harness_pi.ts";
import { varrerCommitsHumanos } from "../../../aplicacao/metricas/varrer_commits_humanos.ts";
import { escrever } from "../../../armazenamento/banco.ts";
import { noLog } from "../../../infra/registro.ts";
import {
  buscarProjeto,
  editarProjeto,
  listarProjetos,
  projetoExistente,
  registrarProjeto,
  removerProjeto,
} from "../../../aplicacao/projeto/cadastro.ts";
import {
  Configuracao,
  configuracao,
  configuracaoDoAmbiente,
  salvarConfiguracao,
} from "../../../armazenamento/servico.ts";
import { validarESalvarConfiguracaoDoAmbiente } from "../../../aplicacao/configuracao/configuracao_do_ambiente.ts";
import {
  eliminarAmbienteDoConjunto,
  listarAmbientesDoConjunto,
} from "../../../aplicacao/ambiente/conjunto_da_configuracao.ts";
import { conferirProjeto } from "../../../infra/repositorio/cadastro.ts";
import { ErroHttp } from "../erros.ts";
import type { Agendador, Rota } from "../rotas.ts";

/** A configuração do F4 §3 e o estado do agendador: a próxima busca, só ligado. */
function estado(banco: DatabaseSync, agendador: Agendador) {
  const c = configuracao(banco);
  return { ...c, proximaBusca: c.agendadorAtivo ? agendador.proximaBusca().toISOString() : null };
}

/** O projeto como o formulário manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
const DoFormulario = Projeto.pick({ nome: true, raiz_git: true, branch_base: true, link_produto: true }).extend({
  hospedagem: Hospedagem.optional(),
  preparacao: ComandosDePreparacao,
  /** O modelo e o effort de cada etapa; a etapa ausente usa o padrão do pi. */
  configuracoes: z.partialRecord(EtapaTicket, ConfiguracaoAgente),
});
/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
const DaEdicao = DoFormulario.extend({ nome: z.unknown() });

type Configuracoes = z.infer<typeof DoFormulario>["configuracoes"];

/** As etapas do projeto no formato do formulário: a configuração do agente de cada etapa que tem uma. */
const configuracoesDasEtapas = (etapas: Projeto["etapas"]): Configuracoes =>
  Object.fromEntries(
    etapas.flatMap(({ etapa, configuracao_agente }) => (configuracao_agente ? [[etapa, configuracao_agente]] : [])),
  );

/** O projeto como o formulário o lê: o cadastro com a configuração do agente de cada etapa. */
const comConfiguracoes = (p: Projeto) => ({ ...p, configuracoes: configuracoesDasEtapas(p.etapas) });

/** As linhas de `configuracao_etapa_projeto` do formulário: só as etapas com modelo ou effort escolhido. */
const etapasDoFormulario = (configuracoes: Configuracoes) =>
  EtapaTicket.options.flatMap((etapa) => {
    const configuracao_agente = configuracoes[etapa];
    return configuracao_agente?.modelo || configuracao_agente?.effort ? [{ etapa, configuracao_agente }] : [];
  });

/** O Ambiente: o tipo e os limites gravados, e o conjunto de containers da Fabriquinha (só os que ela criou). */
const estadoDoAmbiente = (banco: DatabaseSync) => ({
  configuracao: configuracaoDoAmbiente(banco),
  conjunto: listarAmbientesDoConjunto(banco),
});

const par = (m: Modelo | undefined): string | undefined => m && `${m.provedor}/${m.nome}`;

/**
 * F4 §9: o modelo novo ou trocado precisa existir no pi; o rejeitado vira erro do campo (422). O igual ao gravado não
 * chama o pi: o que ele deixou de listar continua salvando sem mexer.
 */
async function conferirModelosAlterados(banco: DatabaseSync, nome: string, configuracoes: Configuracoes) {
  const gravadas = configuracoesDasEtapas(buscarProjeto(banco, nome)?.etapas ?? []);
  const alterados = EtapaTicket.options.flatMap((etapa) => {
    const modelo = configuracoes[etapa]?.modelo;
    return modelo && par(modelo) !== par(gravadas[etapa]?.modelo) ? [{ etapa, modelo }] : [];
  });
  const rejeitados = (
    await Promise.all(
      alterados.map(({ etapa, modelo }) =>
        new HarnessPi().conferirModelo(modelo).then(
          () => [],
          (error_: unknown) => [
            {
              code: "custom" as const,
              path: ["configuracoes", etapa, "modelo"],
              message: mensagem(error_),
              input: modelo,
            },
          ],
        ),
      ),
    )
  ).flat();
  if (rejeitados.length > 0) throw new z.ZodError(rejeitados);
}

/**
 * C19 pelo web: confere o repositório (F5 §2; a falha é externa, 502, e nada é gravado) e os modelos, e grava o
 * cadastro e as etapas numa transação só.
 */
async function conferirEGravar(banco: DatabaseSync, p: z.infer<typeof DoFormulario>, gravar: typeof registrarProjeto) {
  const { configuracoes, preparacao, ...cadastro } = p;
  const { hospedagem } = await conferirProjeto(cadastro).catch((error_: unknown) => {
    throw new ErroHttp(502, mensagem(error_));
  });
  await conferirModelosAlterados(banco, p.nome, configuracoes);
  return escrever(banco, () => {
    // A chave do SonarQube é da configuração SDLC, que a edita; o cadastro começa com o nome do projeto.
    const salvo = gravar(banco, {
      ...cadastro,
      hospedagem,
      chave_sonarqube: p.nome,
      etapas: etapasDoFormulario(configuracoes),
      verificacoes: { preparacao },
    });
    return comConfiguracoes(salvo);
  });
}

/**
 * O cadastro e só ele fixa o cursor inicial da base (F6 §4.4); a edição não varre. A varredura que falha só vai para o
 * log: o agendador a refaz no dia seguinte.
 */
async function cadastrar(banco: DatabaseSync, p: z.infer<typeof DoFormulario>) {
  const salvo = await conferirEGravar(banco, p, registrarProjeto);
  await varrerCommitsHumanos(banco, salvo.nome).catch(noLog);
  return salvo;
}

export const ROTAS_DA_CONFIGURACAO: Rota[] = [
  { metodo: "GET", caminho: "/api/configuracao", tratar: ({ banco, agendador }) => estado(banco, agendador) },
  {
    metodo: "POST",
    caminho: "/api/configuracao",
    tratar: async ({ banco, agendador, corpo }) => {
      const nova = Configuracao.parse(corpo);
      const modelo = nova.modeloAuditoria;
      const gravado = configuracao(banco).modeloAuditoria;
      if (modelo && (modelo.provedor !== gravado?.provedor || modelo.nome !== gravado.nome)) {
        await new HarnessPi().conferirModelo(modelo).catch((error_: unknown) => {
          throw new z.ZodError([
            { code: "custom", path: ["modeloAuditoria"], message: mensagem(error_), input: modelo },
          ]);
        });
      }
      salvarConfiguracao(banco, nova);
      return estado(banco, agendador);
    },
  },
  { metodo: "GET", caminho: "/api/ambiente", tratar: ({ banco }) => estadoDoAmbiente(banco) },
  {
    metodo: "POST",
    caminho: "/api/ambiente",
    tratar: ({ banco, corpo }) => {
      validarESalvarConfiguracaoDoAmbiente(banco, corpo);
      return estadoDoAmbiente(banco);
    },
  },
  {
    metodo: "DELETE",
    caminho: "/api/ambiente/:id",
    tratar: ({ banco, params }) => eliminarAmbienteDoConjunto(banco, String(params.id)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => listarProjetos(banco).map(comConfiguracoes),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return comConfiguracoes(projetoExistente(banco, nome));
    },
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => new HarnessPi().listarModelos() },
  {
    metodo: "POST",
    caminho: "/api/projetos",
    tratar: ({ banco, corpo }) => cadastrar(banco, DoFormulario.parse(corpo)),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params, corpo }) =>
      conferirEGravar(banco, { ...DaEdicao.parse(corpo), nome: String(params.nome) }, editarProjeto),
  },
  {
    metodo: "DELETE",
    caminho: "/api/projetos/:nome",
    tratar: async ({ banco, params }) => {
      const { avisos } = await removerProjeto(banco, String(params.nome));
      return { avisos };
    },
  },
];
