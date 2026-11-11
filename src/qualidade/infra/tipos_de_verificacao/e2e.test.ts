import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { AmbienteHostLocal } from "../../../ambiente/infra/ambiente_host_local.ts";
import { VerificacaoE2E } from "./e2e.ts";

const ambiente = new AmbienteHostLocal();
const worktree = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-e2e-")));
after(() => {
  rmSync(worktree, { recursive: true, force: true });
});
mkdirSync(join(worktree, "back"));

const e2e = (build: string, execucao: string) =>
  new VerificacaoE2E({ caminho_linguagem: "back", comando_build: build, comando_execucao: execucao, codigo_falha: 7 });

test("build e execução com saída 0 passam, na pasta da linguagem, com um log para cada", async () => {
  const resultado = await e2e("pwd", "echo rodou").executar({ ambiente, worktree });

  assert.equal(resultado.tipo, "passou");
  assert.deepEqual(
    resultado.relatorio?.logs.map((l) => [l.nome, l.texto.trim()]),
    [
      ["e2e-back-build.log", join(worktree, "back")],
      ["e2e-back.log", "rodou"],
    ],
  );
});

test("só o codigo_falha reprova a execução; outro código é falha de infraestrutura", async () => {
  assert.deepEqual(await e2e("true", "echo falhou; exit 7").executar({ ambiente, worktree }), {
    tipo: "reprovacao",
    motivo: "echo falhou; exit 7 saiu com código 7",
    log: "\nfalhou\n",
  });
  assert.deepEqual(await e2e("true", "exit 9").executar({ ambiente, worktree }), {
    tipo: "falha_infraestrutura",
    causa: "comando_ausente",
    motivo: "exit 9 saiu com código inesperado 9",
  });
});

test("build com saída diferente de 0 reprova e a execução não roda; o tipo é e2e", async () => {
  const verificacao = e2e("exit 2", "echo rodou");
  const registro = await verificacao.coletar({ ambiente, worktree });

  assert.equal(verificacao.tipo, "e2e");
  assert.equal(registro.tipo, "execucao_testes");
  assert.equal(registro.passou, false);
  assert.equal(registro.logs.length, 1);
});
