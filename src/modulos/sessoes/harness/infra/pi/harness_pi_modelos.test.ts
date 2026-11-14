import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarPiFalso } from "../../../../../../apoio-testes/falsos/pi_falso.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { conferirModeloNaLista } from "../../../../../server/system/banco_da_fabriquinha.ts";
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

const conferir = (modelo: { provedor: string; nome: string }) => conferirModeloNaLista(harness.listarModelos(), modelo);
const recusa = async (provedor: string, modelo: string, mensagem: string) => {
  await assert.rejects(
    conferir({ provedor, nome: modelo }),
    (erro) => erro instanceof ErroDeRegra && erro.message === mensagem,
  );
};

test("aceita o par listado exatamente", async () => {
  await conferir({ provedor: "openai-codex", nome: "gpt-6-luna" });
  await conferir({ provedor: "llamacpp", nome: "qwen3 coder (local)" });
});

test("recusa o que não é o par exato da lista", async () => {
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
    await conferir({ provedor: "openai-codex", nome: "gpt-6-luna" });
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

test("HarnessPi.precosDosModelos: o preço de cada modelo do catálogo do pi, pelo RPC get_available_models", async () => {
  piFalso.roteirizar([
    {
      catalogoDeModelos: [
        {
          provider: "openai-codex",
          id: "gpt-6-luna",
          name: "GPT-6 Luna",
          cost: {
            input: 0.1,
            output: 0.5,
            cacheRead: 0.01,
            cacheWrite: 0.125,
            tiers: [{ inputTokensAbove: 272000, input: 0.2, output: 0.75, cacheRead: 0.02, cacheWrite: 0.25 }],
          },
        },
        // O pi declara 0 quando não sabe o preço (os modelos das extensões sem preço): fica fora, não é preço.
        {
          provider: "claude-bridge",
          id: "claude-haiku-5-5",
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
        { provider: "local", id: "sem-custo" },
      ],
    },
  ]);
  try {
    assert.deepEqual(await harness.precosDosModelos(), [
      {
        modelo: { provedor: "openai-codex", nome: "gpt-6-luna" },
        usd_por_milhao: { entrada: 0.1, saida: 0.5, cache_leitura: 0.01, cache_escrita: 0.125 },
        origem: "pi",
      },
    ]);
    const [inicio, comando] = piFalso.registro();
    assert.deepEqual(inicio?.argv, ["--mode", "rpc", "--no-session", "--offline"]);
    assert.deepEqual(comando?.comando, { type: "get_available_models" });
  } finally {
    piFalso.roteirizar([{ listaDeModelos: { tabela } }]);
  }
});

test("HarnessPi.precosDosModelos recusa quando o pi não responde ao get_available_models", async () => {
  piFalso.roteirizar([{ sai: { codigo: 3, stderr: "sem provedores", quando: "antes_da_sessao" } }]);
  try {
    await assert.rejects(
      harness.precosDosModelos(),
      (erro) =>
        erro instanceof ErroDeRegra &&
        erro.message ===
          "o pi não informou os preços dos modelos: sem provedores (confira o pi rodando pi --mode rpc e o comando get_available_models)",
    );
  } finally {
    piFalso.roteirizar([{ listaDeModelos: { tabela } }]);
  }
});
