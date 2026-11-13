// A nota (1–5) que o humano deu no Gate do PR da rodada; a única média das notas.
import type { EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerDecisoesDoRecorte } from "../leitura_dos_fatos.ts";

type DecisoesDoRecorte = ReturnType<typeof lerDecisoesDoRecorte>;

export class MetricaDeNotaHumana extends MetricaPorEtapa<
  DecisoesDoRecorte,
  {
    /** `soma` e `quantidade` deixam o recorte maior somar sem tirar média de médias. */
    soma: number;
    quantidade: number;
    /** `null` sem nota. */
    media: number | null;
  }
> {
  readonly definicao = { tipo: "nota_humana", rotulo: "Nota humana", fonte: "Gate do PR" } as const;

  protected lerFatos(escopo: EscopoDosFatos): DecisoesDoRecorte {
    return lerDecisoesDoRecorte(escopo);
  }

  formula(decisoes: DecisoesDoRecorte) {
    return (etapa: EtapaTicket) => {
      // Só o PR aprovado tem nota: a reprovação não conta.
      const notas = decisoes.flatMap((d) => (d.etapa === etapa && !d.reprovada && d.nota !== null ? [d.nota] : []));
      const soma = notas.reduce((total, nota) => total + nota, 0);
      return { soma, quantidade: notas.length, media: notas.length === 0 ? null : soma / notas.length };
    };
  }
}
