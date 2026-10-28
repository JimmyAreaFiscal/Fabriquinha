// Avaliações de melhoria do SDLC sobre demandas (D12) no banco: escopo, achados, uso do modelo e o vínculo achado → demanda.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../dominio/erros.ts";
import { escrever } from "./banco.ts";

export interface NovaAvaliacao {
  id: string;
  projeto: string;
  de: string;
  ate: string;
  pedido: string;
  criada_em: string;
  demandas: string[];
}

export interface Achado {
  achado_id: number;
  titulo: string;
  descricao: string;
  evidencia: string;
  demanda_id: string | null;
}

export interface UsoAvaliacao {
  modelo_provedor: string;
  modelo_nome: string;
  chamadas: number;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  custo: number | null;
}

export interface ResumoAvaliacao {
  id: string;
  projeto: string;
  de: string;
  ate: string;
  pedido: string;
  criada_em: string;
}

/** As demandas do projeto com alguma sessão terminada entre `de` e `ate` (AAAA-MM-DD, inclusivas). */
export const demandasComSessaoNoPeriodo = (banco: DatabaseSync, projeto: string, de: string, ate: string): string[] =>
  (
    banco
      .prepare(
        `SELECT DISTINCT d.id FROM demanda d JOIN sessao s ON s.demanda_id = d.id JOIN execucao_sessao e ON e.sessao_id = s.id
         WHERE d.projeto = ? AND substr(e.fim, 1, 10) BETWEEN ? AND ? ORDER BY d.id`,
      )
      .all(projeto, de, ate) as { id: string }[]
  ).map((l) => l.id);

export function criarAvaliacao(banco: DatabaseSync, a: NovaAvaliacao): void {
  escrever(banco, () => {
    banco
      .prepare("INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES (?, ?, ?, ?, ?, ?)")
      .run(a.id, a.projeto, a.de, a.ate, a.pedido, a.criada_em);
    for (const d of a.demandas) {
      banco.prepare("INSERT INTO avaliacao_demanda (avaliacao_id, demanda_id) VALUES (?, ?)").run(a.id, d);
    }
  });
}

/** Desfaz uma avaliação que não chegou a subir: o escopo, o uso e os achados vão com ela. */
export function apagarAvaliacao(banco: DatabaseSync, id: string): void {
  escrever(banco, () => {
    for (const t of ["avaliacao_demanda", "achado_avaliacao", "uso_avaliacao", "avaliacao"]) {
      banco.prepare(`DELETE FROM ${t} WHERE ${t === "avaliacao" ? "id" : "avaliacao_id"} = ?`).run(id);
    }
  });
}

export const listarAvaliacoes = (banco: DatabaseSync): (ResumoAvaliacao & { achados: number })[] =>
  banco
    .prepare(
      `SELECT a.*, (SELECT count(*) FROM achado_avaliacao WHERE avaliacao_id = a.id) AS achados
       FROM avaliacao a ORDER BY a.criada_em DESC, a.rowid DESC`,
    )
    .all() as unknown as (ResumoAvaliacao & { achados: number })[];

export function abrirAvaliacao(banco: DatabaseSync, id: string) {
  const avaliacao = banco.prepare("SELECT * FROM avaliacao WHERE id = ?").get(id) as ResumoAvaliacao | undefined;
  if (!avaliacao) throw new ErroDeInexistente(`a avaliação ${id} não existe`, "confira o id da avaliação");
  const todas = (sql: string) => banco.prepare(sql).all(id);
  return {
    ...avaliacao,
    demandas: (
      todas("SELECT demanda_id FROM avaliacao_demanda WHERE avaliacao_id = ? ORDER BY demanda_id") as {
        demanda_id: string;
      }[]
    ).map((l) => l.demanda_id),
    achados: todas(
      "SELECT achado_id, titulo, descricao, evidencia, demanda_id FROM achado_avaliacao WHERE avaliacao_id = ? ORDER BY achado_id",
    ) as unknown as Achado[],
    uso: todas(
      "SELECT modelo_provedor, modelo_nome, chamadas, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo FROM uso_avaliacao WHERE avaliacao_id = ? ORDER BY modelo_provedor, modelo_nome",
    ) as unknown as UsoAvaliacao[],
  };
}

/** Importa os achados novos; os já importados (mesmo `achado_id`) ficam como estão. */
export function importarAchados(banco: DatabaseSync, id: string, achados: Omit<Achado, "demanda_id">[]): void {
  escrever(banco, () => {
    for (const a of achados) {
      banco
        .prepare(
          "INSERT OR IGNORE INTO achado_avaliacao (avaliacao_id, achado_id, titulo, descricao, evidencia) VALUES (?, ?, ?, ?, ?)",
        )
        .run(id, a.achado_id, a.titulo, a.descricao, a.evidencia);
    }
  });
}

/** Regrava o uso inteiro da avaliação (a soma do JSONL é sempre o total). */
export function regravarUso(banco: DatabaseSync, id: string, usos: UsoAvaliacao[]): void {
  escrever(banco, () => {
    banco.prepare("DELETE FROM uso_avaliacao WHERE avaliacao_id = ?").run(id);
    for (const u of usos) {
      banco
        .prepare("INSERT INTO uso_avaliacao VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(
          id,
          u.modelo_provedor,
          u.modelo_nome,
          u.chamadas,
          u.tokens_entrada,
          u.tokens_saida,
          u.tokens_cache_leitura,
          u.tokens_cache_escrita,
          u.custo,
        );
    }
  });
}

/** Liga o achado à demanda criada a partir dele; o UNIQUE parcial impede reencaminhar. */
export function vincularAchado(banco: DatabaseSync, id: string, achadoId: number, demandaId: string): void {
  const r = banco
    .prepare("UPDATE achado_avaliacao SET demanda_id = ? WHERE avaliacao_id = ? AND achado_id = ?")
    .run(demandaId, id, achadoId);
  if (r.changes === 0)
    throw new ErroDeInexistente(`o achado ${String(achadoId)} da avaliação ${id} não existe`, "confira o id do achado");
}

/** O achado que originou a demanda, ou `undefined`. */
export const achadoDaDemanda = (banco: DatabaseSync, demandaId: string) =>
  banco.prepare("SELECT avaliacao_id, achado_id, titulo FROM achado_avaliacao WHERE demanda_id = ?").get(demandaId) as
    { avaliacao_id: string; achado_id: number; titulo: string } | undefined;

/** Os ids das sessões da demanda com execução terminada entre `de` e `ate` (AAAA-MM-DD, inclusivas). */
export const sessoesDaDemandaNoPeriodo = (banco: DatabaseSync, demanda: string, de: string, ate: string): string[] =>
  (
    banco
      .prepare(
        `SELECT DISTINCT s.id FROM sessao s JOIN execucao_sessao e ON e.sessao_id = s.id
         WHERE s.demanda_id = ? AND substr(e.fim, 1, 10) BETWEEN ? AND ? ORDER BY s.id`,
      )
      .all(demanda, de, ate) as { id: string }[]
  ).map((l) => l.id);

/** O projeto da demanda, ou `undefined` se ela não existe. */
export const projetoDaDemanda = (banco: DatabaseSync, demanda: string): string | undefined =>
  (banco.prepare("SELECT projeto FROM demanda WHERE id = ?").get(demanda) as { projeto: string } | undefined)?.projeto;
