// Dependência entre demandas (comparacao-sdlc-implementacao.md §3 e §7.2): grafo próprio, fora do AgregadoDemanda.
// Funções puras sobre as arestas; ler e gravar é da persistência.
import { FASES_TERMINADAS, satisfazDependencia } from "./cancelamento_demanda.ts";
import { acharCiclo } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import type { FaseDemanda } from "./primitivos.ts";

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
  const grafo = new Map<string, string[]>();
  for (const e of [...existentes, nova])
    grafo.set(e.demanda_id, [...(grafo.get(e.demanda_id) ?? []), e.depende_demanda_id]);
  const ciclo = acharCiclo(grafo);
  if (ciclo) throw new ErroDeRegra(`as demandas ${ciclo.join(" → ")} formam um ciclo de dependência`);
  return nova;
}

/** CA-7 e CA-8: só remove aresta que existe, de demanda ainda não enviada. */
export function exigirRemovivel(
  existentes: readonly DependenciaDemanda[],
  demanda: { id: string; enviada: boolean },
  dependeId: string,
): void {
  if (demanda.enviada) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já foi enviada`,
      "a dependência só se remove antes do envio da demanda",
    );
  }
  if (!existentes.some((e) => mesma(e, { demanda_id: demanda.id, depende_demanda_id: dependeId }))) {
    throw new ErroDeRegra(`a demanda ${demanda.id} não depende da ${dependeId}`);
  }
}

/** CA-9 e CA-10: os ids das predecessoras que ainda não satisfazem a dependência (D08: arquivada satisfaz). */
export const predecessorasPendentes = (predecessoras: readonly { demanda_id: string; fase: FaseDemanda }[]): string[] =>
  predecessoras.filter((p) => !satisfazDependencia(p.fase)).map((p) => p.demanda_id);

/** CA-11: as dependentes de `id`, diretas e indiretas, que ainda não terminaram. */
export function dependentesNaoConcluidas(
  arestas: readonly DependenciaDemanda[],
  fases: ReadonlyMap<string, FaseDemanda>,
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
    const fase = fases.get(d);
    return fase !== undefined && !FASES_TERMINADAS.includes(fase);
  });
}
