import assert from "node:assert/strict";
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { git, gitComLimite } from "../../../compartilhado/infra/processo.ts";
import { ambienteSemCredenciais, type ComandoNoAmbiente } from "../ambiente.ts";
import { AmbienteHostLocal } from "./ambiente_host_local.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ambiente-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const ambiente = new AmbienteHostLocal();
const envDoServico = process.env as Record<string, string>;

function comandoSh(linha: string, resto: Partial<ComandoNoAmbiente> = {}): ComandoNoAmbiente {
  return { programa: "/bin/sh", argumentos: ["-c", linha], cwd: base, env: envDoServico, ...resto };
}

function comandoNoShell(linha: string, resto: Partial<ComandoNoAmbiente> = {}): ComandoNoAmbiente {
  return { programa: linha, argumentos: [], cwd: base, env: envDoServico, noShell: true, ultimosBytes: 1024, ...resto };
}

function semDuracao<T extends { duracaoMs: number }>(saida: T): Omit<T, "duracaoMs"> {
  const { duracaoMs, ...resto } = saida;
  assert.ok(Number.isInteger(duracaoMs) && duracaoMs >= 0);
  return resto;
}

test("o host local se identifica, mantém os caminhos do host, herda as variáveis do serviço, escreve no .git e morre com o serviço", () => {
  assert.equal(ambiente.id, "host_local");
  assert.deepEqual(
    [ambiente.isolaAsVariaveisDoServico, ambiente.escreveEmTodoOGitDoClone, ambiente.processosMorremComOServico],
    [false, true, true],
  );
  assert.equal(ambiente.caminhoNoAmbiente("/a/b"), "/a/b");
});

test("roda no cwd pedido e devolve código, stdout e stderr", async () => {
  const saida = await ambiente.executar(comandoSh("pwd; echo erro >&2; exit 3"));
  assert.deepEqual(semDuracao(saida), { codigo: 3, saida: `${base}\n`, erro: "erro\n", limiteEstourado: false });
});

test("passado o limite, mata o grupo inteiro, não só o shell", async () => {
  const inicio = Date.now();
  // O `sleep` em segundo plano herda o stdout: se só o shell morresse, o close esperaria os 30 s dele.
  const saida = await ambiente.executar(comandoSh("sleep 30 & sleep 30", { limiteMs: 200 }));
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, null);
  assert.ok(Date.now() - inicio < 10_000);
});

test("o limite vale também para o neto que segura o stdout depois que o shell saiu", async () => {
  const inicio = Date.now();
  const saida = await ambiente.executar(comandoSh("sleep 30 & exit 0", { limiteMs: 200 }));
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
  assert.ok(Date.now() - inicio < 10_000);
});

test("neto fora do grupo (setsid) não derruba o limite: o kill sem alvo é ignorado e o close vem quando ele sai", async () => {
  const saida = await ambiente.executar(comandoSh("setsid sleep 1 & exit 0", { limiteMs: 100 }));
  assert.equal(saida.limiteEstourado, true);
  assert.equal(saida.codigo, 0);
});

test("com `ultimosBytes`, guarda só o fim de cada saída", async () => {
  const saida = await ambiente.executar(comandoSh("printf %050d 7; printf %050d 8 >&2", { ultimosBytes: 10 }));
  assert.equal(saida.saida.slice(-10), "0000000007");
  assert.ok(saida.saida.length <= 20);
  assert.ok(saida.erro.endsWith("8") && saida.erro.length <= 20);
});

test("noShell: /bin/sh -c no cwd, stdout e stderr intercalados na saída, código e duração", async () => {
  const r = await ambiente.executar(comandoNoShell('pwd; echo erro >&2; echo "$((1 + 1))" && exit 3'));
  assert.deepEqual(semDuracao(r), { codigo: 3, saida: `${base}\nerro\n2\n`, erro: "", limiteEstourado: false });
});

test("noShell: comando não encontrado sai com 127 e a mensagem do shell vai para a saída", async () => {
  const r = await ambiente.executar(comandoNoShell("comando-que-nao-existe-na-fabriquinha"));
  assert.equal(r.codigo, 127);
  assert.match(r.saida, /comando-que-nao-existe-na-fabriquinha: (command )?not found/);
});

test("noShell: passado o limite, o código é null e estourou", async () => {
  const r = await ambiente.executar(comandoNoShell("echo antes; sleep 30", { limiteMs: 200 }));
  assert.deepEqual(semDuracao(r), { codigo: null, saida: "antes\n", erro: "", limiteEstourado: true });
  assert.ok(r.duracaoMs >= 200 && r.duracaoMs < 10_000);
});

test("noShell: guarda os últimos `ultimosBytes` bytes, sem cortar caractere nem levar byte nulo", async () => {
  // 5 bytes ("x", U+FFFD no lugar do nulo, "y"), seis "é" de 2 bytes e um "a": com 10, o corte cai no meio de um "é".
  const r = await ambiente.executar(comandoNoShell("printf 'x\\000y'; printf éééééé; printf a", { ultimosBytes: 10 }));
  assert.equal(r.saida, "ééééa");
  const curto = await ambiente.executar(comandoNoShell("printf 'x\\000y'"));
  assert.equal(curto.saida, "x\uFFFDy");
});

test("noShell: erro de sintaxe, que impede até o exec 2>&1, também vai para a saída", async () => {
  for (const linha of ["npm test (", 'echo "sem fim', "true &&"]) {
    const r = await ambiente.executar(comandoNoShell(linha));
    assert.equal(r.codigo, 2, linha);
    assert.match(r.saida, /syntax error/i, linha);
  }
});

test("ambienteSemCredenciais tira os tokens e aponta gh e az para a pasta vazia; o env chega ao comando", async () => {
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
    SEM_VALOR: undefined,
  };
  const env = ambienteSemCredenciais(comTokens, "/vazio");
  assert.deepEqual(env, { PATH: "/bin", GH_CONFIG_DIR: "/vazio", AZURE_CONFIG_DIR: "/vazio" });
  assert.equal(comTokens.GH_TOKEN, "1");
  const r = await ambiente.executar(comandoNoShell('echo "[$GH_TOKEN] $GH_CONFIG_DIR"', { env: env }));
  assert.equal(r.saida, "[] /vazio\n");
});

test("git tem limite: o git parado é morto e o stderr diz por quê; sem estourar, a saída vem igual", async () => {
  const dir = mkdtempSync(join(base, "git-"));
  // Um alias de shell segura o git como um fetch parado seguraria.
  const r = await gitComLimite(200, dir, "-c", "alias.dorme=!sleep 30", "dorme");
  assert.equal(r.limiteEstourado, true);
  assert.equal(r.codigo, null);
  assert.match(r.erro, /passou do limite de 200 ms e foi morto$/);
  const v = await git(dir, "--version");
  assert.equal(v.limiteEstourado, false);
  assert.match(v.saida, /^git version /);
});

test("git recusa o clone cujo .git tem commondir, que um container forjaria para o git executar a config dele", async () => {
  const dir = mkdtempSync(join(base, "clone-"));
  await git(dir, "init", "-q");
  assert.equal((await git(dir, "status")).codigo, 0);
  writeFileSync(join(dir, ".git", "commondir"), "forjado\n");
  const r = await git(dir, "status");
  assert.notEqual(r.codigo, 0);
  assert.match(r.erro, /commondir existe num clone: recusado/);
});

test("lancar: conversa por stdin e stdout até saiu e devolve o grupo do processo", async () => {
  const processo = ambiente.lancar(comandoSh('read linha; echo "eco:$linha"; echo aviso >&2'));
  assert.equal(processo.identificador.ambiente_id, "host_local");
  assert.ok(processo.identificador.grupo_processo > 0);
  let saida = "";
  let erro = "";
  processo.stdout.setEncoding("utf8").on("data", (parte: string) => (saida += parte));
  processo.stderr.setEncoding("utf8").on("data", (parte: string) => (erro += parte));
  processo.stdin.write("oi\n");
  assert.equal(await processo.saiu, 0);
  assert.equal(saida, "eco:oi\n");
  assert.equal(erro, "aviso\n");
});

test("lancar: programa que não existe chega a aoFalhar", async () => {
  const processo = ambiente.lancar({
    programa: "programa-que-nao-existe-na-fabriquinha",
    argumentos: [],
    cwd: base,
    env: envDoServico,
  });
  const falha = await new Promise<Error>((resolve) => {
    processo.aoFalhar(resolve);
  });
  assert.match(falha.message, /ENOENT/);
});

test("sinalizar: o sinal chega ao grupo inteiro do processo lançado", async () => {
  const processo = ambiente.lancar(comandoSh("sleep 30 & sleep 30"));
  await ambiente.sinalizar(processo.identificador, "SIGKILL");
  assert.equal(await processo.saiu, null);
});

test("sinalizar: grupo que já acabou é ignorado", async () => {
  await assert.doesNotReject(ambiente.sinalizar({ ambiente_id: "host_local", grupo_processo: 2 ** 22 + 1 }, "SIGTERM"));
});

test("sinalizar: recusa processo de outro ambiente", async () => {
  await assert.rejects(
    ambiente.sinalizar({ ambiente_id: "container_x", grupo_processo: 1 }, "SIGTERM"),
    /o processo é do ambiente container_x, não do host_local/,
  );
});
