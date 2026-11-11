// Dependência entre demandas no banco (comparacao-sdlc-implementacao.md §7.2): lê e grava; as regras são da aplicação.
import type { DatabaseSync } from "node:sqlite";
import { type DependenciaDemanda, dependentesNaoConcluidas } from "../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { encontrado } from "../../compartilhado/nucleo/erros.ts";
import { EstadoDemanda } from "../../compartilhado/nucleo/primitivos.ts";
import { lerEmSnapshot } from "../../compartilhado/armazenamento/snapshot.ts";

/** Todas as arestas de dependência, na ordem em que foram gravadas. */
export const arestasDeDependencia = (banco: DatabaseSync): DependenciaDemanda[] =>
  banco
    .prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda ORDER BY rowid")
    .all() as unknown as DependenciaDemanda[];

/** O id e se foi enviada da demanda que vai registrar ou receber uma dependência; ela precisa existir. */
export const demandaParaDependencia = (banco: DatabaseSync, id: string): { id: string; enviada: boolean } => {
  const linha = banco.prepare("SELECT enviada FROM demanda WHERE id = ?").get(id);
  return { id, enviada: encontrado(linha, `a demanda ${id} não existe`, "confira o id da demanda").enviada === 1 };
};

export const gravarDependenciaDemanda = (
  banco: DatabaseSync,
  { demanda_id, depende_demanda_id }: DependenciaDemanda,
): void => {
  banco
    .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
    .run(demanda_id, depende_demanda_id);
};

/**
 * As predecessoras diretas de cada demanda de `ids` com o estado de cada uma, numa leitura só (sem N+1).
 * @testes o teste exercita direto; a produção a usa só dentro do módulo (a consulta que a usa vem em seguida)
 */
export function predecessorasDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, { demanda_id: string; estado: EstadoDemanda }[]> {
  const linhas = banco
    .prepare(
      `SELECT dd.demanda_id AS dependente, d.id AS demanda_id, d.estado
       FROM dependencia_demanda dd JOIN demanda d ON d.id = dd.depende_demanda_id
       WHERE dd.demanda_id IN (SELECT value FROM json_each(?)) ORDER BY dd.rowid`,
    )
    .all(JSON.stringify(ids));
  // shortcut: filtra as linhas por demanda (ids × linhas), agrupar num passe só se passar de milhares de arestas.
  return new Map(
    ids.map((id) => [
      id,
      linhas
        .filter((l) => l.dependente === id)
        .map((l) => ({ demanda_id: l.demanda_id as string, estado: EstadoDemanda.parse(l.estado) })),
    ]),
  );
}

/** As predecessoras diretas de `id` com o estado de cada uma, para `predecessorasPendentes`. */
export const predecessorasDaDemanda = (
  banco: DatabaseSync,
  id: string,
): { demanda_id: string; estado: EstadoDemanda }[] => [...predecessorasDasDemandas(banco, [id]).values()].flat();

/**
 * As dependentes (diretas e indiretas) que ainda não terminaram de cada demanda de `ids`, lidas num snapshot só.
 * @testes o teste exercita direto; a produção a usa só dentro do módulo (a consulta que a usa vem em seguida)
 */
export function dependentesNaoConcluidasDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, string[]> {
  return lerEmSnapshot(banco, () => {
    const estados = new Map(
      banco
        .prepare("SELECT id, estado FROM demanda")
        .all()
        .map((l) => [l.id as string, EstadoDemanda.parse(l.estado)]),
    );
    const arestas = arestasDeDependencia(banco);
    return new Map(ids.map((id) => [id, dependentesNaoConcluidas(arestas, estados, id)]));
  });
}

/** As dependentes de `id` (diretas e indiretas) que ainda não terminaram, lidas num snapshot só. */
export const dependentesNaoConcluidasDaDemanda = (banco: DatabaseSync, id: string): string[] =>
  [...dependentesNaoConcluidasDasDemandas(banco, [id]).values()].flat();
