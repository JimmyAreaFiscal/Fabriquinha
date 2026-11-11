import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { predecessorasPendentes } from "../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { ErroDeInexistente } from "../../compartilhado/nucleo/erros.ts";
import { escrever, migrar } from "../../compartilhado/armazenamento/banco.ts";
import {
  arestasDeDependencia,
  demandaParaDependencia,
  dependentesNaoConcluidasDaDemanda,
  dependentesNaoConcluidasDasDemandas,
  gravarDependenciaDemanda,
  predecessorasDaDemanda,
  predecessorasDasDemandas,
} from "./dependencias_demanda.ts";
import { MIGRACOES } from "../../compartilhado/armazenamento/migracoes/migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

const banco = (demandas: Record<string, { projeto?: string; estado?: string; enviada?: number }>) => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  for (const nome of ["a", "b"]) {
    b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', 'k')`);
  }
  for (const [id, { projeto = "a", estado = "entender_e_desenhar", enviada = 0 }] of Object.entries(demandas)) {
    b.exec(
      `INSERT INTO demanda VALUES ('${id}', '${projeto}', 't', 'problema', 'd', '${estado}', ${T}, 'f', 's', ${String(enviada)}, 'fabriquinha/${id}')`,
    );
  }
  return b;
};
const registrarDependenciaDemanda = (b: DatabaseSync, demanda_id: string, depende_demanda_id: string) => {
  gravarDependenciaDemanda(b, { demanda_id, depende_demanda_id });
};

test("CA-1 e CA-6: registra, entre projetos, e a consulta devolve a predecessora", () => {
  const b = banco({ "I-1": {}, "I-2": { projeto: "b" } });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(predecessorasDaDemanda(b, "I-2"), [{ demanda_id: "I-1", estado: "entender_e_desenhar" }]);
});

test("arestasDeDependencia lê na ordem de gravação", () => {
  const b = banco({ "I-1": {}, "I-2": {}, "I-3": {} });
  registrarDependenciaDemanda(b, "I-3", "I-1");
  registrarDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(
    arestasDeDependencia(b).map((a) => ({ ...a })),
    [
      { demanda_id: "I-3", depende_demanda_id: "I-1" },
      { demanda_id: "I-2", depende_demanda_id: "I-1" },
    ],
  );
});

test("demandaParaDependencia diz se foi enviada; demanda inexistente dá ErroDeInexistente", () => {
  const b = banco({ "I-1": {}, "I-2": { enviada: 1 } });
  assert.deepEqual(demandaParaDependencia(b, "I-1"), { id: "I-1", enviada: false });
  assert.deepEqual(demandaParaDependencia(b, "I-2"), { id: "I-2", enviada: true });
  assert.throws(() => demandaParaDependencia(b, "I-9"), ErroDeInexistente);
});

test("CA-9 e CA-10: predecessora pendente até ser concluída ou arquivada", () => {
  const b = banco({ "I-1": { estado: "em_execucao" }, "I-2": {} });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), ["I-1"]);
  b.exec("UPDATE demanda SET estado = 'arquivada' WHERE id = 'I-1'");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), []);
});

test("CA-11: dependentes não concluídas, entre projetos", () => {
  const b = banco({ "I-1": {}, "I-2": {}, "I-3": { projeto: "b" }, "I-4": { estado: "concluida" } });
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
    b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('a', '/repo/a', 'main', 'github', 'k')`);
    for (const id of ["I-1", "I-2"]) {
      b.exec(
        `INSERT INTO demanda VALUES ('${id}', 'a', 't', 'problema', 'd', 'entender_e_desenhar', ${T}, 'f', 's', 0, 'fabriquinha/${id}')`,
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

test("predecessorasDasDemandas e dependentesNaoConcluidasDasDemandas leem várias demandas de uma vez, na mesma ordem das de uma só", () => {
  const b = banco({ "I-1": {}, "I-2": {}, "I-3": { estado: "concluida" }, "I-4": {} });
  registrarDependenciaDemanda(b, "I-2", "I-1");
  registrarDependenciaDemanda(b, "I-2", "I-3");
  registrarDependenciaDemanda(b, "I-4", "I-2");
  const ids = ["I-2", "I-1", "I-4"];
  assert.deepEqual(predecessorasDasDemandas(b, ids), new Map(ids.map((id) => [id, predecessorasDaDemanda(b, id)])));
  assert.deepEqual(predecessorasDasDemandas(b, ["I-2"]).get("I-2"), [
    { demanda_id: "I-1", estado: "entender_e_desenhar" },
    { demanda_id: "I-3", estado: "concluida" },
  ]);
  assert.deepEqual(
    dependentesNaoConcluidasDasDemandas(b, ids),
    new Map([
      ["I-2", ["I-4"]],
      ["I-1", ["I-2", "I-4"]],
      ["I-4", []],
    ]),
  );
});
