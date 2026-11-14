// Leituras do Despacho: as demandas que ele avalia e os tickets com trabalho vivo. Só lê; a seleção é do núcleo, e a
// reserva e a entrega à Condução são da aplicação.
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  carregarDemanda,
  demandasNosEstados,
  type EstadoDemanda,
} from "../../processo/publico.ts";
import { Endereco } from "../../etapas/publico.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { montarSessoesDeAgente } from "../../../sessoes/publico.ts";

/**
 * Os agregados das demandas em um dos `estados` (os da demanda em andamento em que o agendador despacha; quem os escolhe
 * é a aplicação), na ordem de criação.
 */
export const agregadosParaDespacho = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): AgregadoDemanda[] =>
  lerEmSnapshot(banco, () => demandasNosEstados(banco, estados).map((id) => carregarDemanda(banco, id)));

/** Os tickets com trabalho vivo: execução aberta, com ou sem o pi no ar. */
export const trabalhosVivos = (banco: DatabaseSync): Endereco[] =>
  montarSessoesDeAgente({ banco })
    .listar({ abertas: true })
    .map(({ demanda_id, ticket_id }) => Endereco.doTicket(demanda_id, ticket_id));
