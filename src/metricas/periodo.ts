// Visão por mês e por issue num período de meses (F6 §5.7, §5.8): leituras sobre fatos já gravados, sem mudar estado.
// O mês é o do fuso do serviço (o do processo); os instantes continuam em UTC no banco (F2 §3.6).
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { GateDecisao } from "../dominio/agregado.ts";
import { Etapa, Fase, Id, Slug, Titulo } from "../dominio/primitivos.ts";
import {
  execucoesPorMes,
  type Fato,
  fatosPorMes,
  type Intervalo,
  issuesNoPeriodo,
  usoPorMes,
} from "../persistencia/metricas.ts";
import { Consumo, ConsumoModelo, consumo, consumoDe, ETAPA_DO_GATE, Inteiro, Nota } from "./issue.ts";

export const Mes = z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/); // AAAA-MM; o `Date` do JS leva os anos 0 a 99 para 1900

/** O filtro das duas visões: de `de` até `ate`, inclusive; sem `projeto`, todos. */
export const Periodo = z
  .object({ projeto: Slug.optional(), de: Mes, ate: Mes })
  .refine((p) => p.de <= p.ate, "`de` não pode ser depois de `ate`");

const Apoio = { execucoes: Inteiro, falhas: Inteiro, reprovacoes: Inteiro, duracaoMs: Inteiro };

export const MetricasMes = z.object({
  mes: Mes,
  projeto: Slug.nullable(), // null = todos os projetos
  consumo: Consumo, // M1 somado: autônomas, interativas e consultas
  modelos: z.array(ConsumoModelo),
  issues: z.object({ registradas: Inteiro, concluidas: Inteiro }),
  tickets: z.object({ criados: Inteiro, concluidos: Inteiro }),
  prs: z.object({ abertos: Inteiro, mergeados: Inteiro }),
  notaPR: z.object({ media: z.number().min(1).max(5).nullable(), notas: Inteiro }), // M7; null se não houve nota
  etapas: z.array(Consumo.extend({ etapa: Etapa, ...Apoio })), // "Por etapa" da página de métricas
});

export const MetricasIssuePeriodo = z.object({
  issue: Id,
  projeto: Slug,
  titulo: Titulo.nullable(),
  fase: Fase,
  consumo: Consumo, // só as execuções iniciadas no período
  ...Apoio,
  notaPR: Nota.nullable(), // a nota do encerramento, de qualquer data; null se a issue não foi encerrada
});

export type Periodo = z.input<typeof Periodo>;
export type MetricasMes = z.infer<typeof MetricasMes>;
export type MetricasIssuePeriodo = z.infer<typeof MetricasIssuePeriodo>;

/** O mês `AAAA-MM` de um instante, no fuso do serviço. */
export const mesDe = (d: Date): string => `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** O mês `AAAA-MM` deslocado de `n` meses, com o intervalo de instantes UTC das suas meias-noites no fuso do serviço. */
export function intervalo(mes: string, n = 0): Intervalo {
  const [ano = 0, m = 0] = mes.split("-").map(Number);
  const inicio = new Date(ano, m - 1 + n, 1);
  return { mes: mesDe(inicio), inicio: inicio.toISOString(), fim: new Date(ano, m + n, 1).toISOString() };
}

/** O mês `AAAA-MM` por extenso, em português: `setembro de 2026`. */
export const mesPorExtenso = (mes: string): string =>
  new Date(`${mes}-01T12:00:00`).toLocaleString("pt-BR", { month: "long", year: "numeric" });

/** O mês `n` meses depois de `mes` (antes, com `n` negativo). */
export const somarMeses = (mes: string, n: number): string => intervalo(mes, n).mes;

/** Os meses de `de` a `ate`, inclusive. */
function intervalos(de: string, ate: string): Intervalo[] {
  const lista: Intervalo[] = [];
  for (let i = intervalo(de); i.mes <= ate; i = intervalo(de, lista.length)) lista.push(i);
  return lista;
}

/**
 * F6 §5.7: consumo e volume de trabalho de cada mês de `de` a `ate`, de um projeto ou de todos. As etapas são as
 * 6, sempre, e contam só as execuções autônomas e interativas, como no relatório da issue (§6.2); as consultas
 * entram no `consumo` e nos `modelos` do mês.
 */
export function metricasPorMes(banco: DatabaseSync, filtro: Periodo): MetricasMes[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const meses = intervalos(de, ate);
  const uso = Map.groupBy(usoPorMes(banco, meses, projeto), (l) => l.mes);
  const execucoes = new Map(execucoesPorMes(banco, meses, projeto).map((l) => [`${l.mes} ${l.etapa}`, l]));
  const fatos = new Map(fatosPorMes(banco, meses, projeto).map((l) => [`${l.mes} ${l.fato}`, l]));

  return meses.map(({ mes }) => {
    const n = (fato: Fato) => fatos.get(`${mes} ${fato}`)?.n ?? 0;
    const mergeados = fatos.get(`${mes} prsMergeados`);
    const { modelos, ...total } = consumo(uso.get(mes) ?? []);
    return MetricasMes.parse({
      mes,
      projeto,
      consumo: total,
      modelos,
      issues: { registradas: n("issuesRegistradas"), concluidas: n("issuesConcluidas") },
      tickets: { criados: n("ticketsCriados"), concluidos: n("ticketsConcluidos") },
      prs: { abertos: n("prsAbertos"), mergeados: n("prsMergeados") },
      notaPR: { media: mergeados?.media ?? null, notas: mergeados?.notas ?? 0 },
      etapas: Etapa.options.map((etapa) => {
        const { execucoes: qtd = 0, falhas = 0, duracaoMs = 0, ...soma } = execucoes.get(`${mes} ${etapa}`) ?? {};
        return {
          etapa,
          ...consumoDe({ chamadas: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, custo: 0, ...soma }),
          execucoes: qtd,
          falhas,
          duracaoMs,
          // F6 §5.6, pela data da decisão.
          reprovacoes: GateDecisao.options
            .filter((gate) => ETAPA_DO_GATE[gate] === etapa)
            .reduce((total, gate) => total + n(`reprovacao_${gate}`), 0),
        };
      }),
    });
  });
}

/**
 * F6 §5.8: uma linha por issue com pelo menos uma execução iniciada no período, consultas incluídas; `fase` e
 * `notaPR` são o estado atual, e os demais números contam só o que caiu no período.
 */
export function metricasPorIssue(banco: DatabaseSync, filtro: Periodo): MetricasIssuePeriodo[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const periodo = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim };
  return issuesNoPeriodo(banco, periodo, projeto).map(
    ({ issue, projeto: p, titulo, fase, execucoes, falhas, reprovacoes, duracaoMs, notaPR, ...soma }) =>
      MetricasIssuePeriodo.parse({
        issue,
        projeto: p,
        titulo,
        fase,
        consumo: consumoDe(soma),
        execucoes,
        falhas,
        reprovacoes,
        duracaoMs,
        notaPR,
      }),
  );
}
