// As linhas escritas na Etapa que pessoas alteraram depois, na base.
import type { DatabaseSync } from "node:sqlite";
import { commitsDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

export class MetricaDeAlteracoesPosteriores extends CalculoDeMetrica<{
  adicionadas: number;
  alteradasPorHumanos: number;
}> {
  readonly definicao = {
    tipo: "alteracoes_posteriores",
    rotulo: "Alterações posteriores no código",
    fonte: "Commits humanos posteriores na base",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const commits = commitsDoRecorte(banco, recorte);
    return (etapa: EtapaTicket) => {
      const daEtapa = commits.filter((c) => c.etapa === etapa);
      return {
        adicionadas: daEtapa.reduce((soma, c) => soma + c.adicionadas, 0),
        alteradasPorHumanos: daEtapa.reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
      };
    };
  }
}
