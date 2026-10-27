// Dependência entre demandas no banco (comparacao-sdlc-implementacao.md §7.2): lê, chama as regras puras do domínio e grava.
import type { DatabaseSync } from "node:sqlite";
import {
  type DependenciaDemanda,
  dependentesNaoConcluidas,
  exigirRemovivel,
  registrarDependencia,
} from "../dominio/dependencia_demanda.ts";
import { encontrado } from "../dominio/erros.ts";
import { FaseDemanda } from "../dominio/primitivos.ts";
import { escrever } from "./banco.ts";

const arestas = (banco: DatabaseSync) =>
  banco
    .prepare("SELECT demanda_id, depende_demanda_id FROM dependencia_demanda ORDER BY rowid")
    .all() as unknown as DependenciaDemanda[];

const demandaDe = (banco: DatabaseSync, id: string) => {
  const linha = banco.prepare("SELECT enviada FROM demanda WHERE id = ?").get(id);
  return { id, enviada: encontrado(linha, `a demanda ${id} não existe`, "confira o id da demanda").enviada === 1 };
};

/** Registra `demandaId` como dependente de `dependeId`; as duas precisam existir. */
export const registrarDependenciaDemanda = (banco: DatabaseSync, demandaId: string, dependeId: string): void => {
  escrever(banco, () => {
    const demanda = demandaDe(banco, demandaId);
    demandaDe(banco, dependeId);
    const nova = registrarDependencia(arestas(banco), demanda, dependeId);
    banco
      .prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)")
      .run(nova.demanda_id, nova.depende_demanda_id);
  });
};

export const removerDependenciaDemanda = (banco: DatabaseSync, demandaId: string, dependeId: string): void => {
  escrever(banco, () => {
    exigirRemovivel(arestas(banco), demandaDe(banco, demandaId), dependeId);
    banco
      .prepare("DELETE FROM dependencia_demanda WHERE demanda_id = ? AND depende_demanda_id = ?")
      .run(demandaId, dependeId);
  });
};

/** As predecessoras diretas de `id` com a fase de cada uma, para `predecessorasPendentes`. */
export function predecessorasDaDemanda(banco: DatabaseSync, id: string): { demanda_id: string; fase: FaseDemanda }[] {
  const linhas = banco
    .prepare(
      `SELECT d.id AS demanda_id, d.fase FROM dependencia_demanda dd JOIN demanda d ON d.id = dd.depende_demanda_id
       WHERE dd.demanda_id = ? ORDER BY dd.rowid`,
    )
    .all(id);
  return linhas.map((l) => ({ demanda_id: l.demanda_id as string, fase: FaseDemanda.parse(l.fase) }));
}

/** As dependentes de `id` (diretas e indiretas) que ainda não terminaram, lidas num snapshot só. */
export function dependentesNaoConcluidasDaDemanda(banco: DatabaseSync, id: string): string[] {
  const propria = !banco.isTransaction; // dentro de `escrever` a leitura já é parte da transação
  if (propria) banco.exec("BEGIN");
  try {
    const fases = new Map(
      banco
        .prepare("SELECT id, fase FROM demanda")
        .all()
        .map((l) => [l.id as string, FaseDemanda.parse(l.fase)]),
    );
    return dependentesNaoConcluidas(arestas(banco), fases, id);
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}
