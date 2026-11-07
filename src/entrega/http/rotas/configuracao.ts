// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { mensagem } from "../../../nucleo/erros.ts";
import { ConfiguracaoAgente, type Modelo } from "../../../nucleo/configuracao_agente.ts";
import { EtapaTicket } from "../../../nucleo/primitivos.ts";
import { Hospedagem, Projeto } from "../../../nucleo/projeto.ts";
import { conferirModelo, listarModelos } from "../../../infra/agente/modelos.ts";
import { varrerBase } from "../../../aplicacao/retrabalho.ts";
import { escrever } from "../../../armazenamento/banco.ts";
import { etapasDoProjeto, substituirEtapasDoProjeto } from "../../../armazenamento/configuracao_projeto.ts";
import { noLog } from "../../../infra/registro.ts";
import {
  editarProjeto,
  projetoExistente,
  projetos,
  registrarProjeto,
  removerProjeto,
} from "../../../aplicacao/projeto/cadastro.ts";
import { Configuracao, configuracao, salvarConfiguracao } from "../../../armazenamento/servico.ts";
import { conferirProjeto } from "../../../infra/repositorio/cadastro.ts";
import { ErroHttp } from "../erros.ts";
import type { Agendador, Rota } from "../rotas.ts";

/** A configuração do F4 §3 e o estado do agendador: a próxima busca, só ligado. */
function estado(banco: DatabaseSync, agendador: Agendador) {
  const c = configuracao(banco);
  return { ...c, proximaBusca: c.agendadorAtivo ? agendador.proximaBusca().toISOString() : null };
}

/** O projeto como o formulário manda: a hospedagem, que ele só mostra, é ignorada; o F5 a deduz do remoto. */
const DoFormulario = Projeto.omit({ sonar: true }).extend({
  hospedagem: Hospedagem.optional(),
  /** O modelo e o effort de cada etapa; a etapa ausente usa o padrão do pi. */
  configuracoes: z.partialRecord(EtapaTicket, ConfiguracaoAgente),
});
/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
const DaEdicao = DoFormulario.extend({ nome: z.unknown() });

type Configuracoes = z.infer<typeof DoFormulario>["configuracoes"];

/** As etapas gravadas do projeto no formato do formulário: a configuração do agente de cada etapa que tem uma. */
const configuracoesDoProjeto = (banco: DatabaseSync, nome: string): Configuracoes =>
  Object.fromEntries(
    etapasDoProjeto(banco, nome).flatMap(({ etapa, configuracao_agente }) =>
      configuracao_agente ? [[etapa, configuracao_agente]] : [],
    ),
  );

/** O projeto como o formulário o lê: o cadastro com a configuração do agente de cada etapa. */
const comConfiguracoes = (banco: DatabaseSync, p: Projeto) => ({
  ...p,
  configuracoes: configuracoesDoProjeto(banco, p.nome),
});

/** As linhas de `configuracao_etapa_projeto` do formulário: só as etapas com modelo ou effort escolhido. */
const etapasDoFormulario = (configuracoes: Configuracoes) =>
  EtapaTicket.options.flatMap((etapa) => {
    const configuracao_agente = configuracoes[etapa];
    return configuracao_agente?.modelo || configuracao_agente?.effort ? [{ etapa, configuracao_agente }] : [];
  });

const par = (m: Modelo | undefined): string | undefined => m && `${m.provedor}/${m.nome}`;

/**
 * F4 §9: o modelo novo ou trocado precisa existir no pi; o recusado vira erro do campo (422). O igual ao gravado não
 * chama o pi: o que ele deixou de listar continua salvando sem mexer.
 */
async function conferirModelosAlterados(banco: DatabaseSync, nome: string, configuracoes: Configuracoes) {
  const gravadas = configuracoesDoProjeto(banco, nome);
  const alterados = EtapaTicket.options.flatMap((etapa) => {
    const modelo = configuracoes[etapa]?.modelo;
    return modelo && par(modelo) !== par(gravadas[etapa]?.modelo) ? [{ etapa, modelo }] : [];
  });
  const recusados = (
    await Promise.all(
      alterados.map(({ etapa, modelo }) =>
        conferirModelo(modelo).then(
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
  if (recusados.length > 0) throw new z.ZodError(recusados);
}

/**
 * C19 pelo web: confere o repositório (F5 §2; a falha é externa, 502, e nada é gravado) e os modelos, e grava o
 * cadastro e as etapas numa transação só.
 */
async function conferirEGravar(banco: DatabaseSync, p: z.infer<typeof DoFormulario>, gravar: typeof registrarProjeto) {
  const { configuracoes, ...cadastro } = p;
  const { hospedagem } = await conferirProjeto(cadastro).catch((error_: unknown) => {
    throw new ErroHttp(502, mensagem(error_));
  });
  await conferirModelosAlterados(banco, p.nome, configuracoes);
  return escrever(banco, () => {
    // A chave do SonarQube é da configuração SDLC, que a edita; o cadastro começa com o nome do projeto.
    const salvo = gravar(banco, { ...cadastro, hospedagem, sonar: { projectKey: p.nome } });
    substituirEtapasDoProjeto(banco, salvo.nome, etapasDoFormulario(configuracoes));
    return comConfiguracoes(banco, salvo);
  });
}

/**
 * O cadastro e só ele fixa o cursor inicial da base (F6 §4.4); a edição não varre. A varredura que falha só vai para o
 * log: o agendador a refaz no dia seguinte.
 */
async function cadastrar(banco: DatabaseSync, p: z.infer<typeof DoFormulario>) {
  const salvo = await conferirEGravar(banco, p, registrarProjeto);
  await varrerBase(banco, salvo.nome).catch(noLog);
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
        await conferirModelo(modelo).catch((error_: unknown) => {
          throw new z.ZodError([
            { code: "custom", path: ["modeloAuditoria"], message: mensagem(error_), input: modelo },
          ]);
        });
      }
      salvarConfiguracao(banco, nova);
      return estado(banco, agendador);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/projetos",
    tratar: ({ banco }) => projetos(banco).map((p) => comConfiguracoes(banco, p)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return comConfiguracoes(banco, projetoExistente(banco, nome));
    },
  },
  { metodo: "GET", caminho: "/api/modelos", tratar: () => listarModelos() },
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
