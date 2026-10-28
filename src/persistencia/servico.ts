// Configuração do serviço e as consultas do agendador e do reinício (F4 §3, §4, §4.1, §7, §10).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ErroDeRegra } from "../dominio/erros.ts";
import { Id, Modelo } from "../dominio/primitivos.ts";

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

/** Limite global de paralelismo (D04): todas as demandas juntas. Fora de `Configuracao`, que a web grava inteira. */
export const limiteParalelismo = (banco: DatabaseSync): number =>
  (banco.prepare("SELECT limite_paralelismo FROM configuracao").get() as { limite_paralelismo: number })
    .limite_paralelismo;

export function alterarLimiteParalelismo(banco: DatabaseSync, n: number): void {
  if (!Id.safeParse(n).success)
    throw new ErroDeRegra(`limite de paralelismo inválido: ${String(n)}`, "use um inteiro maior que zero");
  banco.prepare("UPDATE configuracao SET limite_paralelismo = ?").run(n);
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
