import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { garantirPacoteDoAgente } from "./pacote_do_agente.ts";

let pasta: string;
let destino: string;
let entrada: string;

before(() => {
  pasta = mkdtempSync(join(tmpdir(), "pacote-agente-"));
  destino = join(pasta, "bin", "fabriquinha");
  entrada = join(pasta, "principal.ts");
  writeFileSync(join(pasta, "mensagem.ts"), 'export const mensagem = "oi";\n');
  writeFileSync(entrada, 'import { mensagem } from "./mensagem.ts";\nconsole.log(mensagem);\n');
});
after(() => {
  rmSync(pasta, { recursive: true, force: true });
});

test("pacote ausente: gera o executável e grava o hash ao lado", async () => {
  assert.equal(await garantirPacoteDoAgente(destino, entrada), true);
  assert.match(readFileSync(destino, "utf8"), /^#!\/usr\/bin\/env node\n/);
  assert.equal(statSync(destino).mode & 0o111, 0o111);
  assert.match(readFileSync(`${destino}.versao`, "utf8"), /^[0-9a-f]{64}$/);
});

test("hash igual: não toca no arquivo", async () => {
  const antes = new Date("2020-01-01T00:00:00Z");
  utimesSync(destino, antes, antes);
  assert.equal(await garantirPacoteDoAgente(destino, entrada), false);
  assert.equal(statSync(destino).mtimeMs, antes.getTime());
});

test("hash velho: gera de novo e grava o hash do código atual", async () => {
  writeFileSync(`${destino}.versao`, "hash-de-uma-versao-anterior");
  assert.equal(await garantirPacoteDoAgente(destino, entrada), true);
  assert.match(readFileSync(`${destino}.versao`, "utf8"), /^[0-9a-f]{64}$/);
  assert.equal(await garantirPacoteDoAgente(destino, entrada), false);
});

test("código-fonte alterado: o hash muda e o pacote é gerado de novo", async () => {
  writeFileSync(entrada, 'console.log("tchau");\n');
  assert.equal(await garantirPacoteDoAgente(destino, entrada), true);
  assert.match(readFileSync(destino, "utf8"), /tchau/);
});

test("falha do empacotamento: lança o erro do esbuild e não toca no pacote", async () => {
  const versaoAntes = readFileSync(`${destino}.versao`, "utf8");
  const quebrada = join(pasta, "quebrada.ts");
  writeFileSync(quebrada, 'import "./nao_existe.ts";\n');
  await assert.rejects(garantirPacoteDoAgente(destino, quebrada), /nao_existe/);
  assert.equal(readFileSync(`${destino}.versao`, "utf8"), versaoAntes);
});
