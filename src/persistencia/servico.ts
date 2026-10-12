// Configuração do serviço e as consultas do agendador e do reinício (F4 §3, §4, §4.1, §7, §10).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { Id } from "../dominio/primitivos.ts";

export const Configuracao = z.object({
  agendadorAtivo: z.boolean().default(false),
  intervaloMin: z.number().int().min(1).max(1440).default(5),
  timeoutMin: z.number().int().min(10).max(1440).default(120),
  ociosidadeMin: z.number().int().min(5).max(1440).default(30),
});
export type Configuracao = z.infer<typeof Configuracao>;

/** As etapas que rodam em modo autônomo (F1 §3.6); as fases delas têm o mesmo nome (F1 §4.3). */
const AUTONOMAS = "('desenho','desenvolvimento','revisao','encerramento')";

export function configuracao(banco: DatabaseSync): Configuracao {
  const l = banco.prepare("SELECT * FROM configuracao").get() as Record<string, number>;
  return {
    agendadorAtivo: l.agendador_ativo === 1,
    intervaloMin: Number(l.intervalo_min),
    timeoutMin: Number(l.timeout_min),
    ociosidadeMin: Number(l.ociosidade_min),
  };
}

/** Grava a configuração inteira; campo ausente volta ao padrão. */
export function salvarConfiguracao(banco: DatabaseSync, entrada: unknown): Configuracao {
  const c = Configuracao.parse(entrada);
  banco
    .prepare("UPDATE configuracao SET agendador_ativo = ?, intervalo_min = ?, timeout_min = ?, ociosidade_min = ?")
    .run(Number(c.agendadorAtivo), c.intervaloMin, c.timeoutMin, c.ociosidadeMin);
  return c;
}

/**
 * F4 §4.1: o próximo ticket autônomo elegível, da issue mais antiga e, nela, o mais antigo. Além da consulta da
 * spec, pula a issue com execução em andamento (consulta inclusive) ou com ticket em execução: C5 a recusaria, e o
 * agendador escolheria o mesmo ticket a cada ciclo, sem chegar às outras issues.
 */
export function ticketElegivel(banco: DatabaseSync): Id | undefined {
  const linha = banco
    .prepare(
      `SELECT t.id FROM ticket t JOIN issue i ON i.id = t.issue
       WHERE t.status = 'aberto'
         AND t.etapa IN ${AUTONOMAS}
         AND i.fase = t.etapa
         AND i.arquivada_em IS NULL
         AND NOT EXISTS (SELECT 1 FROM issue_dep d JOIN issue x ON x.id = d.dep
                         WHERE d.issue = i.id AND x.fase <> 'concluida')
         AND NOT EXISTS (SELECT 1 FROM ticket o LEFT JOIN execucao e ON e.ticket = o.id
                         WHERE o.issue = i.id AND (o.status = 'em_execucao' OR e.resultado = 'em_andamento'))
       ORDER BY i.id, t.id
       LIMIT 1`,
    )
    .get();
  return linha && Number(linha.id);
}

/** A execução autônoma em andamento, que ocupa a vaga do D8. */
export function autonomaEmAndamento(banco: DatabaseSync): { execucao: Id; ticket: Id } | undefined {
  const linha = banco
    .prepare("SELECT id, ticket FROM execucao WHERE modo = 'autonomo' AND resultado = 'em_andamento'")
    .get();
  return linha && { execucao: Number(linha.id), ticket: Number(linha.ticket) };
}

/** F4 §7: as execuções em andamento, com a issue e o grupo de processos do pi. */
export const execucoesEmAndamento = (banco: DatabaseSync): { id: Id; issue: Id; pgid: number | null }[] =>
  banco
    .prepare(
      `SELECT e.id, t.issue, e.pgid_pi AS pgid FROM execucao e JOIN ticket t ON t.id = e.ticket
       WHERE e.resultado = 'em_andamento' ORDER BY e.id`,
    )
    .all()
    .map((l) => ({ id: Number(l.id), issue: Number(l.issue), pgid: l.pgid === null ? null : Number(l.pgid) }));

/** Tickets autônomos `em_execucao`; sem execução em andamento, nada mais os tira desse estado (F4 §7). */
export const ticketsAutonomosEmExecucao = (banco: DatabaseSync): { id: Id; issue: Id }[] =>
  banco
    .prepare(`SELECT id, issue FROM ticket WHERE status = 'em_execucao' AND etapa IN ${AUTONOMAS} ORDER BY id`)
    .all()
    .map((l) => ({ id: Number(l.id), issue: Number(l.issue) }));
