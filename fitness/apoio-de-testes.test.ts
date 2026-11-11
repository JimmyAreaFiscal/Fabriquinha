// Fitness function: teste nenhum conhece a porta 4317 nem a raiz ~/fabriquinha do serviço real. Teste que sobe ou aponta
// para elas dispara a Fabriquinha de verdade (porta ocupada, banco real migrado). Vale para os `*.test.ts` e `*.spec.ts`
// de src/ e pacote-pi/ e para todo arquivo de integracao/, e2e/, estresse/ e apoio-testes/, inclusive comentário e nome de teste.
// Teste também não monta o próprio banco (`mkdtemp` junto com `abrir(`): usa `abrirBancoTemporario()` de apoio-testes/.
// Nenhum `*.test.ts` é importado por outro arquivo (import estático ou `import()`): o que é compartilhado vive em apoio-testes/.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";

const PASTAS_SO_COM_ARQUIVOS_DE_TESTE = ["src", "pacote-pi"];
const PASTAS_DE_APOIO_A_TESTE = ["integracao", "e2e", "estresse", "apoio-testes"];
const REFERENCIA_AO_SERVICO_REAL = /4317|~\/fabriquinha|homedir\(\)[^;]*["'/]fabriquinha/;
// Estes dois testes fixam os padrões de produção (porta do serviço, raiz de `abrir()`) sem subir o serviço nem tocar o banco real.
const ARQUIVOS_QUE_FIXAM_O_PADRAO_DE_PRODUCAO = [
  "src/composicao/servico.test.ts",
  "src/compartilhado/armazenamento/banco.test.ts",
];

const PASTAS_QUE_NAO_MONTAM_BANCO_PROPRIO = ["src", "pacote-pi", "integracao", "e2e", "estresse"];
// Estes dois testam o próprio `banco.ts` e a linha de base de migração: precisam abrir o banco numa raiz que eles controlam.
const ARQUIVOS_QUE_PODEM_MONTAR_BANCO_PROPRIO = [
  "src/compartilhado/armazenamento/banco.test.ts",
  "src/compartilhado/armazenamento/migracoes/migracao_linha_de_base.test.ts",
];

const PASTAS_QUE_NAO_IMPORTAM_TESTE = ["src", "pacote-pi", "integracao", "e2e", "apoio-testes", "fitness", "estresse"];
// Mesmo critério do grep do CA-1; este arquivo fica de fora porque o autoteste dele traz esses textos entre aspas.
const IMPORTACAO_DE_ARQUIVO_DE_TESTE = /(from |import\()["'][^"']*\.test\.ts["']/;
const ARQUIVO_DESTA_FITNESS = "fitness/apoio-de-testes.test.ts";

function listarArquivos(raiz: string, pasta: string): string[] {
  return (
    readdirSync(join(raiz, pasta), { recursive: true, withFileTypes: true })
      .filter((entrada) => entrada.isFile())
      .map((entrada) => relative(raiz, join(entrada.parentPath, entrada.name)))
      .filter((caminho) => !caminho.split("/").includes("node_modules"))
      // O JSON que `npm run estresse` grava (ignorado pelo git) traz a porta medida, não é teste: sem isso, rodar o
      // estresse antes do check derrubava o próprio check.
      .filter((caminho) => !caminho.startsWith("estresse/resultados/"))
  );
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

// Mesmo critério do grep do CA-3: `mkdtemp` e `\babrir(` (palavra inteira, qualquer chamada) no mesmo arquivo.
function acharArquivosQueMontamBancoProprio(raiz: string): string[] {
  return PASTAS_QUE_NAO_MONTAM_BANCO_PROPRIO.flatMap((pasta) => listarArquivos(raiz, pasta))
    .filter((caminho) => caminho.endsWith(".ts"))
    .filter((caminho) => !ARQUIVOS_QUE_PODEM_MONTAR_BANCO_PROPRIO.includes(caminho))
    .filter((caminho) => {
      const conteudo = readFileSync(join(raiz, caminho), "utf8");
      return conteudo.includes("mkdtemp") && /\babrir\(/.test(conteudo);
    })
    .sort();
}

function acharArquivosQueImportamArquivoDeTeste(raiz: string): string[] {
  return PASTAS_QUE_NAO_IMPORTAM_TESTE.flatMap((pasta) => listarArquivos(raiz, pasta))
    .filter((caminho) => caminho.endsWith(".ts") && caminho !== ARQUIVO_DESTA_FITNESS)
    .filter((caminho) => IMPORTACAO_DE_ARQUIVO_DE_TESTE.test(readFileSync(join(raiz, caminho), "utf8")))
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
    escrever("src/composicao/servico.test.ts", "assert.equal(portaDoServico({}), 4317);\n");
    escrever("src/compartilhado/armazenamento/banco.test.ts", "// usa ~/fabriquinha\n");
    escrever("e2e/node_modules/x/index.ts", "4317\n");
    escrever("estresse/resultados/medicao.json", '{"url":"http://127.0.0.1:4317/"}\n');

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

test("nenhum teste monta o próprio banco com mkdtemp mais abrir(", () => {
  const raiz = resolve(import.meta.dirname, "..");
  assert.deepEqual(acharArquivosQueMontamBancoProprio(raiz), []);
});

test("autoteste: acusa pelo caminho o arquivo com mkdtemp e abrir(, e poupa as exceções listadas", () => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-banco-"));
  try {
    const escrever = (caminho: string, conteudo: string) => {
      mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
      writeFileSync(join(raiz, caminho), conteudo);
    };
    for (const pasta of PASTAS_QUE_NAO_MONTAM_BANCO_PROPRIO) mkdirSync(join(raiz, pasta));
    escrever("src/a/proprio.test.ts", "const pasta = mkdtempSync(tmp);\nconst banco = abrir(pasta);\n");
    escrever("e2e/sub/proprio.ts", "mkdtempSync(tmp);\nawait abrir(pasta);\n");
    escrever("estresse/hospedagem.ts", "mkdtempSync(tmp);\ngh.abrir({});\n");
    // Fora do alcance da regra: só um dos dois, o método `abrirPr`, as exceções listadas e node_modules.
    escrever("src/a/so_mkdtemp.test.ts", "mkdtempSync(tmp);\n");
    escrever("src/a/so_abrir.test.ts", "abrir(raiz);\n");
    escrever("src/a/pr.test.ts", "mkdtempSync(tmp);\nhospedagem.abrirPr({});\n");
    escrever("src/compartilhado/armazenamento/banco.test.ts", "mkdtempSync(tmp);\nabrir(raiz);\n");
    escrever(
      "src/compartilhado/armazenamento/migracoes/migracao_linha_de_base.test.ts",
      "mkdtempSync(tmp);\nabrir(raiz);\n",
    );
    escrever("e2e/node_modules/x/index.ts", "mkdtemp abrir(\n");

    assert.deepEqual(acharArquivosQueMontamBancoProprio(raiz), [
      "e2e/sub/proprio.ts",
      "estresse/hospedagem.ts",
      "src/a/proprio.test.ts",
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test("nenhum arquivo importa um *.test.ts", () => {
  const raiz = resolve(import.meta.dirname, "..");
  assert.deepEqual(acharArquivosQueImportamArquivoDeTeste(raiz), []);
});

test("autoteste: acusa pelo caminho o arquivo que importa um *.test.ts, estático ou por import()", () => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-importa-teste-"));
  try {
    const escrever = (caminho: string, conteudo: string) => {
      mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
      writeFileSync(join(raiz, caminho), conteudo);
    };
    for (const pasta of PASTAS_QUE_NAO_IMPORTAM_TESTE) mkdirSync(join(raiz, pasta));
    escrever("src/a/estatico.test.ts", 'import { cenario } from "./cenario.test.ts";\n');
    escrever("e2e/sub/dinamico.ts", 'const modulo = await import("../src/x.test.ts");\n');
    escrever("fitness/outra.test.ts", "import { x } from '../src/y.test.ts';\n");
    // Fora do alcance da regra: import de módulo comum, `.test.ts` só em texto e node_modules.
    escrever("src/a/limpo.test.ts", 'import { cenario } from "./cenario.ts";\n');
    escrever("src/a/texto.ts", 'const nome = "cenario.test.ts";\n');
    escrever("e2e/node_modules/x/index.ts", 'import "./y.test.ts";\n');

    assert.deepEqual(acharArquivosQueImportamArquivoDeTeste(raiz), [
      "e2e/sub/dinamico.ts",
      "fitness/outra.test.ts",
      "src/a/estatico.test.ts",
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});
