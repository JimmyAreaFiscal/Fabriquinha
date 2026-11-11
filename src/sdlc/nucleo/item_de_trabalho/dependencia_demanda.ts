// Dependência entre demandas (comparacao-sdlc-implementacao.md §3 e §7.2): grafo próprio, fora do AgregadoDemanda.
// Funções puras sobre as arestas; ler e gravar é da persistência.
import { satisfazDependencia } from "../ciclo_de_vida/cancelamento_demanda.ts";
import { CICLO_DA_DEMANDA } from "../ciclo_de_vida/ciclos.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { GrafoDeDependencias } from "./item_de_trabalho.ts";
import type { EstadoDemanda } from "../ciclo_de_vida/ciclos.ts";

/** `demanda_id` só pode começar o planejamento depois de `depende_demanda_id` satisfeita. */
export interface DependenciaDemanda {
  demanda_id: string;
  depende_demanda_id: string;
}

const mesma = (a: DependenciaDemanda, b: DependenciaDemanda) =>
  a.demanda_id === b.demanda_id && a.depende_demanda_id === b.depende_demanda_id;

/** CA-2 a CA-6: devolve a aresta nova, ou recusa se a demanda já foi enviada, se é autorreferência, repetida ou fecha ciclo. */
export function registrarDependencia(
  existentes: readonly DependenciaDemanda[],
  demanda: { id: string; enviada: boolean },
  dependeId: string,
): DependenciaDemanda {
  if (demanda.enviada) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já foi enviada`,
      "a dependência só se registra antes do envio da demanda",
    );
  }
  if (demanda.id === dependeId) {
    throw new ErroDeRegra(`a demanda ${demanda.id} não pode depender de si mesma`);
  }
  const nova = { demanda_id: demanda.id, depende_demanda_id: dependeId };
  if (existentes.some((e) => mesma(e, nova))) {
    throw new ErroDeRegra(`a demanda ${demanda.id} já depende da ${dependeId}`);
  }
  new GrafoDeDependencias(
    [...existentes, nova].map((e): [string, string] => [e.demanda_id, e.depende_demanda_id]),
    "as demandas",
  ).exigirSemCiclo();
  return nova;
}

/** CA-9 e CA-10: os ids das predecessoras que ainda não satisfazem a dependência (D08: arquivada satisfaz). */
export const predecessorasPendentes = (
  predecessoras: readonly { demanda_id: string; estado: EstadoDemanda }[],
): string[] => predecessoras.filter((p) => !satisfazDependencia(p.estado)).map((p) => p.demanda_id);

/** CA-11: as dependentes de `id`, diretas e indiretas, que ainda não terminaram. */
export function dependentesNaoConcluidas(
  arestas: readonly DependenciaDemanda[],
  estados: ReadonlyMap<string, EstadoDemanda>,
  id: string,
): string[] {
  const achadas = new Set<string>();
  const fila = [id];
  for (let atual = fila.pop(); atual !== undefined; atual = fila.pop()) {
    for (const a of arestas) {
      if (a.depende_demanda_id === atual && !achadas.has(a.demanda_id)) {
        achadas.add(a.demanda_id);
        fila.push(a.demanda_id);
      }
    }
  }
  // ponytail: concluída no meio do caminho não corta a busca; a dependente dela ainda é cancelada se não terminou.
  return [...achadas].filter((d) => {
    const estado = estados.get(d);
    return estado !== undefined && !CICLO_DA_DEMANDA.ehTerminal(estado);
  });
}
