// A dependência entre pedidos (MELHORIAS §12, regra 4 do §11): o grafo das arestas, fora do processo de cada pedido.
// Funções puras sobre as arestas e as situações dos pedidos; ler e gravar é do armazenamento.
import { GrafoDeDependencias } from "../../../ciclo_de_vida/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { pedidoTerminou, type SituacaoDoPedido } from "../../pedidos/publico.ts";

/** `demanda_id` só pode começar o planejamento depois de `depende_demanda_id` satisfeita. */
export interface DependenciaDemanda {
  demanda_id: string;
  depende_demanda_id: string;
}

const mesma = (primeira: DependenciaDemanda, segunda: DependenciaDemanda) =>
  primeira.demanda_id === segunda.demanda_id && primeira.depende_demanda_id === segunda.depende_demanda_id;

/** CA-2 a CA-6: a aresta nova, ou a recusa se o pedido já foi enviado, se é autorreferência, repetida ou fecha ciclo. */
export function dependenciaNovaValidada(
  existentes: readonly DependenciaDemanda[],
  pedido: { id: string; enviada: boolean },
  dependeId: string,
): DependenciaDemanda {
  if (pedido.enviada) {
    throw new ErroDeRegra(
      `a demanda ${pedido.id} já foi enviada`,
      "a dependência só se registra antes do envio da demanda",
    );
  }
  if (pedido.id === dependeId) {
    throw new ErroDeRegra(`a demanda ${pedido.id} não pode depender de si mesma`);
  }
  const nova = { demanda_id: pedido.id, depende_demanda_id: dependeId };
  if (existentes.some((existente) => mesma(existente, nova))) {
    throw new ErroDeRegra(`a demanda ${pedido.id} já depende da ${dependeId}`);
  }
  new GrafoDeDependencias(
    [...existentes, nova].map((aresta): [string, string] => [aresta.demanda_id, aresta.depende_demanda_id]),
    "as demandas",
  ).exigirSemCiclo();
  return nova;
}

/** CA-11: os pedidos que dependem de `id`, direta e indiretamente, e ainda não terminaram. */
export function dependentesNaoConcluidos(
  arestas: readonly DependenciaDemanda[],
  situacoes: ReadonlyMap<string, SituacaoDoPedido>,
  id: string,
): string[] {
  const achados = new Set<string>();
  const fila = [id];
  for (let atual = fila.pop(); atual !== undefined; atual = fila.pop()) {
    for (const aresta of arestas) {
      if (aresta.depende_demanda_id === atual && !achados.has(aresta.demanda_id)) {
        achados.add(aresta.demanda_id);
        fila.push(aresta.demanda_id);
      }
    }
  }
  // ponytail: concluído no meio do caminho não corta a busca; o dependente dele ainda é cancelado se não terminou.
  return [...achados].filter((dependente) => {
    const situacao = situacoes.get(dependente);
    return situacao !== undefined && !pedidoTerminou(situacao);
  });
}

/**
 * CA-9 e CA-10: de cada pedido de `ids`, as predecessoras diretas que ainda não concluíram, na ordem das arestas; o
 * pedido sem nenhuma está liberado para o desenvolvimento. Só o pedido concluído libera (o arquivado também está).
 */
export const predecessorasNaoConcluidas = (
  arestas: readonly DependenciaDemanda[],
  situacoes: ReadonlyMap<string, SituacaoDoPedido>,
  ids: readonly string[],
): Map<string, string[]> =>
  new Map(
    ids.map((id) => [
      id,
      arestas
        .filter((aresta) => aresta.demanda_id === id && situacoes.get(aresta.depende_demanda_id) !== "concluido")
        .map((aresta) => aresta.depende_demanda_id),
    ]),
  );
