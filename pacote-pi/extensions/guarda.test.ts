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
    // Opções antes e depois de `pr`, com o valor separado ou com `=`; na dúvida se a opção leva valor, barra.
    "gh --repo dono/r pr create",
    "gh --repo=dono/r pr merge 1",
    "gh pr -R dono/r create",
    "gh pr --repo=dono/r edit 3",
    "gh pr --web create",
    "gh api -X POST repos/d/r/pulls",
    "az --debug repos pr create",
    "az repos --org x pr update --id 9",
  ])
    assert.equal(bloqueio(comando), RECUSA, comando);
});

test("libera as leituras de PR e o que não mexe em PR (P1 §6)", () => {
  for (const comando of [
    "gh pr view 12 --json state",
    "gh pr list",
    // O subcomando é a primeira palavra depois de `pr` que não é opção: o resto da linha não conta.
    "gh pr list --label ready",
    "gh pr list --search review",
    "gh pr view 12 --comments --json reviews",
    "gh pr -R dono/r list --label ready",
    "gh pr --repo=dono/r view 1",
    'gh issue create --title "fix pr review"',
    "gh issue comment 1 --body pr create",
    "gh pr diff 1",
    "gh pr checks 1",
    "gh pr status",
    "gh issue create",
    "gh api repos/d/r/issues",
    "az repos pr show --id 9",
    "az repos pr list",
    "az repos pr list --status create",
    "az repos pr show --id 9 --query reviewer",
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

test("na auditoria (e só nela), recusa o subagent cujo agente, ou o de algum item de tasks, não é o scout (CA-7)", () => {
  const tratadores: Record<string, (evento: { toolName: string; input: never }) => unknown> = {};
  guarda({
    on(nome, tratador) {
      tratadores[nome] = tratador;
    },
  });
  const chamar = (input: object) => tratadores.tool_call?.({ toolName: "subagent", input: input as never });
  const recusa = { block: true, reason: "A auditoria só usa subagentes de leitura (scout)." };
  const worker = { agent: "worker", task: "edite" };
  const tres = {
    tasks: [
      { agent: "scout", task: "a" },
      { agent: "scout", task: "b" },
    ],
  };

  assert.equal(chamar(worker), undefined, "fora da auditoria a guarda não olha o subagent");
  process.env.FABRIQUINHA_AUDITORIA = "1";
  try {
    assert.deepEqual(chamar(worker), recusa);
    assert.deepEqual(chamar({ tasks: [...tres.tasks, { agent: "worker", task: "c" }] }), recusa);
    assert.equal(chamar({ agent: "scout", task: "lê" }), undefined);
    assert.equal(chamar(tres), undefined);
    assert.equal(
      tratadores.tool_call?.({ toolName: "read", input: { agent: "worker" } as never }),
      undefined,
      "só o subagent",
    );
  } finally {
    delete process.env.FABRIQUINHA_AUDITORIA;
  }
});
