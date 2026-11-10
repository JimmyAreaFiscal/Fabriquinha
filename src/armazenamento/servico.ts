// Configuração do serviço (F4 §3, §10).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { Modelo } from "../nucleo/configuracao_agente.ts";
import { ConfiguracaoDoAmbiente } from "../nucleo/projeto.ts";

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
        : { provedor: String(l.auditoria_provedor), nome: String(l.auditoria_modelo) },
  };
}

/** Limite global de paralelismo (D04): todas as demandas juntas. Fora de `Configuracao`, que a web grava inteira. */
export const limiteParalelismo = (banco: DatabaseSync): number =>
  (banco.prepare("SELECT limite_paralelismo FROM configuracao").get() as { limite_paralelismo: number })
    .limite_paralelismo;

/** Grava a configuração inteira, já validada pela aplicação. */
export function salvarConfiguracao(banco: DatabaseSync, c: Configuracao): Configuracao {
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
      c.modeloAuditoria?.nome ?? null,
    );
  return c;
}

/**
 * O Ambiente em que o trabalho roda e os limites de cada container. Fora de `Configuracao`, que a web grava inteira.
 * @testes o consumidor de produção é o conjunto de Ambientes, de outro ticket da I-286.R1
 */
export function configuracaoDoAmbiente(banco: DatabaseSync): ConfiguracaoDoAmbiente {
  const l = banco
    .prepare(
      `SELECT ambiente_tipo, ambiente_memoria_maxima_mb, ambiente_cpus, ambiente_ociosidade_para_eliminar_min
       FROM configuracao`,
    )
    .get() as Record<string, number | string>;
  return ConfiguracaoDoAmbiente.parse({
    tipo: l.ambiente_tipo,
    memoria_maxima_mb: l.ambiente_memoria_maxima_mb,
    cpus: l.ambiente_cpus,
    ociosidade_para_eliminar_min: l.ambiente_ociosidade_para_eliminar_min,
  });
}

/**
 * Grava a configuração do Ambiente inteira, já validada pela aplicação.
 */
export function salvarConfiguracaoDoAmbiente(banco: DatabaseSync, a: ConfiguracaoDoAmbiente): ConfiguracaoDoAmbiente {
  banco
    .prepare(
      `UPDATE configuracao SET ambiente_tipo = ?, ambiente_memoria_maxima_mb = ?, ambiente_cpus = ?,
         ambiente_ociosidade_para_eliminar_min = ?`,
    )
    .run(a.tipo, a.memoria_maxima_mb, a.cpus, a.ociosidade_para_eliminar_min);
  return a;
}
