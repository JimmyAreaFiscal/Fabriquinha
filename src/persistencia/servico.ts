// Configuração do serviço (F4 §3, §10).
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
