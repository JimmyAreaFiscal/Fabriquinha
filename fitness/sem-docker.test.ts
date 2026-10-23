// Fitness function: a Fabriquinha não lança contêineres. O SonarQube é um serviço do Auditor, único contêiner da
// máquina; o scanner roda no host (`sonar-scanner` do PATH). Um `docker run` novo no código estoura a memória da VM
// do Docker Desktop (código 137) e cria contêineres fora do controle do Auditor.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PASTAS = ["src", "pacote-pi", "skills"];

test("nenhum código da Fabriquinha chama o docker", () => {
  const raiz = resolve(import.meta.dirname, "..");
  const achados: string[] = [];
  for (const pasta of PASTAS) {
    for (const arquivo of readdirSync(join(raiz, pasta), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|md|sh)$/.test(arquivo) || arquivo.endsWith(".test.ts")) continue;
      const texto = readFileSync(join(raiz, pasta, arquivo), "utf8");
      if (/\bdocker\s+(run|create|exec|start)\b|"docker"/.test(texto)) achados.push(`${pasta}/${arquivo}`);
    }
  }
  assert.deepEqual(achados, []);
});
