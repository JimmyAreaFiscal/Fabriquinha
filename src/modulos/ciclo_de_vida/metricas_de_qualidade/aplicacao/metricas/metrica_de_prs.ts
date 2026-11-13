// Os PRs das rodadas do SDLC inteiro abertos no recorte, e quantos deles a Etapa que publica o PR aprovou (mergeados).
import { evidenciasDoTipoDasDemandas } from "../../../evidencias/publico.ts";
import { etapaDoPapel } from "../../../etapas/publico.ts";
import { decisoesEmLote } from "../../../processo/publico.ts";
import { noPeriodo } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, ticketsCitados } from "../leitura_dos_fatos.ts";

/** Os PRs abertos no recorte: se a rodada de cada um foi aprovada na Etapa que publica o PR. */
type FatosDosPrs = { mergeado: boolean }[];

export class MetricaDePrs extends MetricaDoSdlc<"prs", FatosDosPrs, { abertos: number; mergeados: number }> {
  readonly definicao = { tipo: "prs", rotulo: "PRs", fonte: "PR aberto e Gate do PR das rodadas" } as const;

  /**
   * Um PR por rodada, no instante do primeiro `pr_aberto` dela (o do ticket, nas rodadas novas, ou o da própria rodada,
   * nas migradas). Mergeado quando a rodada tem a Etapa que publica o PR aprovada: por coorte, nunca passa dos abertos.
   */
  protected lerFatos(escopo: EscopoDosFatos): FatosDosPrs {
    const etapaQuePublicaOPr = etapaDoPapel("publica_o_pr_da_rodada");
    const prsAbertos = evidenciasDoTipoDasDemandas(escopo.banco, { demandas: escopo.demandas, tipo: "pr_aberto" });
    // As Decisões são só das demandas com PR, e os tickets delas já vêm com os dos PRs.
    const ticketDe = ticketsCitados(escopo.banco, prsAbertos);
    const porRodada = Map.groupBy(prsAbertos, (pr) => {
      const rodadaId = pr.rodada_id ?? (pr.ticket_id === null ? null : ticketDe(pr.demanda_id, pr.ticket_id).rodada_id);
      return `${pr.demanda_id}\0${String(rodadaId)}`;
    });
    const abertosNoRecorte = [...porRodada].filter(([, daRodada]) =>
      noPeriodo((daRodada.map((pr) => pr.em).toSorted() as [string])[0], escopo.periodo),
    );
    const demandasComPr = [...new Set(abertosNoRecorte.flatMap(([, daRodada]) => daRodada.map((pr) => pr.demanda_id)))];
    const aprovadas = new Set(
      decisoesEmLote(escopo.banco, { demandas: demandasComPr }).flatMap((decisao) => {
        const ticket = ticketDe(decisao.demanda_id, decisao.ticket_id);
        // Sem rodada não há PR da rodada a aprovar.
        return ticket.rodada_id !== null && ticket.etapa === etapaQuePublicaOPr && decisao.resultado !== "reprovado"
          ? [`${decisao.demanda_id}\0${String(ticket.rodada_id)}`]
          : [];
      }),
    );
    return abertosNoRecorte.map(([rodada]) => ({ mergeado: aprovadas.has(rodada) }));
  }

  formula(prs: FatosDosPrs) {
    return { abertos: prs.length, mergeados: prs.filter((pr) => pr.mergeado).length };
  }
}
