// Os pedidos que as Métricas de Qualidade recebem como dado (o Ciclo de Vida não importa Demandas), lidos em lote.
// provisório: a tabela `demanda` é dos Pedidos de Demandas; o ticket 19 traz esta leitura para a fachada de Demandas.
import type { DatabaseSync } from "node:sqlite";
import type { PedidoDasMetricas } from "../../ciclo_de_vida/publico.ts";
import { instrucaoPreparada } from "../../../shared/armazenamento/banco.ts";

/** Os pedidos das demandas `ids`, ou de todas sem `ids`, na ordem em que foram registrados. */
export const lerPedidosDasMetricas = (banco: DatabaseSync, ids?: readonly string[]): PedidoDasMetricas[] =>
  instrucaoPreparada(
    banco,
    `SELECT d.id, d.projeto, d.titulo, d.estado, d.estado_alterado_em, h.criada_em, h.concluida_em
       FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id
       WHERE $ids IS NULL OR d.id IN (SELECT value FROM json_each($ids)) ORDER BY d.rowid`,
  )
    .all({ ids: ids === undefined ? null : JSON.stringify(ids) })
    .map((linha) => ({
      id: String(linha.id),
      projeto: String(linha.projeto),
      titulo: String(linha.titulo),
      estado: String(linha.estado),
      estadoAlteradoEm: String(linha.estado_alterado_em),
      criadaEm: linha.criada_em === null ? null : String(linha.criada_em),
      concluidaEm: linha.concluida_em === null ? null : String(linha.concluida_em),
    }));
