// A subida do serviço garante o CLI do agente (pacote-pi/bin/fabriquinha) num checkout sem ele (CA-1) e o regera
// quando o hash gravado é de um código anterior (CA-2). O destino é sempre uma pasta temporária: nunca o pacote-pi do repositório.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { iniciarServico } from "../src/composicao/servico.ts";

let base: string;
let pastaDoPacote: string;
let arquivoDoPacote: string;

before(() => {
  base = mkdtempSync(join(tmpdir(), "fabriquinha-pacote-do-agente-"));
  pastaDoPacote = join(base, "pacote-pi", "bin");
  arquivoDoPacote = join(pastaDoPacote, "fabriquinha");
  process.env.FABRIQUINHA_PORTA = "0"; // uma porta livre, sem disputar com uma Fabriquinha de verdade
});
after(() => {
  rmSync(base, { recursive: true, force: true });
});

async function subirEPararOServico(raiz: string): Promise<void> {
  const servico = await iniciarServico(raiz, pastaDoPacote);
  await servico.parar();
}

test("checkout sem o pacote: a subida o gera e o --help lista evidencia add (CA-1)", async () => {
  assert.equal(existsSync(arquivoDoPacote), false);
  await subirEPararOServico(join(base, "raiz-1"));
  const ajuda = execFileSync(process.execPath, [arquivoDoPacote, "--help"], { encoding: "utf8" });
  assert.match(ajuda, /fabriquinha evidencia add/);
});

test("hash gravado de uma versão anterior: a subida gera o pacote de novo (CA-2)", async () => {
  writeFileSync(`${arquivoDoPacote}.versao`, "hash-de-uma-versao-anterior");
  await subirEPararOServico(join(base, "raiz-2"));
  assert.match(readFileSync(`${arquivoDoPacote}.versao`, "utf8"), /^[0-9a-f]{64}$/);
});
