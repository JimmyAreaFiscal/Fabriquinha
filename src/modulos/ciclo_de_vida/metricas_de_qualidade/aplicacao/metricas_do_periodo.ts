// As Métricas da tela de Métricas, do Início e do Projeto: as de cada Etapa (`metricasDasEtapas`) por mês e por Demanda,
// as do SDLC inteiro (`metricasDoSdlc`) por mês, e a soma do Uso em cada nível de agrupamento. O Uso da demanda calcula
// só a Métrica de Uso.
import { intervalo } from "../../../../shared/nucleo/periodo.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import {
  type CustoDoUso,
  type LinhaDeUso,
  textoDoCustoDe,
  Uso,
  type UsoDaExecucao,
  usoEmLote,
} from "../../../sessoes/publico.ts";
import type { EtapaTicket, TipoMetrica } from "../../etapas/publico.ts";
import type { Recorte } from "../nucleo/metrica.ts";
import { Periodo } from "../nucleo/periodo.ts";
import type { ValorDaMetrica, ValorDe } from "./calculo_de_metrica.ts";
import {
  type EscopoDosFatos,
  escopoDoRecorte,
  lerExecucoesDoRecorte,
  lerUsoDeclaradoDoRecorte,
  type OrigemDosFatos,
} from "./leitura_dos_fatos.ts";
import type { MetricaDeConformidade } from "./metricas/metrica_de_conformidade.ts";
import type { MetricaDeExigenciasDeAlteracao } from "./metricas/metrica_de_exigencias_de_alteracao.ts";
import type { MetricaDeNotaHumana } from "./metricas/metrica_de_nota_humana.ts";
import { MetricaDeUso, usoDeclaradoDe, usoPorExecucao } from "./metricas/metrica_de_uso.ts";
import type { MetricaDeAprovacoesEReprovacoes } from "./metricas/metrica_de_aprovacoes_e_reprovacoes.ts";
import type { MetricaDeDemandas } from "./metricas/metrica_de_demandas.ts";
import type { MetricaDePrs } from "./metricas/metrica_de_prs.ts";
import type { MetricaDeTickets } from "./metricas/metrica_de_tickets.ts";
import { metricasDasEtapas, metricasDoSdlc, type TipoMetricaDoSdlc } from "./registro_das_metricas.ts";

interface Soma {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
  custo: CustoDoUso;
  /** O custo como todas as telas o mostram (`textoDoCusto`). */
  textoDoCusto: string;
}

/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export const NIVEIS = ["execucao", "sessao", "ticket", "rodada", "demanda", "projeto"] as const;
type Nivel = (typeof NIVEIS)[number];

/** Uma execução do período com a demanda, o ticket e a Etapa dela; cada execução vale uma vez, no mês em que começou. */
interface ExecucaoNoPeriodo {
  execucao: string;
  sessao: string;
  ticket: number;
  /** `null` = ticket de demanda, sem rodada. */
  rodada: number | null;
  demanda: string;
  projeto: string;
  titulo: string;
  estado: string;
  etapa: string;
  inicio: string;
  falha: boolean;
  duracaoMs: number;
}

/** As execuções do escopo, com o cabeçalho da demanda de cada uma, na ordem do início. */
function lerExecucoesNoPeriodo(escopo: EscopoDosFatos): ExecucaoNoPeriodo[] {
  const pedidos = new Map(escopo.pedidos.map((pedido) => [pedido.id, pedido]));
  return lerExecucoesDoRecorte(escopo).map((execucao) => {
    const { projeto, titulo, estado } = encontrado(
      pedidos.get(execucao.demanda_id),
      `a demanda ${execucao.demanda_id} da execução não está entre os pedidos`,
      "passe os pedidos de todas as demandas do recorte",
    );
    return {
      execucao: execucao.id,
      sessao: execucao.sessao,
      ticket: execucao.ticket_id,
      rodada: execucao.rodadaId,
      demanda: execucao.demanda_id,
      projeto,
      titulo,
      estado,
      etapa: execucao.etapa,
      inicio: execucao.inicio,
      falha: execucao.falha,
      duracaoMs: execucao.duracaoMs,
    };
  });
}

const CHAVE_DO_NIVEL: Record<Nivel, (e: ExecucaoNoPeriodo) => string> = {
  execucao: (e) => e.execucao,
  sessao: (e) => e.sessao,
  ticket: (e) => `${e.demanda}\0${String(e.ticket)}`,
  rodada: (e) => `${e.demanda}\0${String(e.rodada)}`,
  demanda: (e) => e.demanda,
  projeto: (e) => e.projeto,
};

/** Uma Etapa com os valores das Métricas que o catálogo declara para ela. */
/** @testes o teste exercita direto; a produção o usa só dentro do módulo */
export interface MetricasDaEtapa {
  etapa: EtapaTicket;
  metricas: ValorDaMetrica[];
}

/** @testes o teste de rota tipa o corpo da resposta com ele */
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

interface MetricasDaDemandaNoPeriodo extends Soma {
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
/** @testes o teste de rota tipa o corpo da resposta com ele */
export interface MetricasPorDemanda {
  demandas: MetricasDaDemandaNoPeriodo[];
  total: Soma & { conformidade: number | null; nota: number | null };
}

const soma = (ns: number[]) => ns.reduce((s, n) => s + n, 0);

/** Os valores das Métricas de todas as Etapas do recorte, na ordem do fluxo. */
const metricasDoRecorte = (origem: OrigemDosFatos, recorte: Recorte): MetricasDaEtapa[] =>
  [...metricasDasEtapas(origem, recorte)].map(([etapa, metricas]) => ({ etapa, metricas }));

/** O valor da Métrica de `tipo` em cada Etapa que a declara. */
function valoresDe<Valor>(etapas: readonly MetricasDaEtapa[], tipo: TipoMetrica): Valor[] {
  return etapas.flatMap((e) => e.metricas.filter((m) => m.definicao.tipo === tipo).map((m) => m.valor as Valor));
}

/** O valor da Métrica do SDLC de `tipo`; o registro sempre a calcula. */
const valorDoSdlc = (metricas: readonly ValorDaMetrica[], tipo: TipoMetricaDoSdlc): unknown =>
  metricas.find((m) => m.definicao.tipo === tipo)?.valor;

/** O Uso de todas as Etapas somado: o que o total do mês, da demanda e do rodapé mostram. */
const somarUsoDasEtapas = (etapas: readonly MetricasDaEtapa[]): Soma =>
  somarUso(valoresDe<ValorDe<MetricaDeUso>>(etapas, "uso"));

/** O Uso das Etapas somado. */
function somarUso(usos: readonly ValorDe<MetricaDeUso>[]): Soma {
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
    trabalhosComCustoEstimado: soma(usos.map((u) => u.custo.trabalhosComCustoEstimado)),
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

/** O Uso das Etapas por modelo. */
const somarModelos = (usos: readonly ValorDe<MetricaDeUso>[]): LinhaDeUso[] =>
  Uso.de(
    usos.flatMap((u) => u.modelos),
    0,
  ).porModelo();

/** O Uso de todas as Etapas por modelo. */
const somarModelosDasEtapas = (etapas: readonly MetricasDaEtapa[]): LinhaDeUso[] =>
  somarModelos(valoresDe<ValorDe<MetricaDeUso>>(etapas, "uso"));

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

/** O Uso das execuções, cada uma um Trabalho: cada linha do Uso medido pertence a uma só execução. */
const usoDe = (execs: ExecucaoNoPeriodo[], uso: Map<string, UsoDaExecucao[]>): Uso =>
  execs
    .map((e) => usoPorExecucao(uso.get(e.execucao) ?? []))
    .reduce((total, daExecucao) => total.somar(daExecucao), Uso.vazio());

function resumir(execs: ExecucaoNoPeriodo[], doUso: Uso): Soma {
  const tokens = (campo: keyof LinhaDeUso & `tokens_${string}`) =>
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
const porNivel = (execs: ExecucaoNoPeriodo[], nivel: Nivel, uso: Map<string, UsoDaExecucao[]>, declarado: Uso) => {
  const grupos = [...Map.groupBy(execs, CHAVE_DO_NIVEL[nivel]).values()];
  const usoDosGrupos = grupos.map((g) => usoDe(g, uso)).reduce((total, g) => total.somar(g), declarado);
  return { nivel, grupos: grupos.length, total: resumir(grupos.flat(), usoDosGrupos) };
};

/** O Uso da demanda inteira: o que o cabeçalho dela mostra. Só a Métrica de Uso é calculada. */
export function usoDaDemanda(origem: OrigemDosFatos, demandaId: string): Soma & { modelos: LinhaDeUso[] } {
  const usos = [...new MetricaDeUso().calcular(origem, { demandaId }).values()];
  return { ...somarUso(usos), modelos: somarModelos(usos) };
}

const mesesEntre = (de: string, ate: string): number => {
  const indice = (mes: string) => Number(mes.slice(0, 4)) * 12 + Number(mes.slice(5)) - 1;
  return indice(ate) - indice(de) + 1;
};

/** As Métricas de cada Etapa e as do SDLC de cada mês de `de` a `ate`, de um projeto ou de todos. */
export function metricasDosMeses(origem: OrigemDosFatos, filtro: Periodo): MetricasDoMes[] {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const meses = Array.from({ length: mesesEntre(de, ate) }, (_, i) => intervalo(de, i));
  const escopo = escopoDoRecorte(origem, { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto });
  const noMes = <T>(linhas: T[], em: (l: T) => string) =>
    Map.groupBy(linhas, (l) => meses.find((m) => em(l) >= m.inicio && em(l) < m.fim)?.mes);
  const execucoes = noMes(lerExecucoesNoPeriodo(escopo), (e) => e.inicio);
  const uso = Map.groupBy(
    usoEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo }),
    (u) => u.execucao_id,
  );
  const declarado = noMes(lerUsoDeclaradoDoRecorte(escopo), (d) => d.em);

  return meses.map(({ mes, inicio, fim }) => {
    const execs = execucoes.get(mes) ?? [];
    const usoDeclaradoDoMes = usoDeclaradoDe(declarado.get(mes) ?? []);
    const etapas = metricasDoRecorte(origem, { inicio, fim, projeto });
    const doSdlc = metricasDoSdlc(origem, { inicio, fim, projeto });
    return {
      mes,
      projeto,
      etapas,
      total: { ...somarUsoDasEtapas(etapas), modelos: somarModelosDasEtapas(etapas) },
      niveis: NIVEIS.map((nivel) => porNivel(execs, nivel, uso, usoDeclaradoDoMes)),
      demandas: valorDoSdlc(doSdlc, "demandas") as ValorDe<MetricaDeDemandas>,
      tickets: valorDoSdlc(doSdlc, "tickets") as ValorDe<MetricaDeTickets>,
      prs: valorDoSdlc(doSdlc, "prs") as ValorDe<MetricaDePrs>,
    };
  });
}

/** Uma linha por demanda com execução iniciada ou Uso declarado no período; `estado` é a atual e o resto só conta o período. */
export function metricasDasDemandasDoPeriodo(origem: OrigemDosFatos, filtro: Periodo): MetricasPorDemanda {
  const { projeto = null, de, ate } = Periodo.parse(filtro);
  const periodo = { inicio: intervalo(de).inicio, fim: intervalo(ate).fim, projeto };
  const escopo = escopoDoRecorte(origem, periodo);
  const pedidos = new Map(escopo.pedidos.map((pedido) => [pedido.id, pedido]));
  // A demanda só com Uso declarado no período também é linha, com 0 execuções: a soma das linhas é o rodapé.
  const comFatoNoPeriodo = new Set([
    ...lerUsoDeclaradoDoRecorte(escopo).map((declarado) => declarado.demanda),
    ...lerExecucoesDoRecorte(escopo).map((execucao) => execucao.demanda_id),
  ]);
  const demandas = [...comFatoNoPeriodo]
    .map((id) => {
      const {
        projeto: doPedido,
        titulo,
        estado,
      } = encontrado(
        pedidos.get(id),
        `a demanda ${id} não está entre os pedidos`,
        "passe os pedidos de todas as demandas do recorte",
      );
      const etapas = metricasDoRecorte(origem, { ...periodo, demandaId: id });
      return {
        demanda: id,
        projeto: doPedido,
        titulo,
        estado,
        ...somarUsoDasEtapas(etapas),
        reprovacoes: reprovacoesDas(etapas),
        conformidade: conformidadeDas(etapas),
        nota: notaDas(etapas),
      };
    })
    .toSorted((a, b) => a.demanda.localeCompare(b.demanda, "pt-BR", { numeric: true }));
  const etapas = metricasDoRecorte(origem, periodo);
  return {
    demandas,
    total: { ...somarUsoDasEtapas(etapas), conformidade: conformidadeDas(etapas), nota: notaDas(etapas) },
  };
}
