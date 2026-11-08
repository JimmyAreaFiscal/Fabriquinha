import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarPiFalso } from "../../../apoio-testes/pi_falso.ts";
import { ErroDeRegra } from "../../nucleo/erros.ts";
import { HarnessPi } from "./harness_pi.ts";

const harness = new HarnessPi();
const base = mkdtempSync(join(tmpdir(), "fabriquinha-modelos-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// A busca aproximada do pi devolve a tabela toda, inclusive o modelo com espaços.
const piFalso = instalarPiFalso(base);
process.env.FABRIQUINHA_ROOT = base;
const tabela = `provider      model                context  max-out  thinking  images
openai-codex  gpt-5.6-luna         272K     128K     yes       yes
openai-codex  gpt-6-luna           272K     128K     yes       yes
llamacpp      qwen3 coder (local)  32.8K    8.2K     yes       no
`;
piFalso.roteirizar([{ listaDeModelos: { tabela } }]);
symlinkSync(piFalso.caminho, join(base, "pi"));
const argumentos = () => piFalso.registro().at(-1)?.argv;

const recusa = async (provedor: string, modelo: string, mensagem: string) => {
  await assert.rejects(
    harness.conferirModelo({ provedor, nome: modelo }),
    (erro) => erro instanceof ErroDeRegra && erro.message === mensagem,
  );
};

test("aceita o par listado exatamente e passa a busca como um argumento só", async () => {
  await harness.conferirModelo({ provedor: "openai-codex", nome: "gpt-6-luna" });
  assert.deepEqual(argumentos(), ["--list-models", "openai-codex/gpt-6-luna"]);
  await harness.conferirModelo({ provedor: "llamacpp", nome: "qwen3 coder (local)" });
  assert.deepEqual(argumentos(), ["--list-models", "llamacpp/qwen3 coder (local)"]);
});

test("recusa o que a busca aproximada do pi lista, mas não é o par exato", async () => {
  const como = (par: string) => `o modelo ${par} não existe no pi (escolha um par listado por pi --list-models)`;
  await recusa("openai-codex", "gpt-6", como("openai-codex/gpt-6"));
  await recusa("openai", "gpt-6-luna", como("openai/gpt-6-luna"));
  await recusa("llamacpp", "qwen3", como("llamacpp/qwen3"));
  await recusa("provider", "model", como("provider/model"));
});

test("HarnessPi.listarModelos: todos os pares da tabela do pi, sem busca, para os seletores", async () => {
  assert.deepEqual(await harness.listarModelos(), [
    { provedor: "openai-codex", nome: "gpt-5.6-luna" },
    { provedor: "openai-codex", nome: "gpt-6-luna" },
    { provedor: "llamacpp", nome: "qwen3 coder (local)" },
  ]);
  assert.deepEqual(argumentos(), ["--list-models"]);
});

test("recusa quando o pi falha, com o stderr dele", async () => {
  piFalso.roteirizar([{ listaDeModelos: { stderr: "sem configuração", codigo: 1 } }]);
  try {
    await recusa(
      "openai-codex",
      "gpt-6-luna",
      "o pi falhou ao listar os modelos: sem configuração (confira o pi rodando pi --list-models)",
    );
  } finally {
    piFalso.roteirizar([{ listaDeModelos: { tabela } }]);
  }
});

test("sem $FABRIQUINHA_PI usa pi do PATH; binário ausente diz como resolver", async () => {
  const pathOriginal = process.env.PATH;
  delete process.env.FABRIQUINHA_PI;
  process.env.PATH = `${base}:${pathOriginal ?? ""}`; // o pi falso na frente do de verdade
  try {
    await harness.conferirModelo({ provedor: "openai-codex", nome: "gpt-6-luna" });
    process.env.FABRIQUINHA_PI = join(base, "nao-existe");
    await recusa(
      "openai-codex",
      "gpt-6-luna",
      `não foi possível rodar ${join(base, "nao-existe")}: spawn ${join(base, "nao-existe")} ENOENT (instale ${join(base, "nao-existe")} ou confira o PATH)`,
    );
  } finally {
    process.env.PATH = pathOriginal;
    process.env.FABRIQUINHA_PI = piFalso.caminho;
  }
});
