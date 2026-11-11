// As Decisões do Gate da demanda: quantas aprovaram e quantas reprovaram.
import type { DatabaseSync } from "node:sqlite";
import { decisoesDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

export class MetricaDeAprovacoesEReprovacoes extends CalculoDeMetrica<{ aprovacoes: number; reprovacoes: number }> {
  readonly definicao = {
    tipo: "aprovacoes_e_reprovacoes",
    rotulo: "Reprovações no Gate",
    fonte: "Gate da demanda",
  } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const decisoes = decisoesDoRecorte(banco, recorte);
    return (etapa: EtapaTicket) => {
      const daEtapa = decisoes.filter((d) => d.etapa === etapa);
      const reprovacoes = daEtapa.filter((d) => d.reprovada).length;
      return { aprovacoes: daEtapa.length - reprovacoes, reprovacoes };
    };
  }
}
