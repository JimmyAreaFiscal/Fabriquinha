// Leituras do agendador das demandas (comparacao-sdlc-implementacao.md §4.1): o que há para despachar e quais tickets têm
// trabalho vivo. Só lê; a seleção é do Despacho, e a reserva e o início são do serviço de despacho.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { Endereco } from "../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import type { EstadoDemanda } from "../../compartilhado/nucleo/primitivos.ts";
import { carregarDemanda } from "../../demanda/armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../demanda/armazenamento/dependencias_demanda.ts";
import { lerEmSnapshot } from "../../compartilhado/armazenamento/snapshot.ts";
import { processosAbertos } from "./trabalho_agentico.ts";

// `estados` são os da demanda em andamento em que o agendador despacha; quem os escolhe é a aplicação.
const emLista = (estados: readonly EstadoDemanda[]) => `(${estados.map((estado) => `'${estado}'`).join(", ")})`;

interface DemandaParaDespacho {
  agregado: AgregadoDemanda;
  predecessoras: { demanda_id: string; estado: EstadoDemanda }[];
}

/** As demandas em um dos `estados`, com o agregado e as predecessoras diretas. */
export const demandasParaDespacho = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): DemandaParaDespacho[] =>
  lerEmSnapshot(banco, () =>
    banco
      .prepare(`SELECT id FROM demanda WHERE estado IN ${emLista(estados)} ORDER BY rowid`)
      .all()
      .map(({ id }) => ({
        agregado: carregarDemanda(banco, id as string),
        predecessoras: predecessorasDaDemanda(banco, id as string),
      })),
  );

/** Os tickets com trabalho vivo: execução aberta, com ou sem o pi no ar. */
export const trabalhosVivos = (banco: DatabaseSync): Endereco[] =>
  processosAbertos(banco).map(({ demanda_id, ticket_id }) => Endereco.doTicket(demanda_id, ticket_id));
