// O período de meses das Métricas (F6 §5.7): o mês é o do fuso do serviço (o do processo); os instantes continuam em
// UTC no banco (F2 §3.6).
import { z } from "zod";
import { Slug } from "./primitivos.ts";
import { inicioDoMes } from "./relogio.ts";

export const Mes = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/); // AAAA-MM; o `Date` do JS leva os anos 0 a 99 para 1900

/** O filtro das visões: de `de` até `ate`, inclusive; sem `projeto`, todos. */
export const Periodo = z
  .object({ projeto: Slug.optional(), de: Mes, ate: Mes })
  .refine((p) => p.de <= p.ate, "`de` não pode ser depois de `ate`");

export type Periodo = z.input<typeof Periodo>;

/** Um mês do fuso do serviço como o intervalo `[inicio, fim)` de instantes UTC, no formato gravado no banco. */
interface Intervalo {
  mes: string;
  inicio: string;
  fim: string;
}

/** O mês `AAAA-MM` de um instante, no fuso do serviço. */
export const mesDe = (d: Date): string => `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** O mês `AAAA-MM` deslocado de `n` meses, com o intervalo de instantes UTC das suas meias-noites no fuso do serviço. */
export function intervalo(mes: string, n = 0): Intervalo {
  const [ano = 0, m = 0] = mes.split("-").map(Number);
  const mesesDesdeOAnoZero = ano * 12 + (m - 1 + n);
  const anoDeslocado = Math.floor(mesesDesdeOAnoZero / 12);
  const mesDeslocado = (mesesDesdeOAnoZero % 12) + 1;
  return {
    mes: `${String(anoDeslocado).padStart(4, "0")}-${String(mesDeslocado).padStart(2, "0")}`,
    inicio: inicioDoMes(anoDeslocado, mesDeslocado),
    fim: inicioDoMes(anoDeslocado, mesDeslocado + 1),
  };
}

/** O mês `n` meses depois de `mes` (antes, com `n` negativo). */
export const somarMeses = (mes: string, n: number): string => intervalo(mes, n).mes;
