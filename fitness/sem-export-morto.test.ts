// Fitness function: todo export de src/** e pacote-pi/** tem importador de produção.
// Um export só de teste passa apenas com a marca `/** @testes justificativa */` na declaração.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const RAIZ_DO_REPOSITORIO = resolve(import.meta.dirname, "..");
const PASTAS_DE_PRODUCAO = ["src", "pacote-pi"];
const PASTAS_DE_TESTE_DO_PROJETO = ["integracao", "e2e", "estresse", "fitness"];
// O pi e o bundle do navegador carregam estes arquivos pelo caminho, não por import.
const ARQUIVOS_SEM_IMPORTADOR_POR_DESENHO = [
  /^src\/cli\/fabriquinha\.ts$/,
  /^src\/web\/cliente\/app\.ts$/,
  /^pacote-pi\/extensions\/[^/]+\.ts$/,
];

function listarArquivosTypeScript(raiz: string, pastas: string[]): string[] {
  return pastas.flatMap((pasta) =>
    readdirSync(join(raiz, pasta), { recursive: true, encoding: "utf8" })
      .filter((arquivo) => /\.tsx?$/.test(arquivo) && !arquivo.includes("node_modules"))
      .map((arquivo) => join(raiz, pasta, arquivo)),
  );
}

function ehArquivoDeTeste(caminhoRelativo: string): boolean {
  return (
    /\.test\.tsx?$/.test(caminhoRelativo) ||
    PASTAS_DE_TESTE_DO_PROJETO.some((pasta) => caminhoRelativo.startsWith(`${pasta}/`))
  );
}

function acharExportsMortos(raiz: string, opcoesDoCompilador: ts.CompilerOptions): string[] {
  const arquivos = listarArquivosTypeScript(raiz, [
    ...PASTAS_DE_PRODUCAO,
    ...PASTAS_DE_TESTE_DO_PROJETO.filter((pasta) => ehPastaExistente(raiz, pasta)),
  ]);
  const servicoDeLinguagem = ts.createLanguageService({
    getScriptFileNames: () => arquivos,
    getScriptVersion: () => "1",
    getScriptSnapshot: (arquivo) => ts.ScriptSnapshot.fromString(ts.sys.readFile(arquivo) ?? ""),
    getCurrentDirectory: () => raiz,
    getCompilationSettings: () => opcoesDoCompilador,
    getDefaultLibFileName: (opcoes) => ts.getDefaultLibFilePath(opcoes),
    fileExists: (arquivo) => ts.sys.fileExists(arquivo),
    readFile: (arquivo) => ts.sys.readFile(arquivo),
    readDirectory: (...argumentos) => ts.sys.readDirectory(...argumentos),
  });
  const programa = servicoDeLinguagem.getProgram();
  assert.ok(programa);
  const verificadorDeTipos = programa.getTypeChecker();
  const achados: string[] = [];

  for (const arquivoFonte of programa.getSourceFiles()) {
    const caminhoRelativo = relative(raiz, arquivoFonte.fileName);
    const ehDeProducao = PASTAS_DE_PRODUCAO.some((pasta) => caminhoRelativo.startsWith(`${pasta}/`));
    if (!ehDeProducao || ehArquivoDeTeste(caminhoRelativo)) continue;
    if (ARQUIVOS_SEM_IMPORTADOR_POR_DESENHO.some((padrao) => padrao.test(caminhoRelativo))) continue;
    const simboloDoModulo = verificadorDeTipos.getSymbolAtLocation(arquivoFonte);
    if (!simboloDoModulo) continue;

    for (const simbolo of verificadorDeTipos.getExportsOfModule(simboloDoModulo)) {
      // Valor e tipo de mesmo nome são um export só: um importador de qualquer um dos dois basta.
      // Reexport (`export { x } from`, `export *`) não conta: o export final, no arquivo que o declara, é quem responde.
      const declaracoes = (simbolo.declarations ?? []).filter(
        (declaracao) => declaracao.getSourceFile() === arquivoFonte && !ts.isExportSpecifier(declaracao),
      );
      const nomes = declaracoes.map((declaracao) => ts.getNameOfDeclaration(declaracao) ?? declaracao);
      const arquivosQueReferenciam = new Set(
        nomes
          .flatMap(
            (nome) =>
              servicoDeLinguagem.getReferencesAtPosition(arquivoFonte.fileName, nome.getStart(arquivoFonte)) ?? [],
          )
          .filter((referencia) => referencia.fileName !== arquivoFonte.fileName && !ehReexport(programa, referencia))
          .map((referencia) => relative(raiz, referencia.fileName)),
      );
      if ([...arquivosQueReferenciam].some((arquivo) => !ehArquivoDeTeste(arquivo))) continue;
      const justificativas = declaracoes
        .flatMap((declaracao) => ts.getJSDocTags(declaracao))
        .filter((marca) => marca.tagName.text === "testes");
      const temJustificativa = justificativas.some((marca) => ts.getTextOfJSDocComment(marca.comment)?.trim());
      const [primeiroNome] = nomes;
      if (!primeiroNome) continue;
      const posicao = arquivoFonte.getLineAndCharacterOfPosition(primeiroNome.getStart(arquivoFonte));
      const local = `${caminhoRelativo}:${String(posicao.line + 1)} ${simbolo.name}`;
      if (arquivosQueReferenciam.size === 0) achados.push(`${local}: sem importador`);
      else if (!temJustificativa) achados.push(`${local}: só de teste, falta /** @testes justificativa */`);
    }
  }
  return achados.sort();
}

function ehReexport(programa: ts.Program, referencia: ts.ReferenceEntry): boolean {
  const arquivoFonte = programa.getSourceFile(referencia.fileName);
  if (!arquivoFonte) return false;
  let no: ts.Node = arquivoFonte;
  for (
    let filho = acharFilhoQueContem(no, referencia.textSpan.start);
    filho;
    filho = acharFilhoQueContem(no, referencia.textSpan.start)
  )
    no = filho;
  return ts.isExportSpecifier(no.parent);
}

function acharFilhoQueContem(no: ts.Node, posicao: number): ts.Node | undefined {
  return no.getChildren().find((filho) => filho.getStart() <= posicao && posicao < filho.getEnd());
}

function ehPastaExistente(raiz: string, pasta: string): boolean {
  return ts.sys.directoryExists(join(raiz, pasta));
}

function lerOpcoesDoCompilador(): ts.CompilerOptions {
  const configuracao = ts.readConfigFile(join(RAIZ_DO_REPOSITORIO, "tsconfig.json"), (arquivo) =>
    ts.sys.readFile(arquivo),
  );
  return ts.parseJsonConfigFileContent(configuracao.config, ts.sys, RAIZ_DO_REPOSITORIO).options;
}

test("todo export de src e pacote-pi tem importador de produção ou a marca @testes", () => {
  assert.deepEqual(acharExportsMortos(RAIZ_DO_REPOSITORIO, lerOpcoesDoCompilador()), []);
});

test("a fitness acusa export sem importador e export só de teste sem a marca @testes", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const pasta of ["src/cli", "src/web/cliente", "pacote-pi/extensions"])
    mkdirSync(join(raiz, pasta), { recursive: true });
  const escrever = (arquivo: string, linhas: string[]): void => {
    writeFileSync(join(raiz, arquivo), linhas.join("\n"));
  };
  escrever("src/usado.ts", [
    "export const usadoEmProducao = 1;",
    "/** @testes atalho do teste de consumidor */",
    "export const soNoTesteMarcado = 2;",
    "/** @testes */",
    "export const soNoTesteMarcaSemJustificativa = 3;",
    "export const soNoTesteSemMarca = 4;",
    "export const semImportador = 5;",
  ]);
  escrever("src/consumidor.ts", [
    'import { usadoEmProducao } from "./usado.ts";',
    "export const consumidor = usadoEmProducao;",
  ]);
  escrever("src/consumidor.test.ts", [
    'import { consumidor } from "./consumidor.ts";',
    'import { soNoTesteMarcado, soNoTesteMarcaSemJustificativa, soNoTesteSemMarca } from "./usado.ts";',
    "console.log(consumidor, soNoTesteMarcado, soNoTesteMarcaSemJustificativa, soNoTesteSemMarca);",
  ]);
  escrever("src/cli/fabriquinha.ts", ["export const pontoDeEntrada = 1;"]);
  escrever("src/web/cliente/app.ts", ["export const pontoDeEntradaDoNavegador = 1;"]);
  escrever("pacote-pi/extensions/guarda.ts", ["export default function guarda(): void {}"]);

  assert.deepEqual(
    acharExportsMortos(raiz, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
    }),
    [
      "src/consumidor.ts:2 consumidor: só de teste, falta /** @testes justificativa */",
      "src/usado.ts:5 soNoTesteMarcaSemJustificativa: só de teste, falta /** @testes justificativa */",
      "src/usado.ts:6 soNoTesteSemMarca: só de teste, falta /** @testes justificativa */",
      "src/usado.ts:7 semImportador: sem importador",
    ],
  );
});

test("a fitness acusa o export final de um reexport sem consumidor e reconhece importador por namespace", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const pasta of ["src", "pacote-pi"]) mkdirSync(join(raiz, pasta), { recursive: true });
  const escrever = (arquivo: string, linhas: string[]): void => {
    writeFileSync(join(raiz, arquivo), linhas.join("\n"));
  };
  escrever("src/a.ts", [
    "export const morto = 1;",
    "export const reexportadoEUsado = 2;",
    "export const viaNamespaceDeProducao = 3;",
    "/** @testes atalho do teste de namespace */",
    "export const viaNamespaceSoDeTeste = 4;",
    "export const viaNamespaceSoDeTesteSemMarca = 5;",
  ]);
  escrever("src/b.ts", ['export { morto, reexportadoEUsado } from "./a.ts";', 'export * from "./a.ts";']);
  escrever("src/consumidor.ts", [
    'import { reexportadoEUsado } from "./b.ts";',
    'import * as a from "./a.ts";',
    "export const consumidor = [reexportadoEUsado, a.viaNamespaceDeProducao];",
  ]);
  escrever("src/consumidor.test.ts", [
    'import * as a from "./a.ts";',
    'import { consumidor } from "./consumidor.ts";',
    "console.log(consumidor, a.viaNamespaceSoDeTeste, a.viaNamespaceSoDeTesteSemMarca);",
  ]);

  assert.deepEqual(
    acharExportsMortos(raiz, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
    }),
    [
      "src/a.ts:1 morto: sem importador",
      "src/a.ts:6 viaNamespaceSoDeTesteSemMarca: só de teste, falta /** @testes justificativa */",
      "src/consumidor.ts:3 consumidor: só de teste, falta /** @testes justificativa */",
    ],
  );
});
