// Métricas da página Métricas, por mês e projeto, lidas das tabelas da demanda: cada execução vale uma vez (a retomada de
// uma sessão é outra execução) e a soma de cada nível de agrupamento, da execução ao projeto, bate com o total.
import type { DatabaseSync } from "node:sqlite";
import { EtapaTicket } from "../dominio/primitivos.ts";
import {
  decisoesNoPeriodo,
  type ExecucaoNoPeriodo,
  execucoesNoPeriodo,
  fatosNoPeriodo,
  prsNoPeriodo,
  retrabalhoNoPeriodo,
  type UsoNoPeriodo,
  usoNoPeriodo,
} from "../persistencia/metricas_demanda.ts";
import { type Custo, agruparModelos, somarCustos, type UsoDoModelo } from "./demanda.ts";
import { intervalo, Periodo } from "./periodo.ts";

export interface Soma {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number };
  custo: Custo;
}

export const NIVEIS = ["execucao", "sessao", "ticket", "rodada", "demanda", "projeto"] as const;
export type Nivel = (typeof NIVEIS)[number];

const CHAVE_DO_NIVEL: Record<Nivel, (e: ExecucaoNoPeriodo) => string> = {
  execucao: (e) => e.execucao,
  sessao: (e) => e.sessao,
  ticket: (e) => `${e.demanda}\0${String(e.ticket)}`,
  rodada: (e) => `${e.demanda}\0${String(e.rodada)}`,
  demanda: (e) => e.demanda,
  projeto: (e) => e.projeto,
};

export interface MetricasMesDemanda {
  mes: string;
  /** `null` = todos os projetos. */
  projeto: string | null;
  total: Soma & { modelos: UsoDoModelo[] };
  /** A soma dos grupos de cada nível, que é sempre o `total`. */
  niveis: { nivel: Nivel; grupos: number; total: Soma }[];
  demandas: { registradas: number; concluidas: number };
  tickets: { criados: number; concluidos: number };
  prs: { abertos: number; mergeados: number };
  nota: { media: number | null; notas: number };
  retrabalho: { adicionadas: number; alteradas: number; porHumanos: number };
  etapas: (Soma & { etapa: EtapaTicket; reprovacoes: number })[];
}

export interface MetricasDemandaPeriodo extends Soma {
  demanda: string;
  projeto: string;
  titulo: string;
  fase: string;
  reprovacoes: number;
  /** Média das notas do encerramento de rodada dadas no período; `null` sem nota. */
  nota: number | null;
}

const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

function juntar(somas: Soma[]): Soma {
  const t = (campo: keyof Soma["tokens"]) => soma(somas.map((s) => s.tokens[campo]));
  return {
    execucoes: soma(somas.map((s) => s.execucoes)),
    falhas: soma(somas.map((s) => s.falhas)),
    duracaoMs: soma(somas.map((s) => s.duracaoMs)),
    tokens: {
      entrada: t("entrada"),
      saida: t("saida"),
      cacheLeitura: t("cacheLeitura"),
      cacheEscrita: t("cacheEscrita"),
    },
    custo: { conhecido: soma(somas.map((s) => s.custo.conhecido)), incompleto: somas.some((s) => s.custo.incompleto) },
  };
}

/** O uso das execuções, sem repetir nenhuma: cada linha de `uso_modelo_execucao` pertence a uma só execução. */
const usoDe = (execs: ExecucaoNoPeriodo[], uso: Map<string, UsoNoPeriodo[]>) =>
  execs.flatMap((e) => uso.get(e.execucao) ?? []);

function somar(execs: ExecucaoNoPeriodo[], uso: Map<string, UsoNoPeriodo[]>): Soma {
  const u = usoDe(execs, uso);
  const t = (campo: keyof Omit<UsoNoPeriodo, "execucao" | "provedor" | "modelo" | "custo">) =>
    soma(u.map((x) => x[campo]));
  return {
    execucoes: execs.length,
    falhas: execs.filter((e) => e.falha).length,
    duracaoMs: soma(execs.map((e) => e.duracaoMs)),
    tokens: {
      entrada: t("entrada"),
      saida: t("saida"),
      cacheLeitura: t("cacheLeitura"),
      cacheEscrita: t("cacheEscrita"),
    },
    custo: somarCustos(u.map((x) => x.custo)),
  };
}

const porNivel = (execs: ExecucaoNoPeriodo[], nivel: Nivel, uso: Map<string, UsoNoPeriodo[]>) => {
  const grupos = [...Map.groupBy(execs, CHAVE_DO_NIVEL[nivel]).values()].map((g) => somar(g, uso));
  return { nivel, grupos: grupos.length, total: juntar(grupos) };
};

/** Consumo e volume de trabalho de cada mês de `de` a `ate`, de um projeto ou de todos. */
export function metricasDemandaPorMes(banco: DatabaseSync, filtro: Periodo): MetricasMesDemanda[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const meses = Array.from({ length: mesesEntre(de, ate) }, (_, i) => intervalo(de, i));
  const recorte = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  const noMes = <T>(linhas: T[], em: (l: T) => string) =>
    Map.groupBy(linhas, (l) => meses.find((m) => em(l) >= m.inicio && em(l) < m.fim)?.mes);
  const execucoes = noMes(execucoesNoPeriodo(banco, recorte), (e) => e.inicio);
  const uso = Map.groupBy(usoNoPeriodo(banco, recorte), (u) => u.execucao);
  const fatos = noMes(fatosNoPeriodo(banco, recorte), (f) => f.em);
  const prs = noMes(prsNoPeriodo(banco, recorte), (p) => p.em);
  const decisoes = noMes(decisoesNoPeriodo(banco, recorte), (d) => d.em);
  const retrabalho = noMes(retrabalhoNoPeriodo(banco, recorte), (r) => r.em);

  return meses.map(({ mes }) => {
    const execs = execucoes.get(mes) ?? [];
    const n = (fato: string) => (fatos.get(mes) ?? []).filter((f) => f.fato === fato).length;
    const ds = decisoes.get(mes) ?? [];
    const mergeados = ds.filter((d) => d.etapa === "encerrar_rodada" && !d.recusada);
    const notas = mergeados.flatMap((d) => (d.nota === null ? [] : [d.nota]));
    const prsDoMes = prs.get(mes) ?? [];
    const r = retrabalho.get(mes) ?? [];
    return {
      mes,
      projeto,
      total: { ...somar(execs, uso), modelos: agruparModelos(usoDe(execs, uso)) },
      niveis: NIVEIS.map((nivel) => porNivel(execs, nivel, uso)),
      demandas: { registradas: n("demandasRegistradas"), concluidas: n("demandasConcluidas") },
      tickets: { criados: n("ticketsCriados"), concluidos: n("ticketsConcluidos") },
      prs: { abertos: prsDoMes.length, mergeados: prsDoMes.filter((p) => p.mergeado).length },
      nota: { media: notas.length === 0 ? null : soma(notas) / notas.length, notas: notas.length },
      retrabalho: {
        adicionadas: soma(r.map((x) => x.adicionadas)),
        alteradas: soma(r.map((x) => x.alteradas)),
        porHumanos: soma(r.map((x) => x.porHumanos)),
      },
      etapas: EtapaTicket.options.map((etapa) => ({
        etapa,
        ...somar(
          execs.filter((e) => e.etapa === etapa),
          uso,
        ),
        reprovacoes: ds.filter((d) => d.etapa === etapa && d.recusada).length,
      })),
    };
  });
}

const mesesEntre = (de: string, ate: string): number => {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1;
  return indice(ate) - indice(de) + 1;
};

/** Uma linha por demanda com pelo menos uma execução iniciada no período; `fase` é a atual e o resto só conta o período. */
export function metricasPorDemanda(banco: DatabaseSync, filtro: Periodo): MetricasDemandaPeriodo[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const recorte = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  const uso = Map.groupBy(usoNoPeriodo(banco, recorte), (u) => u.execucao);
  const decisoes = Map.groupBy(decisoesNoPeriodo(banco, recorte), (d) => d.demanda);
  return [...Map.groupBy(execucoesNoPeriodo(banco, recorte), (e) => e.demanda).values()]
    .map((execs) => {
      const [{ demanda, projeto: p, titulo, fase }] = execs as [ExecucaoNoPeriodo, ...ExecucaoNoPeriodo[]];
      const ds = decisoes.get(demanda) ?? [];
      const notas = ds.flatMap((d) =>
        d.etapa === "encerrar_rodada" && !d.recusada && d.nota !== null ? [d.nota] : [],
      );
      return {
        demanda,
        projeto: p,
        titulo,
        fase,
        ...somar(execs, uso),
        reprovacoes: ds.filter((d) => d.recusada).length,
        nota: notas.length === 0 ? null : soma(notas) / notas.length,
      };
    })
    .toSorted((a, b) => a.demanda.localeCompare(b.demanda, "pt-BR", { numeric: true }));
}
