// As Métricas do Repositório de cada Etapa: as linhas escritas na Etapa que pessoas alteraram depois, na base, e as dos
// commits que a Etapa de revisão revisou. O Repositório dá as alterações de cada commit de ticket; aqui elas se juntam
// pela Etapa e pela rodada do ticket, que o Ciclo de Vida diz.
import type { DatabaseSync } from "node:sqlite";
import {
  CATALOGO_DE_ETAPAS,
  type EtapaTicket,
  metricasDoCicloDeVida,
  type MetricasDoProcesso,
  type OrigemDosFatos,
  type Recorte,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import { montarRepositorio } from "../../../modulos/repositorio/publico.ts";
import { valoresDasEtapasQueDeclaram } from "./metrica_de_uso.ts";

export const DEFINICAO_DAS_ALTERACOES_POSTERIORES = {
  tipo: "alteracoes_posteriores",
  rotulo: "Alterações posteriores no código",
  fonte: "Commits humanos posteriores na base",
} as const;

export const DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS = {
  tipo: "bugs_nos_arquivos_revisados",
  rotulo: "Bugs nos arquivos revisados",
  fonte: "Commits humanos posteriores na base",
} as const;

/** Um commit de ticket feito no período, com a Etapa e a rodada do ticket (`null` em ticket de demanda). */
export interface CommitDaEtapa {
  demanda_id: string;
  em: string;
  etapa: string;
  rodadaId: number | null;
  adicionadas: number;
  alteradasPorHumanos: number;
}

/** Os commits de ticket das demandas do recorte feitos no período, lidos do Repositório uma vez. */
export function lerCommitsDoPeriodo(banco: DatabaseSync, processo: MetricasDoProcesso): CommitDaEtapa[] {
  const { alteracoes } = montarRepositorio({ banco }).metricas({
    demandas: processo.demandas,
    periodo: processo.periodo,
  });
  return alteracoes.map((commit) => ({
    demanda_id: commit.demanda_id,
    em: commit.em,
    ...processo.ticketDoFato(commit.demanda_id, commit.ticket_id),
    adicionadas: commit.linhasAdicionadas,
    alteradasPorHumanos: commit.linhasAlteradasPorHumanos,
  }));
}

/** A fórmula, pura: as linhas adicionadas na Etapa e as que pessoas alteraram depois. */
export const alteracoesPosterioresDaEtapa =
  (commits: readonly CommitDaEtapa[]) =>
  (etapa: EtapaTicket): { adicionadas: number; alteradasPorHumanos: number } => {
    const daEtapa = commits.filter((c) => c.etapa === etapa);
    return {
      adicionadas: daEtapa.reduce((soma, c) => soma + c.adicionadas, 0),
      alteradasPorHumanos: daEtapa.reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
    };
  };

/**
 * A fórmula, pura: as linhas que pessoas alteraram depois nos commits que a revisão revisou.
 * shortcut: o banco guarda as linhas alteradas por commit, não por arquivo; a revisão da rodada conta os commits das
 * rodadas e a da demanda, todos.
 */
export const bugsNosArquivosRevisadosDaEtapa =
  (commits: readonly CommitDaEtapa[]) =>
  (etapa: EtapaTicket): { alteradasPorHumanos: number } => ({
    alteradasPorHumanos: commits
      .filter((c) => CATALOGO_DE_ETAPAS[etapa].escopo === "demanda" || c.rodadaId !== null)
      .reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
  });

const commitsDoRecorte = (origem: OrigemDosFatos, recorte: Recorte) =>
  lerCommitsDoPeriodo(origem.banco, metricasDoCicloDeVida(origem, recorte));

/** As alterações posteriores de cada Etapa que as declara, no recorte. */
/** @testes o teste da métrica pede um recorte só; a produção junta as Etapas por parte */
export const alteracoesPosterioresPorEtapa = (origem: OrigemDosFatos, recorte: Recorte) =>
  valoresDasEtapasQueDeclaram(
    DEFINICAO_DAS_ALTERACOES_POSTERIORES.tipo,
    alteracoesPosterioresDaEtapa(commitsDoRecorte(origem, recorte)),
  );

/** Os bugs nos arquivos revisados de cada Etapa que os declara, no recorte. */
/** @testes o teste da métrica pede um recorte só; a produção junta as Etapas por parte */
export const bugsNosArquivosRevisadosPorEtapa = (origem: OrigemDosFatos, recorte: Recorte) =>
  valoresDasEtapasQueDeclaram(
    DEFINICAO_DOS_BUGS_NOS_ARQUIVOS_REVISADOS.tipo,
    bugsNosArquivosRevisadosDaEtapa(commitsDoRecorte(origem, recorte)),
  );
