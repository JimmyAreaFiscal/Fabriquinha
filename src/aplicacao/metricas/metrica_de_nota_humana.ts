// A nota (1–5) que o humano deu no Gate do PR da rodada; a única média das notas.
import type { DatabaseSync } from "node:sqlite";
import { decisoesDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import type { EtapaTicket } from "../../nucleo/primitivos.ts";
import { CalculoDeMetrica } from "./calculo_de_metrica.ts";

export class MetricaDeNotaHumana extends CalculoDeMetrica<{
  /** `soma` e `quantidade` deixam o recorte maior somar sem tirar média de médias. */
  soma: number;
  quantidade: number;
  /** `null` sem nota. */
  media: number | null;
}> {
  readonly definicao = { tipo: "nota_humana", rotulo: "Nota humana", fonte: "Gate do PR" } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const decisoes = decisoesDoRecorte(banco, recorte);
    return (etapa: EtapaTicket) => {
      // Só o PR aprovado tem nota: a reprovação não conta.
      const notas = decisoes.flatMap((d) => (d.etapa === etapa && !d.reprovada && d.nota !== null ? [d.nota] : []));
      const soma = notas.reduce((total, nota) => total + nota, 0);
      return { soma, quantidade: notas.length, media: notas.length === 0 ? null : soma / notas.length };
    };
  }
}
