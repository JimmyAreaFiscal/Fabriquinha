// Fitness function: os módulos de src/ dependem numa só direção, sem ciclo, e só `armazenamento` fala SQL.
// O motor e as regras ficam em fitness/fronteiras/: a matriz das camadas (camadas.ts) e um arquivo de regras por domínio
// (dominios/<domínio>.ts); o topo de fronteiras/motor.ts diz como declarar um subdomínio ou uma dependência. Não há exceção:
// a violação reprova.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { EtapaTicket } from "../src/modulos/ciclo_de_vida/publico.ts";
import { ARQUITETURA_DE_SRC } from "./fronteiras/arquitetura.ts";
import {
  ARMAZENAMENTO_DE_EVIDENCIA,
  ARQUIVO_DO_CATALOGO,
  ENTRADAS_DO_ARMAZENAMENTO_DE_EVIDENCIA,
  ARQUIVO_QUE_SUBMETE_EVIDENCIA,
  ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA,
  PASTA_DOS_CASOS_DE_USO_DO_AGENTE,
  PASTAS_QUE_CITAM_NOME_DE_ETAPA,
} from "./fronteiras/dominios/ciclo_de_vida.ts";
import { PASTA_DA_API_DO_AGENTE, PASTA_DA_COMPOSICAO } from "./fronteiras/dominios/server.ts";
import { ARQUIVO_DO_CONDUTOR, ARQUIVO_DO_HARNESS } from "./fronteiras/dominios/sessoes.ts";
import {
  ARQUIVO_DO_PROCESSO,
  ARQUIVO_DO_RELOGIO,
  MIGRACOES_DOS_DOMINIOS,
  PASTA_DO_HISTORICO_DO_ESQUEMA,
} from "./fronteiras/dominios/shared.ts";
import {
  acharCiclosEntreDominios,
  acharEspecificadoresDe,
  acharEspecificadoresSoDeTipo,
  acharImportadoresDe,
  acharViolacoes,
  descrever,
  listarArquivosDeProducao,
  moduloDoArquivo,
} from "./fronteiras/motor.ts";

const SRC = resolve(import.meta.dirname, "../src");
const moduloDe = (caminhoRelativoASrc: string) => moduloDoArquivo(caminhoRelativoASrc, ARQUITETURA_DE_SRC);

test("src respeita a matriz de dependências e as regras dos domínios, não tem ciclo e só armazenamento fala SQL", () => {
  assert.deepEqual(acharViolacoes(SRC, ARQUITETURA_DE_SRC).map(descrever), []);
});

// A API do agente chega aos casos de uso pela fachada do Ciclo de Vida, que exporta a aplicação inteira: pela declaração
// de cada nome que ela importa, da aplicação dos domínios só os casos de uso do agente.
test("api/agente só alcança, da aplicação dos domínios, os casos de uso do agente", () => {
  const daApiDoAgente = listarArquivosDeProducao(SRC)
    .filter((arquivo) => arquivo.startsWith(PASTA_DA_API_DO_AGENTE))
    .map((arquivo) => join(SRC, arquivo));
  assert.ok(daApiDoAgente.length > 0);
  const programa = ts.createProgram(daApiDoAgente, {
    allowImportingTsExtensions: true,
    noEmit: true,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
  });
  const verificador = programa.getTypeChecker();
  const declaracaoDoNome = (nome: ts.Identifier): string | undefined => {
    const simbolo = verificador.getSymbolAtLocation(nome);
    const declaracao = simbolo && verificador.getAliasedSymbol(simbolo).declarations?.[0];
    return declaracao && relative(SRC, declaracao.getSourceFile().fileName);
  };
  const nomesImportados = (caminho: string): ts.Identifier[] =>
    (programa.getSourceFile(caminho)?.statements ?? []).flatMap((declaracao: ts.Statement) => {
      const nomeados = ts.isImportDeclaration(declaracao) ? declaracao.importClause?.namedBindings : undefined;
      return nomeados && ts.isNamedImports(nomeados) ? nomeados.elements.map((elemento) => elemento.name) : [];
    });
  // A resolução acha os casos de uso do agente: sem ela, a regra passaria sem olhar nada.
  assert.ok(
    daApiDoAgente.some((caminho) =>
      nomesImportados(caminho).some((nome) => declaracaoDoNome(nome)?.startsWith(PASTA_DOS_CASOS_DE_USO_DO_AGENTE)),
    ),
  );
  const deAplicacaoFora = daApiDoAgente.flatMap((caminho) =>
    nomesImportados(caminho).flatMap((nome) => {
      const arquivo = declaracaoDoNome(nome);
      return arquivo && moduloDe(arquivo) === "aplicacao" && !arquivo.startsWith(PASTA_DOS_CASOS_DE_USO_DO_AGENTE)
        ? [`${relative(SRC, caminho)} importa ${nome.text}, de ${arquivo}`]
        : [];
    }),
  );
  assert.deepEqual(deAplicacaoFora, []);
});

test("nenhum importador da API fora de composicao e da própria API", () => {
  const importadores = listarArquivosDeProducao(SRC)
    .filter((arquivo) => !arquivo.startsWith(PASTA_DA_COMPOSICAO) && !arquivo.startsWith("server/api/"))
    .filter((arquivo) => /from ['"](\.\.\/)+(server\/)?api\//.test(readFileSync(join(SRC, arquivo), "utf8")));
  assert.deepEqual(importadores, []);
});

test("a fitness acusa cada violação pelo arquivo e aceita o que a matriz permite", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const SANDBOXES = "modulos/ambiente/sandboxes";
  const arquivos: Record<string, string> = {
    // Permitidos: as camadas do subdomínio, a fachada e o shared.
    [`${SANDBOXES}/nucleo/ok.ts`]:
      'import { z } from "zod";\nimport { isAbsolute } from "node:path";\nexport { Y } from "./sub/y.ts";\n',
    [`${SANDBOXES}/nucleo/sub/y.ts`]: 'import { z } from "../ok.ts";\n',
    [`${SANDBOXES}/nucleo/ruim.test.ts`]: 'import { test } from "node:test";\nimport { x } from "node:fs";\n',
    [`${SANDBOXES}/armazenamento/ok.ts`]:
      'import { z } from "../nucleo/ok.ts";\nimport { DatabaseSync } from "node:sqlite";\nbanco.exec("CREATE TABLE a (b)");\nbanco.prepare("SELECT 1");\n',
    [`${SANDBOXES}/aplicacao/ok.ts`]:
      'import { a } from "../armazenamento/ok.ts";\nimport { b } from "../infra/ok.ts";\nconst achou = /a/.exec(texto);\n',
    [`${SANDBOXES}/infra/ok.ts`]: 'import { spawn } from "node:child_process";\nimport { z } from "../nucleo/ok.ts";\n',
    [`${SANDBOXES}/publico.ts`]: 'export { a } from "./aplicacao/ok.ts";\n',
    "modulos/ambiente/publico.ts": 'export { a } from "./sandboxes/publico.ts";\n',
    "shared/nucleo/erros.ts": 'import { z } from "zod";\n',
    "shared/armazenamento/snapshot.ts": 'import { e } from "../nucleo/erros.ts";\n',
    "server/web/compartilhado/ok.ts": "export const c = 1;\n",
    "server/contrato/ok.ts":
      'import { z } from "zod";\nimport { Id } from "../../modulos/ambiente/publico.ts";\nimport { e } from "../../shared/nucleo/erros.ts";\n',
    "server/cli-agente/ok.ts":
      'import { Resposta } from "../contrato/ok.ts";\nimport { readFileSync } from "node:fs";\nimport { b } from "./sub.ts";\n',
    "server/api/ok.ts":
      'import { a } from "../../modulos/ambiente/publico.ts";\nimport { c } from "../web/compartilhado/ok.ts";\nimport { Resposta } from "../contrato/ok.ts";\nimport { t } from "../consultas/tela.ts";\nimport { f } from "../fluxos/fluxo.ts";\n',
    "server/cli/ok.ts": 'import { t } from "../consultas/tela.ts";\nimport { f } from "../fluxos/fluxo.ts";\n',
    // A consulta da tela junta os domínios no formato do contrato, pelas fachadas (fronteiras-de-destino.test.ts).
    "server/consultas/tela.ts":
      'import type { R } from "../contrato/ok.ts";\nimport { l } from "../../shared/armazenamento/snapshot.ts";\n',
    // O fluxo coordena os domínios pela fachada.
    "server/fluxos/fluxo.ts":
      'import { a } from "../../modulos/ambiente/publico.ts";\nimport { e } from "../../shared/nucleo/erros.ts";\n',
    "server/web/ok.ts":
      'import type { N } from "../../modulos/ambiente/publico.ts";\nimport type { R } from "../contrato/ok.ts";\nimport { b } from "./sub.ts";\nimport { c } from "./compartilhado/ok.ts";\n',
    "server/web/sub.ts": 'export type { Z } from "../../modulos/ambiente/publico.ts";\n',
    "server/web/pacotes.ts":
      'import markdownit from "markdown-it/browser";\nimport { createRoot } from "react-dom/client";\nimport { useThread } from "@assistant-ui/react";\n',
    "server/composicao/ok.ts":
      'import { a } from "../api/ok.ts";\nimport express from "express";\nimport { a } from "../../modulos/ambiente/publico.ts";\n',
    // Proibidos
    [`${SANDBOXES}/nucleo/fs.ts`]: 'import { readFileSync } from "node:fs";\n',
    [`${SANDBOXES}/infra/armazenamento.ts`]: 'import { b } from "../armazenamento/ok.ts";\n',
    "server/web/compartilhado/impuro.ts":
      'import { z } from "../../../shared/nucleo/erros.ts";\nimport { readFileSync } from "node:fs";\n',
    "server/contrato/impuro.ts":
      'import { readFileSync } from "node:fs";\nimport { l } from "../../shared/armazenamento/snapshot.ts";\n',
    "server/web/fachada_valor.ts": 'import { a } from "../../modulos/ambiente/publico.ts";\n',
    "server/web/contrato_valor.ts": 'import { Resposta } from "../contrato/ok.ts";\n',
    "server/web/nucleo_valor.ts": 'import { e } from "../../shared/nucleo/erros.ts";\n',
    "server/web/lodash.ts": 'import _ from "lodash";\n',
    "server/web/node.ts": 'import { readFileSync } from "node:fs";\n',
    "server/web/react_puro.ts": 'import { useState } from "react";\n',
    "server/web/node.test.ts":
      'import { test } from "node:test";\nimport { a } from "../../modulos/ambiente/publico.ts";\n',
    "server/cli-agente/fachada.ts": 'import { a } from "../../modulos/ambiente/publico.ts";\n',
    "server/cli-agente/shared.ts": 'import { e } from "../../shared/nucleo/erros.ts";\n',
    "server/cli-agente/sqlite.ts": 'import { DatabaseSync } from "node:sqlite";\n',
    "server/cli-agente/zod.ts": 'import { z } from "zod";\n',
    "server/api/usa_o_interior.ts": `import { a } from "../../${SANDBOXES}/armazenamento/ok.ts";\n`,
    // A consulta só lê: não chama fluxo. O fluxo não fala o contrato, não lê pela consulta nem pelo banco.
    "server/consultas/usa_o_fluxo.ts": 'import { f } from "../fluxos/fluxo.ts";\n',
    "server/fluxos/usa_o_contrato.ts": 'import type { R } from "../contrato/ok.ts";\n',
    "server/fluxos/usa_a_consulta.ts": 'import { t } from "../consultas/tela.ts";\n',
    "server/fluxos/usa_o_banco.ts": 'import { l } from "../../shared/armazenamento/snapshot.ts";\n',
    // Nenhum domínio importa o servidor, nem o contrato da API: a consulta que o devolve é do servidor.
    [`${SANDBOXES}/aplicacao/usa_o_contrato.ts`]: 'import type { R } from "../../../../server/contrato/ok.ts";\n',
    [`${SANDBOXES}/aplicacao/sql.ts`]: 'banco.prepare("SELECT 1");\nbanco.exec(`DELETE FROM a`);\n',
    // Toda pasta de src/modulos/ é um domínio declarado; fora de `modulos/`, `server/` e `shared/`, o módulo é desconhecido.
    "modulos/sem_regras/aplicacao/x.ts": "export const x = 1;\n",
    "solto.ts": "export const s = 1;\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(
    acharViolacoes(raiz, ARQUITETURA_DE_SRC).map(descrever).sort(),
    [
      `${SANDBOXES}/aplicacao/sql.ts importa SQL .exec(`,
      `${SANDBOXES}/aplicacao/sql.ts importa SQL .prepare(`,
      `${SANDBOXES}/aplicacao/usa_o_contrato.ts importa ../../../../server/contrato/ok.ts (um domínio não importa src/server/)`,
      `${SANDBOXES}/infra/armazenamento.ts importa ../armazenamento/ok.ts`,
      `${SANDBOXES}/nucleo/fs.ts importa node:fs`,
      "modulos/sem_regras/aplicacao/x.ts importa fora da organização: domínio sem_regras não declarado em fitness/fronteiras/dominios/",
      `server/api/usa_o_interior.ts importa ../../${SANDBOXES}/armazenamento/ok.ts (de fora do domínio ambiente, só pela fachada publico.ts)`,
      "server/cli-agente/fachada.ts importa ../../modulos/ambiente/publico.ts",
      "server/cli-agente/shared.ts importa ../../shared/nucleo/erros.ts",
      "server/cli-agente/sqlite.ts importa node:sqlite",
      "server/cli-agente/zod.ts importa zod",
      "server/consultas/usa_o_fluxo.ts importa ../fluxos/fluxo.ts",
      "server/consultas/usa_o_fluxo.ts importa ciclo entre módulos: consultas → fluxos → consultas",
      "server/contrato/impuro.ts importa ../../shared/armazenamento/snapshot.ts",
      "server/contrato/impuro.ts importa node:fs",
      "server/fluxos/usa_a_consulta.ts importa ../consultas/tela.ts",
      "server/fluxos/usa_o_banco.ts importa ../../shared/armazenamento/snapshot.ts",
      "server/fluxos/usa_o_contrato.ts importa ../contrato/ok.ts",
      "server/web/compartilhado/impuro.ts importa ../../../shared/nucleo/erros.ts",
      "server/web/compartilhado/impuro.ts importa node:fs",
      "server/web/contrato_valor.ts importa ../contrato/ok.ts",
      "server/web/fachada_valor.ts importa ../../modulos/ambiente/publico.ts",
      "server/web/lodash.ts importa lodash",
      "server/web/node.ts importa node:fs",
      "server/web/nucleo_valor.ts importa ../../shared/nucleo/erros.ts",
      "server/web/react_puro.ts importa react",
      "solto.ts importa módulo desconhecido: ",
    ].sort(),
  );
});

// O relógio é do `composicao` (que o injeta) e de `nucleo/relogio.ts`: `new Date(` em qualquer outro .ts de src/ (cliente web
// e compartilhado inclusive) lê a hora ou faz conta de calendário fora dele. Os *.test.ts (já fora da lista) e *_cenario.ts ficam de fora.

function acharNewDateForaDoRelogio(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter(
      (arquivo) =>
        arquivo !== ARQUIVO_DO_RELOGIO && !arquivo.startsWith(PASTA_DA_COMPOSICAO) && !arquivo.endsWith("_cenario.ts"),
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
    [`${PASTA_DA_COMPOSICAO}servico.ts`]: "const batida = new Date(inicio);\n",
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
// Cada domínio declara os seus em `processoDoHost`: as pastas do próprio Ambiente, quem importa child_process e a lista fixa
// dos chamadores diretos, cada um falando com o `gh`/`az`, o cadastro, o blame, o pdftotext, o sonar-scanner, o pi sem
// worktree ou a rede do git com credenciais.
const PROCESSO_DO_HOST = Object.values(ARQUITETURA_DE_SRC.dominios).map((regras) => regras.processoDoHost);
const PASTAS_LIBERADAS_DO_PROCESSO = PROCESSO_DO_HOST.flatMap((declarado) => declarado.pastasLiberadas);
const ARQUIVOS_COM_CHILD_PROCESS = new Set(PROCESSO_DO_HOST.flatMap((declarado) => declarado.importamChildProcess));
const CHAMADORES_DIRETOS_DO_PROCESSO = PROCESSO_DO_HOST.flatMap((declarado) => declarado.chamadoresDiretos);

const ehChildProcess = (alvo: string): boolean => /^(node:)?child_process$/.test(alvo);
const ehProcessoDoServico = (alvo: string): boolean => /(^|\/)processo\.ts$/.test(alvo);

function acharViolacoesDoProcesso(src: string, chamadoresDiretos: readonly string[]): string[] {
  const doAmbiente = (arquivo: string) => PASTAS_LIBERADAS_DO_PROCESSO.some((inicio) => arquivo.startsWith(inicio));
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
    [`${PASTAS_LIBERADAS_DO_PROCESSO[0] ?? ""}host_local/ambiente_host_local.ts`]:
      'import { spawn } from "child_process";\nimport { executar } from "../../../compartilhado/infra/processo.ts";\n',
    "modulos/repositorio/hospedagem/infra/pr.ts": 'import { executar } from "../../../../shared/infra/processo.ts";\n',
    "modulos/repositorio/commits/infra/commit.ts": 'import { exigirGitNoAmbiente } from "../../git/publico.ts";\n',
    "modulos/repositorio/espaco_de_trabalho/aplicacao/espaco_ruim.ts":
      'import { spawn } from "node:child_process";\nimport { git } from "../../../../shared/infra/processo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharViolacoesDoProcesso(raiz, ["modulos/repositorio/hospedagem/infra/pr.ts"]).sort(), [
    "modulos/repositorio/espaco_de_trabalho/aplicacao/espaco_ruim.ts importa infra/processo.ts",
    "modulos/repositorio/espaco_de_trabalho/aplicacao/espaco_ruim.ts importa node:child_process",
  ]);
});

// Só a submissão de Evidência do Processo (e o armazenamento) grava em `evidencia_demanda`: toda Evidência entra pela submissão avaliada. O
// `gravar*` das Evidências se importa do armazenamento delas, da API de Evidências ou da fachada do Ciclo de Vida.
const MONTA_EVIDENCIAS_A_PARTIR_DA_ATUAL = /evidencias:\s*\[\s*\.\.\./;

// shortcut: o padrão de lista é textual, então também acusa o literal dentro de comentário ou string; nenhum existe hoje em src/.
function acharGravacoesDeEvidenciaForaDeSubmeter(src: string): string[] {
  return listarArquivosDeProducao(src)
    .filter(
      (arquivo) =>
        arquivo !== ARQUIVO_QUE_SUBMETE_EVIDENCIA &&
        moduloDe(arquivo) !== "armazenamento" &&
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
        const especificador = declaracao.moduleSpecifier.text;
        const entrada = ENTRADAS_DO_ARMAZENAMENTO_DE_EVIDENCIA.find((caminho) => especificador.endsWith(caminho));
        if (entrada === undefined) continue;
        const ligacoes = declaracao.importClause?.namedBindings;
        if (!ligacoes || !ts.isNamedImports(ligacoes)) continue;
        for (const nome of ligacoes.elements.map((elemento) => (elemento.propertyName ?? elemento.name).text)) {
          if (nome.startsWith("gravar")) achados.push(`${arquivo} importa ${nome} de ${entrada}`);
        }
      }
      return achados;
    });
}

test("só a submissão do Processo e o armazenamento gravam em evidencia_demanda", () => {
  assert.deepEqual(acharGravacoesDeEvidenciaForaDeSubmeter(SRC), []);
});

test("a fitness de gravação de evidência acusa o arquivo que monta a lista ou importa gravar* e aceita o resto", (t) => {
  const EVIDENCIAS = "modulos/ciclo_de_vida/evidencias";
  const CONDUCAO = "modulos/ciclo_de_vida/conducao/aplicacao";
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-evidencia-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_QUE_SUBMETE_EVIDENCIA]: "const x = { ...ag, evidencias: [...ag.evidencias, nova] };\n",
    [`${EVIDENCIAS}/${ARMAZENAMENTO_DE_EVIDENCIA}`]: "export function gravarAnexos() {}\n",
    [`${EVIDENCIAS}/armazenamento/outro.ts`]: `import { gravarAnexos } from "../${ARMAZENAMENTO_DE_EVIDENCIA}";\nconst x = { evidencias: [...a.evidencias] };\n`,
    [`${CONDUCAO}/monta_lista.ts`]: "const x = { ...ag, evidencias: [...ag.evidencias, nova] };\n",
    [`${CONDUCAO}/importa_gravar.ts`]: `import { gravarAnexos as gravar } from "../../evidencias/${ARMAZENAMENTO_DE_EVIDENCIA}";\n`,
    [`${CONDUCAO}/le_anexos.ts`]: `import { anexosDaDemanda } from "../../evidencias/${ARMAZENAMENTO_DE_EVIDENCIA}";\nconst x = { evidencias: [] };\n`,
    [`${CONDUCAO}/gravar_de_outro.ts`]: 'import { gravarAnexos } from "../../evidencias/armazenamento/outro.ts";\n',
    [`${CONDUCAO}/gravar_pela_fachada.ts`]: 'import { gravarAnexos } from "../../../ciclo_de_vida/publico.ts";\n',
    [`${CONDUCAO}/le_pela_api.ts`]: 'import { lerAnexo } from "../../evidencias/publico.ts";\n',
    [`${CONDUCAO}/teste_que_grava.test.ts`]: "const x = { evidencias: [...ag.evidencias] };\n",
    [`${CONDUCAO}/montagem_cenario.ts`]: "const x = { evidencias: [...ag.evidencias] };\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharGravacoesDeEvidenciaForaDeSubmeter(raiz).sort(), [
    `${CONDUCAO}/gravar_pela_fachada.ts importa gravarAnexos de ciclo_de_vida/publico.ts`,
    `${CONDUCAO}/importa_gravar.ts importa gravarAnexos de ${ARMAZENAMENTO_DE_EVIDENCIA}`,
    `${CONDUCAO}/monta_lista.ts monta evidencias a partir da lista atual`,
  ]);
});

// Os domínios de src/ (as duas primeiras pastas, `modulos/<domínio>` e `server/<parte>`, e o shared inteiro) não formam
// ciclo de import, de valor ou de tipo.
test("os domínios de src/ não formam ciclo de import", () => {
  assert.deepEqual(acharCiclosEntreDominios(SRC), []);
});

test("a fitness de ciclos entre domínios acusa o ciclo, de valor ou de tipo, e ignora os testes", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-dominios-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    "modulos/processo/nucleo/gate.ts": 'import { Demanda } from "../../pedidos/nucleo/demanda.ts";\n',
    "modulos/pedidos/nucleo/demanda.ts": 'import type { Gate } from "../../processo/nucleo/gate.ts";\n',
    "modulos/pedidos/aplicacao/tela.tsx": 'import { c } from "../../../server/contrato/x.ts";\n',
    "server/contrato/x.ts": 'import { z } from "zod";\n',
    "server/api/rota.ts":
      'import { a } from "../../modulos/pedidos/nucleo/demanda.ts";\nimport { c } from "../contrato/x.ts";\n',
    "modulos/processo/nucleo/gate.test.ts": 'import { r } from "../../../server/api/rota.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz), [
    "ciclo entre módulos: modulos/pedidos → modulos/processo → modulos/pedidos",
  ]);
});

// O nome de cada Etapa (os valores de EtapaTicket) como dado, em literal de texto, chave de objeto (`{ planejar: … }`) ou
// entre aspas simples no SQL de um literal ou template (`etapa = 'planejar'`), só nas pastas de Etapas e da Condução
// (PASTAS_QUE_CITAM_NOME_DE_ETAPA) e nas migrações, que guardam o esquema do passado; os demais perguntam ao catálogo. A
// lista dos arquivos tolerados fica vazia; arquivo novo citando o nome falha, e arquivo da lista que deixou de citar também.
const NOMES_DE_ETAPA = new Set<string>(EtapaTicket.options);
const NOME_DE_ETAPA_NO_SQL = new RegExp(`'(${[...NOMES_DE_ETAPA].join("|")})'`);
const PASTAS_LIBERADAS_PARA_NOME_DE_ETAPA = [
  ...PASTAS_QUE_CITAM_NOME_DE_ETAPA,
  PASTA_DO_HISTORICO_DO_ESQUEMA,
  ...MIGRACOES_DOS_DOMINIOS,
];

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

test("nome de Etapa só nas pastas das Etapas e nas migrações", () => {
  assert.deepEqual(
    acharArquivosQueCitamNomeDeEtapa(SRC).filter(
      (arquivo) =>
        !PASTAS_LIBERADAS_PARA_NOME_DE_ETAPA.some((pasta) => arquivo.startsWith(pasta)) &&
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

function acharVoltasPorValor(src: string, arquivoVigiado: string, nomeDoVigiado: string): string[] {
  const importadosPorValor = (arquivo: string): string[] => {
    const caminho = join(src, arquivo);
    const fonte = ts.createSourceFile(caminho, readFileSync(caminho, "utf8"), ts.ScriptTarget.Latest);
    const soDeTipo = acharEspecificadoresSoDeTipo(fonte);
    return acharEspecificadoresDe(src, arquivo)
      .filter((alvo) => alvo.startsWith(".") && !soDeTipo.has(alvo))
      .map((alvo) => relative(src, resolve(dirname(caminho), alvo)));
  };
  const fecho = [arquivoVigiado];
  for (const arquivo of fecho) {
    for (const alvo of importadosPorValor(arquivo)) if (!fecho.includes(alvo)) fecho.push(alvo);
  }
  return fecho
    .filter((arquivo) => importadosPorValor(arquivo).includes(arquivoVigiado))
    .map((arquivo) => `${arquivo} importa ${nomeDoVigiado}, que o importa por valor`);
}

const acharVoltasAoCatalogo = (src: string): string[] => acharVoltasPorValor(src, ARQUIVO_DO_CATALOGO, "o catálogo");

test("o catálogo de Etapas não está num ciclo de import de valor", () => {
  assert.deepEqual(acharVoltasAoCatalogo(SRC), []);
});

// A fachada de um domínio que estivesse num ciclo de import de valor seria lida ainda pela metade (TDZ) por quem sobe antes
// dela no ciclo, conforme o ponto de entrada: com as APIs de todos os subdomínios na fachada, nenhuma pode estar num ciclo.
test("a fachada de cada domínio não está num ciclo de import de valor", () => {
  const fachadas = Object.keys(ARQUITETURA_DE_SRC.dominios)
    .filter((dominio) => dominio !== "server" && dominio !== "shared")
    .map((dominio) => `modulos/${dominio}/publico.ts`);
  assert.ok(fachadas.includes("modulos/ciclo_de_vida/publico.ts"));
  assert.deepEqual(
    fachadas.flatMap((fachada) => acharVoltasPorValor(SRC, fachada, `a fachada ${fachada}`)),
    [],
  );
});

test("a fitness do catálogo acusa a volta por valor e aceita a de tipo", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-catalogo-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    [ARQUIVO_DO_CATALOGO]: 'import { D } from "./planejar/definicao.ts";\nimport type { T } from "./tipo.ts";\n',
    "modulos/ciclo_de_vida/etapas/nucleo/planejar/definicao.ts":
      'import { c } from "../../../processo/nucleo/ciclos.ts";\n',
    "modulos/ciclo_de_vida/etapas/nucleo/tipo.ts": 'import { C } from "./catalogo.ts";\n',
    "modulos/ciclo_de_vida/processo/nucleo/ciclos.ts": 'import { CATALOGO } from "../../etapas/nucleo/catalogo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharVoltasAoCatalogo(raiz), [
    "modulos/ciclo_de_vida/processo/nucleo/ciclos.ts importa o catálogo, que o importa por valor",
  ]);
});
