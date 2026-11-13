// Os tickets do SDLC inteiro no recorte: quantos foram criados e quantos concluídos nele.
import { ticketsDasDemandas } from "../../../planejamento/publico.ts";
import { noPeriodo } from "../../nucleo/metrica.ts";
import { MetricaDoSdlc } from "../calculo_de_metrica.ts";
import type { EscopoDosFatos } from "../leitura_dos_fatos.ts";

/** Os instantes em que os tickets das demandas do recorte foram criados e, os concluídos, concluídos; os dois no período. */
interface FatosDosTickets {
  criados: string[];
  concluidos: string[];
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
    const tickets = ticketsDasDemandas(escopo.banco, escopo.demandas);
    return {
      criados: tickets
        .map((ticket) => ticket.criado_em ?? ticket.estado_alterado_em)
        .filter((instante) => noPeriodo(instante, escopo.periodo)),
      concluidos: tickets
        .filter((ticket) => ticket.estado === "concluido")
        .map((ticket) => ticket.concluido_em ?? ticket.estado_alterado_em)
        .filter((instante) => noPeriodo(instante, escopo.periodo)),
    };
  }

  formula({ criados, concluidos }: FatosDosTickets) {
    return { criados: criados.length, concluidos: concluidos.length };
  }
}
