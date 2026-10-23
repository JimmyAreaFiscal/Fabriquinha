// Sessão, execução da sessão e uso por modelo (comparacao-sdlc-implementacao.md §7.3). Funções puras sobre arrays:
// quem chama persiste o resultado. `ExecucaoSessao` não substitui a `Execucao` legada de agregado.ts.
import { z } from "zod";
import { ModoExecucao } from "./agregado.ts";
import { TicketRef } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import { Instante, Motivo } from "./primitivos.ts";

const IdTexto = z.string().trim().min(1);
const Tokens = z.number().int().nonnegative();

export const Sessao = TicketRef.extend({
  id: IdTexto,
  modo: ModoExecucao,
  conversa_referencia: IdTexto,
});

export const ExecucaoSessao = z.object({
  id: IdTexto,
  sessao_id: IdTexto,
  inicio: Instante,
  fim: Instante.optional(),
  falha: Motivo.optional(),
});

/** Tokens e custo pertencem ao uso da execução, nunca à sessão. `custo` ausente é desconhecido, não zero. */
export const UsoModeloExecucao = z.object({
  execucao_id: IdTexto,
  modelo_provedor: IdTexto,
  modelo_nome: IdTexto,
  tokens_entrada: Tokens,
  tokens_saida: Tokens,
  tokens_cache_leitura: Tokens,
  tokens_cache_escrita: Tokens,
  custo: z.number().nonnegative().optional(),
});

export type Sessao = z.infer<typeof Sessao>;
export type ExecucaoSessao = z.infer<typeof ExecucaoSessao>;
export type UsoModeloExecucao = z.infer<typeof UsoModeloExecucao>;
export type EstadoExecucaoSessao = "em_andamento" | "sucesso" | "falha";

export interface TotalUso {
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  /** Soma só dos custos conhecidos. */
  custo_conhecido: number;
  /** Algum uso somado está sem custo: `custo_conhecido` é um piso, não o total. */
  custo_incompleto: boolean;
}

export const criarSessao = (sessoes: readonly Sessao[], nova: Sessao): Sessao[] => {
  const sessao = Sessao.parse(nova);
  if (sessoes.some((s) => s.id === sessao.id)) throw new ErroDeRegra(`sessão ${sessao.id} já existe`, "use outro id");
  return [...sessoes, sessao];
};

/** Fim ausente é não encerrada: `falha` sozinha não indica sucesso. */
export const estadoExecucao = (e: ExecucaoSessao): EstadoExecucaoSessao =>
  e.fim === undefined ? "em_andamento" : e.falha === undefined ? "sucesso" : "falha";

const abrir = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  nova: ExecucaoSessao,
  retomada: boolean,
) => {
  const exec = ExecucaoSessao.parse(nova);
  const daSessao = execucoes.filter((e) => e.sessao_id === exec.sessao_id);
  if (!sessoes.some((s) => s.id === exec.sessao_id)) throw new ErroDeRegra(`sessão ${exec.sessao_id} não existe`);
  if (retomada && daSessao.length === 0)
    throw new ErroDeRegra(`sessão ${exec.sessao_id} não tem execução a retomar`, "inicie uma");
  if (execucoes.some((e) => e.id === exec.id)) throw new ErroDeRegra(`execução ${exec.id} já existe`, "use outro id");
  if (daSessao.some((e) => e.fim === undefined))
    throw new ErroDeRegra(`sessão ${exec.sessao_id} já tem execução sem fim`, "encerre-a antes");
  return [...execucoes, exec];
};

export const iniciarExecucao = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  nova: ExecucaoSessao,
) => abrir(sessoes, execucoes, nova, false);

/** Execução nova (id distinto) na mesma sessão; `conversa_referencia` fica na sessão, que não muda. */
export const retomarSessao = (sessoes: readonly Sessao[], execucoes: readonly ExecucaoSessao[], nova: ExecucaoSessao) =>
  abrir(sessoes, execucoes, nova, true);

export const encerrarExecucao = (
  execucoes: readonly ExecucaoSessao[],
  id: string,
  fim: string,
  falha?: string,
): ExecucaoSessao[] => {
  const alvo = execucoes.find((e) => e.id === id);
  if (!alvo) throw new ErroDeRegra(`execução ${id} não existe`);
  if (alvo.fim !== undefined) throw new ErroDeRegra(`execução ${id} já foi encerrada`);
  const encerrada = ExecucaoSessao.parse({ ...alvo, fim, falha });
  return execucoes.map((e) => (e.id === id ? encerrada : e));
};

const mesmaChave = (a: UsoModeloExecucao, b: UsoModeloExecucao): boolean =>
  a.execucao_id === b.execucao_id && a.modelo_provedor === b.modelo_provedor && a.modelo_nome === b.modelo_nome;

/** Registrar de novo a mesma chave substitui o uso, não soma. */
export const registrarUso = (usos: readonly UsoModeloExecucao[], uso: UsoModeloExecucao): UsoModeloExecucao[] => {
  const novo = UsoModeloExecucao.parse(uso);
  return [...usos.filter((u) => !mesmaChave(u, novo)), novo];
};

/** Soma os usos das execuções das sessões dadas; cada chave conta uma vez, mesmo em sessões retomadas. */
export const totalDeSessoes = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
): TotalUso => {
  const ids = new Set(sessoes.map((s) => s.id));
  const execs = new Set(execucoes.filter((e) => ids.has(e.sessao_id)).map((e) => e.id));
  const unicos = usos.reduce<UsoModeloExecucao[]>((acc, u) => registrarUso(acc, u), []);
  const total: TotalUso = {
    tokens_entrada: 0,
    tokens_saida: 0,
    tokens_cache_leitura: 0,
    tokens_cache_escrita: 0,
    custo_conhecido: 0,
    custo_incompleto: false,
  };
  for (const u of unicos.filter((u) => execs.has(u.execucao_id))) {
    total.tokens_entrada += u.tokens_entrada;
    total.tokens_saida += u.tokens_saida;
    total.tokens_cache_leitura += u.tokens_cache_leitura;
    total.tokens_cache_escrita += u.tokens_cache_escrita;
    if (u.custo === undefined) total.custo_incompleto = true;
    else total.custo_conhecido += u.custo;
  }
  return total;
};

export const totalDaSessao = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
  id: string,
) =>
  totalDeSessoes(
    sessoes.filter((s) => s.id === id),
    execucoes,
    usos,
  );

export const totalDoTicket = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
  ticket: z.infer<typeof TicketRef>,
) =>
  totalDeSessoes(
    sessoes.filter((s) => s.demanda_id === ticket.demanda_id && s.ticket_id === ticket.ticket_id),
    execucoes,
    usos,
  );

export const totalDaDemanda = (
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
  demandaId: string,
) =>
  totalDeSessoes(
    sessoes.filter((s) => s.demanda_id === demandaId),
    execucoes,
    usos,
  );
