// Agregado da issue, ator e contexto dos comandos (F1 §3.2, §3.4, §3.5, §5).
// Cada comando é uma função pura `(agregado, entrada, ator, contexto) → agregado`; o F2 carrega, aplica e grava.
import { z } from "zod";
import { ErroDeEscopo } from "./erros.ts";
import { Etapa, Fase, Id, Instante, Markdown, Modelo, Slug, Titulo, type TipoId } from "./primitivos.ts";
import type { Projeto } from "./projeto.ts";

/** Quem pede o comando; também é a origem de um ticket (quem o criou). */
export const TipoAtor = z.enum(["auditor", "agente", "fabriquinha"]);

export const Ator = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal(TipoAtor.enum.auditor) }),
  z.object({ tipo: z.literal(TipoAtor.enum.agente), execucao: Id, ticket: Id }),
  z.object({ tipo: z.literal(TipoAtor.enum.fabriquinha) }),
]);

export const TipoIssue = z.enum(["funcionalidade", "problema"]);

export const Issue = z.object({
  id: Id,
  projeto: Slug,
  titulo: Titulo.nullable(),
  tipo: TipoIssue.nullable(),
  descricao: Markdown.default(""),
  fase: Fase,
  deps: z.array(Id).default([]),
  criadaEm: Instante,
  concluidaEm: Instante.optional(),
  arquivadaEm: Instante.optional(),
});

export const StatusTicket = z.enum(["aberto", "em_execucao", "concluido", "falhou"]);

export const Ticket = z.object({
  id: Id,
  issue: Id,
  etapa: Etapa,
  titulo: Titulo,
  descricao: Markdown.default(""),
  status: StatusTicket,
  origem: TipoAtor,
  origemTicket: Id.optional(),
  modelo: Modelo.optional(),
  instrucao: Markdown.optional(),
  erro: z.string().max(2000).optional(),
  criadoEm: Instante,
  concluidoEm: Instante.optional(),
});

export const ModoExecucao = z.enum(["autonomo", "interativo", "consulta"]);
export const ResultadoExecucao = z.enum(["em_andamento", "sucesso", "falha"]);

export const Execucao = z.object({
  id: Id,
  ticket: Id,
  modo: ModoExecucao,
  sessaoPi: z.uuid(),
  modelo: Modelo.optional(),
  resultado: ResultadoExecucao,
  erro: z.string().max(2000).optional(),
  iniciadaEm: Instante,
  terminadaEm: Instante.optional(),
});

export type Ator = z.infer<typeof Ator>;
export type TipoIssue = z.infer<typeof TipoIssue>;
export type Issue = z.infer<typeof Issue>;
export type Ticket = z.infer<typeof Ticket>;
export type ModoExecucao = z.infer<typeof ModoExecucao>;
export type Execucao = z.infer<typeof Execucao>;

/** A issue com o que pertence a ela. Decisões e evidências entram com os tickets que as criam. */
export interface Agregado {
  readonly issue: Issue;
  readonly tickets: readonly Ticket[];
  /** As execuções dos tickets desta issue. */
  readonly execucoes: readonly Execucao[];
}

/**
 * Instante, IDs e fatos externos que o comando consulta. São funções para que só rode a consulta que o comando
 * usa; o F2 as responde dentro da transação do comando (F2 §3.5).
 */
export interface Contexto {
  readonly agora: Instante;
  novoId(tipo: TipoId): Id;
  projeto(nome: string): Projeto | undefined;
  issueExiste(id: Id): boolean;
  /** Issues de que `id` depende, direta ou indiretamente. */
  alcancaveis(id: Id): readonly Id[];
  /** Todas as dependências da issue estão `concluida`. */
  depsConcluidas(issue: Id): boolean;
  /** Há execução autônoma em andamento em qualquer issue (D8). */
  execucaoAutonomaEmAndamento(): boolean;
}

/** Nome gravado na tabela `comando` (F6 §7) para cada comando aplicado por `comIssue`. */
export type NomeComando =
  | "editarIssue"
  | "adicionarDependencia"
  | "removerDependencia"
  | "iniciarExecucao"
  | "terminarExecucao"
  | "falharTicket"
  | "reabrirTicket"
  | "definirModeloTicket"
  | "iniciarConsulta";

export const rotuloIssue = (ag: Agregado): string => `I-${String(ag.issue.id)}`;

export function exigirAuditor(ator: Ator, acao: string): void {
  if (ator.tipo !== "auditor") throw new ErroDeEscopo(`só o Auditor pode ${acao}`, "peça ao Auditor pelo web");
}

export function exigirFabriquinha(ator: Ator, acao: string): void {
  if (ator.tipo !== "fabriquinha") {
    throw new ErroDeEscopo(`só a Fabriquinha pode ${acao}`, "ela faz isso sozinha ao executar o ticket");
  }
}

/**
 * Auditor sempre. Agente só pelo próprio ticket, se ele for desta issue e de uma das `etapas`, e só enquanto a
 * execução dele está em andamento (F1 §3.2). Consulta não conta: ela pergunta, não altera (F4 §6.5).
 */
export function exigirAuditorOuAgente(ag: Agregado, ator: Ator, etapas: readonly Etapa[], acao: string): void {
  if (ator.tipo === "auditor") return;
  const quem = `o Auditor ou o agente de ${etapas.join(", ")} da ${rotuloIssue(ag)}`;
  if (ator.tipo === "fabriquinha") throw new ErroDeEscopo(`a Fabriquinha não pode ${acao}`, `quem pode é ${quem}`);
  const ticket = `T-${String(ator.ticket)}`;
  if (!ag.tickets.some((t) => t.id === ator.ticket && etapas.includes(t.etapa))) {
    throw new ErroDeEscopo(`o agente de ${ticket} não pode ${acao}`, `quem pode é ${quem}`);
  }
  const execucao = `E-${String(ator.execucao)}`;
  const emAndamento = ag.execucoes.find(
    (e) => e.id === ator.execucao && e.ticket === ator.ticket && e.resultado === "em_andamento",
  );
  if (!emAndamento) throw new ErroDeEscopo(`a execução ${execucao} já terminou`, "peça ao Auditor uma nova execução");
  if (emAndamento.modo === "consulta") {
    throw new ErroDeEscopo(
      `a execução ${execucao} é uma consulta, que só pergunta e não pode ${acao}`,
      "peça ao Auditor que faça a mudança",
    );
  }
}
