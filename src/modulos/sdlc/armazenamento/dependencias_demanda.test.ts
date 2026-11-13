import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { predecessorasPendentes } from "../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { migrar } from "../../compartilhado/armazenamento/banco.ts";
import { predecessorasDaDemanda, predecessorasDasDemandas } from "./dependencias_demanda.ts";
import { MIGRACOES } from "../../compartilhado/armazenamento/migracoes/migracoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";

const banco = (demandas: Record<string, { projeto?: string; estado?: string }>) => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  for (const nome of ["a", "b"]) {
    b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', 'k')`);
  }
  for (const [id, { projeto = "a", estado = "entender_e_desenhar" }] of Object.entries(demandas)) {
    b.exec(
      `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('${id}', '${projeto}', 't', 'problema', 'd', '${estado}', ${T}, 'f', 's', 0, 'fabriquinha/${id}')`,
    );
  }
  return b;
};
const gravarAresta = (b: DatabaseSync, demanda_id: string, depende_demanda_id: string) => {
  b.prepare("INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)").run(
    demanda_id,
    depende_demanda_id,
  );
};

test("CA-1 e CA-6: entre projetos, a consulta devolve a predecessora com o estado dela", () => {
  const b = banco({ "I-1": {}, "I-2": { projeto: "b" } });
  gravarAresta(b, "I-2", "I-1");
  assert.deepEqual(predecessorasDaDemanda(b, "I-2"), [{ demanda_id: "I-1", estado: "entender_e_desenhar" }]);
});

test("CA-9 e CA-10: predecessora pendente até ser concluída ou arquivada", () => {
  const b = banco({ "I-1": { estado: "em_execucao" }, "I-2": {} });
  gravarAresta(b, "I-2", "I-1");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), ["I-1"]);
  b.exec("UPDATE demanda SET estado = 'arquivada' WHERE id = 'I-1'");
  assert.deepEqual(predecessorasPendentes(predecessorasDaDemanda(b, "I-2")), []);
});

test("o banco recusa autorreferência", () => {
  const b = banco({ "I-1": {} });
  assert.throws(() => {
    b.exec("INSERT INTO dependencia_demanda VALUES ('I-1', 'I-1')");
  }, /constraint/i);
});

test("predecessorasDasDemandas lê várias demandas de uma vez, na mesma ordem das de uma só", () => {
  const b = banco({ "I-1": {}, "I-2": {}, "I-3": { estado: "concluida" }, "I-4": {} });
  gravarAresta(b, "I-2", "I-1");
  gravarAresta(b, "I-2", "I-3");
  gravarAresta(b, "I-4", "I-2");
  const ids = ["I-2", "I-1", "I-4"];
  assert.deepEqual(predecessorasDasDemandas(b, ids), new Map(ids.map((id) => [id, predecessorasDaDemanda(b, id)])));
  assert.deepEqual(predecessorasDasDemandas(b, ["I-2"]).get("I-2"), [
    { demanda_id: "I-1", estado: "entender_e_desenhar" },
    { demanda_id: "I-3", estado: "concluida" },
  ]);
});
