import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { abrigarNoAmbiente, pastasDoAmbiente, recolherParaOEspaco } from "./pastas_do_ambiente.ts";

const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-pastas-do-ambiente-"));
after(() => {
  rmSync(raiz, { recursive: true, force: true });
});

const ehLink = (caminho: string): boolean => lstatSync(caminho).isSymbolicLink();

test("abrigar: a pasta de verdade do core vai para o container e o caminho do core vira link para ela", () => {
  mkdirSync(join(raiz, "execucoes", "E-1"), { recursive: true });
  writeFileSync(join(raiz, "execucoes", "E-1", "log"), "linha\n");
  abrigarNoAmbiente(raiz, "amb-a", "execucoes", "E-1");
  const dentro = join(pastasDoAmbiente(raiz, "amb-a").execucoes, "E-1");
  assert.equal(readlinkSync(join(raiz, "execucoes", "E-1")), dentro);
  assert.equal(readFileSync(join(raiz, "execucoes", "E-1", "log"), "utf8"), "linha\n");
  abrigarNoAmbiente(raiz, "amb-a", "execucoes", "E-1"); // já está lá: não muda nada
  assert.equal(readlinkSync(join(raiz, "execucoes", "E-1")), dentro);
});

test("abrigar: pasta que não existe nasce vazia no container", () => {
  abrigarNoAmbiente(raiz, "amb-a", "sessoes", "s-1");
  assert.ok(existsSync(join(pastasDoAmbiente(raiz, "amb-a").sessoes, "s-1")));
  assert.ok(ehLink(join(raiz, "sessoes", "s-1")));
});

test("abrigar: link que sobrou sem a pasta (alvo apagado) vira pasta vazia no container novo", () => {
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  symlinkSync(join(raiz, "sumiu"), join(raiz, "sessoes", "s-2"));
  abrigarNoAmbiente(raiz, "amb-b", "sessoes", "s-2");
  assert.equal(readlinkSync(join(raiz, "sessoes", "s-2")), join(pastasDoAmbiente(raiz, "amb-b").sessoes, "s-2"));
  assert.ok(existsSync(join(raiz, "sessoes", "s-2")));
});

test("recolher: o container só fica com o que é do Espaço atual; o que era do anterior sai e o core ainda lê pelo mesmo caminho", () => {
  writeFileSync(join(raiz, "sessoes", "s-1", "2026_s-1.jsonl"), "sessão\n");
  recolherParaOEspaco(raiz, "amb-a", "I-1.R1");
  const arquivo = join(raiz, "espacos", "I-1.R1");
  assert.deepEqual(
    [
      existsSync(join(pastasDoAmbiente(raiz, "amb-a").sessoes, "s-1")),
      existsSync(join(pastasDoAmbiente(raiz, "amb-a").execucoes, "E-1")),
    ],
    [false, false],
  );
  assert.equal(readlinkSync(join(raiz, "sessoes", "s-1")), join(arquivo, "sessoes", "s-1"));
  assert.equal(readFileSync(join(raiz, "sessoes", "s-1", "2026_s-1.jsonl"), "utf8"), "sessão\n");
  assert.equal(readFileSync(join(raiz, "execucoes", "E-1", "log"), "utf8"), "linha\n");
  // O Espaço seguinte, no mesmo container, não enxerga as pastas do anterior.
  abrigarNoAmbiente(raiz, "amb-a", "sessoes", "s-9");
  assert.deepEqual(
    existsSync(join(pastasDoAmbiente(raiz, "amb-a").sessoes, "s-1")) ||
      existsSync(join(pastasDoAmbiente(raiz, "amb-a").execucoes, "E-1")),
    false,
  );
});

test("abrigar: retomar a sessão de um Espaço antigo traz a pasta de volta ao container atual", () => {
  abrigarNoAmbiente(raiz, "amb-c", "sessoes", "s-1");
  assert.equal(readlinkSync(join(raiz, "sessoes", "s-1")), join(pastasDoAmbiente(raiz, "amb-c").sessoes, "s-1"));
  assert.equal(readFileSync(join(raiz, "sessoes", "s-1", "2026_s-1.jsonl"), "utf8"), "sessão\n");
});

test("recolher: container sem pastas (nunca abrigou nada) não faz nada, e pasta cujo caminho do core sumiu também é recolhida", () => {
  recolherParaOEspaco(raiz, "amb-inexistente", "I-2.R1");
  mkdirSync(join(pastasDoAmbiente(raiz, "amb-d").execucoes, "E-5"), { recursive: true });
  recolherParaOEspaco(raiz, "amb-d", "I-2.R1");
  assert.ok(existsSync(join(raiz, "espacos", "I-2.R1", "execucoes", "E-5")));
  assert.ok(ehLink(join(raiz, "execucoes", "E-5")));
});
