// As linhas escritas na Etapa que pessoas alteraram depois, na base.
import type { EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerCommitsDoRecorte } from "../leitura_dos_fatos.ts";

interface CommitsDoRecorte {
  commits: ReturnType<typeof lerCommitsDoRecorte>;
}

export class MetricaDeAlteracoesPosteriores extends MetricaPorEtapa<
  CommitsDoRecorte,
  { adicionadas: number; alteradasPorHumanos: number }
> {
  readonly definicao = {
    tipo: "alteracoes_posteriores",
    rotulo: "Alterações posteriores no código",
    fonte: "Commits humanos posteriores na base",
  } as const;

  protected lerFatos(escopo: EscopoDosFatos): CommitsDoRecorte {
    return { commits: lerCommitsDoRecorte(escopo) };
  }

  formula({ commits }: CommitsDoRecorte) {
    return (etapa: EtapaTicket) => {
      const daEtapa = commits.filter((c) => c.etapa === etapa);
      return {
        adicionadas: daEtapa.reduce((soma, c) => soma + c.adicionadas, 0),
        alteradasPorHumanos: daEtapa.reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
      };
    };
  }
}
