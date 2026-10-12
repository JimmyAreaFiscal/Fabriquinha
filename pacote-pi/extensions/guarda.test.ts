import assert from "node:assert/strict";
import { test } from "node:test";
import guarda, { bloqueio } from "./guarda.ts";

const RECUSA = "Somente a Fabriquinha cria e altera PR. Termine o seu ticket; ela publica o PR no encerramento.";

test("barra quem cria, altera, reabre ou faz merge de PR pelo gh ou pelo az (P1 §6)", () => {
  for (const comando of [
    "gh pr create --fill",
    "cd app && gh pr merge 12 --merge",
    'bash -c "gh pr edit 3 --body x"',
    "env GH_DEBUG=1 gh -R dono/r pr create",
    "/usr/bin/gh pr reopen 4",
    "gh api repos/d/r/pulls -f title=x",
    "az repos pr create --title t",
    "az repos pr update --id 9 --status completed",
    // Os demais subcomandos da lista do P1 §3.1, e os separadores, as crases e a substituição.
    ...["new", "close", "ready", "review", "comment"].map((sub) => `gh pr ${sub} 1`),
    ...["set-vote", "reviewer", "work-item"].map((sub) => `az repos pr ${sub} --id 9`),
    "true || gh pr close 1",
    "true; gh pr close 1",
    "git log | gh pr comment 1 --body-file -",
    "sleep 1 & gh pr close 1",
    "git push\ngh pr create",
    "echo `gh pr create`",
    "x=$(gh pr create)",
    "/opt/az repos pr create",
  ])
    assert.equal(bloqueio(comando), RECUSA, comando);
});

test("libera as leituras de PR e o que não mexe em PR (P1 §6)", () => {
  for (const comando of [
    "gh pr view 12 --json state",
    "gh pr list",
    "gh pr diff 1",
    "gh pr checks 1",
    "gh pr status",
    "gh issue create",
    "gh api repos/d/r/issues",
    "az repos pr show --id 9",
    "az repos pr list",
    "npm test && git status",
    // `pr` e `create` sem o `gh` antes, no mesmo trecho.
    "pr create; gh status",
  ])
    assert.equal(bloqueio(comando), null, comando);
});

test('recusa `echo "gh pr create"`, o falso positivo aceito (P1 §3.1)', () => {
  assert.equal(bloqueio('echo "gh pr create"'), RECUSA);
});

test("a extensão responde no tool_call do bash com block e reason, sem terminate, e ignora as outras ferramentas", () => {
  const tratadores: Record<string, (evento: { toolName: string; input: { command: string } }) => unknown> = {};
  guarda({
    on(nome, tratador) {
      tratadores[nome] = tratador;
    },
  });
  const tratador = tratadores.tool_call;
  assert.ok(tratador);
  assert.deepEqual(tratador({ toolName: "bash", input: { command: "gh pr create --fill" } }), {
    block: true,
    reason: RECUSA,
  });
  assert.equal(tratador({ toolName: "bash", input: { command: "gh pr view 1" } }), undefined);
  assert.equal(tratador({ toolName: "write", input: { command: "gh pr create" } }), undefined);
});
