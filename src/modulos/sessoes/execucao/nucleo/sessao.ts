// A Sessão e as execuções dela (MELHORIAS §9, regras 1 a 3). A sessão é a conversa com o agente (tabela
// `trabalho_agentico`); cada execução é um processo do harness que a continua (`processo_do_trabalho`); as chamadas ao
// modelo dentro de uma execução não têm registro próprio: o Uso delas fica somado por execução e modelo. O contexto da
// demanda e do ticket chega como identificador opaco de correlação. Funções puras sobre arrays: quem chama persiste.
import { z } from "zod";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { Id, Instante } from "../../../../shared/nucleo/primitivos.ts";
import { ModoTrabalho } from "../../harness/publico.ts";
import { ConfiguracaoDoModelo } from "../../modelos/publico.ts";

/** A identificação da sessão (`trabalho_agentico.id`). */
export type IdDaSessao = string;
/** A identificação de uma execução, o processo do harness (`processo_do_trabalho.id`); é distinta da sessão. */
export type IdDaExecucao = string;

const IdTexto = z.string().trim().min(1);

/** A correlação com quem pediu a sessão: identificadores opacos, que Sessões só guarda e filtra. */
export const ContextoDaSessao = z.object({ demanda_id: IdTexto, ticket_id: Id });
export type ContextoDaSessao = z.infer<typeof ContextoDaSessao>;

export const Sessao = ContextoDaSessao.extend({
  id: IdTexto,
  modo: ModoTrabalho,
  conversa_referencia: IdTexto,
});
export type Sessao = z.infer<typeof Sessao>;

export const Execucao = z.object({
  id: IdTexto,
  /** A sessão que a execução continua. */
  trabalho_id: IdTexto,
  inicio: Instante,
  fim: Instante.nullish(),
  /** Só vale com `fim`: false é sucesso, true é falha. */
  falha: z.boolean(),
  /** Grupo de processo do harness, para o reinício do serviço interrompê-lo. */
  grupo_processo: Id.optional(),
  /** Modelo e effort com que a execução rodou, escolhidos pela política. */
  configuracao_agente: ConfiguracaoDoModelo.optional(),
});
export type Execucao = z.infer<typeof Execucao>;

export const criarSessao = (sessoes: readonly Sessao[], nova: Sessao): Sessao[] => {
  const sessao = Sessao.parse(nova);
  if (sessoes.some((s) => s.id === sessao.id)) throw new ErroDeRegra(`sessão ${sessao.id} já existe`, "use outro id");
  return [...sessoes, sessao];
};

/** Fim null ou omitido é execução não encerrada. */
const estaAberta = (execucao: Execucao): boolean => execucao.fim == null;

const abrirExecucao = (
  sessoes: readonly Sessao[],
  execucoes: readonly Execucao[],
  nova: Execucao,
  ehRetomada: boolean,
) => {
  const execucao = Execucao.parse(nova);
  const daSessao = execucoes.filter((e) => e.trabalho_id === execucao.trabalho_id);
  if (!sessoes.some((s) => s.id === execucao.trabalho_id))
    throw new ErroDeRegra(`sessão ${execucao.trabalho_id} não existe`);
  if (ehRetomada && daSessao.length === 0)
    throw new ErroDeRegra(`sessão ${execucao.trabalho_id} não tem execução a retomar`, "inicie uma");
  if (execucoes.some((e) => e.id === execucao.id))
    throw new ErroDeRegra(`execução ${execucao.id} já existe`, "use outro id");
  if (daSessao.some(estaAberta))
    throw new ErroDeRegra(`sessão ${execucao.trabalho_id} já tem execução sem fim`, "encerre-a antes");
  return [...execucoes, execucao];
};

export const iniciarExecucao = (sessoes: readonly Sessao[], execucoes: readonly Execucao[], nova: Execucao) =>
  abrirExecucao(sessoes, execucoes, nova, false);

/** Execução nova (id distinto) na mesma sessão; `conversa_referencia` fica na sessão, que não muda. */
export const retomarSessao = (sessoes: readonly Sessao[], execucoes: readonly Execucao[], nova: Execucao) =>
  abrirExecucao(sessoes, execucoes, nova, true);

export const encerrarExecucao = (
  execucoes: readonly Execucao[],
  id: IdDaExecucao,
  fim: string,
  falha: boolean,
): Execucao[] => {
  const alvo = execucoes.find((e) => e.id === id);
  if (!alvo) throw new ErroDeRegra(`execução ${id} não existe`);
  if (!estaAberta(alvo)) throw new ErroDeRegra(`execução ${id} já foi encerrada`);
  const encerrada = Execucao.parse({ ...alvo, fim, falha });
  return execucoes.map((e) => (e.id === id ? encerrada : e));
};
