import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { conferirModelo } from "./modelos.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-modelos-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// pi falso via $FABRIQUINHA_PI (F4 §12): anota os argumentos e imprime a tabela, aproximada como a busca do pi.
const pi = join(base, "pi");
const argumentos = join(base, "argumentos");
writeFileSync(
  pi,
  `#!/bin/sh
printf '%s\\n' "$@" > "${argumentos}"
[ -n "$FALSO_PI_ERRO" ] && { echo "$FALSO_PI_ERRO" >&2; exit 1; }
cat <<'TABELA'
provider      model                context  max-out  thinking  images
openai-codex  gpt-5.6-luna         272K     128K     yes       yes
openai-codex  gpt-6-luna           272K     128K     yes       yes
llamacpp      qwen3 coder (local)  32.8K    8.2K     yes       no
TABELA
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

const recusa = async (provedor: string, modelo: string, mensagem: string) => {
  await assert.rejects(
    conferirModelo({ provedor, modelo }),
    (erro) => erro instanceof ErroDeRegra && erro.message === mensagem,
  );
};

test("aceita o par listado exatamente e passa a busca como um argumento só", async () => {
  await conferirModelo({ provedor: "openai-codex", modelo: "gpt-6-luna" });
  assert.deepEqual(readFileSync(argumentos, "utf8"), "--list-models\nopenai-codex/gpt-6-luna\n");
  await conferirModelo({ provedor: "llamacpp", modelo: "qwen3 coder (local)" });
  assert.deepEqual(readFileSync(argumentos, "utf8"), "--list-models\nllamacpp/qwen3 coder (local)\n");
});

test("recusa o que a busca aproximada do pi lista, mas não é o par exato", async () => {
  const como = (par: string) => `o modelo ${par} não existe no pi (escolha um par listado por pi --list-models)`;
  await recusa("openai-codex", "gpt-6", como("openai-codex/gpt-6"));
  await recusa("openai", "gpt-6-luna", como("openai/gpt-6-luna"));
  await recusa("llamacpp", "qwen3", como("llamacpp/qwen3"));
  await recusa("provider", "model", como("provider/model"));
});

test("recusa quando o pi falha, com o stderr dele", async () => {
  process.env.FALSO_PI_ERRO = "sem configuração";
  try {
    await recusa(
      "openai-codex",
      "gpt-6-luna",
      "o pi falhou ao listar os modelos: sem configuração (confira o pi rodando pi --list-models)",
    );
  } finally {
    delete process.env.FALSO_PI_ERRO;
  }
});

test("sem $FABRIQUINHA_PI usa pi do PATH; binário ausente diz como resolver", async () => {
  const pathOriginal = process.env.PATH;
  delete process.env.FABRIQUINHA_PI;
  process.env.PATH = `${base}:${pathOriginal ?? ""}`; // o pi falso na frente do de verdade
  try {
    await conferirModelo({ provedor: "openai-codex", modelo: "gpt-6-luna" });
    process.env.FABRIQUINHA_PI = join(base, "nao-existe");
    await recusa(
      "openai-codex",
      "gpt-6-luna",
      `não foi possível rodar ${join(base, "nao-existe")}: spawn ${join(base, "nao-existe")} ENOENT (instale ${join(base, "nao-existe")} ou confira o PATH)`,
    );
  } finally {
    process.env.PATH = pathOriginal;
    process.env.FABRIQUINHA_PI = pi;
  }
});
