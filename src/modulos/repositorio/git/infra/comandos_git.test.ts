import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { Ambiente, ComandoNoAmbiente, SaidaDoComando } from "../../../ambiente/publico.ts";
import { exigirGitNoAmbiente, gitNoAmbiente } from "./comandos_git.ts";
import { preparar } from "../../espaco_de_trabalho/infra/worktree.ts";

/** Um Ambiente que registra o comando recebido e responde com a saída dada, para ver o que o git pede ao Ambiente. */
function ambienteQueResponde(saida: Partial<SaidaDoComando>) {
  const comandos: ComandoNoAmbiente[] = [];
  const ambiente: Ambiente = {
    id: "falso",
    processosMorremComOServico: true,
    isolaAsVariaveisDoServico: false,
    escreveEmTodoOGitDoClone: true,
    executar: (comando) => {
      comandos.push(comando);
      return Promise.resolve({ codigo: 0, saida: "", erro: "", limiteEstourado: false, duracaoMs: 0, ...saida });
    },
    lancar: () => assert.fail("o git não lança processo interativo"),
    sinalizar: () => assert.fail("o git não sinaliza"),
    caminhoNoAmbiente: (caminho) => `/ambiente${caminho}`,
    abrigarProcesso: () => assert.fail("o git não abriga processo"),
  };
  return { ambiente, comandos };
}

test("o git do Espaço pede ao Ambiente: caminho convertido, sem terminal para senha e com o limite dos comandos", async () => {
  const { ambiente, comandos } = ambienteQueResponde({ saida: "ok\n" });
  assert.equal(await exigirGitNoAmbiente(ambiente, "/repo", "status", "--short"), "ok\n");
  assert.equal(comandos.length, 1);
  const [comando] = comandos;
  assert.ok(comando);
  const { programa, argumentos, cwd, env, limiteMs } = comando;
  assert.deepEqual(
    { programa, argumentos, cwd, limiteMs },
    {
      programa: "git",
      argumentos: ["-C", "/ambiente/repo", "status", "--short"],
      cwd: "/",
      limiteMs: 30 * 60_000,
    },
  );
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.LC_ALL, "C");
  assert.equal(env.PATH, process.env.PATH);
});

test("git que passa do limite diz por quê no stderr, e exigir vira ErroDeRegra com esse motivo", async () => {
  const { ambiente } = ambienteQueResponde({ codigo: null, limiteEstourado: true, erro: "parcial\n" });
  assert.match(
    (await gitNoAmbiente(ambiente, "/repo", "fetch")).erro,
    /^parcial\npassou do limite de 1800000 ms e foi morto$/,
  );
  await assert.rejects(
    exigirGitNoAmbiente(ambiente, "/repo", "fetch"),
    (erro: unknown) =>
      erro instanceof ErroDeRegra && erro.message.startsWith("git fetch falhou em /repo: parcial\npassou do limite"),
  );
});

test("a Preparação roda no shell do Ambiente com o env completo do serviço e guarda o fim do log", async () => {
  const { ambiente, comandos } = ambienteQueResponde({ saida: "saída\n" });
  const log = `${process.env.TMPDIR ?? "/tmp"}/preparacao-no-ambiente-${String(process.pid)}.log`;
  await preparar(ambiente, "/worktree", ["npm ci"], log);
  const [comando] = comandos;
  assert.ok(comando);
  const { programa, argumentos, cwd, env, noShell, ultimosBytes } = comando;
  assert.deepEqual(
    { programa, argumentos, cwd, noShell, ultimosBytes },
    {
      programa: "npm ci",
      argumentos: [],
      cwd: "/ambiente/worktree",
      noShell: true,
      ultimosBytes: 5 * 1024 * 1024,
    },
  );
  assert.equal(env.PATH, process.env.PATH);
});
