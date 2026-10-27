import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { Projeto } from "../dominio/configuracao_projeto.ts";
import { type EntradaComandos, verificarFitness, verificarTestes } from "./verificacoes_comandos.ts";

const worktree = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-comandos-")));
after(() => {
  rmSync(worktree, { recursive: true, force: true });
});
for (const pasta of ["back", "front"]) mkdirSync(join(worktree, pasta));

const projeto = (parcial: Record<string, unknown> = {}) =>
  Projeto.parse({
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: "/repos/loja",
    hospedagem: "github",
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: "back", linguagem: "ts", comando_teste: "true" }],
    ...parcial,
  });
const entrada = (parcial: Record<string, unknown> = {}, resto: Partial<EntradaComandos> = {}): EntradaComandos => ({
  projeto: projeto(parcial),
  e2e: false,
  worktree,
  arquivos: [],
  ...resto,
});
const comE2E = (build: string, execucao: string) => ({
  e2e: [{ caminho_linguagem: "back", comando_build: build, comando_execucao: execucao, codigo_falha: 7 }],
  globs: [{ caminho_linguagem: "back", glob: "back/**/*.ts" }],
});
const rodada = { e2e: true, arquivos: ["back/a.ts"] };

test("CA-1: teste com saída 0 aprova, com o código de saída e o caminho", async () => {
  const v = await verificarTestes(entrada());
  assert.equal(v.tipo, "execucao_testes");
  assert.equal(v.aprovada, true);
  assert.deepEqual(v.falhas, []);
  const [c] = (v.dados as { comandos: Record<string, unknown>[] }).comandos;
  assert.equal(c?.codigoSaida, 0);
  assert.equal(c.caminho, "back");
  assert.equal(v.logs[0]?.nome, "teste-back.log");
});

test("CA-2: saída diferente de 0 é reprovação técnica", async () => {
  const v = await verificarTestes(
    entrada({ linguagens: [{ caminho: "back", linguagem: "ts", comando_teste: "exit 1" }] }),
  );
  assert.equal(v.aprovada, false);
  assert.deepEqual(v.falhas, [{ classe: "tecnica", motivo: "exit 1 saiu com código 1", comando: "exit 1" }]);
});

test("CA-3: comando inexistente é infraestrutura, com o comando e a mensagem do shell", async () => {
  const comando = "comando-que-nao-existe-na-fabriquinha";
  const v = await verificarTestes(
    entrada({ linguagens: [{ caminho: "back", linguagem: "ts", comando_teste: comando }] }),
  );
  assert.equal(v.aprovada, undefined);
  assert.equal(v.falhas[0]?.classe, "infraestrutura");
  assert.match(v.falhas[0].motivo, /comando-que-nao-existe-na-fabriquinha: .*not found/);
});

test("CA-4: passar do tempo limite é infraestrutura; morte por sinal é técnica", async () => {
  const lento = await verificarTestes(
    entrada({ linguagens: [{ caminho: "back", linguagem: "ts", comando_teste: "sleep 5" }] }, { limiteMs: 100 }),
  );
  assert.equal(lento.aprovada, undefined);
  assert.deepEqual(lento.falhas, [{ classe: "infraestrutura", motivo: "sleep 5: tempo limite", comando: "sleep 5" }]);

  const morto = await verificarTestes(
    entrada({ linguagens: [{ caminho: "back", linguagem: "ts", comando_teste: "kill -9 $$" }] }),
  );
  assert.equal(morto.aprovada, false);
});

test("CA-5: todos os comandos rodam, cada um na pasta da sua linguagem", async () => {
  const v = await verificarTestes(
    entrada({
      linguagens: [
        { caminho: "back", linguagem: "ts", comando_teste: "pwd; exit 1" },
        { caminho: "front", linguagem: "ts", comando_teste: "pwd" },
      ],
    }),
  );
  assert.deepEqual(
    v.logs.map((l) => l.texto.trim()),
    [join(worktree, "back"), join(worktree, "front")],
  );
  assert.equal(v.falhas.length, 1);
});

test("CA-6: build do E2E com saída diferente de 0 reprova e a execução não roda", async () => {
  const v = await verificarTestes(entrada(comE2E("exit 2", "echo rodou"), rodada));
  assert.equal(v.aprovada, false);
  assert.equal(v.falhas[0]?.classe, "tecnica");
  assert.equal(v.logs.length, 2);
});

test("CA-3: build do E2E inexistente é infraestrutura", async () => {
  const v = await verificarTestes(entrada(comE2E("inexistente-na-fabriquinha", "true"), rodada));
  assert.equal(v.aprovada, undefined);
  assert.equal(v.falhas[0]?.classe, "infraestrutura");
});

test("CA-7 e CA-8: sem a marca e2e, ou sem arquivo que case com o glob, o E2E não roda", async () => {
  const config = comE2E("exit 2", "exit 2");
  assert.equal((await verificarTestes(entrada(config, { arquivos: ["back/a.ts"] }))).aprovada, true);
  assert.equal(
    (await verificarTestes(entrada(config, { e2e: true, arquivos: ["front/a.ts", "back/a.md"] }))).aprovada,
    true,
  );
});

test("CA-9, CA-10 e CA-11: a execução do E2E sai 0, codigo_falha ou outro código", async () => {
  const passou = await verificarTestes(entrada(comE2E("true", "exit 0"), rodada));
  assert.equal(passou.aprovada, true);
  assert.equal(passou.logs.length, 3);

  const reprovou = await verificarTestes(entrada(comE2E("true", "exit 7"), rodada));
  assert.equal(reprovou.aprovada, false);
  assert.equal(reprovou.falhas[0]?.classe, "tecnica");

  const inesperado = await verificarTestes(entrada(comE2E("true", "exit 9"), rodada));
  assert.equal(inesperado.aprovada, undefined);
  assert.deepEqual(inesperado.falhas, [
    { classe: "infraestrutura", motivo: "exit 9 saiu com código inesperado 9", comando: "exit 9" },
  ]);

  const morto = await verificarTestes(entrada(comE2E("true", "kill -9 $$"), rodada));
  assert.equal(morto.aprovada, undefined);
});

test("CA-12 e CA-13: fitness aprova com saída 0 e reprova tecnicamente com 1, na worktree", async () => {
  const ok = await verificarFitness(
    entrada({
      fitness: [
        { nome: "a", comando: "pwd", descricao: "d" },
        { nome: "b", comando: "true", descricao: "d" },
      ],
    }),
  );
  assert.equal(ok.tipo, "matriz_fitness");
  assert.equal(ok.aprovada, true);
  assert.equal(ok.logs[0]?.texto.trim(), worktree);
  assert.equal((ok.dados as { linhas: unknown[] }).linhas.length, 2);

  const ruim = await verificarFitness(entrada({ fitness: [{ nome: "a", comando: "exit 1", descricao: "d" }] }));
  assert.equal(ruim.aprovada, false);
  assert.equal(ruim.falhas[0]?.classe, "tecnica");
});

test("o ambiente dos comandos não leva credenciais", async () => {
  process.env.SONAR_TOKEN = "segredo";
  const v = await verificarFitness(
    entrada({ fitness: [{ nome: "a", comando: 'echo "[$SONAR_TOKEN]"', descricao: "d" }] }),
  );
  assert.equal(v.logs[0]?.texto.trim(), "[]");
});
