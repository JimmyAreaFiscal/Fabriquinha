// CLI (F7 §7, CLI) contra banco real numa raiz temporária: os comandos legados fora do alcance, com e sem
// FABRIQUINHA_EXECUCAO; a ajuda; o servidor, o abrir e o executável de verdade. Os comandos do agente e os da
// ferramenta externa têm os testes deles.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { abrir } from "../persistencia/banco.ts";
import { comandoDoNavegador, principal } from "./cli.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-cli-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

interface Saida {
  codigo: number;
  out: string;
  err: string;
}

let saidas = 0;

/** Roda o CLI no processo do teste, com `env` no lugar do ambiente e `stdin` como entrada. */
async function cli(env: NodeJS.ProcessEnv, args: string[], stdin = ""): Promise<Saida> {
  let out = "";
  let err = "";
  const codigo = await principal(args, {
    env,
    stdin: Readable.from([stdin]),
    stdout: { write: (t: string) => (out += t) },
    stderr: { write: (t: string) => (err += t) },
    parada: () => Promise.resolve(),
    sair: () => saidas++,
  });
  return { codigo, out, err };
}

/** O JSON de uma saída de sucesso, que é uma linha só. */
function json(s: Saida): Record<string, unknown> {
  assert.equal(s.err, "");
  assert.equal(s.codigo, 0);
  assert.match(s.out, /^[^\n]+\n$/);
  return JSON.parse(s.out) as Record<string, unknown>;
}

/** Falha com código 1 e a mensagem do F1 em uma linha no stderr. */
function falha(s: Saida, mensagem: string | RegExp): void {
  assert.deepEqual([s.codigo, s.out], [1, ""]);
  assert.match(s.err, /^[^\n]+\n$/);
  if (typeof mensagem === "string") assert.equal(s.err, `${mensagem}\n`);
  else assert.match(s.err, mensagem);
}

/** Uso inválido: código 2, o motivo e a ajuda só do grupo. */
function usoInvalido(s: Saida, motivo: string | RegExp, grupo: string): void {
  assert.deepEqual([s.codigo, s.out], [2, ""]);
  const [primeira, ...resto] = s.err.split("\n");
  if (typeof motivo === "string") assert.equal(primeira, motivo);
  else assert.match(String(primeira), motivo);
  const usos = resto.filter((l) => l.startsWith("  fabriquinha "));
  assert.ok(usos.length > 0);
  for (const linha of usos) assert.ok(`${linha} `.startsWith(`  fabriquinha ${grupo} `), linha);
}

/** Comando fora da tabela de quem chama: código 2, `comando desconhecido` e a ajuda inteira. */
function desconhecido(s: Saida, args: readonly string[]): void {
  assert.deepEqual([s.codigo, s.out], [2, ""], args.join(" "));
  assert.equal(s.err.split("\n")[0], `comando desconhecido: ${args.join(" ")}`);
  assert.match(s.err, /^Uso:$/m);
}

/** Os comandos da tabela legada (issue, ticket, necessidade, evidência e revisão da issue), que saíram do CLI. */
const LEGADOS: readonly string[][] = [
  ["issue", "ver", "I-1"],
  ["issue", "editar", "I-1", "--titulo", "Busca lenta"],
  ["issue", "propor", "I-1", "--titulo", "Parte B", "--arquivos", "35", "--descricao", "-"],
  ["issue", "cancelar", "I-1"],
  ["issue", "dep", "add", "I-1", "I-2"],
  ["issue", "dep", "rm", "I-1", "I-2"],
  ["ticket", "editar", "T-1", "--titulo", "Outro"],
  ["ticket", "remover", "T-1"],
  ["ticket", "enviar", "T-1"],
  ["evidencia", "ver", "T-1", "comportamento"],
  ["necessidade", "registrar", "--projeto", "loja", "--titulo", "Busca", "--tipo", "problema", "--descricao", "-"],
  ["necessidade", "editar", "I-1", "--titulo", "X"],
  ["necessidade", "evidencia", "I-1", "comportamento"],
  ["necessidade", "schema", "comportamento"],
  ["necessidade", "enviar", "I-1"],
  ["necessidade", "ver", "I-1"],
];

test("CA-1: sem FABRIQUINHA_EXECUCAO, issue, ticket e necessidade são comando desconhecido; a ajuda lista só servidor, abrir e demanda", async () => {
  const raiz = mkdtempSync(join(base, "sem-agente-"));
  const env = { FABRIQUINHA_ROOT: raiz };
  for (const args of [...LEGADOS, ["ticket", "ver", "T-1"], ["ticket", "criar", "I-1", "--titulo", "Cache"]]) {
    desconhecido(await cli(env, args), args);
  }
  const ajuda = await cli(env, ["--help"]);
  assert.deepEqual([ajuda.codigo, ajuda.err], [0, ""]);
  const usos = ajuda.out.split("\n").filter((l) => l.startsWith("  fabriquinha "));
  assert.ok(usos.length > 2);
  for (const linha of usos) assert.match(linha, /^ {2}fabriquinha (servidor|abrir|demanda )/);
  assert.match(ajuda.out, /^ {2}fabriquinha servidor$/m);
  assert.match(ajuda.out, /^ {2}fabriquinha abrir$/m);
  // Sem grupo conhecido, a ajuda inteira, sem nenhum comando do agente.
  for (const args of [[], ["tick"]]) {
    const s = await cli(env, args);
    assert.equal(s.codigo, 2);
    assert.match(s.err, args.length === 0 ? /^falta o comando\n/ : /^comando desconhecido: tick\n/);
    assert.match(s.err, /^ {2}fabriquinha servidor$/m);
    assert.doesNotMatch(s.err, /fabriquinha (ticket|revisao|evidencia|projeto) /);
  }
});

test("CA-2: com FABRIQUINHA_EXECUCAO de uma execução que não existe, nenhum comando legado é alcançável", async () => {
  const raiz = mkdtempSync(join(base, "execucao-inexistente-"));
  abrir(raiz).close();
  const env = { FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "1" };
  for (const args of [...LEGADOS, ["servidor"], ["abrir"]]) {
    desconhecido(await cli(env, args), args);
  }
  // Os comandos do agente da demanda existem, mas a execução não.
  for (const args of [
    ["projeto", "ver"],
    ["ticket", "ver", "I-1.T1"],
    ["revisao", "decidir", "I-1.T1", "aprovar"],
  ]) {
    falha(await cli(env, args), "a execução 1 não existe (confira FABRIQUINHA_EXECUCAO)");
  }
  const ajuda = (await cli(env, ["--help"])).out;
  assert.match(ajuda, /^ {2}fabriquinha demanda ver I-<n>$/m);
  assert.doesNotMatch(ajuda, /fabriquinha (servidor|abrir|issue|necessidade)/);
});

test("argumento que falta é uso inválido, com a ajuda do grupo", async () => {
  usoInvalido(await cli({}, ["demanda", "ver"]), /^falta /, "demanda");
});

test("--help de um grupo imprime só a ajuda dele no stdout", async () => {
  const s = await cli({}, ["demanda", "registrar", "-h"]);
  assert.deepEqual([s.codigo, s.err], [0, ""]);
  assert.match(s.out, /^ {2}fabriquinha demanda registrar /m);
  assert.doesNotMatch(s.out, /fabriquinha (servidor|abrir)/);
});

/** Uma porta livre em 127.0.0.1, para o serviço de teste não disputar a 4317 de outro serviço. */
async function portaLivre(): Promise<number> {
  const s = createServer().listen(0, "127.0.0.1");
  await new Promise((pronto) => s.once("listening", pronto));
  const { port } = s.address() as { port: number };
  await new Promise((fechou) => s.close(fechou));
  return port;
}

test("servidor sobe o serviço na raiz e para na parada; não sobe uma segunda instância; o agente não o alcança", async () => {
  const raiz = mkdtempSync(join(base, "servidor-"));
  process.env.FABRIQUINHA_PORTA = String(await portaLivre());
  const s = await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]);
  assert.deepEqual(s, { codigo: 0, out: `{"porta":${process.env.FABRIQUINHA_PORTA}}\n`, err: "" });
  assert.ok(existsSync(join(raiz, "fabriquinha.db")));
  assert.equal(saidas, 1);

  const ocupada = createServer().listen(Number(process.env.FABRIQUINHA_PORTA), "127.0.0.1");
  await new Promise((pronto) => ocupada.once("listening", pronto));
  falha(await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]), /^a Fabriquinha não conseguiu abrir 127\.0\.0\.1:/);
  await new Promise((fechou) => ocupada.close(fechou));

  for (const args of [["servidor"], ["servidor", "a-mais"], ["abrir", "--porta", "1"]]) {
    desconhecido(await cli({ FABRIQUINHA_ROOT: raiz, FABRIQUINHA_EXECUCAO: "1" }, args), args);
  }
  usoInvalido(await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor", "a-mais"]), "argumento a mais: a-mais", "servidor");
  usoInvalido(await cli({ FABRIQUINHA_ROOT: raiz }, ["abrir", "--porta", "1"]), /^Unknown option '--porta'/, "abrir");

  // Na porta 0, a linha leva a porta que o serviço escolheu.
  process.env.FABRIQUINHA_PORTA = "0";
  const livre = await cli({ FABRIQUINHA_ROOT: raiz }, ["servidor"]);
  const { porta } = json(livre) as { porta: number };
  assert.ok(Number.isInteger(porta) && porta > 0, `porta ${String(porta)}`);
});

test("abrir lê web.url e abre o navegador; sem o arquivo, diz que o serviço não está rodando", async () => {
  const raiz = mkdtempSync(join(base, "abrir-"));
  const bin = mkdtempSync(join(base, "bin-"));
  const aberto = join(bin, "aberto");
  const navegador = join(bin, comandoDoNavegador(process.platform));
  writeFileSync(navegador, `#!/bin/sh\nprintf '%s' "$1" > ${aberto}\n`);
  chmodSync(navegador, 0o755);
  const env = { FABRIQUINHA_ROOT: raiz, PATH: bin };

  falha(
    await cli(env, ["abrir"]),
    `o serviço não está rodando: falta ${join(raiz, "web.url")} (suba-o com fabriquinha servidor)`,
  );

  const url = "http://127.0.0.1:4317/entrar?token=abc";
  writeFileSync(join(raiz, "web.url"), `${url}\n`);
  assert.deepEqual(json(await cli(env, ["abrir"])), { url });
  while (!existsSync(aberto)) await dormir(10);
  await dormir(10);
  assert.equal(readFileSync(aberto, "utf8"), url);

  falha(
    await cli({ ...env, PATH: raiz }, ["abrir"]),
    `a Fabriquinha não conseguiu abrir o navegador: spawn xdg-open ENOENT (abra ${url} no navegador)`,
  );
});

test("o navegador é aberto com open no macOS e xdg-open nos demais", () => {
  assert.equal(comandoDoNavegador("darwin"), "open");
  assert.equal(comandoDoNavegador("linux"), "xdg-open");
});

test("o executável roda o CLI direto, sem aviso no stderr, com os códigos de saída", () => {
  const bin = join(import.meta.dirname, "fabriquinha.ts");
  const rodar = (args: string[], env: NodeJS.ProcessEnv) => {
    const { status, stdout, stderr } = spawnSync(bin, args, {
      env: { PATH: process.env.PATH, ...env },
      encoding: "utf8",
    });
    return { status, stdout, stderr };
  };
  const ajuda = rodar(["--help"], {});
  assert.deepEqual([ajuda.status, ajuda.stderr], [0, ""]);
  assert.match(ajuda.stdout, /^ {2}fabriquinha abrir$/m);
  assert.deepEqual(rodar(["projeto", "ver"], { FABRIQUINHA_ROOT: base, FABRIQUINHA_EXECUCAO: "7" }), {
    status: 1,
    stdout: "",
    stderr: "a execução 7 não existe (confira FABRIQUINHA_EXECUCAO)\n",
  });
  assert.equal(rodar([], {}).status, 2);
});

test("o executável sobe o servidor e para com SIGTERM, fechando o serviço", async () => {
  const raiz = mkdtempSync(join(base, "executavel-"));
  const porta = await portaLivre();
  const { FABRIQUINHA_EXECUCAO: _, ...env } = process.env;
  const servidor = spawn(join(import.meta.dirname, "fabriquinha.ts"), ["servidor"], {
    env: { ...env, FABRIQUINHA_ROOT: raiz, FABRIQUINHA_PORTA: String(porta) },
    stdio: ["ignore", "pipe", "inherit"],
  });
  const [linha] = (await once(servidor.stdout, "data")) as [Buffer];
  assert.equal(linha.toString(), `{"porta":${String(porta)}}\n`);
  servidor.kill("SIGTERM");
  assert.deepEqual(await once(servidor, "exit"), [0, null]);
  assert.ok(existsSync(join(raiz, "fabriquinha.db")));
});
