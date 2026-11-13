// A migração 51, de Demandas (MELHORIAS §5.1.6 e §12): a situação administrativa do pedido ganha coluna própria em
// `demanda`, derivada do estado e do envio gravados até a versão 50. É aditiva: nenhuma coluna sai, e as demais colunas
// das linhas existentes não mudam, então a demanda em andamento continua de onde estava.
import type { DatabaseSync } from "node:sqlite";

/** A situação que o estado do desenvolvimento e o envio gravados implicam; a arquivada, para Demandas, está concluída. */
const SITUACAO_IMPLICADA_PELO_ESTADO_GRAVADO = `CASE
    WHEN estado IN ('concluida', 'arquivada') THEN 'concluido'
    WHEN estado = 'cancelada' THEN 'cancelado'
    WHEN enviada = 1 THEN 'enviado'
    ELSE 'rascunho' END`;

const MIGRACAO_51_SITUACAO_DO_PEDIDO = `
ALTER TABLE demanda ADD COLUMN situacao TEXT NOT NULL DEFAULT 'rascunho'
  CHECK (situacao IN ('rascunho', 'enviado', 'cancelado', 'concluido'));
UPDATE demanda SET situacao = ${SITUACAO_IMPLICADA_PELO_ESTADO_GRAVADO};
`;

/** As migrações de Demandas, cada uma com a versão do banco que ela entrega; a composição as registra em `abrir`. */
export const MIGRACOES_DE_DEMANDAS = {
  dominio: "demandas",
  migracoes: [{ versao: 51, migracao: MIGRACAO_51_SITUACAO_DO_PEDIDO }],
};

/**
 * Deriva a situação da demanda `id` do estado gravado, como a migração faz com as linhas antigas.
 * @testes o cenário que grava o processo direto, sem os fluxos, alinha a situação do pedido ao estado montado
 */
export function alinharSituacaoAoEstadoGravado(banco: DatabaseSync, id: string): void {
  banco.prepare(`UPDATE demanda SET situacao = ${SITUACAO_IMPLICADA_PELO_ESTADO_GRAVADO} WHERE id = ?`).run(id);
}
