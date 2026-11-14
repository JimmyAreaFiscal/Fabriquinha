// A Métrica de Uso de cada Etapa: tokens, modelo e custo, do Uso medido nas execuções e do Uso declarado das sessões
// externas. Sessões dá o Uso de cada Trabalho com o contexto dele; aqui ele se junta pela Etapa do ticket, que o Ciclo de
// Vida diz, e o custo vira o texto que as telas mostram.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import {
  type CatalogoDoCicloDeVida,
  type CicloDeVida,
  EtapaTicket,
  type MetricasDoProcesso,
  type OrigemDosFatos,
  type Recorte,
  type TipoMetrica,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import { type CustoDoUso, type LinhaDeUso, montarSessoesDeAgente, Uso } from "../../../../modulos/sessoes/publico.ts";

/** Os fatos que as Métricas leem, com o Ciclo de Vida que dá as do processo e o catálogo das Etapas. */
export type OrigemDasMetricas = OrigemDosFatos & { cicloDeVida: CicloDeVida };

/** O que cada Etapa declara: o executor, o escopo e as Métricas. */
export type DeclaracaoDasEtapas = CatalogoDoCicloDeVida["porEtapa"];

export const DEFINICAO_DO_USO = { tipo: "uso", rotulo: "Uso", fonte: "Uso" } as const;

export interface ValorDoUso {
  execucoes: number;
  falhas: number;
  duracaoMs: number;
  tokens: { entrada: number; saida: number; cacheLeitura: number; cacheEscrita: number; total: number };
  modelos: LinhaDeUso[];
  /**
   * Custo ausente não é zero: `trabalhosSemCusto > 0` avisa que `conhecido` soma só o que foi informado ou estimado, e
   * `trabalhosComCustoEstimado > 0`, que parte dele foi estimada pelo catálogo de preços.
   */
  custo: CustoDoUso;
  /** O custo como todas as telas o mostram (`textoDoCusto`). */
  textoDoCusto: string;
  /** A parte do custo vinda das sessões externas declaradas, já somada em `custo`. */
  custoExterno: CustoDoUso & { sessoes: number };
}

/** O que um fato de Uso diz de onde é: a demanda e o instante, que dizem em que parte do recorte ele cai, e a Etapa. */
interface DonoDoUso {
  demanda_id: string;
  em: string;
  etapa: string;
}

/** Uma execução do período, no instante em que começou, com a Etapa e a rodada (`null` em ticket de demanda) do ticket. */
export interface ExecucaoDoUso extends DonoDoUso {
  id: string;
  sessao: string;
  ticket_id: number;
  inicio: string;
  falha: boolean;
  duracaoMs: number;
  rodadaId: number | null;
}

/** Os fatos de Uso do recorte: cada um é de uma demanda e tem instante, e a divisão do recorte os reparte sem ler de novo. */
export interface FatosDeUso {
  /** As execuções do período, na ordem do início. */
  execucoes: ExecucaoDoUso[];
  /** O Uso medido de cada execução que tem algum, na ordem em que foi gravado. */
  usos: (DonoDoUso & { execucao: string; uso: Uso })[];
  /** Cada sessão externa declarada, no instante do registro da demanda, só as do período. */
  declarados: { demanda_id: string; em: string; uso: Uso }[];
}

/** O instante está no período; a ponta ausente não restringe. */
const noPeriodo = (instante: string, { inicio, fim }: Pick<Recorte, "inicio" | "fim">): boolean =>
  (inicio === undefined || instante >= inicio) && (fim === undefined || instante < fim);

/**
 * Os fatos de Uso das demandas do recorte, lidos de Sessões uma vez.
 * shortcut: o Uso declarado vale no instante do registro da demanda; gravar a data da declaração em `uso_declarado` se
 * isso distorcer a série.
 */
export function lerFatosDeUso(banco: DatabaseSync, processo: MetricasDoProcesso): FatosDeUso {
  const { execucoes, usoPorExecucao, declarados } = montarSessoesDeAgente({ banco }).metricas({
    demandas: processo.demandas,
    periodo: processo.periodo,
  });
  const execucoesDoUso = execucoes.map((execucao) => {
    const { etapa, rodadaId } = processo.ticketDoFato(execucao.demanda_id, execucao.ticket_id);
    return { ...execucao, em: execucao.inicio, etapa, rodadaId };
  });
  const execucaoPorId = new Map(execucoesDoUso.map((execucao) => [execucao.id, execucao]));
  return {
    execucoes: execucoesDoUso,
    usos: [...usoPorExecucao].map(([id, uso]) => {
      const { demanda_id, em, etapa } = encontrado(
        execucaoPorId.get(id),
        `a execução ${id} do Uso não está no recorte`,
        "leia o Uso e as execuções com o mesmo pedido",
      );
      return { demanda_id, em, etapa, execucao: id, uso };
    }),
    declarados: declarados
      .map(({ demanda_id, uso }) => ({ demanda_id, em: processo.registroDaDemanda(demanda_id), uso }))
      .filter((declarado) => noPeriodo(declarado.em, processo.periodo)),
  };
}

/** A soma dos Usos, cada um um Trabalho ou mais. */
export const somarUsos = (usos: readonly Uso[]): Uso => usos.reduce((total, uso) => total.somar(uso), Uso.vazio());

// shortcut: o Uso declarado não tem Etapa e conta na Etapa de executor externo (só uma o é); dar Etapa à declaração se houver sessão externa de outra.
const etapaDoUsoDeclarado = (porEtapa: DeclaracaoDasEtapas) =>
  EtapaTicket.options.find((etapa) => porEtapa[etapa].executor === "externo");

const somar = (numeros: number[]) => numeros.reduce((soma, n) => soma + n, 0);

// Instanciar o formatador é caro; `toLocaleString` o recriaria a cada chamada.
const formatadorDeDolares = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const sessoes = (quantas: number): string => `${String(quantas)} ${quantas === 1 ? "sessão" : "sessões"}`;

/**
 * O custo como as telas o mostram: "US$ 4,20"; "≥ US$ 4,20 (2 sessões sem custo)" quando falta custo; e
 * "US$ 4,20 (estimado em 1 sessão)" quando parte dele veio do catálogo de preços. Os avisos ficam entre parênteses,
 * separados por ";".
 */
export function textoDoCusto({ conhecido, trabalhosSemCusto, trabalhosComCustoEstimado }: CustoDoUso): string {
  const avisos = [
    ...(trabalhosSemCusto > 0 ? [`${sessoes(trabalhosSemCusto)} sem custo`] : []),
    ...(trabalhosComCustoEstimado > 0 ? [`estimado em ${sessoes(trabalhosComCustoEstimado)}`] : []),
  ];
  const dolares = `${trabalhosSemCusto > 0 ? "≥ " : ""}US$ ${formatadorDeDolares.format(conhecido)}`;
  return avisos.length === 0 ? dolares : `${dolares} (${avisos.join("; ")})`;
}

/** A fórmula, pura: o Uso de cada Etapa; cada execução vale uma vez, e a sessão externa com Uso, uma sessão. */
export function usoDaEtapa(
  { execucoes: todasAsExecucoes, usos, declarados }: FatosDeUso,
  porEtapa: DeclaracaoDasEtapas,
) {
  const etapaDoDeclarado = etapaDoUsoDeclarado(porEtapa);
  const execucoesPorEtapa = Map.groupBy(todasAsExecucoes, (execucao) => execucao.etapa);
  const usoPorEtapa = Map.groupBy(usos, (daExecucao) => daExecucao.etapa);
  const sessoesExternas = declarados.filter((declarado) => declarado.uso.porModelo().length > 0);
  return (etapa: EtapaTicket): ValorDoUso => {
    const execucoes = execucoesPorEtapa.get(etapa) ?? [];
    const sessoesDaEtapa = etapa === etapaDoDeclarado ? sessoesExternas : [];
    const usoExterno = somarUsos(sessoesDaEtapa.map((sessao) => sessao.uso));
    const uso = somarUsos((usoPorEtapa.get(etapa) ?? []).map((daExecucao) => daExecucao.uso)).somar(usoExterno);
    const modelos = uso.porModelo();
    const [entrada, saida, cacheLeitura, cacheEscrita] = [
      somar(modelos.map((m) => m.tokens_entrada)),
      somar(modelos.map((m) => m.tokens_saida)),
      somar(modelos.map((m) => m.tokens_cache_leitura)),
      somar(modelos.map((m) => m.tokens_cache_escrita)),
    ];
    return {
      execucoes: execucoes.length,
      falhas: execucoes.filter((e) => e.falha).length,
      duracaoMs: somar(execucoes.map((e) => e.duracaoMs)),
      tokens: { entrada, saida, cacheLeitura, cacheEscrita, total: entrada + saida + cacheLeitura + cacheEscrita },
      modelos,
      custo: uso.custo(),
      textoDoCusto: textoDoCusto(uso.custo()),
      custoExterno: { ...usoExterno.custo(), sessoes: sessoesDaEtapa.length },
    };
  };
}

/** As Etapas que declaram a Métrica de `tipo`, na ordem do fluxo, cada uma com o valor dela. */
export const valoresDasEtapasQueDeclaram = <Valor>(
  porEtapa: DeclaracaoDasEtapas,
  tipo: TipoMetrica,
  valorDaEtapa: (etapa: EtapaTicket) => Valor,
): Map<EtapaTicket, Valor> =>
  new Map(
    EtapaTicket.options
      .filter((etapa) => porEtapa[etapa].metricas.includes(tipo))
      .map((etapa) => [etapa, valorDaEtapa(etapa)]),
  );

/** O Uso de cada Etapa que o declara, no recorte. */
export const usoPorEtapa = (origem: OrigemDasMetricas, recorte: Recorte): Map<EtapaTicket, ValorDoUso> => {
  const { porEtapa } = origem.cicloDeVida.etapas();
  return valoresDasEtapasQueDeclaram(
    porEtapa,
    DEFINICAO_DO_USO.tipo,
    usoDaEtapa(lerFatosDeUso(origem.banco, origem.cicloDeVida.metricas(origem, recorte)), porEtapa),
  );
};
