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
    // Os cenários são roteiro de teste e2e, fora da cobertura como no `package.json`.
    caminhoRelativo.endsWith("_cenario.ts") ||
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
  const consumidoresDoNamespaceInteiro = acharConsumidoresDoNamespaceInteiro(raiz, programa);
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
      // `export { x }` sem `from` aponta para a declaração local de x, que é onde o export se responde.
      const especificadoresLocais = (simbolo.declarations ?? []).filter(
        (declaracao): declaracao is ts.ExportSpecifier =>
          ts.isExportSpecifier(declaracao) && !declaracao.parent.parent.moduleSpecifier,
      );
      const declaracoesExportadasDiretamente = (simbolo.declarations ?? []).filter(
        (declaracao) => declaracao.getSourceFile() === arquivoFonte && !ts.isExportSpecifier(declaracao),
      );
      const declaracoes = [
        ...declaracoesExportadasDiretamente,
        ...especificadoresLocais
          .map((especificador) => verificadorDeTipos.getExportSpecifierLocalTargetSymbol(especificador))
          .filter((simboloLocal) => simboloLocal && !(simboloLocal.flags & ts.SymbolFlags.Alias))
          .flatMap((simboloLocal) => simboloLocal?.declarations ?? []),
      ];
      const nomes = declaracoes.map((declaracao) => ts.getNameOfDeclaration(declaracao) ?? declaracao);
      // Em `export { x as a, x as b }` cada nome exportado tem os seus importadores: a busca parte do nome exportado, não de `x`.
      const nomesExportados = [
        ...declaracoesExportadasDiretamente.map((declaracao) => ts.getNameOfDeclaration(declaracao) ?? declaracao),
        ...especificadoresLocais.map((especificador) => especificador.name),
      ];
      const arquivosQueReferenciam = new Set(
        nomesExportados
          .flatMap(
            (nome) =>
              servicoDeLinguagem.getReferencesAtPosition(arquivoFonte.fileName, nome.getStart(arquivoFonte)) ?? [],
          )
          .filter((referencia) => referencia.fileName !== arquivoFonte.fileName && !ehReexport(programa, referencia))
          .map((referencia) => relative(raiz, referencia.fileName))
          .concat(consumidoresDoNamespaceInteiro.get(resolverAlias(verificadorDeTipos, simbolo)) ?? []),
      );
      if ([...arquivosQueReferenciam].some((arquivo) => !ehArquivoDeTeste(arquivo))) continue;
      const justificativas = [
        ...declaracoes,
        ...especificadoresLocais.map((especificador) => especificador.parent.parent),
      ]
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

function resolverAlias(verificadorDeTipos: ts.TypeChecker, simbolo: ts.Symbol): ts.Symbol {
  return simbolo.flags & ts.SymbolFlags.Alias ? verificadorDeTipos.getAliasedSymbol(simbolo) : simbolo;
}

// `import * as m` usado além de `m.x` (ex.: `Object.values(m)`) consome todos os exports do módulo importado,
// inclusive os que ele reexporta: a chave é a declaração original de cada export.
function acharConsumidoresDoNamespaceInteiro(raiz: string, programa: ts.Program): Map<ts.Symbol, string[]> {
  const verificadorDeTipos = programa.getTypeChecker();
  const consumidores = new Map<ts.Symbol, string[]>();
  for (const arquivoFonte of programa.getSourceFiles()) {
    for (const importacao of arquivoFonte.statements.filter(ts.isImportDeclaration)) {
      const vinculo = importacao.importClause?.namedBindings;
      if (!vinculo || !ts.isNamespaceImport(vinculo)) continue;
      const simboloDoModuloImportado = verificadorDeTipos.getSymbolAtLocation(importacao.moduleSpecifier);
      if (!simboloDoModuloImportado) continue;
      const simboloDoNamespace = verificadorDeTipos.getSymbolAtLocation(vinculo.name);
      const usadoComoObjeto = (no: ts.Node): boolean =>
        (ts.isIdentifier(no) &&
          no !== vinculo.name &&
          verificadorDeTipos.getSymbolAtLocation(no) === simboloDoNamespace &&
          !(ts.isPropertyAccessExpression(no.parent) && no.parent.expression === no) &&
          !(
            ts.isElementAccessExpression(no.parent) &&
            no.parent.expression === no &&
            ts.isStringLiteralLike(no.parent.argumentExpression)
          ) &&
          !(ts.isQualifiedName(no.parent) && no.parent.left === no)) ||
        ts.forEachChild(no, usadoComoObjeto) === true;
      if (!usadoComoObjeto(arquivoFonte)) continue;
      for (const exportado of verificadorDeTipos.getExportsOfModule(simboloDoModuloImportado)) {
        const original = resolverAlias(verificadorDeTipos, exportado);
        consumidores.set(original, [...(consumidores.get(original) ?? []), relative(raiz, arquivoFonte.fileName)]);
      }
    }
  }
  return consumidores;
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

test("a fitness acusa export local via `export { x }` e reconhece namespace consumido como objeto", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const pasta of ["src", "pacote-pi"]) mkdirSync(join(raiz, pasta), { recursive: true });
  const escrever = (arquivo: string, linhas: string[]): void => {
    writeFileSync(join(raiz, arquivo), linhas.join("\n"));
  };
  escrever("src/local.ts", [
    "const semImportador = 1;",
    "const soNoTesteSemMarca = 2;",
    "/** @testes atalho do teste */",
    "const soNoTesteMarcado = 3;",
    "const usadoEmProducao = 4;",
    "const usadoComOutroNome = 5;",
    "export { semImportador, soNoTesteSemMarca, soNoTesteMarcado, usadoEmProducao, usadoComOutroNome as nomePublico };",
  ]);
  escrever("src/consumidor.ts", [
    'import { usadoEmProducao, nomePublico } from "./local.ts";',
    'import * as todos from "./todos.ts";',
    "export const consumidor = [usadoEmProducao, nomePublico, Object.values(todos)];",
  ]);
  escrever("src/todos.ts", ["export const a = 1;", "const b = 2;", "export { b };"]);
  escrever("src/parcial.ts", ["export const usado = 1;", "export const naoUsado = 2;"]);
  escrever("src/consumidor-parcial.ts", [
    'import * as parcial from "./parcial.ts";',
    "export const consumidorParcial = parcial.usado;",
  ]);
  escrever("src/consumidor.test.ts", [
    'import { soNoTesteSemMarca, soNoTesteMarcado } from "./local.ts";',
    'import { consumidor } from "./consumidor.ts";',
    'import { consumidorParcial } from "./consumidor-parcial.ts";',
    "console.log(consumidor, consumidorParcial, soNoTesteSemMarca, soNoTesteMarcado);",
  ]);

  assert.deepEqual(
    acharExportsMortos(raiz, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
    }),
    [
      "src/consumidor-parcial.ts:2 consumidorParcial: só de teste, falta /** @testes justificativa */",
      "src/consumidor.ts:3 consumidor: só de teste, falta /** @testes justificativa */",
      "src/local.ts:1 semImportador: sem importador",
      "src/local.ts:2 soNoTesteSemMarca: só de teste, falta /** @testes justificativa */",
      "src/parcial.ts:2 naoUsado: sem importador",
    ],
  );
});

test("a fitness trata acesso por colchetes, nomes exportados do mesmo valor e namespace de reexport", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const pasta of ["src", "pacote-pi"]) mkdirSync(join(raiz, pasta), { recursive: true });
  const escrever = (arquivo: string, linhas: string[]): void => {
    writeFileSync(join(raiz, arquivo), linhas.join("\n"));
  };
  escrever("src/parcial.ts", ["export const usado = 1;", "export const naoUsado = 2;"]);
  escrever("src/aliases.ts", ["const valor = 1;", "export { valor as a, valor as b };"]);
  escrever("src/original.ts", ["export const viaReexport = 1;", "export const outroViaReexport = 2;"]);
  escrever("src/reexporta.ts", ['export * from "./original.ts";']);
  escrever("src/consumidor.ts", [
    'import * as parcial from "./parcial.ts";',
    'import { a } from "./aliases.ts";',
    'import * as reexporta from "./reexporta.ts";',
    'export const consumidor = [parcial["usado"], a, Object.values(reexporta)];',
  ]);
  escrever("src/consumidor.test.ts", ['import { consumidor } from "./consumidor.ts";', "console.log(consumidor);"]);

  assert.deepEqual(
    acharExportsMortos(raiz, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
    }),
    [
      "src/aliases.ts:1 b: sem importador",
      "src/consumidor.ts:4 consumidor: só de teste, falta /** @testes justificativa */",
      "src/parcial.ts:2 naoUsado: sem importador",
    ],
  );
});

test("a fitness trata tipo, default, cadeia de reexport, reexport renomeado, namespace reexportado, import dinâmico e ponto de entrada", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const pasta of ["src/cli", "pacote-pi"]) mkdirSync(join(raiz, pasta), { recursive: true });
  const escrever = (arquivo: string, linhas: string[]): void => {
    writeFileSync(join(raiz, arquivo), linhas.join("\n"));
  };
  escrever("src/tipos.ts", [
    "export type Usado = number;",
    "export interface Forma { lado: number }",
    "export type TipoMorto = string;",
  ]);
  escrever("src/padrao.ts", ["export default function calcular(): number { return 1; }"]);
  escrever("src/padrao-morto.ts", ["export default 2;"]);
  escrever("src/origem.ts", [
    "export const naCadeia = 1;",
    "export const foraDaCadeia = 2;",
    "export const renomeado = 3;",
  ]);
  escrever("src/meio.ts", [
    'export { naCadeia, foraDaCadeia } from "./origem.ts";',
    'export { renomeado as apelido } from "./origem.ts";',
  ]);
  escrever("src/fim.ts", ['export { naCadeia } from "./meio.ts";']);
  escrever("src/espaco.ts", ["export const doEspaco = 1;"]);
  escrever("src/agrupa.ts", ['export * as espaco from "./espaco.ts";']);
  escrever("src/dinamico.ts", ["export const carregado = 1;", "export const naoCarregado = 2;"]);
  escrever("src/cli/fabriquinha.ts", [
    'import type { Usado, Forma } from "../tipos.ts";',
    'import calcular from "../padrao.ts";',
    'import { naCadeia } from "../fim.ts";',
    'import { apelido } from "../meio.ts";',
    'import { espaco } from "../agrupa.ts";',
    'const dinamico = await import("../dinamico.ts");',
    "const forma: Forma = { lado: 1 };",
    "const usado: Usado = calcular();",
    "export const daEntrada = [forma, usado, naCadeia, apelido, espaco.doEspaco, dinamico.carregado];",
  ]);

  assert.deepEqual(
    acharExportsMortos(raiz, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      allowImportingTsExtensions: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
    }),
    [
      "src/dinamico.ts:2 naoCarregado: sem importador",
      "src/origem.ts:2 foraDaCadeia: sem importador",
      "src/padrao-morto.ts:1 default: sem importador",
      "src/tipos.ts:3 TipoMorto: sem importador",
    ],
  );
});
