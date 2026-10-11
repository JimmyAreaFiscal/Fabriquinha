import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ambienteSemCredenciais, executar, executarNoShell } from "./processo.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-processo-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("roda no cwd pedido e devolve código, stdout e stderr", async () => {
  const saida = await executar("/bin/sh", ["-c", "pwd; echo erro >&2; exit 3"], { cwd: base });
  assert.deepEqual(saida, { codigo: 3, saida: `${base}\n`, erro: "erro\n", limiteEstourado: false });
});

test("passado o limite, mata o grupo inteiro, não só o shell", async () => {
  const inicio = Date.now();
  // O `sleep` em segundo plano herda o stdout: se só o shell morresse, o close esperaria os 30 s dele.
  const saida = await executar("/bin/sh", ["-c", "sleep 30 & sleep 30"], { limiteMs: 200 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, null);
  assert.ok(Date.now() - inicio < 10_000);
});

test("o limite vale também para o neto que segura o stdout depois que o shell saiu", async () => {
  const inicio = Date.now();
  const saida = await executar("/bin/sh", ["-c", "sleep 30 & exit 0"], { limiteMs: 200 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
  assert.ok(Date.now() - inicio < 10_000);
});

test("neto fora do grupo (setsid) não derruba o limite: o kill sem alvo é ignorado e o close vem quando ele sai", async () => {
  const saida = await executar("/bin/sh", ["-c", "setsid sleep 1 & exit 0"], { limiteMs: 100 });
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
});

test("com `ultimos`, guarda só o fim de cada saída", async () => {
  const saida = await executar("/bin/sh", ["-c", "printf %050d 7; printf %050d 8 >&2"], { ultimos: 10 });
  assert.equal(saida.saida.slice(-10), "0000000007");
  assert.ok(saida.saida.length <= 20);
  assert.ok(saida.erro.endsWith("8") && saida.erro.length <= 20);
});

test("executarNoShell: /bin/sh -c no cwd, stdout e stderr intercalados no log, código e duração", async () => {
  const r = await executarNoShell('pwd; echo erro >&2; echo "$((1 + 1))" && exit 3', base, {
    limiteLog: 1024,
  });
  assert.deepEqual({ ...r, duracaoMs: 0 }, { codigo: 3, estourou: false, duracaoMs: 0, log: `${base}\nerro\n2\n` });
  assert.ok(Number.isInteger(r.duracaoMs) && r.duracaoMs >= 0);
});

test("executarNoShell: comando não encontrado sai com 127 e a mensagem do shell vai para o log", async () => {
  const r = await executarNoShell("comando-que-nao-existe-na-fabriquinha", base, { limiteLog: 1024 });
  assert.equal(r.codigo, 127);
  assert.match(r.log, /comando-que-nao-existe-na-fabriquinha: (command )?not found/);
});

test("executarNoShell: passado o limite, o código é null e estourou", async () => {
  const r = await executarNoShell("echo antes; sleep 30", base, { limiteMs: 200, limiteLog: 1024 });
  assert.deepEqual({ ...r, duracaoMs: 0 }, { codigo: null, estourou: true, duracaoMs: 0, log: "antes\n" });
  assert.ok(r.duracaoMs >= 200 && r.duracaoMs < 10_000);
});

test("executarNoShell: o log guarda os últimos `limiteLog` bytes, sem cortar caractere nem levar byte nulo", async () => {
  // 5 bytes ("x", U+FFFD no lugar do nulo, "y"), seis "é" de 2 bytes e um "a": com 10, o corte cai no meio de um "é".
  const r = await executarNoShell("printf 'x\\000y'; printf éééééé; printf a", base, { limiteLog: 10 });
  assert.equal(r.log, "ééééa");
  const curto = await executarNoShell("printf 'x\\000y'", base, { limiteLog: 1024 });
  assert.equal(curto.log, "x\uFFFDy");
});

test("executarNoShell: erro de sintaxe, que impede até o exec 2>&1, também vai para o log", async () => {
  for (const comando of ["npm test (", 'echo "sem fim', "true &&"]) {
    const r = await executarNoShell(comando, base, { limiteLog: 1024 });
    assert.equal(r.codigo, 2, comando);
    assert.match(r.log, /syntax error/i, comando);
  }
});

test("ambienteSemCredenciais tira os tokens e aponta gh e az para a pasta vazia; executarNoShell usa o env", async () => {
  const comTokens = {
    PATH: "/bin",
    GH_TOKEN: "1",
    GITHUB_TOKEN: "2",
    GH_ENTERPRISE_TOKEN: "3",
    GITHUB_ENTERPRISE_TOKEN: "4",
    AZURE_DEVOPS_EXT_PAT: "5",
    SYSTEM_ACCESSTOKEN: "6",
    SONAR_TOKEN: "7",
    GH_CONFIG_DIR: "/home/x/.config/gh",
  };
  const env = ambienteSemCredenciais(comTokens, "/vazio");
  assert.deepEqual(env, { PATH: "/bin", GH_CONFIG_DIR: "/vazio", AZURE_CONFIG_DIR: "/vazio" });
  assert.equal(comTokens.GH_TOKEN, "1");
  const r = await executarNoShell('echo "[$GH_TOKEN] $GH_CONFIG_DIR"', base, { env, limiteLog: 1024 });
  assert.equal(r.log, "[] /vazio\n");
});
