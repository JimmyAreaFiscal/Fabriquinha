// Fitness function: os módulos de src/ dependem numa só direção, sem ciclo, e só `armazenamento` fala SQL.
// O motor e as regras ficam em fitness/fronteiras/: a matriz das camadas do legado (legado.ts) e um arquivo de regras por
// domínio de destino (dominios/<domínio>.ts); o topo de fronteiras/motor.ts diz como um ticket declara o seu domínio migrado.
// Violação que ainda existe vira exceção no arquivo do domínio, com o ticket que a remove; a que deixou de existir também falha.
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
  PASTA_DO_HISTORICO_DO_ESQUEMA,
} from "./fronteiras/dominios/shared.ts";
import {
  acharCiclosEntreDominios,
  acharEspecificadoresDe,
  acharEspecificadoresSoDeTipo,
  acharImportadoresDe,
  acharToleranciasVencidas,
  acharViolacoes,
  type DependenciaToleradaEntreDominios,
  dependenciasToleradasDe,
  descrever,
  excecoesDe,
  listarArquivosDeProducao,
  moduloDoArquivo,
} from "./fronteiras/motor.ts";

const SRC = resolve(import.meta.dirname, "../src");
const EXCECOES = excecoesDe(ARQUITETURA_DE_SRC);
const moduloDe = (caminhoRelativoASrc: string) => moduloDoArquivo(caminhoRelativoASrc, ARQUITETURA_DE_SRC);

test("src respeita a matriz de dependências, não tem ciclo e só armazenamento fala SQL (fora das exceções datadas)", () => {
  const listadas = new Set(EXCECOES.map(descrever));
  assert.deepEqual(
    acharViolacoes(SRC, ARQUITETURA_DE_SRC, EXCECOES)
      .map(descrever)
      .filter((descricao) => !listadas.has(descricao)),
    [],
  );
});

test("toda exceção listada ainda existe no código", () => {
  const existentes = new Set(acharViolacoes(SRC, ARQUITETURA_DE_SRC, []).map(descrever));
  assert.deepEqual(
    EXCECOES.map(descrever).filter((descricao) => !existentes.has(descricao)),
    [],
  );
});

test("toda exceção cita arquivo, import e um ticket de 04 a 22", () => {
  for (const excecao of EXCECOES) {
    assert.ok(excecao.arquivo && excecao.import, `exceção sem arquivo ou import: ${JSON.stringify(excecao)}`);
    assert.match(excecao.ticket, /^(0[4-9]|1\d|2[0-2])$/, `${descrever(excecao)}: ticket ${excecao.ticket}`);
  }
});

test("a API não importa armazenamento nem chama .prepare(, nem por exceção", () => {
  const daApi = acharViolacoes(SRC, ARQUITETURA_DE_SRC, []).filter(({ arquivo }) => arquivo.startsWith("server/api/"));
  assert.deepEqual(daApi.map(descrever), []);
});

// A matriz libera `aplicacao` inteira à API; a API do agente só alcança os casos de uso do agente.
test("api/agente só importa de aplicacao o etapas/agente", () => {
  const daApiDoAgente = listarArquivosDeProducao(SRC).filter((arquivo) => arquivo.startsWith(PASTA_DA_API_DO_AGENTE));
  assert.ok(daApiDoAgente.length > 0);
  const deAplicacaoFora = daApiDoAgente.flatMap((arquivo) => {
    const caminho = join(SRC, arquivo);
    return ts
      .preProcessFile(readFileSync(caminho, "utf8"), true, true)
      .importedFiles.map(({ fileName: alvo }) => relative(SRC, resolve(dirname(caminho), alvo)))
      .filter((alvo) => moduloDe(alvo) === "aplicacao" && !alvo.startsWith(PASTA_DOS_CASOS_DE_USO_DO_AGENTE))
      .map((alvo) => `${arquivo} importa ${alvo}`);
  });
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
  const arquivos: Record<string, string> = {
    // Permitidos
    "modulos/nucleo/ok.ts":
      'import { z } from "zod";\nimport { isAbsolute } from "node:path";\nexport { Y } from "./sub/y.ts";\n',
    "modulos/nucleo/sub/y.ts": 'import { z } from "../ok.ts";\n',
    "modulos/nucleo/ruim.test.ts": 'import { test } from "node:test";\nimport { x } from "node:fs";\n',
    "modulos/armazenamento/ok.ts":
      'import { z } from "../nucleo/ok.ts";\nimport { DatabaseSync } from "node:sqlite";\nbanco.exec("CREATE TABLE a (b)");\nbanco.prepare("SELECT 1");\n',
    "modulos/aplicacao/ok.ts":
      'import { a } from "../armazenamento/ok.ts";\nimport { b } from "../infra/ok.ts";\nconst achou = /a/.exec(texto);\n',
    "modulos/infra/ok.ts": 'import { spawn } from "node:child_process";\nimport { z } from "../nucleo/ok.ts";\n',
    "server/web/compartilhado/ok.ts": "export const c = 1;\n",
    "server/contrato/ok.ts": 'import { z } from "zod";\nimport { Id } from "../../modulos/nucleo/ok.ts";\n',
    "server/cli-agente/ok.ts":
      'import { Resposta } from "../contrato/ok.ts";\nimport { readFileSync } from "node:fs";\nimport { b } from "./sub.ts";\n',
    "server/api/ok.ts":
      'import { a } from "../../modulos/aplicacao/ok.ts";\nimport { c } from "../web/compartilhado/ok.ts";\nimport { Resposta } from "../contrato/ok.ts";\nimport { t } from "../consultas/tela.ts";\nimport { f } from "../fluxos/fluxo.ts";\n',
    "server/cli/ok.ts": 'import { t } from "../consultas/tela.ts";\nimport { f } from "../fluxos/fluxo.ts";\n',
    // A consulta da tela junta os domínios no formato do contrato, pelas fachadas (fronteiras-de-destino.test.ts).
    "server/consultas/tela.ts": 'import type { R } from "../contrato/ok.ts";\n',
    // O fluxo coordena os domínios pela fachada (no legado, a aplicação).
    "server/fluxos/fluxo.ts":
      'import { a } from "../../modulos/aplicacao/ok.ts";\nimport { n } from "../../modulos/nucleo/ok.ts";\n',
    "server/web/ok.ts":
      'import type { N } from "../../modulos/nucleo/ok.ts";\nimport type { R } from "../contrato/ok.ts";\nimport { b } from "./sub.ts";\nimport { c } from "./compartilhado/ok.ts";\n',
    "server/web/sub.ts": 'export type { Z } from "../../modulos/nucleo/ok.ts";\n',
    "server/web/pacotes.ts":
      'import markdownit from "markdown-it/browser";\nimport { createRoot } from "react-dom/client";\nimport { useThread } from "@assistant-ui/react";\n',
    "server/composicao/ok.ts":
      'import { a } from "../api/ok.ts";\nimport express from "express";\nimport { HarnessPi } from "../../modulos/harness/pi/harness_pi.ts";\n',
    "modulos/harness/harness.ts":
      'import type { N } from "../nucleo/ok.ts";\nimport type { Ambiente } from "../infra/ok.ts";\nexport interface Harness { n: N }\n',
    "modulos/harness/pi/harness_pi.ts":
      'import type { Harness } from "../harness.ts";\nimport { b } from "../../infra/ok.ts";\nimport { existsSync } from "node:fs";\n',
    "modulos/aplicacao/usa_o_harness.ts": 'import type { Harness } from "../harness/harness.ts";\n',
    "modulos/etapas/catalogo.ts": 'import { D } from "./planejar/definicao.ts";\n',
    "modulos/etapas/definicao/definicao_da_etapa.ts":
      'import { z } from "zod";\nimport type { N } from "../../nucleo/ok.ts";\n',
    "modulos/etapas/planejar/definicao.ts": 'import { evidencia } from "../definicao/definicao_da_etapa.ts";\n',
    "modulos/etapas/planejar/gate.ts": 'import { n } from "../../nucleo/ok.ts";\nimport { D } from "./definicao.ts";\n',
    "modulos/etapas/planejar/conducao_de_planejar.ts":
      'import { D } from "./definicao.ts";\nimport { a } from "../../armazenamento/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "modulos/nucleo/le_o_catalogo.ts": 'import { C } from "../etapas/catalogo.ts";\n',
    // Proibidos
    "modulos/nucleo/fs.ts": 'import { readFileSync } from "node:fs";\n',
    "modulos/infra/armazenamento.ts": 'import { b } from "../armazenamento/ok.ts";\n',
    "server/web/compartilhado/impuro.ts":
      'import { z } from "../../../modulos/nucleo/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "server/contrato/impuro.ts":
      'import { readFileSync } from "node:fs";\nimport { a } from "../../modulos/armazenamento/ok.ts";\n',
    "server/web/aplicacao_tipo.ts": 'import type { B } from "../../modulos/aplicacao/ok.ts";\n',
    "server/web/aplicacao_valor.ts": 'import { a } from "../../modulos/aplicacao/ok.ts";\n',
    "server/web/contrato_valor.ts": 'import { Resposta } from "../contrato/ok.ts";\n',
    "server/web/nucleo_valor.ts": 'import { n } from "../../modulos/nucleo/ok.ts";\n',
    "server/web/lodash.ts": 'import _ from "lodash";\n',
    "server/web/node.ts": 'import { readFileSync } from "node:fs";\n',
    "server/web/react_puro.ts": 'import { useState } from "react";\n',
    "server/web/node.test.ts":
      'import { test } from "node:test";\nimport { a } from "../../modulos/aplicacao/ok.ts";\n',
    "server/cli-agente/aplicacao.ts": 'import { a } from "../../modulos/aplicacao/ok.ts";\n',
    "server/cli-agente/armazenamento.ts": 'import { a } from "../../modulos/armazenamento/ok.ts";\n',
    "server/cli-agente/nucleo.ts": 'import { n } from "../../modulos/nucleo/ok.ts";\n',
    "server/cli-agente/sqlite.ts": 'import { DatabaseSync } from "node:sqlite";\n',
    "server/cli-agente/zod.ts": 'import { z } from "zod";\n',
    "modulos/aplicacao/ciclo.ts": 'import { a } from "../../server/api/ciclo.ts";\n',
    "server/api/ciclo.ts": 'import { a } from "../../modulos/aplicacao/ciclo.ts";\n',
    "server/api/usa_o_banco.ts": 'import { a } from "../../modulos/armazenamento/ok.ts";\n',
    // A consulta só lê: não chama fluxo. O fluxo não fala o contrato, não lê pela consulta nem pelo banco.
    "server/consultas/usa_o_fluxo.ts": 'import { f } from "../fluxos/fluxo.ts";\n',
    // A consulta não lê o código antigo, em camada nenhuma: nem o banco, nem a aplicação.
    "server/consultas/usa_o_banco.ts":
      'import { a } from "../../modulos/armazenamento/ok.ts";\nimport { b } from "../../modulos/aplicacao/ok.ts";\n',
    "server/fluxos/usa_o_contrato.ts": 'import type { R } from "../contrato/ok.ts";\n',
    "server/fluxos/usa_a_consulta.ts": 'import { t } from "../consultas/tela.ts";\n',
    "server/fluxos/usa_o_banco.ts": 'import { a } from "../../modulos/armazenamento/ok.ts";\n',
    // Nenhum domínio importa o contrato da API: a consulta que o devolve é da API.
    "modulos/aplicacao/usa_o_contrato.ts": 'import type { R } from "../../server/contrato/ok.ts";\n',
    "modulos/aplicacao/sql.ts": 'banco.prepare("SELECT 1");\nbanco.exec(`DELETE FROM a`);\n',
    "modulos/aplicacao/usa_o_pi.ts": 'import { HarnessPi } from "../harness/pi/harness_pi.ts";\n',
    "modulos/harness/valor.ts": 'import { b } from "../infra/ok.ts";\nimport { readFileSync } from "node:fs";\n',
    "modulos/harness/pi/armazenamento.ts": 'import { a } from "../../armazenamento/ok.ts";\n',
    "modulos/etapas/implementar/definicao.ts":
      'import { C } from "./conducao_de_implementar.ts";\nimport { readFileSync } from "node:fs";\n',
    // A seção do prompt é da condução, que lê o contexto do motor: a definição que a traz deixa de ser valor puro.
    "modulos/etapas/revisar_rodada/definicao.ts": 'import { s } from "./secao_do_prompt.ts";\n',
    // Fora de `modulos/` e `server/`, o arquivo é de módulo desconhecido.
    "solto.ts": "export const s = 1;\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(
    acharViolacoes(raiz, ARQUITETURA_DE_SRC, []).map(descrever).sort(),
    [
      "modulos/aplicacao/ciclo.ts importa ciclo entre módulos: aplicacao → api → aplicacao",
      "modulos/aplicacao/ciclo.ts importa ciclo entre módulos: aplicacao → api → consultas → aplicacao",
      "modulos/aplicacao/ciclo.ts importa ciclo entre módulos: aplicacao → api → consultas → fluxos → aplicacao",
      // A definição que importa a condução põe o núcleo a depender da aplicação: além do import, fecha ciclo.
      "modulos/aplicacao/ciclo.ts importa ciclo entre módulos: aplicacao → api → web/compartilhado → nucleo → aplicacao",
      "modulos/aplicacao/ciclo.ts importa ../../server/api/ciclo.ts",
      "modulos/aplicacao/usa_o_contrato.ts importa ../../server/contrato/ok.ts",
      "server/api/usa_o_banco.ts importa ../../modulos/armazenamento/ok.ts",
      "server/consultas/usa_o_banco.ts importa ../../modulos/aplicacao/ok.ts",
      "server/consultas/usa_o_banco.ts importa ../../modulos/armazenamento/ok.ts",
      "server/consultas/usa_o_fluxo.ts importa ../fluxos/fluxo.ts",
      "server/consultas/usa_o_fluxo.ts importa ciclo entre módulos: consultas → fluxos → consultas",
      "server/fluxos/usa_o_contrato.ts importa ../contrato/ok.ts",
      "server/fluxos/usa_a_consulta.ts importa ../consultas/tela.ts",
      "server/fluxos/usa_o_banco.ts importa ../../modulos/armazenamento/ok.ts",
      "modulos/aplicacao/sql.ts importa SQL .exec(",
      "modulos/aplicacao/sql.ts importa SQL .prepare(",
      "modulos/aplicacao/usa_o_pi.ts importa ../harness/pi/harness_pi.ts",
      "modulos/harness/pi/armazenamento.ts importa ../../armazenamento/ok.ts",
      "modulos/harness/valor.ts importa ../infra/ok.ts",
      "modulos/harness/valor.ts importa node:fs",
      "server/cli-agente/aplicacao.ts importa ../../modulos/aplicacao/ok.ts",
      "server/cli-agente/armazenamento.ts importa ../../modulos/armazenamento/ok.ts",
      "server/cli-agente/nucleo.ts importa ../../modulos/nucleo/ok.ts",
      "server/cli-agente/sqlite.ts importa node:sqlite",
      "server/cli-agente/zod.ts importa zod",
      "server/web/aplicacao_tipo.ts importa ../../modulos/aplicacao/ok.ts",
      "server/web/aplicacao_valor.ts importa ../../modulos/aplicacao/ok.ts",
      "server/web/compartilhado/impuro.ts importa ../../../modulos/nucleo/ok.ts",
      "server/web/compartilhado/impuro.ts importa node:fs",
      "server/contrato/impuro.ts importa ../../modulos/armazenamento/ok.ts",
      "server/contrato/impuro.ts importa node:fs",
      "server/web/contrato_valor.ts importa ../contrato/ok.ts",
      "server/web/lodash.ts importa lodash",
      "server/web/node.ts importa node:fs",
      "server/web/nucleo_valor.ts importa ../../modulos/nucleo/ok.ts",
      "server/web/react_puro.ts importa react",
      "modulos/etapas/implementar/definicao.ts importa ./conducao_de_implementar.ts",
      "modulos/etapas/implementar/definicao.ts importa node:fs",
      "modulos/etapas/revisar_rodada/definicao.ts importa ./secao_do_prompt.ts",
      "modulos/infra/armazenamento.ts importa ../armazenamento/ok.ts",
      "modulos/nucleo/fs.ts importa node:fs",
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

// Só `submeter.ts` (e o armazenamento) grava em `evidencia_demanda`: toda Evidência entra pela submissão avaliada. O
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
    [`modulos/${ARMAZENAMENTO_DE_EVIDENCIA}`]: "export function gravarAnexos() {}\n",
    "modulos/armazenamento/outro.ts": `import { gravarAnexos } from "../${ARMAZENAMENTO_DE_EVIDENCIA}";\nconst x = { evidencias: [...a.evidencias] };\n`,
    "modulos/aplicacao/monta_lista.ts": "const x = { ...ag, evidencias: [...ag.evidencias, nova] };\n",
    "modulos/aplicacao/importa_gravar.ts": `import { gravarAnexos as gravar } from "../${ARMAZENAMENTO_DE_EVIDENCIA}";\n`,
    "modulos/aplicacao/le_anexos.ts": `import { anexosDaDemanda } from "../${ARMAZENAMENTO_DE_EVIDENCIA}";\nconst x = { evidencias: [] };\n`,
    "modulos/aplicacao/gravar_de_outro.ts": 'import { gravarAnexos } from "../armazenamento/outro.ts";\n',
    "modulos/aplicacao/gravar_pela_fachada.ts": 'import { gravarAnexos } from "../ciclo_de_vida/publico.ts";\n',
    "modulos/aplicacao/le_pela_api.ts": 'import { lerAnexo } from "../ciclo_de_vida/evidencias/publico.ts";\n',
    "modulos/aplicacao/teste_que_grava.test.ts": "const x = { evidencias: [...ag.evidencias] };\n",
    "modulos/aplicacao/montagem_cenario.ts": "const x = { evidencias: [...ag.evidencias] };\n",
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharGravacoesDeEvidenciaForaDeSubmeter(raiz).sort(), [
    "modulos/aplicacao/gravar_pela_fachada.ts importa gravarAnexos de ciclo_de_vida/publico.ts",
    `modulos/aplicacao/importa_gravar.ts importa gravarAnexos de ${ARMAZENAMENTO_DE_EVIDENCIA}`,
    "modulos/aplicacao/monta_lista.ts monta evidencias a partir da lista atual",
  ]);
});

// Os domínios de src/ (as duas primeiras pastas, `modulos/<domínio>` e `server/<parte>`, e o shared inteiro) não formam
// ciclo de import, de valor ou de tipo. A migração SDLC por seams tolerava aqui, com o passo que a removia, a dependência
// que fechava ciclo; desde o passo 6 não resta nenhuma. Na refatoração em módulos, a dependência tolerada fica no arquivo
// do domínio (`dependenciasToleradas`), com o ticket que a remove; fora do grafo, e se sumir do código ou deixar de fechar
// ciclo, a fitness também falha.
const DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS = dependenciasToleradasDe(ARQUITETURA_DE_SRC);

test("os domínios de src/ não formam ciclo de import fora das dependências toleradas", () => {
  assert.deepEqual(acharCiclosEntreDominios(SRC, ARQUITETURA_DE_SRC, DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS), []);
});

test("toda dependência tolerada entre domínios ainda existe e ainda fecha ciclo", () => {
  assert.deepEqual(acharToleranciasVencidas(SRC, ARQUITETURA_DE_SRC, DEPENDENCIAS_TOLERADAS_ENTRE_DOMINIOS), []);
});

test("a fitness de ciclos entre domínios acusa o ciclo novo, de valor ou de tipo, e a tolerância vencida", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-dominios-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    "modulos/fluxo/nucleo/gate.ts": 'import { Demanda } from "../../demanda/nucleo/demanda.ts";\n',
    "modulos/demanda/nucleo/demanda.ts": 'import type { Gate } from "../../fluxo/nucleo/gate.ts";\n',
    "modulos/demanda/aplicacao/tela.tsx": 'import { c } from "../../../server/contrato/x.ts";\n',
    "server/contrato/x.ts": 'import { z } from "zod";\n',
    "server/api/rota.ts":
      'import { a } from "../../modulos/demanda/nucleo/demanda.ts";\nimport { c } from "../contrato/x.ts";\n',
    "modulos/fluxo/nucleo/gate.test.ts": 'import { r } from "../../../server/api/rota.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz, ARQUITETURA_DE_SRC, []), [
    "ciclo entre módulos: modulos/demanda → modulos/fluxo → modulos/demanda",
  ]);
  const toleradas: DependenciaToleradaEntreDominios[] = [
    { de: "modulos/demanda", para: "modulos/fluxo", removidaEm: "5" },
    { de: "server/api", para: "modulos/demanda", removidaEm: "6" },
    { de: "modulos/execucao", para: "modulos/fluxo", removidaEm: "5" },
  ];
  assert.deepEqual(acharCiclosEntreDominios(raiz, ARQUITETURA_DE_SRC, toleradas), []);
  assert.deepEqual(acharToleranciasVencidas(raiz, ARQUITETURA_DE_SRC, toleradas), [
    "server/api → modulos/demanda",
    "modulos/execucao → modulos/fluxo",
  ]);
});

test("o que as Etapas declaram é um domínio embaixo do motor, e o resto de etapas/ fica em cima dele", (t) => {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-declaracoes-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  const arquivos: Record<string, string> = {
    // O motor lê o catálogo, a definição comum e a de cada Etapa; a condução usa o motor.
    "modulos/sdlc/nucleo/ciclos.ts":
      'import { C } from "../../etapas/catalogo.ts";\nimport type { D } from "../../etapas/definicao/definicao_da_etapa.ts";\n',
    "modulos/sdlc/aplicacao/despacho.ts": 'import { P } from "../../etapas/planejar/definicao.ts";\n',
    "modulos/etapas/catalogo.ts":
      'import { P } from "./planejar/definicao.ts";\nimport { e } from "../compartilhado/nucleo/erros.ts";\n',
    "modulos/etapas/planejar/conducao_de_planejar.ts": 'import { c } from "../../sdlc/nucleo/ciclos.ts";\n',
    "modulos/compartilhado/nucleo/erros.ts": "export const e = 1;\n",
    // A definição que lê o motor, e o motor que lê a condução, fecham ciclo.
    "modulos/etapas/planejar/definicao.ts": 'import type { A } from "../../sdlc/nucleo/agregado.ts";\n',
    "modulos/sdlc/nucleo/agregado.ts": 'import { C } from "../../etapas/catalogo.ts";\n',
    "modulos/sdlc/aplicacao/conduz.ts": 'import { C } from "../../etapas/planejar/conducao_de_planejar.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharCiclosEntreDominios(raiz, ARQUITETURA_DE_SRC, []).sort(), [
    "ciclo entre módulos: modulos/etapas/definicao → modulos/sdlc → modulos/etapas/definicao",
    "ciclo entre módulos: modulos/sdlc → modulos/etapas → modulos/sdlc",
  ]);
  rmSync(join(raiz, "modulos/etapas/planejar/definicao.ts"));
  rmSync(join(raiz, "modulos/sdlc/aplicacao/conduz.ts"));
  writeFileSync(
    join(raiz, "modulos/etapas/planejar/definicao.ts"),
    'import { e } from "../../compartilhado/nucleo/erros.ts";\n',
  );
  assert.deepEqual(acharCiclosEntreDominios(raiz, ARQUITETURA_DE_SRC, []), []);
});

// O nome de cada Etapa (os valores de EtapaTicket) como dado, em literal de texto, chave de objeto (`{ planejar: … }`) ou
// entre aspas simples no SQL de um literal ou template (`etapa = 'planejar'`), só em src/modulos/etapas/ e nas migrações, que
// guardam o esquema do passado. A catraca encolheu a cada passo da migração SDLC por seams: o motor (sdlc/,
// trabalho_agentico/, projeto/, repositorio/, verificacao/, avaliacao/) pergunta ao catálogo desde o passo 4b, os enums
// de Etapa, de Gate e de estado saem do catálogo desde o 4c, as Métricas desde o 5 e, desde o 6, a API, a web (que lê as
// Etapas de `GET /api/etapas`) e o SQL do Trabalho Agêntico. A lista dos arquivos tolerados fica vazia; arquivo novo
// citando o nome falha, e arquivo da lista que deixou de citar também.
const NOMES_DE_ETAPA = new Set<string>(EtapaTicket.options);
const NOME_DE_ETAPA_NO_SQL = new RegExp(`'(${[...NOMES_DE_ETAPA].join("|")})'`);
const PASTAS_LIBERADAS_PARA_NOME_DE_ETAPA = [...PASTAS_QUE_CITAM_NOME_DE_ETAPA, PASTA_DO_HISTORICO_DO_ESQUEMA];

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
    "modulos/ciclo_de_vida/etapas/nucleo/planejar/definicao.ts":
      'import { c } from "../../../../sdlc/nucleo/ciclos.ts";\n',
    "modulos/ciclo_de_vida/etapas/nucleo/tipo.ts": 'import { C } from "./catalogo.ts";\n',
    "modulos/sdlc/nucleo/ciclos.ts": 'import { CATALOGO } from "../../ciclo_de_vida/etapas/nucleo/catalogo.ts";\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }

  assert.deepEqual(acharVoltasAoCatalogo(raiz), [
    "modulos/sdlc/nucleo/ciclos.ts importa o catálogo, que o importa por valor",
  ]);
});
