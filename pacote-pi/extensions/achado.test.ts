import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import achado from "./achado.ts";

const ferramentas: Parameters<Parameters<typeof achado>[0]["registerTool"]>[0][] = [];
achado({ registerTool: (f) => ferramentas.push(f) });
const ferramenta = ferramentas[0] ?? assert.fail("sem ferramenta");

const valido = { titulo: " Revisão repetida ", descricao: "Voltou 3 vezes.", evidencia: "I-10, sessão 2" };

async function registrar(entrada: Parameters<typeof ferramenta.execute>[1]): Promise<string> {
  const { content } = await ferramenta.execute("1", entrada);
  return content.map((c) => c.text).join("");
}

test("registra o achado, numera e só anexa; recusa campo inválido sem gravar", async () => {
  const antes = process.cwd();
  const pasta = mkdtempSync(join(tmpdir(), "achado-"));
  process.chdir(pasta);
  try {
    assert.equal(ferramenta.name, "registrar_achado");
    assert.equal(await registrar(valido), "Achado 1 registrado.");
    assert.equal(await registrar({ ...valido, titulo: "Outro" }), "Achado 2 registrado.");
    for (const ruim of [
      { ...valido, titulo: undefined },
      { ...valido, titulo: "duas\nlinhas" },
      { ...valido, titulo: "x".repeat(121) },
      { ...valido, descricao: " " },
      { ...valido, evidencia: 3 },
    ])
      assert.match(await registrar(ruim), /^Achado recusado: /);
    assert.equal(await registrar({ ...valido, titulo: "x".repeat(120) }), "Achado 3 registrado.");
    const linhas = readFileSync(join(pasta, "achados.jsonl"), "utf8").trim().split("\n");
    assert.equal(linhas.length, 3);
    assert.deepEqual(JSON.parse(linhas[0] ?? ""), {
      titulo: "Revisão repetida",
      descricao: "Voltou 3 vezes.",
      evidencia: "I-10, sessão 2",
    });
  } finally {
    process.chdir(antes);
    rmSync(pasta, { recursive: true });
  }
});
