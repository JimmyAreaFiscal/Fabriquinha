// Os tickets do SDLC inteiro no recorte: quantos foram criados e quantos concluídos nele.
import { noPeriodo } from "../../nucleo/metrica.ts";
import { type FatoDatado, MetricaDoSdlc } from "../calculo_de_metrica.ts";
import { type EscopoDosFatos, ticketsDoEscopo } from "../leitura_dos_fatos.ts";

/** Os instantes em que os tickets das demandas do recorte foram criados e, os concluídos, concluídos; os dois no período. */
interface FatosDosTickets {
  criados: FatoDatado[];
  concluidos: FatoDatado[];
}

export class MetricaDeTickets extends MetricaDoSdlc<
  "tickets",
  FatosDosTickets,
  { criados: number; concluidos: number }
> {
  readonly definicao = { tipo: "tickets", rotulo: "Tickets", fonte: "Criação e conclusão dos tickets" } as const;

  /**
   * O ticket novo não grava `criado_em` nem `concluido_em` (só o backfill grava): os dois caem na última mudança de estado.
   * shortcut: ticket novo conta como criado quando mudou de estado pela última vez, gravar `criado_em` no domínio se isso incomodar.
   */
  protected lerFatos(escopo: EscopoDosFatos): FatosDosTickets {
    const tickets = ticketsDoEscopo(escopo);
    return {
      criados: tickets
        .map((ticket) => ({ demanda_id: ticket.demanda_id, em: ticket.criado_em ?? ticket.estado_alterado_em }))
        .filter(({ em }) => noPeriodo(em, escopo.periodo)),
      concluidos: tickets
        .filter((ticket) => ticket.estado === "concluido")
        .map((ticket) => ({ demanda_id: ticket.demanda_id, em: ticket.concluido_em ?? ticket.estado_alterado_em }))
        .filter(({ em }) => noPeriodo(em, escopo.periodo)),
    };
  }

  formula({ criados, concluidos }: FatosDosTickets) {
    return { criados: criados.length, concluidos: concluidos.length };
  }
}
