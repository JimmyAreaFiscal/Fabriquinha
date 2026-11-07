// Fitness function: teste nenhum conhece a porta 4317 nem a raiz ~/fabriquinha do serviço real. Teste que sobe ou aponta
// para elas dispara a Fabriquinha de verdade (porta ocupada, banco real migrado). Vale para os `*.test.ts` e `*.spec.ts`
// de src/ e pacote-pi/ e para todo arquivo de integracao/, e2e/, estresse/ e apoio-testes/, inclusive comentário e nome de teste.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const PASTAS_SO_COM_ARQUIVOS_DE_TESTE = ["src", "pacote-pi"];
const PASTAS_DE_APOIO_A_TESTE = ["integracao", "e2e", "estresse", "apoio-testes"];
const REFERENCIA_AO_SERVICO_REAL = /4317|~\/fabriquinha|homedir\(\)[^;]*["'/]fabriquinha/;
// Estes dois testes fixam os padrões de produção (porta do serviço, raiz de `abrir()`) sem subir o serviço nem tocar o banco real.
const ARQUIVOS_QUE_FIXAM_O_PADRAO_DE_PRODUCAO = ["src/execucao/servico.test.ts", "src/persistencia/banco.test.ts"];

function listarArquivos(raiz: string, pasta: string): string[] {
  return readdirSync(join(raiz, pasta), { recursive: true, withFileTypes: true })
    .filter((entrada) => entrada.isFile())
    .map((entrada) => relative(raiz, join(entrada.parentPath, entrada.name)))
    .filter((caminho) => !caminho.split("/").includes("node_modules"));
}

function acharArquivosDeTesteQueReferenciamOServicoReal(raiz: string): string[] {
  const candidatos = [
    ...PASTAS_SO_COM_ARQUIVOS_DE_TESTE.flatMap((pasta) =>
      listarArquivos(raiz, pasta).filter((caminho) => /\.(test|spec)\.ts$/.test(caminho)),
    ),
    ...PASTAS_DE_APOIO_A_TESTE.flatMap((pasta) => listarArquivos(raiz, pasta)),
  ];
  return candidatos
    .filter((caminho) => !ARQUIVOS_QUE_FIXAM_O_PADRAO_DE_PRODUCAO.includes(caminho))
    .filter((caminho) => REFERENCIA_AO_SERVICO_REAL.test(readFileSync(join(raiz, caminho), "utf8")))
    .sort();
}

test("nenhum teste referencia a porta 4317 nem a raiz ~/fabriquinha", () => {
  const raiz = resolve(import.meta.dirname, "..");
  assert.deepEqual(acharArquivosDeTesteQueReferenciamOServicoReal(raiz), []);
});

test("autoteste: acusa pelo caminho a porta 4317, o texto ~/fabriquinha e homedir() juntado a fabriquinha", () => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-apoio-"));
  try {
    const escrever = (caminho: string, conteudo: string) => {
      mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
      writeFileSync(join(raiz, caminho), conteudo);
    };
    for (const pasta of [...PASTAS_SO_COM_ARQUIVOS_DE_TESTE, ...PASTAS_DE_APOIO_A_TESTE]) mkdirSync(join(raiz, pasta));
    escrever("src/a/porta.test.ts", 'const url = "http://127.0.0.1:4317/";\n');
    escrever("pacote-pi/raiz.spec.ts", "// usa ~/fabriquinha\n");
    escrever("integracao/casa.ts", 'const raiz = join(homedir(), "fabriquinha");\n');
    escrever("e2e/sub/casa_barra.ts", "const raiz = `${homedir()}/fabriquinha`;\n");
    escrever("apoio-testes/porta.ts", "const porta = 4317;\n");
    escrever("estresse/limpo.ts", 'const raiz = join(tmpdir(), "fabriquinha-estresse");\n');
    // Fora do alcance da regra: código de produção, teste sem sufixo em src/ e as exceções listadas.
    escrever("src/a/producao.ts", "const PORTA = 4317;\n");
    escrever("src/execucao/servico.test.ts", "assert.equal(portaDoServico({}), 4317);\n");
    escrever("src/persistencia/banco.test.ts", "// usa ~/fabriquinha\n");
    escrever("e2e/node_modules/x/index.ts", "4317\n");

    assert.deepEqual(acharArquivosDeTesteQueReferenciamOServicoReal(raiz), [
      "apoio-testes/porta.ts",
      "e2e/sub/casa_barra.ts",
      "integracao/casa.ts",
      "pacote-pi/raiz.spec.ts",
      "src/a/porta.test.ts",
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
