// Os pedidos que as Métricas de Qualidade recebem como dado (o Ciclo de Vida não importa Demandas), lidos em lote: o
// cadastro e o histórico administrativo vêm de Demandas e o andamento (estado e última mudança), do processo.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import type { CicloDeVida, PedidoDasMetricas } from "../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";

/** Os pedidos das demandas `ids`, ou de todas sem `ids`, na ordem em que foram registrados. */
export const lerPedidosDasMetricas = (
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  ids?: readonly string[],
): PedidoDasMetricas[] =>
  lerEmSnapshot(banco, () => {
    const andamentos = cicloDeVida.estados(ids);
    return gestaoDeDemandas.pedidos({ ids }).map(({ id, projeto, titulo, criadaEm, concluidaEm }) => {
      const { estado, estadoAlteradoEm } = encontrado(
        andamentos.get(id),
        `a demanda ${id} não tem processo`,
        "recarregue",
      );
      return { id, projeto, titulo, estado, estadoAlteradoEm, criadaEm, concluidaEm };
    });
  });
