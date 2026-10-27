import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { predecessorasPendentes } from "../dominio/dependencia_demanda.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { escrever, migrar } from "./banco.ts";
import {
  dependentesNaoConcluidasDaDemanda,
  predecessorasDaDemanda,
  registrarDependenciaDemanda,
  removerDependenciaDemanda,
} from "./dependencias_demanda.ts";
import { MIGRACOES } from "./migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

const banco = (demandas: Record<string, { projeto?: string; fase?: string; enviada?: number }>) => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  for (const nome of ["a", "b"]) {
    b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
  }
  for (const [id, { projeto = "a", fase = "registro", enviada = 0 }] of Object.entries(demandas)) {
    b.exec(
      `INSERT INTO demanda VALUES ('${id}', '${projeto}', 't', 'problema', 'd', '${fase}', ${T}, 'f', 's', ${String(enviada)}, 'fabriquinha/${id}')`,
    );
  }
  return b;
};
const arestas = (b: DatabaseSync) => b.prepare("SELECT * FROM dependencia_demanda").all().length;

test("CA-1 e CA-6: registra, entre projetos, e a consulta devolve a predecessora", () => {
  const b = banco({ "I-1": {}, "I-2": { projeto: "b" } });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(predecessorasDaDemanda(b, "I-2"), [{ demanda_id: "I-1", fase: "registro" }]);
});

test("CA-2 a CA-5: recusas não gravam nada", () => {
  const b = banco({ "I-1": {}, "I-2": { enviada: 1 }, "I-3": {} });
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-2", "I-1");
  }, /I-2.*já foi enviada/);
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-1", "I-1");
  }, ErroDeRegra);
  registrarDependenciaDemanda(b, "I-3", "I-1");
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-1", "I-3");
  }, /ciclo/);
  assert.equal(arestas(b), 1);
  assert.equal(b.isTransaction, false);
});

test("demanda inexistente, dona ou predecessora, dá ErroDeInexistente", () => {
  const b = banco({ "I-1": {} });
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-9", "I-1");
  }, ErroDeInexistente);
  assert.throws(() => {
    registrarDependenciaDemanda(b, "I-1", "I-9");
  }, ErroDeInexistente);
  assert.throws(() => {
    removerDependenciaDemanda(b, "I-9", "I-1");
  }, ErroDeInexistente);
});

test("CA-7: remove e a consulta devolve vazio", () => {
  const b = banco({ "I-1": {}, "I-2": {} });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  removerDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(predecessorasDaDemanda(b, "I-2"), []);
});

test("CA-8: não remove de demanda enviada", () => {
  const b = banco({ "I-1": {}, "I-2": {} });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  b.exec("UPDATE demanda SET enviada = 1 WHERE id = 'I-2'");
  assert.throws(() => {
    removerDependenciaDemanda(b, "I-2", "I-1");
  }, ErroDeRegra);
  assert.equal(arestas(b), 1);
});

test("CA-9 e CA-10: predecessora pendente até ser concluída ou arquivada", () => {
  const b = banco({ "I-1": { fase: "execucao" }, "I-2": {} });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), ["I-1"]);
  b.exec("UPDATE demanda SET fase = 'arquivada' WHERE id = 'I-1'");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), []);
});

test("CA-11: dependentes não concluídas, entre projetos", () => {
  const b = banco({ "I-1": {}, "I-2": {}, "I-3": { projeto: "b" }, "I-4": { fase: "concluida" } });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  registrarDependenciaDemanda(b, "I-3", "I-2");
  registrarDependenciaDemanda(b, "I-4", "I-1");
  assert.deepEqual(dependentesNaoConcluidasDaDemanda(b, "I-1").toSorted(), ["I-2", "I-3"]);
  assert.equal(b.isTransaction, false);
});

test("o banco recusa autorreferência", () => {
  const b = banco({ "I-1": {} });
  assert.throws(() => {
    b.exec("INSERT INTO dependencia_demanda VALUES ('I-1', 'I-1')");
  }, /constraint/i);
});

test("dependentesNaoConcluidasDaDemanda dentro de escrever não fecha a transação; outra conexão fica travada", () => {
  const dir = mkdtempSync(join(tmpdir(), "fabriquinha-dep-"));
  const b = new DatabaseSync(join(dir, "f.db"));
  const outra = new DatabaseSync(join(dir, "f.db"));
  try {
    b.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL");
    migrar(b, MIGRACOES);
    b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('a', '/repo/a', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]')`);
    for (const id of ["I-1", "I-2"]) {
      b.exec(
        `INSERT INTO demanda VALUES ('${id}', 'a', 't', 'problema', 'd', 'registro', ${T}, 'f', 's', 0, 'fabriquinha/${id}')`,
      );
    }
    outra.exec("PRAGMA busy_timeout = 0; PRAGMA foreign_keys = ON");
    escrever(b, () => {
      assert.deepEqual(dependentesNaoConcluidasDaDemanda(b, "I-1"), []);
      assert.equal(b.isTransaction, true);
      assert.throws(() => {
        registrarDependenciaDemanda(outra, "I-2", "I-1");
      }, /database is locked/);
    });
    assert.equal(b.isTransaction, false);
    registrarDependenciaDemanda(outra, "I-2", "I-1");
    assert.deepEqual(dependentesNaoConcluidasDaDemanda(b, "I-1"), ["I-2"]);
  } finally {
    b.close();
    outra.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
