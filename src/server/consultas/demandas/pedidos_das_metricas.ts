// Os pedidos que as Métricas de Qualidade recebem como dado (o Ciclo de Vida não importa Demandas), lidos em lote: o
// cadastro e o histórico administrativo vêm de Demandas e o andamento (estado e última mudança), do processo.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import type { PedidoDasMetricas } from "../../../modulos/ciclo_de_vida/publico.ts";
import { historicoDosPedidosEmLote } from "../../../modulos/demandas/publico.ts";
import { andamentoDasDemandasEmLote } from "../../../modulos/sdlc/armazenamento/demandas.ts";

/** Os pedidos das demandas `ids`, ou de todas sem `ids`, na ordem em que foram registrados. */
export const lerPedidosDasMetricas = (banco: DatabaseSync, ids?: readonly string[]): PedidoDasMetricas[] =>
  lerEmSnapshot(banco, () => {
    const andamentos = andamentoDasDemandasEmLote(banco, ids);
    return historicoDosPedidosEmLote(banco, ids).map(({ id, projeto, titulo, criadaEm, concluidaEm }) => {
      const { estado, estadoAlteradoEm } = encontrado(
        andamentos.get(id),
        `a demanda ${id} não tem processo`,
        "recarregue",
      );
      return { id, projeto, titulo, estado, estadoAlteradoEm, criadaEm, concluidaEm };
    });
  });
