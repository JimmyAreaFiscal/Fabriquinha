// Rotas da Configuração (F7 §4.2): a configuração do F4 §3 com o estado do agendador, os projetos com o cadastro
// (C19), o modelo e o effort de cada etapa, e os modelos do pi para os seletores.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { encontrado, mensagem } from "../../dominio/erros.ts";
import { Effort, EtapaTicket, Modelo } from "../../dominio/primitivos.ts";
import { Hospedagem, Projeto } from "../../dominio/projeto.ts";
import { conferirModelo, listarModelos } from "../../execucao/modelos.ts";
import { varrerBase } from "../../metricas/retrabalho.ts";
import { escrever, raizDo } from "../../persistencia/banco.ts";
import { etapasDoProjeto, substituirEtapasDoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { noLog } from "../../persistencia/execucoes.ts";
import { editarProjeto, projeto, projetos, registrarProjeto, removerProjeto } from "../../persistencia/projetos.ts";
import { Configuracao, configuracao, salvarConfiguracao } from "../../persistencia/servico.ts";
import { conferirProjeto } from "../../repositorio/cadastro.ts";
import { removerWorktrees } from "../../repositorio/worktree.ts";
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
  modelos: z.partialRecord(EtapaTicket, Modelo),
  efforts: z.partialRecord(EtapaTicket, Effort),
});
/** O nome é a chave e não muda (C19): o do caminho vale, e o do corpo é ignorado. */
const DaEdicao = DoFormulario.extend({ nome: z.unknown() });

type ModelosEEfforts = Pick<z.infer<typeof DoFormulario>, "modelos" | "efforts">;

/** As etapas gravadas do projeto no formato do formulário: o modelo e o effort, cada um pela etapa. */
function modelosEEffortsDoProjeto(banco: DatabaseSync, nome: string): ModelosEEfforts {
  const modelos: ModelosEEfforts["modelos"] = {};
  const efforts: ModelosEEfforts["efforts"] = {};
  for (const e of etapasDoProjeto(banco, nome)) {
    if (e.modelo_provedor !== undefined && e.modelo_nome !== undefined)
      modelos[e.etapa] = { provedor: e.modelo_provedor, modelo: e.modelo_nome };
    if (e.effort !== undefined) efforts[e.etapa] = e.effort;
  }
  return { modelos, efforts };
}

/** O projeto como o formulário o lê: o cadastro com o modelo e o effort de cada etapa. */
const comModelosEEfforts = (banco: DatabaseSync, p: Projeto) => ({ ...p, ...modelosEEffortsDoProjeto(banco, p.nome) });

/** As linhas de `configuracao_etapa_projeto` do formulário: só as etapas com modelo ou effort escolhido. */
const etapasDoFormulario = ({ modelos, efforts }: ModelosEEfforts) =>
  EtapaTicket.options.flatMap((etapa) => {
    const modelo = modelos[etapa];
    const effort = efforts[etapa];
    if (!modelo && !effort) return [];
    return [{ etapa, modelo_provedor: modelo?.provedor, modelo_nome: modelo?.modelo, effort }];
  });

const par = (m: Modelo | undefined): string | undefined => m && `${m.provedor}/${m.modelo}`;

/**
 * F4 §9: o modelo novo ou trocado precisa existir no pi; o recusado vira erro do campo (422). O igual ao gravado não
 * chama o pi: o que ele deixou de listar continua salvando sem mexer.
 */
async function conferirModelosAlterados(banco: DatabaseSync, nome: string, modelos: ModelosEEfforts["modelos"]) {
  const gravados = modelosEEffortsDoProjeto(banco, nome).modelos;
  const alterados = EtapaTicket.options.flatMap((etapa) => {
    const modelo = modelos[etapa];
    return modelo && par(modelo) !== par(gravados[etapa]) ? [{ etapa, modelo }] : [];
  });
  const recusados = (
    await Promise.all(
      alterados.map(({ etapa, modelo }) =>
        conferirModelo(modelo).then(
          () => [],
          (error_: unknown) => [
            { code: "custom" as const, path: ["modelos", etapa], message: mensagem(error_), input: modelo },
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
  const { modelos, efforts, ...cadastro } = p;
  const { hospedagem } = await conferirProjeto(cadastro).catch((error_: unknown) => {
    throw new ErroHttp(502, mensagem(error_));
  });
  await conferirModelosAlterados(banco, p.nome, modelos);
  return escrever(banco, () => {
    // A chave do SonarQube é da configuração SDLC, que a edita; o cadastro começa com o nome do projeto.
    const salvo = gravar(banco, { ...cadastro, hospedagem, sonar: { projectKey: p.nome } });
    substituirEtapasDoProjeto(banco, salvo.nome, etapasDoFormulario({ modelos, efforts }));
    return comModelosEEfforts(banco, salvo);
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
      if (modelo && (modelo.provedor !== gravado?.provedor || modelo.modelo !== gravado.modelo)) {
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
    tratar: ({ banco }) => projetos(banco).map((p) => comModelosEEfforts(banco, p)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome",
    tratar: ({ banco, params }) => {
      const nome = String(params.nome);
      return comModelosEEfforts(
        banco,
        encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, "confira o nome do projeto"),
      );
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
      const { projeto: p, avisos } = await removerProjeto(banco, String(params.nome));
      return { avisos: [...avisos, ...(await removerWorktrees(raizDo(banco), p))] };
    },
  },
];
