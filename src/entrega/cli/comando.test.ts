import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { schemaDoTipo } from "../../sdlc/nucleo/evidencias/evidencia.ts";
import { relogioFixo } from "../../compartilhado/nucleo/relogio.ts";
import { type Comando, type DepsDoCli, type EntradaDoComando, lerJsonDoArquivo, schemaJsonDoTipo } from "./comando.ts";

const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-comando-"));
after(() => {
  rmSync(pasta, { recursive: true, force: true });
});

const stdin = (texto: string) => Readable.from([texto]);

test("lerJsonDoArquivo lê o arquivo e o stdin com -", async () => {
  const arquivo = join(pasta, "dados.json");
  writeFileSync(arquivo, '{"a":1}');
  assert.deepEqual(await lerJsonDoArquivo(arquivo, stdin("")), { a: 1 });
  assert.deepEqual(await lerJsonDoArquivo("-", stdin("[2]")), [2]);
});

test("lerJsonDoArquivo recusa o arquivo ausente ou malformado e diz o que corrigir", async () => {
  const arquivo = join(pasta, "ruim.json");
  writeFileSync(arquivo, "{");
  for (const [valor, entrada] of [
    [arquivo, ""],
    [join(pasta, "ausente.json"), ""],
    ["-", "{"],
  ] as const) {
    await assert.rejects(
      lerJsonDoArquivo(valor, stdin(entrada)),
      (erro: ErroDeRegra) =>
        erro instanceof ErroDeRegra &&
        erro.message.startsWith(`${valor} não é um JSON válido: `) &&
        erro.message.endsWith(" (corrija o arquivo de dados)"),
    );
  }
});

test("lerJsonDoArquivo com opção lê o JSON da própria opção e cita a opção no erro", async () => {
  assert.deepEqual(await lerJsonDoArquivo('[{"a":1}]', stdin(""), "--correcoes"), [{ a: 1 }]);
  assert.deepEqual(await lerJsonDoArquivo("-", stdin('{"b":2}'), "--plano"), { b: 2 });
  await assert.rejects(
    lerJsonDoArquivo("{", stdin(""), "--correcoes"),
    (erro: ErroDeRegra) =>
      erro.message.startsWith("--correcoes não é um JSON válido: ") &&
      erro.message.endsWith(" (passe --correcoes <json|->)"),
  );
});

test("schemaJsonDoTipo traz o schema JSON dos dados e a regra dos arquivos do tipo", () => {
  const schema = schemaJsonDoTipo("comportamento");
  assert.equal(schema.dados.type, "object");
  assert.deepEqual(schema.arquivos, schemaDoTipo("comportamento").arquivos);
});

test("um Comando recebe a entrada já lida e as dependências do processo", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  after(fechar);
  const comando: Comando = {
    nome: "demanda ver",
    posicionais: ["I-<n>"],
    argumentos: { options: { ferramenta: { type: "string" } } },
    executar: ({ posicionais, opcoes }: EntradaDoComando, deps: DepsDoCli) =>
      deps.comBanco((bancoAberto) => ({ posicionais, opcoes, banco: bancoAberto === banco, env: deps.env.X })),
  };
  const entrada = { posicionais: ["I-1"], opcoes: { ferramenta: "claude" } };
  const deps = {
    env: { X: "1" },
    stdin: stdin(""),
    stdout: { write: () => true },
    stderr: { write: () => true },
    raiz: "/raiz",
    relogio: relogioFixo("2026-01-01T00:00:00.000Z"),
    comBanco: <T>(usar: (aberto: DatabaseSync) => T | Promise<T>) => Promise.resolve(usar(banco)),
    iniciarServico: () => Promise.reject(new Error("não sobe")),
    abrirNoNavegador: () => Promise.resolve(),
    parada: () => Promise.resolve(),
  };
  assert.deepEqual(await comando.executar(entrada, deps), { ...entrada, banco: true, env: "1" });
});
