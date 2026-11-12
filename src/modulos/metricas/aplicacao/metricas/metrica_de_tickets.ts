// Os tickets do SDLC inteiro no recorte: quantos foram criados e quantos concluídos nele.
import type { DatabaseSync } from "node:sqlite";
import { fatosDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";

export class MetricaDeTickets extends MetricaDoSdlc<"tickets", { criados: number; concluidos: number }> {
  readonly definicao = { tipo: "tickets", rotulo: "Tickets", fonte: "Criação e conclusão dos tickets" } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const fatos = fatosDoRecorte(banco, recorte);
    return {
      criados: fatos.filter((fato) => fato === "ticketsCriados").length,
      concluidos: fatos.filter((fato) => fato === "ticketsConcluidos").length,
    };
  }
}
