import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeInexistente } from "../dominio/erros.ts";
import {
  abrirAvaliacao,
  achadoDaDemanda,
  apagarAvaliacao,
  criarAvaliacao,
  demandasComSessaoNoPeriodo,
  importarAchados,
  listarAvaliacoes,
  regravarUso,
  vincularAchado,
} from "./avaliacoes.ts";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const uso = (nome: string, chamadas = 1) => ({
  modelo_provedor: "p",
  modelo_nome: nome,
  chamadas,
  tokens_entrada: 1,
  tokens_saida: 2,
  tokens_cache_leitura: 3,
  tokens_cache_escrita: 4,
  custo: null,
});
const achado = (n: number) => ({ achado_id: n, titulo: `t${String(n)}`, descricao: "d", evidencia: "e" });

const banco = () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  for (const nome of ["a", "b"]) {
    b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
  }
  for (const [id, projeto] of Object.entries({ "I-1": "a", "I-2": "a", "I-3": "b" })) {
    b.exec(
      `INSERT INTO demanda VALUES ('${id}', '${projeto}', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/${id}');
       INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', ${T});
       INSERT INTO sessao VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');`,
    );
  }
  return b;
};
const execucao = (b: DatabaseSync, demanda: string, id: string, fim: string | null) => {
  b.exec(
    `INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('${id}', 's-${demanda}', ${T}, ${fim ? `'${fim}'` : "NULL"}, 0)`,
  );
};
const nova = (demandas = ["I-1"]) => ({
  id: "u1",
  projeto: "a",
  de: "2026-01-01",
  ate: "2026-01-31",
  pedido: "",
  criada_em: "x",
  demandas,
});

test("escopo: sessão terminada no período, inclusivo nas duas pontas, só do projeto", () => {
  const b = banco();
  execucao(b, "I-1", "e1", "2026-01-31T23:59:59.000Z");
  execucao(b, "I-1", "e2", "2026-02-01T00:00:00.000Z");
  execucao(b, "I-2", "e3", null);
  execucao(b, "I-3", "e4", "2026-01-10T00:00:00.000Z");
  assert.deepEqual(demandasComSessaoNoPeriodo(b, "a", "2026-01-01", "2026-01-31"), ["I-1"]);
  assert.deepEqual(demandasComSessaoNoPeriodo(b, "a", "2026-02-01", "2026-02-01"), ["I-1"]);
  assert.deepEqual(demandasComSessaoNoPeriodo(b, "a", "2026-03-01", "2026-03-02"), []);
});

test("criar, listar com a contagem de achados, abrir e importar sem duplicar", () => {
  const b = banco();
  criarAvaliacao(b, nova(["I-1", "I-2"]));
  criarAvaliacao(b, { ...nova(), id: "u2", projeto: "b", demandas: [] });
  importarAchados(b, "u1", [achado(1), achado(2)]);
  importarAchados(b, "u1", [{ ...achado(2), titulo: "outro" }, achado(3)]);
  regravarUso(b, "u1", [uso("m", 2), uso("n")]);
  regravarUso(b, "u1", [uso("m", 5)]);
  assert.deepEqual(
    listarAvaliacoes(b).map((l) => [l.id, l.achados]),
    [
      ["u2", 0],
      ["u1", 3],
    ],
  );
  const a = abrirAvaliacao(b, "u1");
  assert.deepEqual(a.demandas, ["I-1", "I-2"]);
  assert.deepEqual(
    a.achados.map((x) => [x.achado_id, x.titulo, x.demanda_id]),
    [
      [1, "t1", null],
      [2, "t2", null],
      [3, "t3", null],
    ],
  );
  assert.deepEqual(
    a.uso.map((u) => ({ ...u })),
    [uso("m", 5)],
  );
  assert.throws(() => abrirAvaliacao(b, "nao"), ErroDeInexistente);
});

test("apagar leva o escopo, achados e uso; as restrições recusam o inválido", () => {
  const b = banco();
  criarAvaliacao(b, nova());
  importarAchados(b, "u1", [achado(1)]);
  regravarUso(b, "u1", [uso("m")]);
  assert.throws(() => {
    criarAvaliacao(b, { ...nova(["I-9"]), id: "u3" });
  });
  assert.equal(listarAvaliacoes(b).length, 1); // a falha reverteu a avaliação u3
  assert.throws(() => {
    criarAvaliacao(b, { ...nova(), id: "u4", ate: "2025-01-01" });
  });
  assert.throws(() => {
    criarAvaliacao(b, { ...nova(), id: "u4", de: "01/01/2026" });
  });
  apagarAvaliacao(b, "u1");
  for (const t of ["avaliacao", "avaliacao_demanda", "achado_avaliacao", "uso_avaliacao"]) {
    assert.equal(b.prepare(`SELECT count(*) AS n FROM ${t}`).get()?.n, 0);
  }
});

test("vincular: ida e volta, e a demanda serve a um só achado", () => {
  const b = banco();
  criarAvaliacao(b, nova());
  importarAchados(b, "u1", [achado(1), achado(2)]);
  assert.equal(achadoDaDemanda(b, "I-2"), undefined);
  vincularAchado(b, "u1", 1, "I-2");
  assert.deepEqual({ ...achadoDaDemanda(b, "I-2") }, { avaliacao_id: "u1", achado_id: 1, titulo: "t1" });
  assert.equal(abrirAvaliacao(b, "u1").achados[0]?.demanda_id, "I-2");
  assert.throws(() => {
    vincularAchado(b, "u1", 2, "I-2");
  }, /UNIQUE/);
  assert.throws(() => {
    vincularAchado(b, "u1", 9, "I-3");
  }, ErroDeInexistente);
  assert.throws(() => {
    vincularAchado(b, "u1", 2, "I-9");
  }, /FOREIGN/);
});

test("migração 32 é aditiva: não altera as tabelas existentes", () => {
  const b = new DatabaseSync(":memory:");
  migrar(b, MIGRACOES.slice(0, 31));
  const esquema = () =>
    b
      .prepare("SELECT name, sql FROM sqlite_master ORDER BY name")
      .all()
      .map((l) => ({ ...l }));
  const antes = esquema();
  migrar(b, MIGRACOES);
  const depois = esquema();
  assert.deepEqual(
    depois.filter((l) => antes.some((a) => a.name === l.name)),
    antes,
  );
  assert.ok(depois.length > antes.length);
});
