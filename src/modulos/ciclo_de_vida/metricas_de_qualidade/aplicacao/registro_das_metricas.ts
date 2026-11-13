// O registro das Métricas: as de Sucesso, que cada Etapa declara na definição dela, e as do SDLC inteiro, de nenhuma Etapa.
// Métrica nova é um arquivo em metricas/ e uma linha aqui; a de Etapa, também o tipo dela em `TipoMetrica` e na
// definição de cada Etapa que a mede.
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../../etapas/publico.ts";
import type { Recorte } from "../nucleo/metrica.ts";
import type { ValorDaMetrica } from "./calculo_de_metrica.ts";
import type { OrigemDosFatos } from "./leitura_dos_fatos.ts";
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

/** Todas as Etapas, cada uma com os valores das Métricas que o catálogo declara para ela. */
export function metricasDasEtapas(origem: OrigemDosFatos, recorte: Recorte): Map<EtapaTicket, ValorDaMetrica[]> {
  const calculados = METRICAS_POR_ETAPA.map((calculo) => ({ calculo, valores: calculo.calcular(origem, recorte) }));
  return new Map(
    EtapaTicket.options.map((etapa) => [
      etapa,
      calculados
        .filter(({ calculo }) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(calculo.tipo))
        .map(({ calculo, valores }) => ({ definicao: calculo.definicao, valor: valores.get(etapa) })),
    ]),
  );
}

/** As Métricas do SDLC inteiro no recorte, na ordem do registro. */
export const metricasDoSdlc = (origem: OrigemDosFatos, recorte: Recorte): ValorDaMetrica[] =>
  METRICAS_DO_SDLC.map((metrica) => ({ definicao: metrica.definicao, valor: metrica.calcular(origem, recorte) }));
