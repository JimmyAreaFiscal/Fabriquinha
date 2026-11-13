// As arestas de dependência entre pedidos no banco: lê e grava; as regras são do núcleo.
import type { DatabaseSync } from "node:sqlite";
import type { DependenciaDemanda } from "../nucleo/dependencia.ts";

/** Todas as arestas de dependência, na ordem em que foram gravadas. */
export const arestasDeDependencia = (banco: DatabaseSync): DependenciaDemanda[] =>
  banco
    .prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda ORDER BY rowid")
    .all()
    .map((linha) => ({ demanda_id: String(linha.demanda_id), depende_demanda_id: String(linha.depende_demanda_id) }));

export const gravarDependencia = (
  banco: DatabaseSync,
  { demanda_id, depende_demanda_id }: DependenciaDemanda,
): void => {
  banco
    .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
    .run(demanda_id, depende_demanda_id);
};
