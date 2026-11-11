// As demandas do SDLC inteiro no recorte: quantas foram registradas e quantas concluídas nele.
import type { DatabaseSync } from "node:sqlite";
import { fatosDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";

export class MetricaDeDemandas extends MetricaDoSdlc<"demandas", { registradas: number; concluidas: number }> {
  readonly definicao = { tipo: "demandas", rotulo: "Demandas", fonte: "Registro e conclusão das demandas" } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const fatos = fatosDoRecorte(banco, recorte);
    return {
      registradas: fatos.filter((fato) => fato === "demandasRegistradas").length,
      concluidas: fatos.filter((fato) => fato === "demandasConcluidas").length,
    };
  }
}
