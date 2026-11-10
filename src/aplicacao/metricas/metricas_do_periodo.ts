// As Métricas da tela de Métricas, do Início e do Projeto: as de cada Etapa (`metricasDasEtapas`) por mês e por Demanda,
// mais o que não é Métrica de Sucesso de uma Etapa: os fatos do mês e a soma do Uso em cada nível de agrupamento.
import type { DatabaseSync } from "node:sqlite";
import {
  type ExecucaoNoPeriodo,
  execucoesNoPeriodo,
  fatosNoPeriodo,
  prsNoPeriodo,
  type UsoNoPeriodo,
  usoNoPeriodo,
} from "../../armazenamento/metricas_demanda.ts";
import { usoDeclaradoNoPeriodo } from "../../armazenamento/uso_declarado.ts";
import type { Recorte, TipoMetrica } from "../../nucleo/metrica.ts";
import { intervalo, Periodo } from "../../nucleo/periodo.ts";
import type { EtapaTicket } from "../../nucleo/primitivos.ts";
import { type LinhaDeUso, textoDoCustoDe, Uso } from "../../nucleo/uso.ts";
import type { ValorDaMetrica, ValorDe } from "./calculo_de_metrica.ts";
import type { MetricaDeConformidade } from "./metrica_de_conformidade.ts";
import type { MetricaDeExigenciasDeAlteracao } from "./metrica_de_exigencias_de_alteracao.ts";
import type { MetricaDeNotaHumana } from "./metrica_de_nota_humana.ts";
import { type MetricaDeUso, usoDeclaradoDe, usoPorExecucao } from "./metrica_de_uso.ts";
import type { MetricaDeAprovacoesEReprovacoes } from "./metrica_de_aprovacoes_e_reprovacoes.ts";
import { metricasDasEtapas } from "./metricas_das_etapas.ts";

interface Soma {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
  custo: { conhecido: number; trabalhosSemCusto: number };
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

/** Uma Etapa com os valores das Métricas que o catálogo declara para ela. */
export interface MetricasDaEtapa {
  etapa: EtapaTicket;
  metricas: ValorDaMetrica[];
}

export interface MetricasDoMes {
  mes: string;
  /** `null` = todos os projetos. */
  projeto: string | null;
  /** Todas as Etapas, na ordem do fluxo. */
  etapas: MetricasDaEtapa[];
  /** O Uso de todas as Etapas somado. */
  total: Soma & { modelos: LinhaDeUso[] };
  /** A soma dos grupos de cada nível, que é sempre o `total`. */
  niveis: { nivel: Nivel; grupos: number; total: Soma }[];
  demandas: { registradas: number; concluidas: number };
  tickets: { criados: number; concluidos: number };
  prs: { abertos: number; mergeados: number };
}

export interface MetricasDaDemandaNoPeriodo extends Soma {
  demanda: string;
  projeto: string;
  titulo: string;
  estado: string;
  /** As Reprovações do Gate da demanda e as exigências de alteração das revisões. */
  reprovacoes: number;
  /** O Jaccard do plano × arquivos alterados, de 0 a 100; `null` sem rodada com plano e commit. */
  conformidade: number | null;
  /** Média da nota humana dada no período; `null` sem nota. */
  nota: number | null;
}

/** As demandas do período e o Uso somado de todas, que é o que o rodapé da tabela mostra. */
export interface MetricasPorDemanda {
  demandas: MetricasDaDemandaNoPeriodo[];
  total: Soma & { conformidade: number | null; nota: number | null };
}

const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/** Os valores das Métricas de todas as Etapas do recorte, na ordem do fluxo. */
const metricasDoRecorte = (banco: DatabaseSync, recorte: Recorte): MetricasDaEtapa[] =>
  [...metricasDasEtapas(banco, recorte)].map(([etapa, metricas]) => ({ etapa, metricas }));

/** O valor da Métrica de `tipo` em cada Etapa que a declara. */
function valoresDe<Valor>(etapas: readonly MetricasDaEtapa[], tipo: TipoMetrica): Valor[] {
  return etapas.flatMap((e) => e.metricas.filter((m) => m.definicao.tipo === tipo).map((m) => m.valor as Valor));
}

/** O Uso de todas as Etapas somado: o que o total do mês, da demanda e do rodapé mostram. */
function somarUsoDasEtapas(etapas: readonly MetricasDaEtapa[]): Soma {
  const usos = valoresDe<ValorDe<MetricaDeUso>>(etapas, "uso");
  const tokens = (campo: keyof LinhaDeUso & `tokens_${string}`) =>
    soma(usos.flatMap((u) => u.modelos.map((m) => m[campo])));
  const [entrada, saida, cacheLeitura, cacheEscrita] = [
    tokens("tokens_entrada"),
    tokens("tokens_saida"),
    tokens("tokens_cache_leitura"),
    tokens("tokens_cache_escrita"),
  ];
  const custo = {
    conhecido: soma(usos.map((u) => u.custo.conhecido)),
    trabalhosSemCusto: soma(usos.map((u) => u.custo.trabalhosSemCusto)),
  };
  return {
    execucoes: soma(usos.map((u) => u.execucoes)),
    falhas: soma(usos.map((u) => u.falhas)),
    duracaoMs: soma(usos.map((u) => u.duracaoMs)),
    tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
    custo,
    textoDoCusto: textoDoCustoDe(custo),
  };
}

/** O Uso de todas as Etapas por modelo. */
const somarModelosDasEtapas = (etapas: readonly MetricasDaEtapa[]): LinhaDeUso[] =>
  Uso.de(
    valoresDe<ValorDe<MetricaDeUso>>(etapas, "uso").flatMap((u) => u.modelos),
    0,
  ).porModelo();

/** As Reprovações do Gate da demanda e as exigências de alteração (os demais Gates e as Tentativas), de todas as Etapas. */
const reprovacoesDas = (etapas: readonly MetricasDaEtapa[]): number =>
  soma(
    valoresDe<ValorDe<MetricaDeAprovacoesEReprovacoes>>(etapas, "aprovacoes_e_reprovacoes").map((v) => v.reprovacoes),
  ) +
  soma(valoresDe<ValorDe<MetricaDeExigenciasDeAlteracao>>(etapas, "exigencias_de_alteracao").map((v) => v.reprovacoes));

const conformidadeDas = (etapas: readonly MetricasDaEtapa[]): number | null =>
  valoresDe<ValorDe<MetricaDeConformidade>>(etapas, "conformidade_com_o_plano")[0]?.percentual ?? null;

const notaDas = (etapas: readonly MetricasDaEtapa[]): number | null =>
  valoresDe<ValorDe<MetricaDeNotaHumana>>(etapas, "nota_humana")[0]?.media ?? null;

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
  const custo = doUso.custo();
  return {
    execucoes: execs.length,
    falhas: execs.filter((e) => e.falha).length,
    duracaoMs: soma(execs.map((e) => e.duracaoMs)),
    tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
    custo,
    textoDoCusto: textoDoCustoDe(custo),
  };
}

// O Uso declarado é da demanda, sem execução: entra no total de cada nível sem criar grupo.
const porNivel = (execs: ExecucaoNoPeriodo[], nivel: Nivel, uso: Map<string, UsoNoPeriodo[]>, declarado: Uso) => {
  const grupos = [...Map.groupBy(execs, CHAVE_DO_NIVEL[nivel]).values()];
  const usoDosGrupos = grupos.map((g) => usoDe(g, uso)).reduce((total, g) => total.somar(g), declarado);
  return { nivel, grupos: grupos.length, total: resumir(grupos.flat(), usoDosGrupos) };
};

/** O Uso da demanda inteira: o que o cabeçalho dela mostra. */
export function usoDaDemanda(banco: DatabaseSync, demandaId: string): Soma & { modelos: LinhaDeUso[] } {
  const etapas = metricasDoRecorte(banco, { demandaId });
  return { ...somarUsoDasEtapas(etapas), modelos: somarModelosDasEtapas(etapas) };
}

const mesesEntre = (de: string, ate: string): number => {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1;
  return indice(ate) - indice(de) + 1;
};

/** As Métricas de cada Etapa e os fatos de cada mês de `de` a `ate`, de um projeto ou de todos. */
export function metricasDosMeses(banco: DatabaseSync, filtro: Periodo): MetricasDoMes[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const meses = Array.from({ length: mesesEntre(de, ate) }, (_, i) => intervalo(de, i));
  const periodo = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  const noMes = <T>(linhas: T[], em: (l: T) => string) =>
    Map.groupBy(linhas, (l) => meses.find((m) => em(l) >= m.inicio && em(l) < m.fim)?.mes);
  const execucoes = noMes(execucoesNoPeriodo(banco, periodo), (e) => e.inicio);
  const uso = Map.groupBy(usoNoPeriodo(banco, periodo), (u) => u.execucao);
  const declarado = noMes(usoDeclaradoNoPeriodo(banco, periodo), (d) => d.em);
  const fatos = noMes(fatosNoPeriodo(banco, periodo), (f) => f.em);
  const prs = noMes(prsNoPeriodo(banco, periodo), (p) => p.em);

  return meses.map(({ mes, inicio, fim }) => {
    const execs = execucoes.get(mes) ?? [];
    const n = (fato: string) => (fatos.get(mes) ?? []).filter((f) => f.fato === fato).length;
    const prsDoMes = prs.get(mes) ?? [];
    const usoDeclaradoDoMes = usoDeclaradoDe(declarado.get(mes) ?? []);
    const etapas = metricasDoRecorte(banco, { inicio, fim, projeto });
    return {
      mes,
      projeto,
      etapas,
      total: { ...somarUsoDasEtapas(etapas), modelos: somarModelosDasEtapas(etapas) },
      niveis: NIVEIS.map((nivel) => porNivel(execs, nivel, uso, usoDeclaradoDoMes)),
      demandas: { registradas: n("demandasRegistradas"), concluidas: n("demandasConcluidas") },
      tickets: { criados: n("ticketsCriados"), concluidos: n("ticketsConcluidos") },
      prs: { abertos: prsDoMes.length, mergeados: prsDoMes.filter((p) => p.mergeado).length },
    };
  });
}

/** Uma linha por demanda com execução iniciada ou Uso declarado no período; `estado` é a atual e o resto só conta o período. */
export function metricasDasDemandasDoPeriodo(banco: DatabaseSync, filtro: Periodo): MetricasPorDemanda {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const periodo = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  // A demanda só com Uso declarado no período também é linha, com 0 execuções: a soma das linhas é o rodapé.
  const cabecalhos = new Map(
    [...usoDeclaradoNoPeriodo(banco, periodo), ...execucoesNoPeriodo(banco, periodo)].map(
      ({ demanda, projeto: p, titulo, estado }) => [demanda, { demanda, projeto: p, titulo, estado }],
    ),
  );
  const demandas = [...cabecalhos.values()]
    .map((cabecalho) => {
      const etapas = metricasDoRecorte(banco, { ...periodo, demandaId: cabecalho.demanda });
      return {
        ...cabecalho,
        ...somarUsoDasEtapas(etapas),
        reprovacoes: reprovacoesDas(etapas),
        conformidade: conformidadeDas(etapas),
        nota: notaDas(etapas),
      };
    })
    .toSorted((a, b) => a.demanda.localeCompare(b.demanda, "pt-BR", { numeric: true }));
  const etapas = metricasDoRecorte(banco, periodo);
  return {
    demandas,
    total: { ...somarUsoDasEtapas(etapas), conformidade: conformidadeDas(etapas), nota: notaDas(etapas) },
  };
}
