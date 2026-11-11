// As linhas que pessoas alteraram depois, na base, nos commits que a Etapa de revisão revisou.
import type { DatabaseSync } from "node:sqlite";
import { commitsDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import { CATALOGO_DE_ETAPAS } from "../../../fluxo/nucleo/etapa.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

export class MetricaDeBugsNosArquivosRevisados extends CalculoDeMetrica<{ alteradasPorHumanos: number }> {
  readonly definicao = {
    tipo: "bugs_nos_arquivos_revisados",
    rotulo: "Bugs nos arquivos revisados",
    fonte: "Commits humanos posteriores na base",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const commits = commitsDoRecorte(banco, recorte);
    // shortcut: o banco guarda as linhas alteradas por commit, não por arquivo; a revisão da rodada conta os commits das rodadas e a da demanda, todos.
    return (etapa: EtapaTicket) => ({
      alteradasPorHumanos: commits
        .filter((c) => CATALOGO_DE_ETAPAS[etapa].escopo === "demanda" || c.rodadaId !== null)
        .reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
    });
  }
}
