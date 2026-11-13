// O teste que entrega o ticket direto à Condução, sem passar pelo ciclo do agendador, o reserva antes, como o Despacho:
// a Condução recebe o ticket já reservado.
import type { DatabaseSync } from "node:sqlite";
import { reservarTicketParaAFabriquinha } from "../src/modulos/ciclo_de_vida/despacho/publico.ts";
import type { Endereco } from "../src/modulos/ciclo_de_vida/publico.ts";
import { carregarDemanda } from "../src/modulos/ciclo_de_vida/processo/armazenamento/agregado_da_demanda.ts";
import { predecessorasPendentesDosPedidos } from "../src/modulos/demandas/publico.ts";
import { relogioDoSistema } from "../src/shared/nucleo/relogio.ts";

/**
 * Reserva o ticket de `endereco` se ele está aberto (o planejamento em execução se retoma), com as predecessoras da
 * demanda que quem chama o Despacho lhe informaria, e devolve o endereço para a Condução.
 */
export function reservadoPeloDespacho(banco: DatabaseSync, endereco: Endereco): Endereco {
  const { demanda_id } = endereco;
  const ticket = carregarDemanda(banco, demanda_id).tickets.find((t) => t.ticket_id === endereco.ticket_id);
  if (ticket?.estado === "aberto") {
    const liberada = predecessorasPendentesDosPedidos(banco, [demanda_id]).get(demanda_id)?.length === 0;
    reservarTicketParaAFabriquinha(banco, ticket, relogioDoSistema, liberada);
  }
  return endereco;
}
