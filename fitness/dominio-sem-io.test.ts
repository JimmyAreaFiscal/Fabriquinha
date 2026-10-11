// Fitness function: o domínio (F1) não faz I/O. Ele só importa a si mesmo, o zod e módulos puros do Node.
// Lista de permitidos em vez de proibidos: um import novo precisa ser liberado aqui de propósito.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const PERMITIDOS = new Set(["zod", "node:path"]);

function violacoes(dominio: string): string[] {
  const achadas: string[] = [];
  for (const arquivo of readdirSync(dominio, { recursive: true, encoding: "utf8" })) {
    if (!arquivo.endsWith(".ts") || arquivo.endsWith(".test.ts")) continue;
    const caminho = join(dominio, arquivo);
    const { importedFiles } = ts.preProcessFile(readFileSync(caminho, "utf8"), true, true);
    for (const { fileName: alvo } of importedFiles) {
      const interno = alvo.startsWith(".") && !relative(dominio, resolve(dirname(caminho), alvo)).startsWith("..");
      if (!interno && !PERMITIDOS.has(alvo)) achadas.push(`${arquivo} importa ${alvo}`);
    }
  }
  return achadas;
}

test("src/dominio não importa I/O, banco nem outros módulos da Fabriquinha", () => {
  assert.deepEqual(violacoes(resolve(import.meta.dirname, "../src/dominio")), []);
});

test("a fitness acusa cada tipo de import proibido e aceita os permitidos", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const dominio = join(raiz, "dominio");
  mkdirSync(join(dominio, "sub"), { recursive: true });
  writeFileSync(
    join(dominio, "ok.ts"),
    'import { z } from "zod";\nimport { isAbsolute } from "node:path";\nimport { X } from "./sub/x.ts";\n',
  );
  writeFileSync(join(dominio, "sub", "x.ts"), 'export { Y } from "../ok.ts";\n');
  writeFileSync(join(dominio, "ruim.test.ts"), 'import { test } from "node:test";\n');
  writeFileSync(
    join(dominio, "sub", "ruim.ts"),
    [
      'import { readFileSync } from "node:fs";',
      'import type { DatabaseSync } from "node:sqlite";',
      'import { escrever } from "../../persistencia/banco.ts";',
      'export { spawn } from "child_process";',
      'const m = await import("node:net");',
    ].join("\n"),
  );

  assert.deepEqual(violacoes(dominio).sort(), [
    "sub/ruim.ts importa ../../persistencia/banco.ts",
    "sub/ruim.ts importa child_process",
    "sub/ruim.ts importa node:fs",
    "sub/ruim.ts importa node:net",
    "sub/ruim.ts importa node:sqlite",
  ]);
});
