// A dependência entre pedidos (MELHORIAS §12, regra 4 do §11): o grafo das arestas, fora do processo de cada pedido.
// Funções puras sobre as arestas e as situações dos pedidos; ler e gravar é do armazenamento.
import { GrafoDeDependencias } from "../../../../shared/nucleo/demanda/grafo_de_dependencias.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { pedidoTerminou, type SituacaoDoPedido } from "./pedido.ts";

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

/** As relações de um pedido no grafo das dependências, que a consulta dos pedidos traz junto de cada um. */
export interface RelacoesDoPedido {
  /** As predecessoras diretas, na ordem em que as arestas foram gravadas. */
  readonly predecessoras: readonly string[];
  /** CA-9 e CA-10: das predecessoras, as que ainda não concluíram; sem nenhuma, o pedido está liberado. */
  readonly predecessorasPendentes: readonly string[];
  /** CA-11: os pedidos que dependem dele, direta e indiretamente, e ainda não terminaram. */
  readonly dependentesPendentes: readonly string[];
}

/** O índice das arestas por uma das pontas, cada lista na ordem das arestas. */
function arestasPorPonta(
  arestas: readonly DependenciaDemanda[],
  ponta: (aresta: DependenciaDemanda) => string,
  outraPonta: (aresta: DependenciaDemanda) => string,
): Map<string, string[]> {
  const indice = new Map<string, string[]>();
  for (const aresta of arestas) indice.set(ponta(aresta), [...(indice.get(ponta(aresta)) ?? []), outraPonta(aresta)]);
  return indice;
}

/**
 * As relações de cada pedido no grafo das `arestas`, pela situação dos pedidos que elas citam: o índice das arestas é
 * montado uma vez, e a relação de cada pedido percorre o índice quando é pedida. Só o pedido concluído libera o dependente (o arquivado também
 * está concluído); o de situação desconhecida não libera e não é dependente.
 */
export function relacoesNoGrafo(
  arestas: readonly DependenciaDemanda[],
  situacoes: ReadonlyMap<string, SituacaoDoPedido>,
): (id: string) => RelacoesDoPedido {
  const predecessorasDe = arestasPorPonta(
    arestas,
    (a) => a.demanda_id,
    (a) => a.depende_demanda_id,
  );
  const dependentesDe = arestasPorPonta(
    arestas,
    (a) => a.depende_demanda_id,
    (a) => a.demanda_id,
  );
  const dependentesPendentes = (id: string): string[] => {
    const achados = new Set<string>();
    const fila = [id];
    for (let atual = fila.pop(); atual !== undefined; atual = fila.pop()) {
      for (const dependente of dependentesDe.get(atual) ?? []) {
        if (!achados.has(dependente)) {
          achados.add(dependente);
          fila.push(dependente);
        }
      }
    }
    // ponytail: concluído no meio do caminho não corta a busca; o dependente dele ainda é cancelado se não terminou.
    return [...achados].filter((dependente) => {
      const situacao = situacoes.get(dependente);
      return situacao !== undefined && !pedidoTerminou(situacao);
    });
  };
  return (id) => {
    const predecessoras = predecessorasDe.get(id) ?? [];
    return {
      predecessoras,
      predecessorasPendentes: predecessoras.filter((predecessora) => situacoes.get(predecessora) !== "concluido"),
      dependentesPendentes: dependentesPendentes(id),
    };
  };
}
