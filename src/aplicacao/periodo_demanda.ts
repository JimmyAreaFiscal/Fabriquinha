// Métricas da página Métricas, por mês e projeto, lidas das tabelas da demanda: cada execução vale uma vez (a retomada de
// uma sessão é outra execução) e a soma de cada nível de agrupamento, da execução ao projeto, bate com o total.
import type { DatabaseSync } from "node:sqlite";
import { EtapaTicket } from "../nucleo/primitivos.ts";
import {
  decisoesNoPeriodo,
  type ExecucaoNoPeriodo,
  execucoesNoPeriodo,
  fatosNoPeriodo,
  prsNoPeriodo,
  retrabalhoNoPeriodo,
  type UsoNoPeriodo,
  usoNoPeriodo,
} from "../armazenamento/metricas_demanda.ts";
import { usoDeclaradoNoPeriodo } from "../armazenamento/uso_declarado.ts";
import { usoDeclaradoDe, usoPorExecucao } from "./demanda.ts";
import { type LinhaDeUso, textoDoCusto, Uso } from "../nucleo/uso.ts";
import { intervalo, Periodo } from "../nucleo/periodo.ts";

export interface Soma {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
  custo: ReturnType<Uso["custo"]>;
  /** O custo como todas as telas o mostram (`textoDoCusto`). */
  textoDoCusto: string;
}

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
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
  total: Soma & { modelos: LinhaDeUso[] };
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
  estado: string;
  reprovacoes: number;
  /** Média das notas do encerramento de rodada dadas no período; `null` sem nota. */
  nota: number | null;
}

/** As demandas do período e o Uso somado de todas, que é o que o rodapé da tabela mostra. */
export interface MetricasPorDemanda {
  demandas: MetricasDemandaPeriodo[];
  total: Soma;
}

const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/** O Uso das execuções, cada uma um Trabalho: cada linha de `uso_modelo_execucao` pertence a uma só execução. */
const usoDe = (execs: ExecucaoNoPeriodo[], uso: Map<string, UsoNoPeriodo[]>): Uso =>
  execs
    .map((e) => usoPorExecucao(uso.get(e.execucao) ?? []))
    .reduce((total, daExecucao) => total.somar(daExecucao), Uso.vazio());

function resumir(execs: ExecucaoNoPeriodo[], doUso: Uso): Soma {
  const tokens = (campo: Exclude<keyof LinhaDeUso, "modelo" | "custo" | "chamadas">) =>
    doUso.porModelo().reduce((n, linha) => n + linha[campo], 0);
  const [entrada, saida, cacheLeitura, cacheEscrita] = [
    tokens("tokens_entrada"),
    tokens("tokens_saida"),
    tokens("tokens_cache_leitura"),
    tokens("tokens_cache_escrita"),
  ];
  return {
    execucoes: execs.length,
    falhas: execs.filter((e) => e.falha).length,
    duracaoMs: soma(execs.map((e) => e.duracaoMs)),
    tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
    custo: doUso.custo(),
    textoDoCusto: textoDoCusto(doUso),
  };
}

const somar = (execs: ExecucaoNoPeriodo[], uso: Map<string, UsoNoPeriodo[]>): Soma => resumir(execs, usoDe(execs, uso));

// O Uso declarado é da demanda, sem execução: entra no total de cada nível sem criar grupo.
const porNivel = (execs: ExecucaoNoPeriodo[], nivel: Nivel, uso: Map<string, UsoNoPeriodo[]>, declarado: Uso) => {
  const grupos = [...Map.groupBy(execs, CHAVE_DO_NIVEL[nivel]).values()];
  const usoDosGrupos = grupos.map((g) => usoDe(g, uso)).reduce((total, g) => total.somar(g), declarado);
  return { nivel, grupos: grupos.length, total: resumir(grupos.flat(), usoDosGrupos) };
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
  const declarado = noMes(usoDeclaradoNoPeriodo(banco, recorte), (d) => d.em);
  const fatos = noMes(fatosNoPeriodo(banco, recorte), (f) => f.em);
  const prs = noMes(prsNoPeriodo(banco, recorte), (p) => p.em);
  const decisoes = noMes(decisoesNoPeriodo(banco, recorte), (d) => d.em);
  const retrabalho = noMes(retrabalhoNoPeriodo(banco, recorte), (r) => r.em);

  return meses.map(({ mes }) => {
    const execs = execucoes.get(mes) ?? [];
    const n = (fato: string) => (fatos.get(mes) ?? []).filter((f) => f.fato === fato).length;
    const ds = decisoes.get(mes) ?? [];
    const mergeados = ds.filter((d) => d.etapa === "encerrar_rodada" && !d.reprovada);
    const notas = mergeados.flatMap((d) => (d.nota === null ? [] : [d.nota]));
    const prsDoMes = prs.get(mes) ?? [];
    const r = retrabalho.get(mes) ?? [];
    const usoDeclaradoDoMes = usoDeclaradoDe(declarado.get(mes) ?? []);
    const usoDoMes = usoDe(execs, uso).somar(usoDeclaradoDoMes);
    return {
      mes,
      projeto,
      total: { ...resumir(execs, usoDoMes), modelos: usoDoMes.porModelo() },
      niveis: NIVEIS.map((nivel) => porNivel(execs, nivel, uso, usoDeclaradoDoMes)),
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
        reprovacoes: ds.filter((d) => d.etapa === etapa && d.reprovada).length,
      })),
    };
  });
}

const mesesEntre = (de: string, ate: string): number => {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1;
  return indice(ate) - indice(de) + 1;
};

/** Uma linha por demanda com execução iniciada ou Uso declarado no período; `estado` é a atual e o resto só conta o período. */
export function metricasPorDemanda(banco: DatabaseSync, filtro: Periodo): MetricasPorDemanda {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const recorte = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  const uso = Map.groupBy(usoNoPeriodo(banco, recorte), (u) => u.execucao);
  const decisoes = Map.groupBy(decisoesNoPeriodo(banco, recorte), (d) => d.demanda);
  const execucoes = execucoesNoPeriodo(banco, recorte);
  const declarado = usoDeclaradoNoPeriodo(banco, recorte);
  const declaradoPorDemanda = Map.groupBy(declarado, (d) => d.demanda);
  const execucoesPorDemanda = Map.groupBy(execucoes, (e) => e.demanda);
  // A demanda só com Uso declarado no período também é linha, com 0 execuções: a soma das linhas é o rodapé.
  const cabecalhos = new Map(
    [...declarado, ...execucoes].map(({ demanda, projeto: p, titulo, estado }) => [
      demanda,
      { demanda, projeto: p, titulo, estado },
    ]),
  );
  const demandas = [...cabecalhos.values()]
    .map(({ demanda, projeto: p, titulo, estado }) => {
      const execs = execucoesPorDemanda.get(demanda) ?? [];
      const ds = decisoes.get(demanda) ?? [];
      const notas = ds.flatMap((d) =>
        d.etapa === "encerrar_rodada" && !d.reprovada && d.nota !== null ? [d.nota] : [],
      );
      return {
        demanda,
        projeto: p,
        titulo,
        estado,
        ...resumir(execs, usoDe(execs, uso).somar(usoDeclaradoDe(declaradoPorDemanda.get(demanda) ?? []))),
        reprovacoes: ds.filter((d) => d.reprovada).length,
        nota: notas.length === 0 ? null : soma(notas) / notas.length,
      };
    })
    .toSorted((a, b) => a.demanda.localeCompare(b.demanda, "pt-BR", { numeric: true }));
  return { demandas, total: resumir(execucoes, usoDe(execucoes, uso).somar(usoDeclaradoDe(declarado))) };
}
