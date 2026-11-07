import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { abrirBancoTemporario } from "./banco_temporario.ts";
import { hospedagemFalsa } from "./hospedagem_falsa.ts";

test("gh e az falsos: o mesmo PR no formato de cada CLI, e PR fechado não é editado", () => {
  const banco = abrirBancoTemporario();
  try {
    const h = hospedagemFalsa(banco.raiz);
    h.zerar();
    h.abrir({ head: "b", base: "main", titulo: "t", corpo: "", estado: "fechado", fork: true });
    const rodar = (cli: string, ...args: string[]) => execFileSync(cli, args, { stdio: "pipe" }).toString();
    assert.deepEqual(JSON.parse(rodar("gh", "pr", "list", "--head", "b")), [
      {
        number: 1,
        url: "https://github.com/org/loja/pull/1",
        state: "CLOSED",
        body: "",
        baseRefName: "main",
        isCrossRepository: true,
      },
    ]);
    assert.deepEqual(JSON.parse(rodar("az", "repos", "pr", "list", "--source-branch", "b")), [
      {
        pullRequestId: 1,
        status: "abandoned",
        description: null,
        targetRefName: "refs/heads/main",
        forkSource: { name: "refs/heads/b" },
        closedDate: "2026-10-11T13:00:00.1234567Z",
        lastMergeCommit: null,
        mergeStatus: "succeeded",
        url: "https://dev.azure.com/org/_apis/git/pullRequests/1",
        repository: { url: "https://dev.azure.com/org/loja/_apis/git/repositories/loja" },
      },
    ]);
    assert.throws(() => rodar("az", "repos", "pr", "update", "--id", "1", "--title", "x", "--description", "y"));
    assert.deepEqual(
      h.chamadas().map((c) => c.cli),
      ["gh", "az", "az"],
    );
  } finally {
    banco.fechar();
  }
});
