// Fitness function: só o Ambiente chama o docker (CONCEITOS.md §7), pelo GeradorDeAmbientes e pelo AmbienteContainer, e todo
// `create`/`run` dele leva limite de memória, de CPU e o rótulo da Fabriquinha. Fora dessas pastas a regra antiga vale: o SonarQube é
// um serviço do Auditor, único contêiner que não é Ambiente; o scanner roda no host (`sonar-scanner` do PATH). Um
// `docker run` sem limite estoura a memória da VM do Docker Desktop (código 137) e cria contêineres fora do controle
// do Auditor.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const PASTAS = ["src", "pacote-pi", "skills"];
// Os únicos lugares que podem chamar o docker (CONCEITOS.md §7): o GeradorDeAmbientes, que cria e elimina os containers,
// e o AmbienteContainer, que executa neles.
const PASTAS_DO_DOCKER = ["src/modulos/ambiente/sandboxes/infra/", "src/modulos/ambiente/execucao/infra/container/"];
const DESCRICAO_DAS_PASTAS_DO_DOCKER = PASTAS_DO_DOCKER.join(" e ");
const CHAMADA_PROIBIDA_FORA_DO_GERADOR = /\bdocker\s+(run|create|exec|start)\b|"docker"/;
// Uma criação de container escrita como texto (`docker run ...`) ou como lista de argumentos (`["run", ...]`).
const CRIACAO_DE_CONTAINER = /\bdocker\s+(?:run|create)\b[^\n]*|\[\s*"(?:run|create)"[^\]]*\]/g;
const ROTULO_EXIGIDO = "fabriquinha.ambiente";
// O gerador escreve o rótulo pela constante; ela dispensa só o rótulo, nunca --memory nem --cpus.
const CONSTANTE_DO_ROTULO = "ROTULO_DO_AMBIENTE";
const EXIGIDOS_NA_CRIACAO = ["--memory", "--cpus", ROTULO_EXIGIDO];

/** O que há de errado no arquivo `caminho` (relativo à raiz do repositório); lista vazia se nada. */
function problemasDoArquivo(caminho: string, texto: string): string[] {
  if (!PASTAS_DO_DOCKER.some((pasta) => caminho.startsWith(pasta)))
    return CHAMADA_PROIBIDA_FORA_DO_GERADOR.test(texto)
      ? [`${caminho}: docker fora de ${DESCRICAO_DAS_PASTAS_DO_DOCKER}`]
      : [];
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
  const dentro = `${PASTAS_DO_DOCKER[0] ?? ""}x.ts`;
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
  assert.deepEqual(problemasDoArquivo("src/outro.ts", completa), [
    `src/outro.ts: docker fora de ${DESCRICAO_DAS_PASTAS_DO_DOCKER}`,
  ]);
  assert.deepEqual(problemasDoArquivo("src/outro.ts", `executar("docker", [])`), [
    `src/outro.ts: docker fora de ${DESCRICAO_DAS_PASTAS_DO_DOCKER}`,
  ]);
});
