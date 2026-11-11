// Os PRs das rodadas do SDLC inteiro abertos no recorte, e quantos deles a Etapa que publica o PR aprovou (mergeados).
import type { DatabaseSync } from "node:sqlite";
import { prsDoRecorte } from "../../armazenamento/metricas_demanda.ts";
import { etapaDoPapel } from "../../../etapas/catalogo.ts";
import type { Recorte } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";

export class MetricaDePrs extends MetricaDoSdlc<"prs", { abertos: number; mergeados: number }> {
  readonly definicao = { tipo: "prs", rotulo: "PRs", fonte: "PR aberto e Gate do PR das rodadas" } as const;

  protected medir(banco: DatabaseSync, recorte: Recorte) {
    const prs = prsDoRecorte(banco, recorte, etapaDoPapel("publica_o_pr_da_rodada"));
    return { abertos: prs.length, mergeados: prs.filter((pr) => pr.mergeado).length };
  }
}
