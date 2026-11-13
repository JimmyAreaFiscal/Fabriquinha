// As linhas que pessoas alteraram depois, na base, nos commits que a Etapa de revisão revisou.
import { CATALOGO_DE_ETAPAS, type EtapaTicket } from "../../../etapas/publico.ts";
import { MetricaPorEtapa } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, lerCommitsDoRecorte } from "../leitura_dos_fatos.ts";

interface CommitsDoRecorte {
  commits: ReturnType<typeof lerCommitsDoRecorte>;
}

export class MetricaDeBugsNosArquivosRevisados extends MetricaPorEtapa<
  CommitsDoRecorte,
  { alteradasPorHumanos: number }
> {
  readonly definicao = {
    tipo: "bugs_nos_arquivos_revisados",
    rotulo: "Bugs nos arquivos revisados",
    fonte: "Commits humanos posteriores na base",
  } as const;

  protected lerFatos(escopo: EscopoDosFatos): CommitsDoRecorte {
    return { commits: lerCommitsDoRecorte(escopo) };
  }

  formula({ commits }: CommitsDoRecorte) {
    // shortcut: o banco guarda as linhas alteradas por commit, não por arquivo; a revisão da rodada conta os commits das rodadas e a da demanda, todos.
    return (etapa: EtapaTicket) => ({
      alteradasPorHumanos: commits
        .filter((c) => CATALOGO_DE_ETAPAS[etapa].escopo === "demanda" || c.rodadaId !== null)
        .reduce((soma, c) => soma + c.alteradasPorHumanos, 0),
    });
  }
}
