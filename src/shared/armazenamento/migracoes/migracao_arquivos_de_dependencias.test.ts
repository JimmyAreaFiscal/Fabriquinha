// A migração 58, de Demandas (banco na versão 57): o `Dockerfile` do projeto vira `package.json`, a outra imagem e o
// projeto sem imagem ficam sem arquivos (host local), e a coluna `imagem_do_ambiente` sai.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../server/system/banco_da_fabriquinha.ts";

test("a migração 58 converte Dockerfile em package.json, zera as outras imagens e remove imagem_do_ambiente", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, 57);
  const inserir = banco.prepare(
    "INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube, imagem_do_ambiente) VALUES (?, ?, 'main', 'github', ?, ?)",
  );
  inserir.run("com-dockerfile", "/r1", "k1", "Dockerfile");
  inserir.run("com-imagem", "/r2", "k2", "node:22");
  inserir.run("sem-imagem", "/r3", "k3", null);

  migrarBancoDaFabriquinha(banco);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, 58);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const colunas = banco
    .prepare("PRAGMA table_info(projeto)")
    .all()
    .map((c) => c.name);
  assert.ok(colunas.includes("arquivos_de_dependencias"));
  assert.ok(!colunas.includes("imagem_do_ambiente"));
  assert.deepEqual(
    banco
      .prepare("SELECT nome, arquivos_de_dependencias FROM projeto ORDER BY nome")
      .all()
      .map((l) => ({ ...l })),
    [
      { nome: "com-dockerfile", arquivos_de_dependencias: '["package.json"]' },
      { nome: "com-imagem", arquivos_de_dependencias: null },
      { nome: "sem-imagem", arquivos_de_dependencias: null },
    ],
  );
});
