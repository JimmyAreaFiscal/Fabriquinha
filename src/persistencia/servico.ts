// Configuração do serviço e as consultas do agendador e do reinício (F4 §3, §4, §4.1, §7, §10).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { type Id, Modelo } from "../dominio/primitivos.ts";

export const Configuracao = z.strictObject({
  agendadorAtivo: z.boolean().default(false),
  intervaloMin: z.number().int().min(1).max(1440).default(5),
  timeoutMin: z.number().int().min(10).max(1440).default(120),
  ociosidadeMin: z.number().int().min(5).max(1440).default(30),
  modeloAuditoria: Modelo.nullable().default(null),
});
export type Configuracao = z.infer<typeof Configuracao>;

/** As etapas que rodam em modo autônomo (F1 §3.6); as fases delas têm o mesmo nome (F1 §4.3). */
const AUTONOMAS = "('desenvolvimento','revisao','encerramento')";
/** As etapas que o agendador inicia (F4 §4): as autônomas e o desenho, que é interativo. */
const AGENDADAS = "('desenho','desenvolvimento','revisao','encerramento')";

export function configuracao(banco: DatabaseSync): Configuracao {
  const l = banco.prepare("SELECT * FROM configuracao").get() as Record<string, number | string | null>;
  return {
    agendadorAtivo: l.agendador_ativo === 1,
    intervaloMin: Number(l.intervalo_min),
    timeoutMin: Number(l.timeout_min),
    ociosidadeMin: Number(l.ociosidade_min),
    modeloAuditoria:
      l.auditoria_provedor === null
        ? null
        : { provedor: String(l.auditoria_provedor), modelo: String(l.auditoria_modelo) },
  };
}

/** Grava a configuração inteira; campo ausente volta ao padrão. */
export function salvarConfiguracao(banco: DatabaseSync, entrada: unknown): Configuracao {
  const c = Configuracao.parse(entrada);
  banco
    .prepare(
      `UPDATE configuracao SET agendador_ativo = ?, intervalo_min = ?, timeout_min = ?, ociosidade_min = ?,
         auditoria_provedor = ?, auditoria_modelo = ?`,
    )
    .run(
      Number(c.agendadorAtivo),
      c.intervaloMin,
      c.timeoutMin,
      c.ociosidadeMin,
      c.modeloAuditoria?.provedor ?? null,
      c.modeloAuditoria?.modelo ?? null,
    );
  return c;
}

/**
 * F4 §4.1: os tickets elegíveis do agendador, um por issue (o mais antigo dela), da issue mais antiga à mais nova; com
 * `issue`, só o dela (o **Executar agora** da página da issue, F7 §4.4). Além da consulta da spec, pula a issue com
 * execução em andamento (consulta inclusive), com ticket em execução ou com ticket da fase que falhou: C5 a recusaria.
 */
export function ticketsElegiveis(banco: DatabaseSync, issue?: Id): Id[] {
  return banco
    .prepare(
      `SELECT min(t.id) AS id FROM ticket t JOIN issue i ON i.id = t.issue
       WHERE t.status = 'aberto'
         AND t.etapa IN ${AGENDADAS}
         AND i.fase = t.etapa
         AND i.arquivada_em IS NULL
         AND ($issue IS NULL OR i.id = $issue)
         AND NOT EXISTS (SELECT 1 FROM issue_dep d JOIN issue x ON x.id = d.dep
                         WHERE d.issue = i.id AND x.fase <> 'concluida')
         AND NOT EXISTS (SELECT 1 FROM ticket o LEFT JOIN execucao e ON e.ticket = o.id
                         WHERE o.issue = i.id AND (o.status = 'em_execucao' OR e.resultado = 'em_andamento'))
         AND NOT EXISTS (SELECT 1 FROM ticket f WHERE f.issue = i.id AND f.etapa = i.fase AND f.status = 'falhou')
       GROUP BY i.id
       ORDER BY i.id`,
    )
    .all({ issue: issue ?? null })
    .map((l) => Number(l.id));
}

/** As execuções autônomas em andamento (uma por issue), da mais antiga à mais nova, com o ticket, a issue e quando começaram. */
export const autonomasEmAndamento = (
  banco: DatabaseSync,
): { execucao: Id; ticket: Id; issue: Id; iniciadaEm: string }[] =>
  banco
    .prepare(
      `SELECT e.id, e.ticket, t.issue, e.iniciada_em FROM execucao e JOIN ticket t ON t.id = e.ticket
       WHERE e.modo = 'autonomo' AND e.resultado = 'em_andamento' ORDER BY e.id`,
    )
    .all()
    .map((l) => ({
      execucao: Number(l.id),
      ticket: Number(l.ticket),
      issue: Number(l.issue),
      iniciadaEm: String(l.iniciada_em),
    }));

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
