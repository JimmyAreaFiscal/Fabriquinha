// Fitness function: os módulos de src/ dependem numa só direção (matriz abaixo), sem ciclo, e só `armazenamento` fala SQL.
// Lista de permitidos em vez de proibidos: uma dependência nova precisa ser liberada aqui de propósito.
// Violação que ainda existe vira exceção datada (demanda que a remove); a exceção que deixou de existir também falha.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { EtapaTicket } from "../src/etapas/catalogo.ts";

const MODULO_CLIENTE_WEB = "web";
const MODULO_COMPARTILHADO_COM_O_NAVEGADOR = "web/compartilhado";
const MODULO_DAS_CONSULTAS_DAS_TELAS = "api/consultas";
const MODULO_DO_HARNESS = "harness";
const MODULO_DO_ADAPTER_PI = "harness/pi";

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
    modulosPermitidos: ["nucleo", "armazenamento", "infra", MODULO_DO_HARNESS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // A interface do Harness: só tipos, que o adapter implementa e o condutor usa.
  [MODULO_DO_HARNESS]: { modulosPermitidos: [], modulosSoComoTipo: ["nucleo", "infra"], externoPermitido: () => false },
  // O adapter pi é infra do harness; só a composição o importa (o resto do serviço pede o harness ao condutor).
  [MODULO_DO_ADAPTER_PI]: {
    modulosPermitidos: ["nucleo", "infra", MODULO_DO_HARNESS],
    externoPermitido: QUALQUER_EXTERNO,
  },
  // Puro: importável pelo servidor e pelo navegador.
  [MODULO_COMPARTILHADO_COM_O_NAVEGADOR]: { modulosPermitidos: [], externoPermitido: () => false },
  // Os tipos e schemas da API: só o núcleo e o zod. Nenhum domínio o importa (as consultas das telas ficam em
  // api/consultas/), e o cliente web só o importa como tipo (fora de `modulosPermitidos` dele).
  contrato: { modulosPermitidos: ["nucleo"], externoPermitido: (alvo) => alvo === "zod" },
  // As consultas que montam a visão de uma tela no formato do contrato, juntando os domínios: a regra da aplicação, mais o contrato.
  [MODULO_DAS_CONSULTAS_DAS_TELAS]: {
    modulosPermitidos: ["nucleo", "armazenamento", "infra", "aplicacao", "contrato"],
    externoPermitido: QUALQUER_EXTERNO,
  },
  api: {
    modulosPermitidos: [
      "aplicacao",
      "nucleo",
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      "contrato",
      MODULO_DAS_CONSULTAS_DAS_TELAS,
    ],
    externoPermitido: QUALQUER_EXTERNO,
  },
  cli: { modulosPermitidos: ["aplicacao", "nucleo", "contrato"], externoPermitido: QUALQUER_EXTERNO },
  // O cliente do agente roda empacotado, sem o core: só o contrato e o Node (menos o SQLite).
  "cli-agente": { modulosPermitidos: ["contrato"], externoPermitido: SO_NODE_SEM_SQLITE },
  // Roda no navegador: de valor, só o `web/compartilhado` (o `casar` e o relógio do navegador); do contrato e do núcleo,
  // só `import type`; de fora, só os pacotes do navegador, servidos em /static/ pelo import map (`node:` só nos testes,
  // que a matriz não lê).
  [MODULO_CLIENTE_WEB]: {
    modulosPermitidos: [MODULO_COMPARTILHADO_COM_O_NAVEGADOR],
    modulosSoComoTipo: ["contrato", "nucleo"],
    externoPermitido: (alvo) => PACOTES_DO_NAVEGADOR.has(pacoteDe(alvo)),
  },
  composicao: {
    modulosPermitidos: [
      "nucleo",
      "armazenamento",
      "infra",
      "aplicacao",
      "api",
      "cli",
      MODULO_COMPARTILHADO_COM_O_NAVEGADOR,
      "contrato",
      MODULO_CLIENTE_WEB,
      MODULO_DO_HARNESS,
      MODULO_DO_ADAPTER_PI,
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

// Cada exceção cita a demanda (04 a 26) que a remove. Vazia: a 20 limpou a API (ex-entrega/http) e nada mais ficou pendente.
const EXCECOES: Excecao[] = [];

// `src/<domínio>/<camada>/…`: o domínio agrupa por conceito, e a regra de dependência é a da camada.
const DOMINIOS = new Set([
  "sdlc",
  "trabalho_agentico",
  "sandbox",
  "repositorio",
  "projeto",
  "verificacao",
  "metricas",
  "avaliacao",
  "compartilhado",
]);

// `src/etapas/` não tem pasta por camada: a pasta é a Etapa, ou o que é comum a elas. O que a Etapa declara é valor puro,
// com a regra do núcleo, para o motor ler o catálogo sem trazer condução nem banco: o catálogo, `definicao/` e, em cada
// Etapa, `definicao.ts` e a regra do Gate dela (`gate.ts`, agregado → agregado). O resto (a condução e os registros das
// conduções e dos Gates, a montagem do prompt, a decisão dos Gates e os casos de uso), a da aplicação.
const DOMINIO_DAS_ETAPAS = "etapas";
const VALOR_PURO_DAS_ETAPAS = /^etapas\/(catalogo\.ts|definicao\/.+|[^/]+\/(definicao|gate)\.ts)$/;

// `src/harness/<arquivo>` é a interface; `src/harness/<adapter>/…`, um módulo por adapter. `src/api/consultas/` e
// `src/web/compartilhado/` são módulos à parte dentro da API e da web; `contrato/`, `cli/` e `cli-agente/`, cada um o seu.
function moduloDoArquivo(caminhoRelativoASrc: string): string {
  const [primeiro, segundo] = caminhoRelativoASrc.split("/");
  if (primeiro === DOMINIO_DAS_ETAPAS) return VALOR_PURO_DAS_ETAPAS.test(caminhoRelativoASrc) ? "nucleo" : "aplicacao";
  if (primeiro === "api") return segundo === "consultas" ? MODULO_DAS_CONSULTAS_DAS_TELAS : "api";
  if (primeiro === MODULO_CLIENTE_WEB)
    return segundo === "compartilhado" ? MODULO_COMPARTILHADO_COM_O_NAVEGADOR : MODULO_CLIENTE_WEB;
  if (primeiro === MODULO_DO_HARNESS)
    return segundo === undefined || segundo.endsWith(".ts") ? MODULO_DO_HARNESS : `${MODULO_DO_HARNESS}/${segundo}`;
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

test("a lista de exceções está vazia: a API não importa armazenamento nem chama .prepare(", () => {
  assert.deepEqual(EXCECOES, []);
  const daApi = acharViolacoes(SRC, []).filter(({ arquivo }) => arquivo.startsWith("api/"));
  assert.deepEqual(daApi.map(descrever), []);
});

// A matriz libera `aplicacao` inteira à API; a API do agente só alcança os casos de uso do agente.
test("api/agente só importa de aplicacao o etapas/agente", () => {
  const daApiDoAgente = listarArquivosDeProducao(SRC).filter((arquivo) => arquivo.startsWith("api/agente/"));
  assert.ok(daApiDoAgente.length > 0);
  const deAplicacaoFora = daApiDoAgente.flatMap((arquivo) => {
    const caminho = join(SRC, arquivo);
    return ts
      .preProcessFile(readFileSync(caminho, "utf8"), true, true)
      .importedFiles.map(({ fileName: alvo }) => relative(SRC, resolve(dirname(caminho), alvo)))
      .filter((alvo) => moduloDoArquivo(alvo) === "aplicacao" && !alvo.startsWith("etapas/agente/"))
      .map((alvo) => `${arquivo} importa ${alvo}`);
  });
  assert.deepEqual(deAplicacaoFora, []);
});

test("nenhum importador da API fora de composicao e da própria API", () => {
  const importadores = listarArquivosDeProducao(SRC)
    .filter((arquivo) => !arquivo.startsWith("composicao/") && !arquivo.startsWith("api/"))
    .filter((arquivo) => /from ['"](\.\.\/)+api\//.test(readFileSync(join(SRC, arquivo), "utf8")));
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
    "web/compartilhado/ok.ts": "export const c = 1;\n",
    "contrato/ok.ts": 'import { z } from "zod";\nimport { Id } from "../nucleo/ok.ts";\n',
    "cli-agente/ok.ts":
      'import { Resposta } from "../contrato/ok.ts";\nimport { readFileSync } from "node:fs";\nimport { b } from "./sub.ts";\n',
    "api/ok.ts":
      'import { a } from "../aplicacao/ok.ts";\nimport { c } from "../web/compartilhado/ok.ts";\nimport { Resposta } from "../contrato/ok.ts";\nimport { t } from "./consultas/tela.ts";\n',
    // A consulta da tela junta os domínios no formato do contrato: lê o banco como a aplicação.
    "api/consultas/tela.ts":
      'import { a } from "../../armazenamento/ok.ts";\nimport { b } from "../../aplicacao/ok.ts";\nimport type { R } from "../../contrato/ok.ts";\n',
    "web/ok.ts":
      'import type { N } from "../nucleo/ok.ts";\nimport type { R } from "../contrato/ok.ts";\nimport { b } from "./sub.ts";\nimport { c } from "./compartilhado/ok.ts";\n',
    "web/sub.ts": 'export type { Z } from "../nucleo/ok.ts";\n',
    "web/pacotes.ts":
      'import markdownit from "markdown-it/browser";\nimport { createRoot } from "react-dom/client";\nimport { useThread } from "@assistant-ui/react";\n',
    "composicao/ok.ts":
      'import { a } from "../api/ok.ts";\nimport express from "express";\nimport { HarnessPi } from "../harness/pi/harness_pi.ts";\n',
    "harness/harness.ts":
      'import type { N } from "../nucleo/ok.ts";\nimport type { Ambiente } from "../infra/ok.ts";\nexport interface Harness { n: N }\n',
    "harness/pi/harness_pi.ts":
      'import type { Harness } from "../harness.ts";\nimport { b } from "../../infra/ok.ts";\nimport { existsSync } from "node:fs";\n',
    "aplicacao/usa_o_harness.ts": 'import type { Harness } from "../harness/harness.ts";\n',
    "etapas/catalogo.ts": 'import { D } from "./planejar/definicao.ts";\n',
    "etapas/definicao/definicao_da_etapa.ts":
      'import { z } from "zod";\nimport type { N } from "../../nucleo/ok.ts";\n',
    "etapas/planejar/definicao.ts": 'import { evidencia } from "../definicao/definicao_da_etapa.ts";\n',
    "etapas/planejar/gate.ts": 'import { n } from "../../nucleo/ok.ts";\nimport { D } from "./definicao.ts";\n',
    "etapas/planejar/conducao_de_planejar.ts":
      'import { D } from "./definicao.ts";\nimport { a } from "../../armazenamento/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "nucleo/le_o_catalogo.ts": 'import { C } from "../etapas/catalogo.ts";\n',
    // Proibidos
    "nucleo/fs.ts": 'import { readFileSync } from "node:fs";\n',
    "infra/armazenamento.ts": 'import { b } from "../armazenamento/ok.ts";\n',
    "web/compartilhado/impuro.ts": 'import { z } from "../../nucleo/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "contrato/impuro.ts": 'import { readFileSync } from "node:fs";\nimport { a } from "../armazenamento/ok.ts";\n',
    "web/aplicacao_tipo.ts": 'import type { B } from "../aplicacao/ok.ts";\n',
    "web/aplicacao_valor.ts": 'import { a } from "../aplicacao/ok.ts";\n',
    "web/contrato_valor.ts": 'import { Resposta } from "../contrato/ok.ts";\n',
    "web/nucleo_valor.ts": 'import { n } from "../nucleo/ok.ts";\n',
    "web/lodash.ts": 'import _ from "lodash";\n',
    "web/node.ts": 'import { readFileSync } from "node:fs";\n',
    "web/react_puro.ts": 'import { useState } from "react";\n',
    "web/node.test.ts": 'import { test } from "node:test";\nimport { a } from "../aplicacao/ok.ts";\n',
    "cli-agente/aplicacao.ts": 'import { a } from "../aplicacao/ok.ts";\n',
    "cli-agente/armazenamento.ts": 'import { a } from "../armazenamento/ok.ts";\n',
    "cli-agente/nucleo.ts": 'import { n } from "../nucleo/ok.ts";\n',
    "cli-agente/sqlite.ts": 'import { DatabaseSync } from "node:sqlite";\n',
    "cli-agente/zod.ts": 'import { z } from "zod";\n',
    "aplicacao/ciclo.ts": 'import { a } from "../api/ciclo.ts";\n',
    "api/ciclo.ts": 'import { a } from "../aplicacao/ciclo.ts";\n',
    "api/usa_o_banco.ts": 'import { a } from "../armazenamento/ok.ts";\n',
    // Nenhum domínio importa o contrato da API: a consulta que o devolve é da API.
    "aplicacao/usa_o_contrato.ts": 'import type { R } from "../contrato/ok.ts";\n',
    "aplicacao/sql.ts": 'banco.prepare("SELECT 1");\nbanco.exec(`DELETE FROM a`);\n',
    "aplicacao/usa_o_pi.ts": 'import { HarnessPi } from "../harness/pi/harness_pi.ts";\n',
    "harness/valor.ts": 'import { b } from "../infra/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "harness/pi/armazenamento.ts": 'import { a } from "../../armazenamento/ok.ts";\n',
    "etapas/implementar/definicao.ts":
      'import { C } from "./conducao_de_implementar.ts";\nimport { readFileSync } from "node:fs";\n',
    // A seção do prompt é da condução, que lê o contexto do motor: a definição que a traz deixa de ser valor puro.
    "etapas/revisar_rodada/definicao.ts": 'import { s } from "./secao_do_prompt.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(
    acharViolacoes(raiz, []).map(descrever).sort(),
    [
      "api/ciclo.ts importa ciclo entre módulos: api → aplicacao → api",
      // A definição que importa a condução põe o núcleo a depender da aplicação: além do import, fecha ciclo.
      "aplicacao/ok.ts importa ciclo entre módulos: aplicacao → armazenamento → nucleo → aplicacao",
      "aplicacao/ciclo.ts importa ../api/ciclo.ts",
      "aplicacao/usa_o_contrato.ts importa ../contrato/ok.ts",
      "api/usa_o_banco.ts importa ../armazenamento/ok.ts",
      "aplicacao/sql.ts importa SQL .exec(",
      "aplicacao/sql.ts importa SQL .prepare(",
      "aplicacao/usa_o_pi.ts importa ../harness/pi/harness_pi.ts",
      "harness/pi/armazenamento.ts importa ../../armazenamento/ok.ts",
      "harness/valor.ts importa ../infra/ok.ts",
      "harness/valor.ts importa node:fs",
      "cli-agente/aplicacao.ts importa ../aplicacao/ok.ts",
      "cli-agente/armazenamento.ts importa ../armazenamento/ok.ts",
      "cli-agente/nucleo.ts importa ../nucleo/ok.ts",
      "cli-agente/sqlite.ts importa node:sqlite",
      "cli-agente/zod.ts importa zod",
      "web/aplicacao_tipo.ts importa ../aplicacao/ok.ts",
      "web/aplicacao_valor.ts importa ../aplicacao/ok.ts",
      "web/compartilhado/impuro.ts importa ../../nucleo/ok.ts",
      "web/compartilhado/impuro.ts importa node:fs",
      "contrato/impuro.ts importa ../armazenamento/ok.ts",
      "contrato/impuro.ts importa node:fs",
      "web/contrato_valor.ts importa ../contrato/ok.ts",
      "web/lodash.ts importa lodash",
      "web/node.ts importa node:fs",
      "web/nucleo_valor.ts importa ../nucleo/ok.ts",
      "web/react_puro.ts importa react",
      "etapas/implementar/definicao.ts importa ./conducao_de_implementar.ts",
      "etapas/implementar/definicao.ts importa node:fs",
      "etapas/revisar_rodada/definicao.ts importa ./secao_do_prompt.ts",
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
    "web/ruim.ts": "const ano = new Date(instante).getFullYear();\n",
    "web/compartilhado/ruim.ts": "export const dia = (i: string) => new Date(i);\n",
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
    "web/compartilhado/ruim.ts chama new Date(",
    "web/ruim.ts chama new Date(",
  ]);
});

// Só o condutor lança o pi e consulta o modelo: o resto do serviço pede ao `CondutorDeTrabalhos`. O harness lança pelo Ambiente.
const ARQUIVO_DO_CONDUTOR = "trabalho_agentico/aplicacao/trabalho/condutor.ts";
const ARQUIVO_DO_HARNESS = "harness/pi/harness_pi.ts";
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
// O Ambiente em si: a interface e os adapters, a infra do sandbox; o git e a hospedagem (repositorio/) seguem a regra comum.
const INICIOS_DO_AMBIENTE = ["sandbox/infra/"];
const ARQUIVO_DO_PROCESSO = "compartilhado/infra/processo.ts";
const ARQUIVOS_COM_CHILD_PROCESS = new Set([ARQUIVO_DO_PROCESSO, ARQUIVO_DO_HARNESS]);
// Lista fixa: cada um fala com o `gh`/`az`, o cadastro, o blame, o pdftotext, o sonar-scanner, o pi sem worktree ou a rede do git com credenciais.
const CHAMADORES_DIRETOS_DO_PROCESSO = [
  "avaliacao/aplicacao/simulacao/executor.ts",
  "composicao/cli.ts",
  "harness/pi/harness_pi.ts",
  "repositorio/infra/git/cadastro.ts",
  "repositorio/infra/git/commits_humanos.ts",
  "repositorio/infra/git/heatmap.ts",
  "repositorio/infra/hospedagem/pr.ts",
  "repositorio/infra/worktree/limpeza_demanda.ts",
  "repositorio/infra/worktree/worktree.ts",
  "verificacao/infra/tipos_de_verificacao/sonar.ts",
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
    "sandbox/infra/host_local/ambiente_host_local.ts":
      'import { spawn } from "child_process";\nimport { executar } from "../../../compartilhado/infra/processo.ts";\n',
    "repositorio/infra/hospedagem/pr.ts": 'import { executar } from "../../../compartilhado/infra/processo.ts";\n',
    "repositorio/infra/git/commit.ts": 'import { exigirGitNoAmbiente } from "../worktree/worktree.ts";\n',
    "repositorio/aplicacao/espaco_ruim.ts":
      'import { spawn } from "node:child_process";\nimport { git } from "../../compartilhado/infra/processo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharViolacoesDoProcesso(raiz, ["repositorio/infra/hospedagem/pr.ts"]).sort(), [
    "repositorio/aplicacao/espaco_ruim.ts importa infra/processo.ts",
    "repositorio/aplicacao/espaco_ruim.ts importa node:child_process",
  ]);
});

// Só `submeter.ts` (e o armazenamento) grava em `evidencia_demanda`: toda Evidência entra pela submissão avaliada.
const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "sdlc/aplicacao/evidencias/submeter.ts";
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

// Os domínios de src/ (a primeira pasta, como no mapa-alvo) não formam ciclo de import, de valor ou de tipo. A migração
// SDLC por seams (1 harness/, 2 sandbox/, repositorio/ e projeto/, 3 etapas/, 4a sdlc/ e trabalho_agentico/, 4b o motor
// derivado do catálogo de Etapas, 4c os ciclos entre os domínios do motor e etapas/, 5 verificacao/ e metricas/, 6 api/,
// web/, cli/, cli-agente/ e contrato/ no lugar de entrega/) tolerava aqui, com o passo que a removia, a dependência que
// fechava ciclo; desde o 6 não resta nenhuma. A ordem, de cima para baixo: api, cli, cli-agente, web, composicao →
// contrato → etapas, avaliacao → metricas → sdlc → trabalho_agentico → harness, verificacao → projeto → repositorio →
// sandbox → etapas/definicao → compartilhado. A aresta tolerada fica fora do grafo; se sumir do código ou deixar de fechar
// ciclo, a fitness também falha.
interface DependenciaToleradaEntreDominios {
  de: string;
  para: string;
  /** O passo da migração, ou a demanda, que remove a dependência. */
  removidaEm: string;
}

const DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS: DependenciaToleradaEntreDominios[] = [];

// O que as Etapas declaram (o catálogo, `definicao/` e o `definicao.ts` de cada uma) conta como um domínio à parte, embaixo
// do motor: todo o serviço lê os nomes das Etapas e o que cada uma declara, e a declaração só depende de `compartilhado`.
// O resto de `etapas/` (as conduções, os Gates, o prompt, a API do agente) é o domínio `etapas`, em cima do motor.
const DECLARACOES_DAS_ETAPAS = /^etapas\/(catalogo\.ts|definicao\/.+|[^/]+\/definicao\.ts)$/;
const DOMINIO_DAS_DECLARACOES_DAS_ETAPAS = "etapas/definicao";

function dominioDoArquivo(caminhoRelativoASrc: string): string {
  if (DECLARACOES_DAS_ETAPAS.test(caminhoRelativoASrc)) return DOMINIO_DAS_DECLARACOES_DAS_ETAPAS;
  return caminhoRelativoASrc.split("/")[0] ?? "";
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
    "fluxo/nucleo/gate.ts": 'import { Demanda } from "../../demanda/nucleo/demanda.ts";\n',
    "demanda/nucleo/demanda.ts": 'import type { Gate } from "../../fluxo/nucleo/gate.ts";\n',
    "demanda/aplicacao/tela.tsx": 'import { c } from "../../contrato/x.ts";\n',
    "contrato/x.ts": 'import { z } from "zod";\n',
    "api/rota.ts": 'import { a } from "../demanda/nucleo/demanda.ts";\nimport { c } from "../contrato/x.ts";\n',
    "fluxo/nucleo/gate.test.ts": 'import { r } from "../../api/rota.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz, []), ["ciclo entre módulos: demanda → fluxo → demanda"]);
  const toleradas: DependenciaToleradaEntreDominios[] = [
    { de: "demanda", para: "fluxo", removidaEm: "5" },
    { de: "api", para: "demanda", removidaEm: "6" },
    { de: "execucao", para: "fluxo", removidaEm: "5" },
  ];
  assert.deepEqual(acharCiclosEntreDominios(raiz, toleradas), []);
  assert.deepEqual(acharToleranciasVencidas(raiz, toleradas), ["api → demanda", "execucao → fluxo"]);
});

test("o que as Etapas declaram é um domínio embaixo do motor, e o resto de etapas/ fica em cima dele", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-declaracoes-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    // O motor lê o catálogo, a definição comum e a de cada Etapa; a condução usa o motor.
    "sdlc/nucleo/ciclos.ts":
      'import { C } from "../../etapas/catalogo.ts";\nimport type { D } from "../../etapas/definicao/definicao_da_etapa.ts";\n',
    "sdlc/aplicacao/despacho.ts": 'import { P } from "../../etapas/planejar/definicao.ts";\n',
    "etapas/catalogo.ts":
      'import { P } from "./planejar/definicao.ts";\nimport { e } from "../compartilhado/nucleo/erros.ts";\n',
    "etapas/planejar/conducao_de_planejar.ts": 'import { c } from "../../sdlc/nucleo/ciclos.ts";\n',
    "compartilhado/nucleo/erros.ts": "export const e = 1;\n",
    // A definição que lê o motor, e o motor que lê a condução, fecham ciclo.
    "etapas/planejar/definicao.ts": 'import type { A } from "../../sdlc/nucleo/agregado.ts";\n',
    "sdlc/nucleo/agregado.ts": 'import { C } from "../../etapas/catalogo.ts";\n',
    "sdlc/aplicacao/conduz.ts": 'import { C } from "../../etapas/planejar/conducao_de_planejar.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz, []).sort(), [
    "ciclo entre módulos: etapas/definicao → sdlc → etapas/definicao",
    "ciclo entre módulos: sdlc → etapas → sdlc",
  ]);
  rmSync(join(raiz, "etapas/planejar/definicao.ts"));
  rmSync(join(raiz, "sdlc/aplicacao/conduz.ts"));
  writeFileSync(
    join(raiz, "etapas/planejar/definicao.ts"),
    'import { e } from "../../compartilhado/nucleo/erros.ts";\n',
  );
  assert.deepEqual(acharCiclosEntreDominios(raiz, []), []);
});

// O nome de cada Etapa (os valores de EtapaTicket) como dado, em literal de texto, chave de objeto (`{ planejar: … }`) ou
// entre aspas simples no SQL de um literal ou template (`etapa = 'planejar'`), só em src/etapas/ e nas migrações, que
// guardam o esquema do passado. A catraca encolheu a cada passo da migração SDLC por seams: o motor (sdlc/,
// trabalho_agentico/, projeto/, repositorio/, verificacao/, avaliacao/) pergunta ao catálogo desde o passo 4b, os enums
// de Etapa, de Gate e de estado saem do catálogo desde o 4c, as Métricas desde o 5 e, desde o 6, a API, a web (que lê as
// Etapas de `GET /api/etapas`) e o SQL do Trabalho Agêntico. A lista dos arquivos tolerados fica vazia; arquivo novo
// citando o nome falha, e arquivo da lista que deixou de citar também.
const NOMES_DE_ETAPA = new Set<string>(EtapaTicket.options);
const NOME_DE_ETAPA_NO_SQL = new RegExp(`'(${[...NOMES_DE_ETAPA].join("|")})'`);
const PASTAS_QUE_CITAM_NOME_DE_ETAPA = ["etapas/", "compartilhado/armazenamento/migracoes/"];
const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA: string[] = [];

/** O texto de um literal, de um trecho de template ou da chave de um objeto; `undefined` em qualquer outro nó. */
function textoDoNo(no: ts.Node): string | undefined {
  if (ts.isStringLiteralLike(no) || ts.isTemplateHead(no) || ts.isTemplateMiddle(no) || ts.isTemplateTail(no))
    return no.text;
  return ts.isPropertyAssignment(no) && ts.isIdentifier(no.name) ? no.name.text : undefined;
}

// `forEachChild` para no primeiro filho que devolve verdadeiro: basta um nome por arquivo.
function citaNomeDeEtapa(no: ts.Node): boolean {
  const texto = textoDoNo(no);
  const cita = texto !== undefined && (NOMES_DE_ETAPA.has(texto) || NOME_DE_ETAPA_NO_SQL.test(texto));
  return cita || ts.forEachChild(no, citaNomeDeEtapa) === true;
}

function acharArquivosQueCitamNomeDeEtapa(src: string): string[] {
  return listarArquivosDeProducao(src).filter((arquivo) =>
    citaNomeDeEtapa(ts.createSourceFile(arquivo, readFileSync(join(src, arquivo), "utf8"), ts.ScriptTarget.Latest)),
  );
}

test("nome de Etapa só em src/etapas/ e nas migrações", () => {
  assert.deepEqual(
    acharArquivosQueCitamNomeDeEtapa(SRC).filter(
      (arquivo) =>
        !PASTAS_QUE_CITAM_NOME_DE_ETAPA.some((pasta) => arquivo.startsWith(pasta)) &&
        !ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA.includes(arquivo),
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

test("a fitness de nomes de Etapa acusa literal, chave de objeto e SQL, em .ts e .tsx, e ignora comentário e teste", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-etapas-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    "fluxo/nucleo/literal.ts": 'if (etapa === "revisar_rodada") pular();\n',
    "fluxo/nucleo/template.ts": "const etapa = `planejar`;\n",
    "web/rotulos.ts": 'export const ROTULOS = { encerrar_demanda: "Encerrar" };\n',
    "web/tela.tsx": 'export const Tela = () => <p title="implementar">ok</p>;\n',
    "etapas/planejar/definicao.ts": 'export const nome = "planejar";\n',
    "fluxo/nucleo/comentario.ts": '// planejar e "implementar"\nconst planejar = 1;\nconst x = "planejar_demanda";\n',
    "fluxo/nucleo/literal.test.ts": 'const etapa = "planejar";\n',
    "fluxo/armazenamento/sql.ts": "banco.prepare(`SELECT 1 FROM t WHERE etapa = 'implementar' AND x = ${y}`);\n",
    "fluxo/armazenamento/sql_no_meio.ts": "banco.prepare(`SELECT ${a} FROM t WHERE etapa IN ('planejar')`);\n",
    "fluxo/armazenamento/parametro.ts": "banco.prepare(`SELECT 1 FROM t WHERE etapa = ? AND e = 'implementar_x'`);\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharArquivosQueCitamNomeDeEtapa(raiz).sort(), [
    "etapas/planejar/definicao.ts",
    "fluxo/armazenamento/sql.ts",
    "fluxo/armazenamento/sql_no_meio.ts",
    "fluxo/nucleo/literal.ts",
    "fluxo/nucleo/template.ts",
    "web/rotulos.ts",
    "web/tela.tsx",
  ]);
});

// O motor deriva do catálogo, na carga do módulo, os ciclos de vida e os enums que citam papéis: o catálogo não pode estar
// num ciclo de import de valor, senão quem o lê na carga o acha ainda em TDZ, conforme a ordem em que os módulos sobem.
// As definições e as seções do prompt importam do motor só tipos e funções que não leem o catálogo.
const ARQUIVO_DO_CATALOGO = "etapas/catalogo.ts";

function acharVoltasAoCatalogo(src: string): string[] {
  const importadosPorValor = (arquivo: string): string[] => {
    const caminho = join(src, arquivo);
    const fonte = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest);
    const soDeTipo = acharEspecificadoresSoDeTipo(fonte);
    return acharEspecificadoresDe(src, arquivo)
      .filter((alvo) => alvo.startsWith(".") && !soDeTipo.has(alvo))
      .map((alvo) => relative(src, resolve(dirname(caminho), alvo)));
  };
  const fecho = [ARQUIVO_DO_CATALOGO];
  for (const arquivo of fecho) {
    for (const alvo of importadosPorValor(arquivo)) if (!fecho.includes(alvo)) fecho.push(alvo);
  }
  return fecho
    .filter((arquivo) => importadosPorValor(arquivo).includes(ARQUIVO_DO_CATALOGO))
    .map((arquivo) => `${arquivo} importa o catálogo, que o importa por valor`);
}

test("o catálogo de Etapas não está num ciclo de import de valor", () => {
  assert.deepEqual(acharVoltasAoCatalogo(SRC), []);
});

test("a fitness do catálogo acusa a volta por valor e aceita a de tipo", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-catalogo-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_DO_CATALOGO]: 'import { D } from "./planejar/definicao.ts";\nimport type { T } from "./tipo.ts";\n',
    "etapas/planejar/definicao.ts": 'import { c } from "../../sdlc/nucleo/ciclos.ts";\n',
    "etapas/tipo.ts": 'import { C } from "./catalogo.ts";\n',
    "sdlc/nucleo/ciclos.ts": 'import { CATALOGO } from "../../etapas/catalogo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharVoltasAoCatalogo(raiz), ["sdlc/nucleo/ciclos.ts importa o catálogo, que o importa por valor"]);
});
