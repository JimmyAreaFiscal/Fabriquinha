// Fitness function: os módulos de src/ dependem numa só direção (matriz abaixo), sem ciclo, e só `armazenamento` fala SQL.
// Lista de permitidos em vez de proibidos: uma dependência nova precisa ser liberada aqui de propósito.
// Violação que ainda existe vira exceção datada (demanda que a remove); a exceção que deixou de existir também falha.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";

const MODULO_CLIENTE_WEB = "entrega/cliente-web";

// Pacote npm ou node:* de fora de src/ não é dependência entre módulos; só o núcleo e o cliente web restringem o externo.
const QUALQUER_EXTERNO = () => true;
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

function moduloDoArquivo(caminhoRelativoASrc: string): string {
  const [primeiro, segundo] = caminhoRelativoASrc.split("/");
  return primeiro === "entrega" && segundo ? `entrega/${segundo}` : (primeiro ?? "");
}

function listarArquivosDeProducao(src: string): string[] {
  return readdirSync(src, { recursive: true, encoding: "utf8" })
    .filter((arquivo) => arquivo.endsWith(".ts") && !arquivo.endsWith(".test.ts"))
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
const ARQUIVO_DO_RELOGIO = "nucleo/relogio.ts";

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
const ARQUIVO_DO_CONDUTOR = "aplicacao/trabalho/condutor.ts";
const ARQUIVO_DO_HARNESS = "infra/agente/harness_pi.ts";
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
const PREFIXO_DO_AMBIENTE = "infra/ambiente/";
const ARQUIVOS_COM_CHILD_PROCESS = new Set(["infra/processo.ts", ARQUIVO_DO_HARNESS]);
// Lista fixa: cada um fala com o `gh`/`az`, o cadastro, o blame, o pdftotext, o sonar-scanner, o pi sem worktree ou a rede do git com credenciais.
const CHAMADORES_DIRETOS_DO_PROCESSO = [
  "aplicacao/auditor_automatico.ts",
  "aplicacao/executor.ts",
  "composicao/cli.ts",
  "infra/agente/harness_pi.ts",
  "infra/repositorio/cadastro.ts",
  "infra/repositorio/commits_humanos.ts",
  "infra/repositorio/heatmap.ts",
  "infra/repositorio/limpeza_demanda.ts",
  "infra/repositorio/pr.ts",
  "infra/repositorio/worktree.ts",
  "infra/verificacao/sonar.ts",
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
  const doAmbiente = (arquivo: string) => arquivo.startsWith(PREFIXO_DO_AMBIENTE);
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
    "infra/processo.ts": 'import { spawn } from "node:child_process";\n',
    "infra/ambiente/ambiente_host_local.ts":
      'import { spawn } from "child_process";\nimport { executar } from "../processo.ts";\n',
    "infra/repositorio/pr.ts": 'import { executar } from "../processo.ts";\n',
    "infra/repositorio/commit.ts": 'import { exigirGitNoAmbiente } from "./worktree.ts";\n',
    "aplicacao/espaco_ruim.ts":
      'import { spawn } from "node:child_process";\nimport { git } from "../infra/processo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharViolacoesDoProcesso(raiz, ["infra/repositorio/pr.ts"]).sort(), [
    "aplicacao/espaco_ruim.ts importa infra/processo.ts",
    "aplicacao/espaco_ruim.ts importa node:child_process",
  ]);
});

// Só `submeter.ts` (e o armazenamento) grava em `evidencia_demanda`: toda Evidência entra pela submissão avaliada.
const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "aplicacao/evidencia/submeter.ts";
const ARMAZENAMENTO_DE_EVIDENCIA = "armazenamento/evidencia_demanda.ts";
const MONTA_EVIDENCIAS_A_PARTIR_DA_ATUAL = /evidencias:\s*\[\s*\.\.\./;

// shortcut: o padrão de lista é textual, então também acusa o literal dentro de comentário ou string; nenhum existe hoje em src/.
function acharGravacoesDeEvidenciaForaDeSubmeter(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter(
      (arquivo) =>
        arquivo !== ARQUIVO_QUE_SUBMETE_EVIDENCIA &&
        !arquivo.startsWith("armazenamento/") &&
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
