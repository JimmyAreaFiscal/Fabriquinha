// Leituras do Despacho: as demandas que ele avalia e os tickets com trabalho vivo. Só lê; a seleção é do núcleo, e a
// reserva e a entrega à Condução são da aplicação.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { Endereco } from "../../etapas/publico.ts";
import type { EstadoDemanda } from "../../processo/publico.ts";
import { carregarDemanda } from "../../../sdlc/armazenamento/demandas.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import { execucoesAbertas } from "../../../sessoes/publico.ts";

// `estados` são os da demanda em andamento em que o agendador despacha; quem os escolhe é a aplicação.
const emLista = (estados: readonly EstadoDemanda[]) => `(${estados.map((estado) => `'${estado}'`).join(", ")})`;

/** Os agregados das demandas em um dos `estados`, na ordem de criação. */
export const agregadosParaDespacho = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): AgregadoDemanda[] =>
  lerEmSnapshot(banco, () =>
    banco
      .prepare(`SELECT id FROM demanda WHERE estado IN ${emLista(estados)} ORDER BY rowid`)
      .all()
      .map(({ id }) => carregarDemanda(banco, id as string)),
  );

/** Os tickets com trabalho vivo: execução aberta, com ou sem o pi no ar. */
export const trabalhosVivos = (banco: DatabaseSync): Endereco[] =>
  execucoesAbertas(banco).map(({ demanda_id, ticket_id }) => Endereco.doTicket(demanda_id, ticket_id));
