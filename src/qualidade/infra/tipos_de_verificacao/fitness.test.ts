import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ComandoRodado } from "../../nucleo/evidencias/schemas.ts";
import { Projeto } from "../../../ambiente/nucleo/projeto.ts";
import { AmbienteHostLocal } from "../../../ambiente/infra/ambiente_host_local.ts";
import { VerificacaoDeFitness } from "./fitness.ts";

const ambiente = new AmbienteHostLocal();
const worktree = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-fitness-")));
after(() => {
  rmSync(worktree, { recursive: true, force: true });
});

const verificacao = (fitness: { nome: string; comando: string }[]) =>
  new VerificacaoDeFitness(
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: "/repos/loja",
      hospedagem: "github",
      verificacoes: { fitness: fitness.map((f) => ({ ...f, descricao: "d" })), linguagens: [] },
    }),
  );

test("fitness aprova com saída 0 e roda cada comando na worktree", async () => {
  const ok = await verificacao([
    { nome: "a", comando: "pwd" },
    { nome: "b", comando: "true" },
  ]).coletar({ ambiente, worktree });

  assert.equal(ok.tipo, "matriz_fitness");
  assert.equal(ok.passou, true);
  assert.equal(ok.logs[0]?.texto.trim(), worktree);
  const { linhas } = ok.dados as { linhas: unknown[] };
  assert.equal(linhas.length, 2);
  assert.deepEqual(
    linhas.map((l) => ComandoRodado.parse(l).log),
    ok.logs.map((l) => l.nome),
  );
});

test("fitness com saída 1 reprova tecnicamente", async () => {
  const ruim = await verificacao([{ nome: "a", comando: "exit 1" }]).coletar({ ambiente, worktree });

  assert.equal(ruim.passou, false);
  assert.equal(ruim.falhas[0]?.classe, "tecnica");
});

test("executar: fitness reprovada devolve reprovacao com o motivo e o log; o tipo é fitness", async () => {
  const fitness = verificacao([{ nome: "a", comando: "echo quebrou; exit 1" }]);

  assert.equal(fitness.tipo, "fitness");
  assert.deepEqual(await fitness.executar({ ambiente, worktree }), {
    tipo: "reprovacao",
    motivo: "echo quebrou; exit 1 saiu com código 1",
    log: "quebrou\n",
  });
});

test("o ambiente dos comandos não leva credenciais", async () => {
  process.env.SONAR_TOKEN = "segredo";
  const v = await verificacao([{ nome: "a", comando: 'echo "[$SONAR_TOKEN]"' }]).coletar({ ambiente, worktree });
  assert.equal(v.logs[0]?.texto.trim(), "[]");
});
