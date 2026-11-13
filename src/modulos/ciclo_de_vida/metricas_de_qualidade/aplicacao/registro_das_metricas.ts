// O registro das Métricas: as de Sucesso, que cada Etapa declara na definição dela, e as do SDLC inteiro, de nenhuma Etapa.
// Métrica nova é um arquivo em metricas/ e uma linha aqui; a de Etapa, também o tipo dela em `TipoMetrica` e na
// definição de cada Etapa que a mede.
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../etapas/publico.ts";
import type { Recorte } from "../nucleo/metrica.ts";
import { DEMANDA_DO_FATO, type ParteDoFato, type ValorDaMetrica, type ValoresPorParte } from "./calculo_de_metrica.ts";
import { type EscopoDosFatos, escopoDoRecorte, type OrigemDosFatos } from "./leitura_dos_fatos.ts";
import { MetricaDeAlteracoesPosteriores } from "./metricas/metrica_de_alteracoes_posteriores.ts";
import { MetricaDeAprovacoesEReprovacoes } from "./metricas/metrica_de_aprovacoes_e_reprovacoes.ts";
import { MetricaDeBugsNosArquivosRevisados } from "./metricas/metrica_de_bugs_nos_arquivos_revisados.ts";
import { MetricaDeDemandas } from "./metricas/metrica_de_demandas.ts";
import { MetricaDeConformidade } from "./metricas/metrica_de_conformidade.ts";
import { MetricaDeExigenciasDeAlteracao } from "./metricas/metrica_de_exigencias_de_alteracao.ts";
import { MetricaDeNotaHumana } from "./metricas/metrica_de_nota_humana.ts";
import { MetricaDePrs } from "./metricas/metrica_de_prs.ts";
import { MetricaDeTickets } from "./metricas/metrica_de_tickets.ts";
import { MetricaDeUso } from "./metricas/metrica_de_uso.ts";

const METRICAS_POR_ETAPA = [
  new MetricaDeUso(),
  new MetricaDeAprovacoesEReprovacoes(),
  new MetricaDeConformidade(),
  new MetricaDeAlteracoesPosteriores(),
  new MetricaDeExigenciasDeAlteracao(),
  new MetricaDeBugsNosArquivosRevisados(),
  new MetricaDeNotaHumana(),
];

const METRICAS_DO_SDLC = [new MetricaDeDemandas(), new MetricaDeTickets(), new MetricaDePrs()];

export type TipoMetricaDoSdlc = (typeof METRICAS_DO_SDLC)[number]["definicao"]["tipo"];

/** De cada valor por parte, o do recorte ou o de uma parte. */
type ValorEscolhido = <Valor>(valores: ValoresPorParte<Valor>) => Valor;

const DO_RECORTE: ValorEscolhido = (valores) => valores.doRecorte();

/**
 * Todas as Etapas, cada uma com os valores das Métricas que o catálogo declara para ela, no escopo e em cada parte dele:
 * cada Métrica lê os fatos dela uma vez.
 */
export function metricasDasEtapasPorParte(
  escopo: EscopoDosFatos,
  parteDoFato: ParteDoFato,
): ValoresPorParte<Map<EtapaTicket, ValorDaMetrica[]>> {
  const calculados = METRICAS_POR_ETAPA.map((calculo) => {
    const valores: ValoresPorParte<Map<EtapaTicket, unknown>> = calculo.calcularPorParte(escopo, parteDoFato);
    return { calculo, valores };
  });
  const porEtapa = (escolher: ValorEscolhido) => {
    const escolhidos = calculados.map(({ calculo, valores }) => ({ calculo, valorDaEtapa: escolher(valores) }));
    return new Map(
      EtapaTicket.options.map((etapa) => [
        etapa,
        escolhidos
          .filter(({ calculo }) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(calculo.tipo))
          .map(({ calculo, valorDaEtapa }) => ({ definicao: calculo.definicao, valor: valorDaEtapa.get(etapa) })),
      ]),
    );
  };
  return { doRecorte: () => porEtapa(DO_RECORTE), daParte: (parte) => porEtapa((valores) => valores.daParte(parte)) };
}

/** As Métricas do SDLC inteiro, na ordem do registro, no escopo e em cada parte dele, cada uma lendo os fatos uma vez. */
export function metricasDoSdlcPorParte(
  escopo: EscopoDosFatos,
  parteDoFato: ParteDoFato,
): ValoresPorParte<ValorDaMetrica[]> {
  const calculados = METRICAS_DO_SDLC.map((metrica) => {
    const valores: ValoresPorParte<unknown> = metrica.calcularPorParte(escopo, parteDoFato);
    return { definicao: metrica.definicao, valores };
  });
  const escolher = (escolhido: ValorEscolhido) =>
    calculados.map(({ definicao, valores }) => ({ definicao, valor: escolhido(valores) }));
  return { doRecorte: () => escolher(DO_RECORTE), daParte: (parte) => escolher((valores) => valores.daParte(parte)) };
}

/** Todas as Etapas, cada uma com os valores das Métricas que o catálogo declara para ela. */
/** @testes o teste do registro pede um recorte só; a produção pede por parte */
export const metricasDasEtapas = (origem: OrigemDosFatos, recorte: Recorte): Map<EtapaTicket, ValorDaMetrica[]> =>
  metricasDasEtapasPorParte(escopoDoRecorte(origem, recorte), DEMANDA_DO_FATO).doRecorte();

/** As Métricas do SDLC inteiro no recorte, na ordem do registro. */
/** @testes o teste do registro pede um recorte só; a produção pede por parte */
export const metricasDoSdlc = (origem: OrigemDosFatos, recorte: Recorte): ValorDaMetrica[] =>
  metricasDoSdlcPorParte(escopoDoRecorte(origem, recorte), DEMANDA_DO_FATO).doRecorte();
