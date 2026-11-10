import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { after, test } from "node:test";
import { abrirBancoTemporario } from "../../../apoio-testes/banco_temporario.ts";
import { montarAgregadoDemanda, montarTicket } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { ErroDeInexistente, ErroDeRegra } from "../../nucleo/erros.ts";
import { schemaDoTipo } from "../../nucleo/evidencia.ts";
import {
  type Comando,
  type DepsDoCli,
  type EntradaDoComando,
  exigirTicket,
  lerJsonDoArquivo,
  schemaJsonDoTipo,
} from "./comando.ts";

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

test("exigirTicket devolve o ticket e, sem ele, diz o endereço público que não existe", () => {
  const agregado = montarAgregadoDemanda("I-206", "em_execucao", {
    tickets: [montarTicket("I-206", 3, "implementar")],
  });
  assert.equal(exigirTicket(agregado, 3).etapa, "implementar");
  assert.throws(
    () => exigirTicket(agregado, 4),
    (erro: ErroDeInexistente) =>
      erro instanceof ErroDeInexistente && erro.message === "o ticket I-206.T4 não existe (confira a execução)",
  );
});

test("um Comando recebe a entrada já lida e as dependências do processo", async () => {
  const { banco, fechar } = abrirBancoTemporario();
  after(fechar);
  const comando: Comando = {
    nome: "demanda ver",
    argumentos: { options: { ferramenta: { type: "string" } }, allowPositionals: true },
    executar: ({ posicionais, opcoes }: EntradaDoComando, deps: DepsDoCli) =>
      Promise.resolve({ posicionais, opcoes, banco: deps.banco === banco, env: deps.env.X }),
  };
  const entrada = { posicionais: ["I-1"], opcoes: { ferramenta: "claude" } };
  assert.deepEqual(await comando.executar(entrada, { banco, env: { X: "1" }, stdin: stdin("") }), {
    ...entrada,
    banco: true,
    env: "1",
  });
});
