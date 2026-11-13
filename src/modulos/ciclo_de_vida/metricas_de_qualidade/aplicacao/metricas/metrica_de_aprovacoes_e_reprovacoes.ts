// As Decisões do Gate da demanda: quantas aprovaram e quantas reprovaram.
import type { EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerDecisoesDoRecorte } from "../leitura_dos_fatos.ts";

type DecisoesDoRecorte = ReturnType<typeof lerDecisoesDoRecorte>;

export class MetricaDeAprovacoesEReprovacoes extends MetricaPorEtapa<
  DecisoesDoRecorte,
  { aprovacoes: number; reprovacoes: number }
> {
  readonly definicao = {
    tipo: "aprovacoes_e_reprovacoes",
    rotulo: "Reprovações no Gate",
    fonte: "Gate da demanda",
  } as const;

  protected lerFatos(escopo: EscopoDosFatos): DecisoesDoRecorte {
    return lerDecisoesDoRecorte(escopo);
  }

  formula(decisoes: DecisoesDoRecorte) {
    return (etapa: EtapaTicket) => {
      const daEtapa = decisoes.filter((d) => d.etapa === etapa);
      const reprovacoes = daEtapa.filter((d) => d.reprovada).length;
      return { aprovacoes: daEtapa.length - reprovacoes, reprovacoes };
    };
  }
}
