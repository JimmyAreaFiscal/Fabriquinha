// Fitness function: só o GeradorDeAmbientes chama o docker (CONCEITOS.md §7), e todo `create`/`run` dele leva limite de
// memória, de CPU e o rótulo da Fabriquinha. Fora de `src/sandbox/infra/container/` a regra antiga vale: o SonarQube é
// um serviço do Auditor, único contêiner que não é Ambiente; o scanner roda no host (`sonar-scanner` do PATH). Um
// `docker run` sem limite estoura a memória da VM do Docker Desktop (código 137) e cria contêineres fora do controle
// do Auditor.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PASTAS = ["src", "pacote-pi", "skills"];
// O único lugar que pode chamar o docker: o GeradorDeAmbientes (CONCEITOS.md §7).
const PASTA_DO_GERADOR = "src/sandbox/infra/container/";
const CHAMADA_PROIBIDA_FORA_DO_GERADOR = /\bdocker\s+(run|create|exec|start)\b|"docker"/;
// Uma criação de container escrita como texto (`docker run ...`) ou como lista de argumentos (`["run", ...]`).
const CRIACAO_DE_CONTAINER = /\bdocker\s+(?:run|create)\b[^\n]*|\[\s*"(?:run|create)"[^\]]*\]/g;
const ROTULO_EXIGIDO = "fabriquinha.ambiente";
// O gerador escreve o rótulo pela constante; ela dispensa só o rótulo, nunca --memory nem --cpus.
const CONSTANTE_DO_ROTULO = "ROTULO_DO_AMBIENTE";
const EXIGIDOS_NA_CRIACAO = ["--memory", "--cpus", ROTULO_EXIGIDO];

/** O que há de errado no arquivo `caminho` (relativo à raiz do repositório); lista vazia se nada. */
function problemasDoArquivo(caminho: string, texto: string): string[] {
  if (!caminho.startsWith(PASTA_DO_GERADOR))
    return CHAMADA_PROIBIDA_FORA_DO_GERADOR.test(texto) ? [`${caminho}: docker fora de ${PASTA_DO_GERADOR}`] : [];
  return [...texto.matchAll(CRIACAO_DE_CONTAINER)].flatMap(([criacao]) =>
    EXIGIDOS_NA_CRIACAO.filter(
      (exigido) => !criacao.includes(exigido) && !(exigido === ROTULO_EXIGIDO && criacao.includes(CONSTANTE_DO_ROTULO)),
    ).map((faltando) => `${caminho}: criação de container sem ${faltando}`),
  );
}

test("só o gerador chama o docker, e toda criação de container leva memória, CPU e rótulo", () => {
  const raiz = resolve(import.meta.dirname, "..");
  const achados: string[] = [];
  for (const pasta of PASTAS) {
    for (const arquivo of readdirSync(join(raiz, pasta), { recursive: true, encoding: "utf8" })) {
      if (!/\.(ts|md|sh)$/.test(arquivo) || arquivo.endsWith(".test.ts")) continue;
      achados.push(...problemasDoArquivo(`${pasta}/${arquivo}`, readFileSync(join(raiz, pasta, arquivo), "utf8")));
    }
  }
  assert.deepEqual(achados, []);
});

test("autoteste: acusa docker run sem --memory, sem o rótulo e docker fora do gerador; aceita a criação completa", () => {
  const dentro = `${PASTA_DO_GERADOR}x.ts`;
  const completa = `docker run --memory 1g --cpus 1 --label fabriquinha.ambiente=a img`;
  assert.deepEqual(problemasDoArquivo(dentro, completa), []);
  assert.deepEqual(
    problemasDoArquivo(dentro, `["run", "--memory", "1g", "--cpus", "1", "--label", "fabriquinha.ambiente=a"]`),
    [],
  );
  assert.deepEqual(problemasDoArquivo(dentro, `docker run --cpus 1 --label fabriquinha.ambiente=a img`), [
    `${dentro}: criação de container sem --memory`,
  ]);
  assert.deepEqual(problemasDoArquivo(dentro, `docker create --memory 1g --cpus 1 img`), [
    `${dentro}: criação de container sem fabriquinha.ambiente`,
  ]);
  assert.deepEqual(problemasDoArquivo(dentro, `["run", "--memory", "1g", "--label", "fabriquinha.ambiente=a"]`), [
    `${dentro}: criação de container sem --cpus`,
  ]);
  assert.deepEqual(problemasDoArquivo(dentro, '["create", `${ROTULO_DO_AMBIENTE}=x`]'), [
    `${dentro}: criação de container sem --memory`,
    `${dentro}: criação de container sem --cpus`,
  ]);
  assert.deepEqual(problemasDoArquivo("src/outro.ts", completa), [`src/outro.ts: docker fora de ${PASTA_DO_GERADOR}`]);
  assert.deepEqual(problemasDoArquivo("src/outro.ts", `executar("docker", [])`), [
    `src/outro.ts: docker fora de ${PASTA_DO_GERADOR}`,
  ]);
});
