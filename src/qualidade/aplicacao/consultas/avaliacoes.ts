// As consultas das telas de avaliação: cada uma monta o contrato da API (`entrega/contrato/avaliacoes.ts`) de uma vez, num
// snapshot, sem uma leitura por linha.
import type { DatabaseSync } from "node:sqlite";
import { demandasComTituloComSessaoNoPeriodo, listarAvaliacoes } from "../../armazenamento/avaliacoes.ts";
import { lerEmSnapshot } from "../../../compartilhado/armazenamento/snapshot.ts";
import type { AvaliacaoNaLista, DemandaDoPeriodo } from "../../../entrega/contrato/avaliacoes.ts";
import { estadoDaAvaliacao } from "../avaliacao/avaliacao.ts";

/**
 * A lista de avaliações, da mais recente para a mais antiga, com a contagem de achados e o estado de cada uma.
 *
 * @testes a rota de avaliações passa a chamá-la; o teste da consulta a confere
 */
export const consultarAvaliacoes = (banco: DatabaseSync): AvaliacaoNaLista[] =>
  lerEmSnapshot(banco, () => listarAvaliacoes(banco).map((a) => ({ ...a, estado: estadoDaAvaliacao(a.id) })));

/**
 * As demandas do projeto com sessão terminada entre `de` e `ate` (AAAA-MM-DD, inclusivas), com o título.
 *
 * @testes a rota de avaliações passa a chamá-la; o teste da consulta a confere
 */
export const consultarDemandasDoPeriodo = (
  banco: DatabaseSync,
  projeto: string,
  de: string,
  ate: string,
): DemandaDoPeriodo[] => lerEmSnapshot(banco, () => demandasComTituloComSessaoNoPeriodo(banco, projeto, de, ate));
