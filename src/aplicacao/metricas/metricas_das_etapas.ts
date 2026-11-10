// A tela de Métricas e a avaliação: cada Etapa com as Métricas de Sucesso que o catálogo declara para ela.
import type { DatabaseSync } from "node:sqlite";
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { EtapaTicket } from "../../nucleo/primitivos.ts";
import type { ValorDaMetrica } from "./calculo_de_metrica.ts";
import { MetricaDeAlteracoesPosteriores } from "./metrica_de_alteracoes_posteriores.ts";
import { MetricaDeAprovacoesEReprovacoes } from "./metrica_de_aprovacoes_e_reprovacoes.ts";
import { MetricaDeBugsNosArquivosRevisados } from "./metrica_de_bugs_nos_arquivos_revisados.ts";
import { MetricaDeConformidade } from "./metrica_de_conformidade.ts";
import { MetricaDeExigenciasDeAlteracao } from "./metrica_de_exigencias_de_alteracao.ts";
import { MetricaDeNotaHumana } from "./metrica_de_nota_humana.ts";
import { MetricaDeUso } from "./metrica_de_uso.ts";

const CALCULOS = [
  new MetricaDeUso(),
  new MetricaDeAprovacoesEReprovacoes(),
  new MetricaDeConformidade(),
  new MetricaDeAlteracoesPosteriores(),
  new MetricaDeExigenciasDeAlteracao(),
  new MetricaDeBugsNosArquivosRevisados(),
  new MetricaDeNotaHumana(),
];

/** Todas as Etapas, cada uma com os valores das Métricas que o catálogo declara para ela. */
export function metricasDasEtapas(banco: DatabaseSync, recorte: Recorte): Map<EtapaTicket, ValorDaMetrica[]> {
  const calculados = CALCULOS.map((calculo) => ({ calculo, valores: calculo.calcular(banco, recorte) }));
  return new Map(
    EtapaTicket.options.map((etapa) => [
      etapa,
      calculados
        .filter(({ calculo }) => CATALOGO_DE_ETAPAS[etapa].metricas.includes(calculo.tipo))
        .map(({ calculo, valores }) => ({ definicao: calculo.definicao, valor: valores.get(etapa) })),
    ]),
  );
}
