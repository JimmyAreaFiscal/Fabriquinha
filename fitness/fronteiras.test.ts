// Fitness function: os módulos de src/ dependem numa só direção (matriz abaixo), sem ciclo, e só `armazenamento` fala SQL.
// Lista de permitidos em vez de proibidos: uma dependência nova precisa ser liberada aqui de propósito.
// Violação que ainda existe vira exceção datada (demanda que a remove); a exceção que deixou de existir também falha.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { EtapaTicket } from "../src/compartilhado/nucleo/primitivos.ts";

const MODULO_CLIENTE_WEB = "entrega/cliente-web";

// Pacote npm ou node:* de fora de src/ não é dependência entre módulos; só o núcleo e o cliente web restringem o externo.
const QUALQUER_EXTERNO = () => true;
const SO_NODE_SEM_SQLITE = (alvo: string) => alvo.startsWith("node:") && alvo !== "node:sqlite";
const SO_ZOD_E_PATH = (alvo: string) => alvo === "zod" || alvo === "node:path";

// O pacote de um especificador externo: `react-dom/client` → `react-dom`, `@assistant-ui/react/x` → `@assistant-ui/react`.
const pacoteDe = (alvo: string): string =>
  alvo
    .split("/")
    .slice(0, alvo.startsWith("@") ? 2 : 1)
    .join("/");
const PACOTES_DO_NAVEGADOR = new Set(["react-dom", "@assistant-ui/react", "markdown-it"]);

interface RegraDoModulo {
  modulosPermitidos: string[];
  externoPermitido: (alvo: string) => boolean;
  /** Módulos de que só se importa tipo (`import type`), apagado na execução; o valor fica fora de `modulosPermitidos`. */
  modulosSoComoTipo?: string[];
}

const MATRIZ: Record<string, RegraDoModulo> = {
  nucleo: { modulosPermitidos: [], externoPermitido: SO_ZOD_E_PATH },
  armazenamento: { modulosPermitidos: ["nucleo"], externoPermitido: QUALQUER_EXTERNO },
  infra: { modulosPermitidos: ["nucleo"], externoPermitido: QUALQUER_EXTERNO },
  aplicacao: {
    modulosPermitidos: ["nucleo", "armazenamento", "infra", "entrega/contrato"],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // Puro: importável pelo servidor e pelo navegador.
  "entrega/compartilhado": { modulosPermitidos: [], externoPermitido: () => false },
  // Os tipos e schemas da API: só o núcleo e o zod. O cliente web só o importa como tipo (fora de `modulosPermitidos` dele).
  "entrega/contrato": { modulosPermitidos: ["nucleo"], externoPermitido: (alvo) => alvo === "zod" },
  "entrega/http": {
    modulosPermitidos: ["aplicacao", "nucleo", "entrega/compartilhado", "entrega/contrato"],
    externoPermitido: QUALQUER_EXTERNO,
  },
  "entrega/cli": { modulosPermitidos: ["aplicacao", "nucleo", "entrega/contrato"], externoPermitido: QUALQUER_EXTERNO },
  // O cliente do agente roda empacotado, sem o core: só o contrato e o Node (menos o SQLite).
  "entrega/cli-agente": { modulosPermitidos: ["entrega/contrato"], externoPermitido: SO_NODE_SEM_SQLITE },
  // Roda no navegador: de valor, só o `entrega/compartilhado` (o `casar`); do contrato e do núcleo, só `import type`;
  // de fora, só os pacotes do navegador, servidos em /static/ pelo import map (`node:` só nos testes, que a matriz não lê).
  [MODULO_CLIENTE_WEB]: {
    modulosPermitidos: ["entrega/compartilhado"],
    modulosSoComoTipo: ["entrega/contrato", "nucleo"],
    externoPermitido: (alvo) => PACOTES_DO_NAVEGADOR.has(pacoteDe(alvo)),
  },
  composicao: {
    modulosPermitidos: [
      "nucleo",
      "armazenamento",
      "infra",
      "aplicacao",
      "entrega/http",
      "entrega/cli",
      "entrega/compartilhado",
      "entrega/contrato",
      MODULO_CLIENTE_WEB,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
};

const MODULO_COM_SQL = "armazenamento";

interface Achado {
  arquivo: string;
  import: string;
}
interface Excecao extends Achado {
  demanda: string;
}

// Cada exceção cita a demanda (04 a 26) que a remove. Vazia: a 20 limpou entrega/http e nada mais ficou pendente.
const EXCECOES: Excecao[] = [];

// `src/<domínio>/<camada>/…`: o domínio agrupa por conceito, e a regra de dependência é a da camada.
const DOMINIOS = new Set(["fluxo", "demanda", "execucao", "ambiente", "qualidade", "custos", "compartilhado"]);

function moduloDoArquivo(caminhoRelativoASrc: string): string {
  const [primeiro, segundo] = caminhoRelativoASrc.split("/");
  if (primeiro === "entrega" && segundo) return `entrega/${segundo}`;
  if (primeiro !== undefined && DOMINIOS.has(primeiro)) return segundo ?? "";
  return primeiro ?? "";
}

function listarArquivosDeProducao(src: string): string[] {
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((arquivo) => /\.tsx?$/.test(arquivo) && !/\.test\.tsx?$/.test(arquivo))
    .sort();
}

// Especificadores que só aparecem em `import type` / `export type … from` (nunca num import de valor).
function acharEspecificadoresSoDeTipo(fonte: ts.SourceFile): Set<string> {
  const deTipo = new Set<string>();
  const deValor = new Set<string>();
  for (const declaracao of fonte.statements) {
    let especificador: ts.Expression | undefined;
    let ehSoDeTipo = false;
    if (ts.isImportDeclaration(declaracao)) {
      especificador = declaracao.moduleSpecifier;
      ehSoDeTipo = declaracao.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword;
    } else if (ts.isExportDeclaration(declaracao)) {
      especificador = declaracao.moduleSpecifier;
      ehSoDeTipo = declaracao.isTypeOnly;
    }
    if (especificador && ts.isStringLiteral(especificador)) (ehSoDeTipo ? deTipo : deValor).add(especificador.text);
  }
  return new Set([...deTipo].filter((alvo) => !deValor.has(alvo)));
}

// shortcut: sem checker de tipos, `.prepare(` é sempre SQL e `.exec(` só conta com literal de texto (SQL); RegExp.exec recebe variável.
function acharChamadasDeSql(fonte: ts.SourceFile): string[] {
  const chamadas = new Set<string>();
  const visitar = (no: ts.Node): void => {
    if (ts.isCallExpression(no) && ts.isPropertyAccessExpression(no.expression)) {
      const metodo = no.expression.name.text;
      const primeiroArgumento = no.arguments[0];
      const ehTexto = primeiroArgumento && ts.isStringLiteralLike(primeiroArgumento);
      const ehTemplate = primeiroArgumento && ts.isTemplateExpression(primeiroArgumento);
      if (metodo === "prepare" || (metodo === "exec" && (ehTexto || ehTemplate))) chamadas.add(`.${metodo}(`);
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  return [...chamadas];
}

interface Aresta {
  de: string;
  para: string;
  arquivo: string;
  achado: Achado;
}

function acharViolacoesEArestas(src: string): { violacoes: Achado[]; arestas: Aresta[] } {
  const violacoes: Achado[] = [];
  const arestas: Aresta[] = [];
  for (const arquivo of listarArquivosDeProducao(src)) {
    const modulo = moduloDoArquivo(arquivo);
    const regra = MATRIZ[modulo];
    if (!regra) {
      violacoes.push({ arquivo, import: `módulo desconhecido: ${modulo}` });
      continue;
    }
    const caminho = join(src, arquivo);
    const texto = readFileSync(caminho, "utf8");
    const fonte = ts.createSourceFile(caminho, texto, ts.ScriptTarget.Latest);
    const soDeTipo = acharEspecificadoresSoDeTipo(fonte);
    for (const { fileName: alvo } of ts.preProcessFile(texto, true, true).importedFiles) {
      const moduloAlvo = alvo.startsWith(".")
        ? moduloDoArquivo(relative(src, resolve(dirname(caminho), alvo)))
        : undefined;
      const permitido =
        moduloAlvo === undefined
          ? regra.externoPermitido(alvo)
          : moduloAlvo === modulo || regra.modulosPermitidos.includes(moduloAlvo);
      const tipoBasta =
        moduloAlvo !== undefined && regra.modulosSoComoTipo?.includes(moduloAlvo) === true && soDeTipo.has(alvo);
      const achado = { arquivo, import: alvo };
      if (!permitido && !tipoBasta) violacoes.push(achado);
      if (moduloAlvo !== undefined && moduloAlvo !== modulo)
        arestas.push({ de: modulo, para: moduloAlvo, arquivo, achado });
    }
    if (modulo !== MODULO_COM_SQL) {
      for (const chamada of acharChamadasDeSql(fonte)) violacoes.push({ arquivo, import: `SQL ${chamada}` });
    }
  }
  return { violacoes, arestas };
}

function acharCiclosEntreModulos(arestas: Aresta[]): Achado[] {
  const vizinhos = new Map<string, Aresta[]>();
  for (const aresta of arestas) vizinhos.set(aresta.de, [...(vizinhos.get(aresta.de) ?? []), aresta]);
  const ciclos: Achado[] = [];
  const emVisita: Aresta[] = [];
  const concluidos = new Set<string>();
  const visitar = (modulo: string): void => {
    for (const aresta of vizinhos.get(modulo) ?? []) {
      const inicioDoCiclo = emVisita.findIndex((passo) => passo.de === aresta.para);
      if (inicioDoCiclo >= 0 || aresta.para === modulo) {
        const volta = [...emVisita.slice(Math.max(inicioDoCiclo, 0)), aresta];
        const caminho = [...volta.map((passo) => passo.de), aresta.para].join(" → ");
        ciclos.push({ arquivo: volta[0]?.arquivo ?? aresta.arquivo, import: `ciclo entre módulos: ${caminho}` });
      } else if (!concluidos.has(aresta.para)) {
        emVisita.push(aresta);
        visitar(aresta.para);
        emVisita.pop();
      }
    }
    concluidos.add(modulo);
  };
  for (const modulo of vizinhos.keys()) if (!concluidos.has(modulo)) visitar(modulo);
  return ciclos;
}

// A aresta de uma exceção listada fica fora do grafo: a dívida já é cobrada pela lista, e o ciclo que sobrar é novo.
function acharViolacoes(src: string, excecoes: Excecao[]): Achado[] {
  const { violacoes, arestas } = acharViolacoesEArestas(src);
  const listadas = new Set(excecoes.map(descrever));
  const unicas = new Map(violacoes.map((achado) => [descrever(achado), achado]));
  const ciclos = acharCiclosEntreModulos(arestas.filter(({ achado }) => !listadas.has(descrever(achado))));
  return [...new Map([...unicas.values(), ...ciclos].map((achado) => [descrever(achado), achado])).values()];
}

function descrever({ arquivo, import: alvo }: Achado): string {
  return `${arquivo} importa ${alvo}`;
}

const SRC = resolve(import.meta.dirname, "../src");

test("src respeita a matriz de dependências, não tem ciclo e só armazenamento fala SQL (fora das exceções datadas)", () => {
  const listadas = new Set(EXCECOES.map(descrever));
  assert.deepEqual(
    acharViolacoes(SRC, EXCECOES)
      .map(descrever)
      .filter((descricao) => !listadas.has(descricao)),
    [],
  );
});

test("toda exceção listada ainda existe no código", () => {
  const existentes = new Set(acharViolacoes(SRC, []).map(descrever));
  assert.deepEqual(
    EXCECOES.map(descrever).filter((descricao) => !existentes.has(descricao)),
    [],
  );
});

test("toda exceção cita arquivo, import e uma demanda de 04 a 26", () => {
  for (const excecao of EXCECOES) {
    assert.ok(excecao.arquivo && excecao.import, `exceção sem arquivo ou import: ${JSON.stringify(excecao)}`);
    assert.match(excecao.demanda, /^(0[4-9]|1\d|2[0-6])$/, `${descrever(excecao)}: demanda ${excecao.demanda}`);
  }
});

test("a lista de exceções está vazia: entrega/http não importa armazenamento nem chama .prepare(", () => {
  assert.deepEqual(EXCECOES, []);
  const daHttp = acharViolacoes(SRC, []).filter(({ arquivo }) => arquivo.startsWith("entrega/http/"));
  assert.deepEqual(daHttp.map(descrever), []);
});

// A matriz libera `aplicacao` inteira a entrega/http; a API do agente só alcança os casos de uso do agente.
test("entrega/http/agente só importa de aplicacao o aplicacao/agente", () => {
  const daApiDoAgente = listarArquivosDeProducao(SRC).filter((arquivo) => arquivo.startsWith("entrega/http/agente/"));
  assert.ok(daApiDoAgente.length > 0);
  const deAplicacaoFora = daApiDoAgente.flatMap((arquivo) => {
    const caminho = join(SRC, arquivo);
    return ts
      .preProcessFile(readFileSync(caminho, "utf8"), true, true)
      .importedFiles.map(({ fileName: alvo }) => relative(SRC, resolve(dirname(caminho), alvo)))
      .filter((alvo) => moduloDoArquivo(alvo) === "aplicacao" && !alvo.startsWith("execucao/aplicacao/agente/"))
      .map((alvo) => `${arquivo} importa ${alvo}`);
  });
  assert.deepEqual(deAplicacaoFora, []);
});

test("nenhum importador de entrega/http fora de composicao e entrega/http", () => {
  const importadores = listarArquivosDeProducao(SRC)
    .filter((arquivo) => !arquivo.startsWith("composicao/") && !arquivo.startsWith("entrega/http/"))
    .filter((arquivo) => /from ['"][^'"]*entrega\/http/.test(readFileSync(join(SRC, arquivo), "utf8")));
  assert.deepEqual(importadores, []);
});

test("a fitness acusa cada violação pelo arquivo e aceita o que a matriz permite", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    // Permitidos
    "nucleo/ok.ts":
      'import { z } from "zod";\nimport { isAbsolute } from "node:path";\nexport { Y } from "./sub/y.ts";\n',
    "nucleo/sub/y.ts": 'import { z } from "../ok.ts";\n',
    "nucleo/ruim.test.ts": 'import { test } from "node:test";\nimport { x } from "node:fs";\n',
    "armazenamento/ok.ts":
      'import { z } from "../nucleo/ok.ts";\nimport { DatabaseSync } from "node:sqlite";\nbanco.exec("CREATE TABLE a (b)");\nbanco.prepare("SELECT 1");\n',
    "aplicacao/ok.ts":
      'import { a } from "../armazenamento/ok.ts";\nimport { b } from "../infra/ok.ts";\nconst achou = /a/.exec(texto);\n',
    "infra/ok.ts": 'import { spawn } from "node:child_process";\nimport { z } from "../nucleo/ok.ts";\n',
    "entrega/compartilhado/ok.ts": "export const c = 1;\n",
    "entrega/contrato/ok.ts": 'import { z } from "zod";\nimport { Id } from "../../nucleo/ok.ts";\n',
    "entrega/cli-agente/ok.ts":
      'import { Resposta } from "../contrato/ok.ts";\nimport { readFileSync } from "node:fs";\nimport { b } from "./sub.ts";\n',
    "entrega/http/ok.ts":
      'import { a } from "../../aplicacao/ok.ts";\nimport { c } from "../compartilhado/ok.ts";\nimport { Resposta } from "../contrato/ok.ts";\n',
    "entrega/cliente-web/ok.ts":
      'import type { N } from "../../nucleo/ok.ts";\nimport type { R } from "../contrato/ok.ts";\nimport { b } from "./sub.ts";\nimport { c } from "../compartilhado/ok.ts";\n',
    "entrega/cliente-web/sub.ts": 'export type { Z } from "../../nucleo/ok.ts";\n',
    "entrega/cliente-web/pacotes.ts":
      'import markdownit from "markdown-it/browser";\nimport { createRoot } from "react-dom/client";\nimport { useThread } from "@assistant-ui/react";\n',
    "composicao/ok.ts": 'import { a } from "../entrega/http/ok.ts";\nimport express from "express";\n',
    // Proibidos
    "nucleo/fs.ts": 'import { readFileSync } from "node:fs";\n',
    "infra/armazenamento.ts": 'import { b } from "../armazenamento/ok.ts";\n',
    "entrega/compartilhado/impuro.ts":
      'import { z } from "../../nucleo/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "entrega/contrato/impuro.ts":
      'import { readFileSync } from "node:fs";\nimport { a } from "../../armazenamento/ok.ts";\n',
    "entrega/cliente-web/aplicacao_tipo.ts": 'import type { B } from "../../aplicacao/ok.ts";\n',
    "entrega/cliente-web/aplicacao_valor.ts": 'import { a } from "../../aplicacao/ok.ts";\n',
    "entrega/cliente-web/contrato_valor.ts": 'import { Resposta } from "../contrato/ok.ts";\n',
    "entrega/cliente-web/nucleo_valor.ts": 'import { n } from "../../nucleo/ok.ts";\n',
    "entrega/cliente-web/lodash.ts": 'import _ from "lodash";\n',
    "entrega/cliente-web/node.ts": 'import { readFileSync } from "node:fs";\n',
    "entrega/cliente-web/react_puro.ts": 'import { useState } from "react";\n',
    "entrega/cliente-web/node.test.ts":
      'import { test } from "node:test";\nimport { a } from "../../aplicacao/ok.ts";\n',
    "entrega/cli-agente/aplicacao.ts": 'import { a } from "../../aplicacao/ok.ts";\n',
    "entrega/cli-agente/armazenamento.ts": 'import { a } from "../../armazenamento/ok.ts";\n',
    "entrega/cli-agente/nucleo.ts": 'import { n } from "../../nucleo/ok.ts";\n',
    "entrega/cli-agente/sqlite.ts": 'import { DatabaseSync } from "node:sqlite";\n',
    "entrega/cli-agente/zod.ts": 'import { z } from "zod";\n',
    "aplicacao/ciclo.ts": 'import { a } from "../entrega/http/ciclo.ts";\n',
    "entrega/http/ciclo.ts": 'import { a } from "../../aplicacao/ciclo.ts";\n',
    "aplicacao/sql.ts": 'banco.prepare("SELECT 1");\nbanco.exec(`DELETE FROM a`);\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(
    acharViolacoes(raiz, []).map(descrever).sort(),
    [
      "aplicacao/ciclo.ts importa ciclo entre módulos: aplicacao → entrega/http → aplicacao",
      "aplicacao/ciclo.ts importa ../entrega/http/ciclo.ts",
      "aplicacao/sql.ts importa SQL .exec(",
      "aplicacao/sql.ts importa SQL .prepare(",
      "entrega/cli-agente/aplicacao.ts importa ../../aplicacao/ok.ts",
      "entrega/cli-agente/armazenamento.ts importa ../../armazenamento/ok.ts",
      "entrega/cli-agente/nucleo.ts importa ../../nucleo/ok.ts",
      "entrega/cli-agente/sqlite.ts importa node:sqlite",
      "entrega/cli-agente/zod.ts importa zod",
      "entrega/cliente-web/aplicacao_tipo.ts importa ../../aplicacao/ok.ts",
      "entrega/cliente-web/aplicacao_valor.ts importa ../../aplicacao/ok.ts",
      "entrega/compartilhado/impuro.ts importa ../../nucleo/ok.ts",
      "entrega/compartilhado/impuro.ts importa node:fs",
      "entrega/contrato/impuro.ts importa ../../armazenamento/ok.ts",
      "entrega/contrato/impuro.ts importa node:fs",
      "entrega/cliente-web/contrato_valor.ts importa ../contrato/ok.ts",
      "entrega/cliente-web/lodash.ts importa lodash",
      "entrega/cliente-web/node.ts importa node:fs",
      "entrega/cliente-web/nucleo_valor.ts importa ../../nucleo/ok.ts",
      "entrega/cliente-web/react_puro.ts importa react",
      "infra/armazenamento.ts importa ../armazenamento/ok.ts",
      "nucleo/fs.ts importa node:fs",
    ].sort(),
  );
});

// O relógio é do `composicao` (que o injeta) e de `nucleo/relogio.ts`: `new Date(` em qualquer outro .ts de src/ (cliente web
// e compartilhado inclusive) lê a hora ou faz conta de calendário fora dele. Os *.test.ts (já fora da lista) e *_cenario.ts ficam de fora.
const ARQUIVO_DO_RELOGIO = "compartilhado/nucleo/relogio.ts";

function acharNewDateForaDoRelogio(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter(
      (arquivo) =>
        arquivo !== ARQUIVO_DO_RELOGIO && !arquivo.startsWith("composicao/") && !arquivo.endsWith("_cenario.ts"),
    )
    .filter((arquivo) => {
      const chamadas: ts.Node[] = [];
      const visitar = (no: ts.Node): void => {
        if (ts.isNewExpression(no) && ts.isIdentifier(no.expression) && no.expression.text === "Date")
          chamadas.push(no);
        ts.forEachChild(no, visitar);
      };
      visitar(ts.createSourceFile(arquivo, readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest));
      return chamadas.length > 0;
    })
    .map((arquivo) => `${arquivo} chama new Date(`);
}

test("new Date( só em composicao/ e nucleo/relogio.ts", () => {
  assert.deepEqual(acharNewDateForaDoRelogio(SRC), []);
});

test("a fitness do relógio acusa new Date( fora de composicao/ e nucleo/relogio.ts e aceita o resto", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-relogio-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_DO_RELOGIO]: "export const agora = () => new Date().toISOString();\n",
    "composicao/servico.ts": "const batida = new Date(inicio);\n",
    "aplicacao/ruim.ts": "const agora = new Date().toISOString();\n",
    "entrega/cliente-web/ruim.ts": "const ano = new Date(instante).getFullYear();\n",
    "entrega/compartilhado/ruim.ts": "export const dia = (i: string) => new Date(i);\n",
    "aplicacao/inocente.ts":
      "// new Date() em comentário\nconst d = Date.parse(x);\nconst n = Date.now();\nconst o = new Datas();\n",
    "aplicacao/ruim.test.ts": "const d = new Date();\n",
    "aplicacao/ruim_cenario.ts": "const d = new Date();\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharNewDateForaDoRelogio(raiz).sort(), [
    "aplicacao/ruim.ts chama new Date(",
    "entrega/cliente-web/ruim.ts chama new Date(",
    "entrega/compartilhado/ruim.ts chama new Date(",
  ]);
});

// Só o condutor lança o pi e consulta o modelo: o resto do serviço pede ao `CondutorDeTrabalhos`. O harness lança pelo Ambiente.
const ARQUIVO_DO_CONDUTOR = "execucao/aplicacao/trabalho/condutor.ts";
const ARQUIVO_DO_HARNESS = "execucao/infra/harness_pi.ts";
const METODOS_DO_HARNESS = new Set(["lancar", "perguntar"]);

// shortcut: sem checker de tipos, qualquer `.lancar(` ou `.perguntar(` conta, seja do HarnessPi ou não; nenhum outro objeto de src/ usa esses nomes.
function acharChamadasAoHarnessForaDoCondutor(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter((arquivo) => arquivo !== ARQUIVO_DO_CONDUTOR && arquivo !== ARQUIVO_DO_HARNESS)
    .flatMap((arquivo) => {
      const fonte = ts.createSourceFile(arquivo, readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest);
      const chamadas: string[] = [];
      const visitar = (no: ts.Node): void => {
        if (
          ts.isCallExpression(no) &&
          ts.isPropertyAccessExpression(no.expression) &&
          METODOS_DO_HARNESS.has(no.expression.name.text)
        ) {
          chamadas.push(`${arquivo} chama .${no.expression.name.text}(`);
        }
        ts.forEachChild(no, visitar);
      };
      visitar(fonte);
      return chamadas;
    });
}

test("só o condutor chama .lancar( e .perguntar( do HarnessPi", () => {
  assert.deepEqual(acharChamadasAoHarnessForaDoCondutor(SRC), []);
});

test("a fitness do condutor acusa o arquivo que lança ou consulta o pi e aceita o condutor", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-condutor-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_DO_CONDUTOR]: "this.harness.lancar(args);\nthis.harness.perguntar(prompt);\n",
    "aplicacao/lancador.ts": "new HarnessPi().lancar(args, opcoes, aoEvento);\n",
    "aplicacao/consultor.ts": "const resposta = await harness.perguntar(prompt);\n",
    "aplicacao/inocente.ts": "const lancar = 1;\nlancar(2);\nperguntar();\nconst lancamento = x.lancamento(3);\n",
    "aplicacao/teste_de_quem_lanca.test.ts": "harness.lancar(args);\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharChamadasAoHarnessForaDoCondutor(raiz).sort(), [
    "aplicacao/consultor.ts chama .perguntar(",
    "aplicacao/lancador.ts chama .lancar(",
  ]);
});

// O processo do Espaço passa pelo `Ambiente`: `node:child_process` só nestes arquivos, e `infra/processo.ts` só nestes chamadores do core.
// O Ambiente em si; repositorio/ e worktree/, vizinhos dele no domínio ambiente, seguem a regra comum.
const INICIOS_DO_AMBIENTE = [
  "ambiente/infra/ambiente.ts",
  "ambiente/infra/ambiente_host_local.ts",
  "ambiente/infra/container/",
];
const ARQUIVO_DO_PROCESSO = "compartilhado/infra/processo.ts";
const ARQUIVOS_COM_CHILD_PROCESS = new Set([ARQUIVO_DO_PROCESSO, ARQUIVO_DO_HARNESS]);
// Lista fixa: cada um fala com o `gh`/`az`, o cadastro, o blame, o pdftotext, o sonar-scanner, o pi sem worktree ou a rede do git com credenciais.
const CHAMADORES_DIRETOS_DO_PROCESSO = [
  "ambiente/infra/repositorio/cadastro.ts",
  "ambiente/infra/repositorio/heatmap.ts",
  "ambiente/infra/repositorio/pr.ts",
  "ambiente/infra/worktree/limpeza_demanda.ts",
  "ambiente/infra/worktree/worktree.ts",
  "composicao/cli.ts",
  "custos/infra/commits_humanos.ts",
  "execucao/aplicacao/trabalho/auditor_automatico.ts",
  "execucao/infra/harness_pi.ts",
  "qualidade/aplicacao/simulacao/executor.ts",
  "qualidade/infra/tipos_de_verificacao/sonar.ts",
];

const ehChildProcess = (alvo: string): boolean => /^(node:)?child_process$/.test(alvo);
const ehProcessoDoServico = (alvo: string): boolean => /(^|\/)processo\.ts$/.test(alvo);

function acharEspecificadoresDe(src: string, arquivo: string): string[] {
  const fonte = ts.createSourceFile(arquivo, readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest);
  return fonte.statements.flatMap((declaracao) =>
    (ts.isImportDeclaration(declaracao) || ts.isExportDeclaration(declaracao)) &&
    declaracao.moduleSpecifier &&
    ts.isStringLiteral(declaracao.moduleSpecifier)
      ? [declaracao.moduleSpecifier.text]
      : [],
  );
}

function acharImportadoresDe(src: string, ehAlvo: (alvo: string) => boolean): string[] {
  return listarArquivosDeProducao(src).filter((arquivo) => acharEspecificadoresDe(src, arquivo).some(ehAlvo));
}

function acharViolacoesDoProcesso(src: string, chamadoresDiretos: readonly string[]): string[] {
  const doAmbiente = (arquivo: string) => INICIOS_DO_AMBIENTE.some((inicio) => arquivo.startsWith(inicio));
  return [
    ...acharImportadoresDe(src, ehChildProcess)
      .filter((arquivo) => !doAmbiente(arquivo) && !ARQUIVOS_COM_CHILD_PROCESS.has(arquivo))
      .map((arquivo) => `${arquivo} importa node:child_process`),
    ...acharImportadoresDe(src, ehProcessoDoServico)
      .filter((arquivo) => !doAmbiente(arquivo) && !chamadoresDiretos.includes(arquivo))
      .map((arquivo) => `${arquivo} importa infra/processo.ts`),
  ];
}

test("node:child_process e infra/processo.ts só nos arquivos liberados", () => {
  assert.deepEqual(acharViolacoesDoProcesso(SRC, CHAMADORES_DIRETOS_DO_PROCESSO), []);
});

test("todo chamador direto da lista fixa ainda importa infra/processo.ts", () => {
  const importadores = new Set(acharImportadoresDe(SRC, ehProcessoDoServico));
  assert.deepEqual(
    CHAMADORES_DIRETOS_DO_PROCESSO.filter((arquivo) => !importadores.has(arquivo)),
    [],
  );
});

test("a fitness do processo acusa o chamador do Espaço que importa child_process e infra/processo.ts", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-processo-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_DO_PROCESSO]: 'import { spawn } from "node:child_process";\n',
    "ambiente/infra/ambiente_host_local.ts":
      'import { spawn } from "child_process";\nimport { executar } from "../../compartilhado/infra/processo.ts";\n',
    "ambiente/infra/repositorio/pr.ts": 'import { executar } from "../../../compartilhado/infra/processo.ts";\n',
    "ambiente/infra/repositorio/commit.ts": 'import { exigirGitNoAmbiente } from "../worktree/worktree.ts";\n',
    "ambiente/aplicacao/espaco_ruim.ts":
      'import { spawn } from "node:child_process";\nimport { git } from "../../compartilhado/infra/processo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharViolacoesDoProcesso(raiz, ["ambiente/infra/repositorio/pr.ts"]).sort(), [
    "ambiente/aplicacao/espaco_ruim.ts importa infra/processo.ts",
    "ambiente/aplicacao/espaco_ruim.ts importa node:child_process",
  ]);
});

// Só `submeter.ts` (e o armazenamento) grava em `evidencia_demanda`: toda Evidência entra pela submissão avaliada.
const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "qualidade/aplicacao/evidencias/submeter.ts";
const ARMAZENAMENTO_DE_EVIDENCIA = "armazenamento/evidencia_demanda.ts";
const MONTA_EVIDENCIAS_A_PARTIR_DA_ATUAL = /evidencias:\s*\[\s*\.\.\./;

// shortcut: o padrão de lista é textual, então também acusa o literal dentro de comentário ou string; nenhum existe hoje em src/.
function acharGravacoesDeEvidenciaForaDeSubmeter(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter(
      (arquivo) =>
        arquivo !== ARQUIVO_QUE_SUBMETE_EVIDENCIA &&
        moduloDoArquivo(arquivo) !== "armazenamento" &&
        !arquivo.endsWith("_cenario.ts"),
    )
    .flatMap((arquivo) => {
      const texto = readFileSync(join(src, arquivo), "utf8");
      const fonte = ts.createSourceFile(arquivo, texto, ts.ScriptTarget.Latest);
      const achados: string[] = [];
      if (MONTA_EVIDENCIAS_A_PARTIR_DA_ATUAL.test(texto))
        achados.push(`${arquivo} monta evidencias a partir da lista atual`);
      for (const declaracao of fonte.statements) {
        if (!ts.isImportDeclaration(declaracao) || !ts.isStringLiteral(declaracao.moduleSpecifier)) continue;
        if (!declaracao.moduleSpecifier.text.endsWith(ARMAZENAMENTO_DE_EVIDENCIA)) continue;
        const ligacoes = declaracao.importClause?.namedBindings;
        if (!ligacoes || !ts.isNamedImports(ligacoes)) continue;
        for (const nome of ligacoes.elements.map((elemento) => (elemento.propertyName ?? elemento.name).text)) {
          if (nome.startsWith("gravar"))
            achados.push(`${arquivo} importa ${nome} de armazenamento/evidencia_demanda.ts`);
        }
      }
      return achados;
    });
}

test("só submeter.ts e o armazenamento gravam em evidencia_demanda", () => {
  assert.deepEqual(acharGravacoesDeEvidenciaForaDeSubmeter(SRC), []);
});

test("a fitness de gravação de evidência acusa o arquivo que monta a lista ou importa gravar* e aceita o resto", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-evidencia-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_QUE_SUBMETE_EVIDENCIA]: "const x = { ...ag, evidencias: [...ag.evidencias, nova] };\n",
    "armazenamento/evidencia_demanda.ts": "export function gravarAnexos() {}\n",
    "armazenamento/outro.ts":
      'import { gravarAnexos } from "./evidencia_demanda.ts";\nconst x = { evidencias: [...a.evidencias] };\n',
    "aplicacao/monta_lista.ts": "const x = { ...ag, evidencias: [...ag.evidencias, nova] };\n",
    "aplicacao/importa_gravar.ts": 'import { gravarAnexos as gravar } from "../armazenamento/evidencia_demanda.ts";\n',
    "aplicacao/le_anexos.ts":
      'import { anexosDaDemanda } from "../armazenamento/evidencia_demanda.ts";\nconst x = { evidencias: [] };\n',
    "aplicacao/gravar_de_outro.ts": 'import { gravarAnexos } from "../armazenamento/outro.ts";\n',
    "aplicacao/teste_que_grava.test.ts": "const x = { evidencias: [...ag.evidencias] };\n",
    "aplicacao/montagem_cenario.ts": "const x = { evidencias: [...ag.evidencias] };\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharGravacoesDeEvidenciaForaDeSubmeter(raiz).sort(), [
    "aplicacao/importa_gravar.ts importa gravarAnexos de armazenamento/evidencia_demanda.ts",
    "aplicacao/monta_lista.ts monta evidencias a partir da lista atual",
  ]);
});

// Os domínios de src/ (a primeira pasta; cada `entrega/<sub>` é um, como na matriz e no mapa-alvo) não formam ciclo de
// import, de valor ou de tipo. Dependência que fecha ciclo hoje é tolerada aqui com o passo da migração SDLC por seams que a
// remove (1 harness/, 2 sandbox/, repositorio/ e projeto/, 3 etapas/, 4 sdlc/, 5 verificacao/ e metricas/, 6 ex-entrega).
// A aresta tolerada fica fora do grafo; se sumir do código ou deixar de fechar ciclo, a fitness também falha.
interface DependenciaToleradaEntreDominios {
  de: string;
  para: string;
  passo: 1 | 2 | 3 | 4 | 5 | 6;
}

const DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS: DependenciaToleradaEntreDominios[] = [
  // servico.ts lê o `Modelo` do agente.
  { de: "compartilhado", para: "execucao", passo: 1 },
  // servico.ts lê a ConfiguracaoDoAmbiente; processo.ts, o LIMITE_COMANDO_MS do Ambiente.
  { de: "compartilhado", para: "ambiente", passo: 2 },
  // O Conjunto de Ambientes, o cadastro e a configuração do Projeto usam o pi, o HarnessPi e a configuração do agente.
  { de: "ambiente", para: "execucao", passo: 1 },
  // O Espaço de Trabalho, a worktree e as consultas do Projeto leem a Demanda e o seu fluxo.
  { de: "ambiente", para: "demanda", passo: 2 },
  { de: "ambiente", para: "fluxo", passo: 2 },
  // O cadastro e o commit do Ticket varrem os commits humanos.
  { de: "ambiente", para: "custos", passo: 5 },
  // As métricas por Etapa leem a definição da Etapa.
  { de: "custos", para: "fluxo", passo: 3 },
  { de: "custos", para: "demanda", passo: 5 },
  { de: "custos", para: "execucao", passo: 5 },
  { de: "custos", para: "qualidade", passo: 5 },
  // O agregado e a gestão da Demanda leem e submetem a Evidência.
  { de: "demanda", para: "qualidade", passo: 3 },
  // O ciclo derivado: Demanda, Despacho, Tentativa e Ciclo de Vida se leem nas duas direções.
  { de: "demanda", para: "execucao", passo: 4 },
  { de: "demanda", para: "fluxo", passo: 4 },
  { de: "execucao", para: "fluxo", passo: 4 },
  // A avaliação e a simulação usam o HarnessPi e o condutor; as verificações, a Tentativa e o Ator.
  { de: "qualidade", para: "execucao", passo: 4 },
  { de: "qualidade", para: "fluxo", passo: 4 },
  // O contrato da API reusa os schemas dos núcleos, e as consultas das aplicações devolvem tipos do contrato.
  { de: "entrega/contrato", para: "ambiente", passo: 6 },
  { de: "entrega/contrato", para: "custos", passo: 6 },
  { de: "entrega/contrato", para: "demanda", passo: 6 },
  { de: "entrega/contrato", para: "execucao", passo: 6 },
  { de: "entrega/contrato", para: "qualidade", passo: 6 },
];

function dominioDoArquivo(caminhoRelativoASrc: string): string {
  const [primeiro, segundo] = caminhoRelativoASrc.split("/");
  return primeiro === "entrega" && segundo ? `entrega/${segundo}` : (primeiro ?? "");
}

const descreverDependencia = ({ de, para }: { de: string; para: string }): string => `${de} → ${para}`;

// Uma aresta por par de domínios, com o primeiro arquivo que a cria.
function acharDependenciasEntreDominios(src: string): Aresta[] {
  const dependencias = new Map<string, Aresta>();
  for (const arquivo of listarArquivosDeProducao(src)) {
    const caminho = join(src, arquivo);
    const de = dominioDoArquivo(arquivo);
    for (const { fileName: alvo } of ts.preProcessFile(readFileSync(caminho, "utf8"), true, true).importedFiles) {
      if (!alvo.startsWith(".")) continue;
      const para = dominioDoArquivo(relative(src, resolve(dirname(caminho), alvo)));
      const descricao = descreverDependencia({ de, para });
      if (para !== de && !dependencias.has(descricao))
        dependencias.set(descricao, { de, para, arquivo, achado: { arquivo, import: alvo } });
    }
  }
  return [...dependencias.values()];
}

function acharCiclosEntreDominios(src: string, toleradas: DependenciaToleradaEntreDominios[]): string[] {
  const listadas = new Set(toleradas.map(descreverDependencia));
  const naoToleradas = acharDependenciasEntreDominios(src).filter(
    (aresta) => !listadas.has(descreverDependencia(aresta)),
  );
  return acharCiclosEntreModulos(naoToleradas).map(({ import: ciclo }) => ciclo);
}

// Vencida: a dependência sumiu, ou já não há caminho de volta de `para` a `de` (deixou de fechar ciclo).
function acharToleranciasVencidas(src: string, toleradas: DependenciaToleradaEntreDominios[]): string[] {
  const dependencias = acharDependenciasEntreDominios(src);
  const existentes = new Set(dependencias.map(descreverDependencia));
  const alcanca = (origem: string, destino: string): boolean => {
    const visitados = [origem];
    for (const dominio of visitados) {
      for (const { de, para } of dependencias) if (de === dominio && !visitados.includes(para)) visitados.push(para);
    }
    return visitados.includes(destino);
  };
  return toleradas
    .filter((tolerada) => !existentes.has(descreverDependencia(tolerada)) || !alcanca(tolerada.para, tolerada.de))
    .map(descreverDependencia);
}

test("os domínios de src/ não formam ciclo de import fora das dependências toleradas", () => {
  assert.deepEqual(acharCiclosEntreDominios(SRC, DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS), []);
});

test("toda dependência tolerada entre domínios ainda existe e ainda fecha ciclo", () => {
  assert.deepEqual(acharToleranciasVencidas(SRC, DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS), []);
});

test("a fitness de ciclos entre domínios acusa o ciclo novo, de valor ou de tipo, e a tolerância vencida", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-dominios-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    "fluxo/nucleo/etapa.ts": 'import { Demanda } from "../../demanda/nucleo/demanda.ts";\n',
    "demanda/nucleo/demanda.ts": 'import type { Etapa } from "../../fluxo/nucleo/etapa.ts";\n',
    "demanda/aplicacao/tela.tsx": 'import { c } from "../../entrega/contrato/x.ts";\n',
    "entrega/contrato/x.ts": 'import { z } from "zod";\n',
    "entrega/http/rota.ts":
      'import { a } from "../../demanda/nucleo/demanda.ts";\nimport { c } from "../contrato/x.ts";\n',
    "fluxo/nucleo/etapa.test.ts": 'import { r } from "../../entrega/http/rota.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz, []), ["ciclo entre módulos: demanda → fluxo → demanda"]);
  const toleradas: DependenciaToleradaEntreDominios[] = [
    { de: "demanda", para: "fluxo", passo: 4 },
    { de: "entrega/http", para: "demanda", passo: 6 },
    { de: "execucao", para: "fluxo", passo: 4 },
  ];
  assert.deepEqual(acharCiclosEntreDominios(raiz, toleradas), []);
  assert.deepEqual(acharToleranciasVencidas(raiz, toleradas), ["entrega/http → demanda", "execucao → fluxo"]);
});

// O nome de cada Etapa (os valores de EtapaTicket) como dado, em literal de texto ou chave de objeto (`{ planejar: … }`), só
// em src/etapas/ e nos arquivos abaixo: a catraca de hoje, que encolhe a cada passo da migração SDLC por seams. primitivos.ts
// (onde o enum nasce) e o catálogo das Etapas (fluxo/nucleo/etapa.ts, ciclos.ts) saem só nos passos 3 e 4.
// Arquivo novo citando o nome falha; arquivo da lista que deixou de citar também.
const NOMES_DE_ETAPA = new Set<string>(EtapaTicket.options);
const PASTA_DAS_ETAPAS = "etapas/";
const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA = [
  "ambiente/aplicacao/consultas/projeto.ts",
  "ambiente/aplicacao/espaco/commit_ticket_demanda.ts",
  "compartilhado/nucleo/primitivos.ts",
  "custos/aplicacao/metricas/metrica_de_exigencias_de_alteracao.ts",
  "custos/aplicacao/metricas/metrica_de_uso.ts",
  "demanda/aplicacao/consultas/demanda.ts",
  "demanda/aplicacao/consultas/inicio.ts",
  "demanda/nucleo/agregado_demanda.ts",
  "demanda/nucleo/pendencia.ts",
  "demanda/nucleo/plano.ts",
  "entrega/cliente-web/render.ts",
  "entrega/cliente-web/rotulos.ts",
  "entrega/cliente-web/telas/demandas.ts",
  "entrega/cliente-web/telas/inicio.ts",
  "entrega/cliente-web/telas/metricas.ts",
  "entrega/cliente-web/telas/projeto.ts",
  "entrega/contrato/inicio.ts",
  "execucao/aplicacao/agente/decidir_revisao.ts",
  "execucao/aplicacao/despacho.ts",
  "execucao/aplicacao/execucao_demanda.ts",
  "execucao/aplicacao/sessoes/sessao_ajustes.ts",
  "execucao/aplicacao/sessoes/sessoes_demanda.ts",
  "execucao/aplicacao/trabalho/auditor_automatico.ts",
  "execucao/nucleo/despacho.ts",
  "execucao/nucleo/tentativa.ts",
  "fluxo/aplicacao/encerramento_rodada.ts",
  "fluxo/aplicacao/etapas/agenticas/conducao_de_implementar.ts",
  "fluxo/aplicacao/etapas/encerramento/conducao_de_encerrar_demanda.ts",
  "fluxo/aplicacao/etapas/interativas/conducao_de_ajustar_resultado.ts",
  "fluxo/aplicacao/etapas/interativas/conducao_de_planejar.ts",
  "fluxo/aplicacao/gates/pr.ts",
  "fluxo/aplicacao/prompt_demanda.ts",
  "fluxo/nucleo/ciclo_de_vida/ciclos.ts",
  "fluxo/nucleo/etapa.ts",
  "fluxo/nucleo/gate.ts",
  "fluxo/nucleo/transicoes/conclusao_ticket.ts",
  "fluxo/nucleo/transicoes/transicoes_demanda.ts",
  "fluxo/nucleo/transicoes/transicoes_encerramento.ts",
  "fluxo/nucleo/transicoes/transicoes_rodada.ts",
  "qualidade/aplicacao/evidencias/aula.ts",
  "qualidade/aplicacao/evidencias/verificacoes.ts",
  "qualidade/aplicacao/revisao_rodada.ts",
  "qualidade/nucleo/evidencias/evidencia.ts",
];

// `forEachChild` para no primeiro filho que devolve verdadeiro: basta um nome por arquivo.
function citaNomeDeEtapa(no: ts.Node): boolean {
  const texto = ts.isStringLiteralLike(no)
    ? no.text
    : ts.isPropertyAssignment(no) && ts.isIdentifier(no.name)
      ? no.name.text
      : undefined;
  return (texto !== undefined && NOMES_DE_ETAPA.has(texto)) || ts.forEachChild(no, citaNomeDeEtapa) === true;
}

function acharArquivosQueCitamNomeDeEtapa(src: string): string[] {
  return listarArquivosDeProducao(src).filter((arquivo) =>
    citaNomeDeEtapa(ts.createSourceFile(arquivo, readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest)),
  );
}

test("nome de Etapa só em src/etapas/ e nos arquivos da catraca", () => {
  assert.deepEqual(
    acharArquivosQueCitamNomeDeEtapa(SRC).filter(
      (arquivo) => !arquivo.startsWith(PASTA_DAS_ETAPAS) && !ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA.includes(arquivo),
    ),
    [],
  );
});

test("todo arquivo da catraca de nomes de Etapa ainda cita um nome", () => {
  const citam = new Set(acharArquivosQueCitamNomeDeEtapa(SRC));
  assert.deepEqual(
    ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA.filter((arquivo) => !citam.has(arquivo)),
    [],
  );
});

test("a fitness de nomes de Etapa acusa literal e chave de objeto, em .ts e .tsx, e ignora comentário e teste", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-etapas-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    "fluxo/nucleo/literal.ts": 'if (etapa === "revisar_rodada") pular();\n',
    "fluxo/nucleo/template.ts": "const etapa = `planejar`;\n",
    "entrega/cliente-web/rotulos.ts": 'export const ROTULOS = { encerrar_demanda: "Encerrar" };\n',
    "entrega/cliente-web/tela.tsx": 'export const Tela = () => <p title="implementar">ok</p>;\n',
    "etapas/planejar/definicao.ts": 'export const nome = "planejar";\n',
    "fluxo/nucleo/comentario.ts": '// planejar e "implementar"\nconst planejar = 1;\nconst x = "planejar_demanda";\n',
    "fluxo/nucleo/literal.test.ts": 'const etapa = "planejar";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharArquivosQueCitamNomeDeEtapa(raiz).sort(), [
    "entrega/cliente-web/rotulos.ts",
    "entrega/cliente-web/tela.tsx",
    "etapas/planejar/definicao.ts",
    "fluxo/nucleo/literal.ts",
    "fluxo/nucleo/template.ts",
  ]);
});
