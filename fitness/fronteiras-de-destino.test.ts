// Fitness function: as regras dos domínios de destino (MELHORIAS §3 e §4), que o motor de fitness/fronteiras/motor.ts
// aplica a cada domínio declarado `migrado` em fitness/fronteiras/dominios/. Como nenhum domínio de src/modulos/ migrou
// ainda, o motor é provado aqui com domínios sintéticos em pasta temporária; em src/, quem o roda é fronteiras.test.ts.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test, type TestContext } from "node:test";
import { ARQUITETURA_DE_SRC } from "./fronteiras/arquitetura.ts";
import {
  acharCiclosDeclarados,
  acharCiclosEntreDominios,
  acharViolacoes,
  type Arquitetura,
  descrever,
  type RegrasDoDominio,
} from "./fronteiras/motor.ts";

const regrasSinteticas = (declaradas: Partial<RegrasDoDominio>): RegrasDoDominio => ({
  migrado: true,
  dependeDe: [],
  subdominios: {},
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  processoDoHost: { pastasLiberadas: [], importamChildProcess: [], chamadoresDiretos: [] },
  ...declaradas,
});

// As matrizes e o servidor de src/, com domínios sintéticos: Ambiente na base, Sessões em cima dele.
const ARQUITETURA_SINTETICA: Arquitetura = {
  ...ARQUITETURA_DE_SRC,
  dominios: {
    ambiente: regrasSinteticas({ subdominios: { sandboxes: ["redes"], redes: [] } }),
    sessoes: regrasSinteticas({ dependeDe: ["ambiente"], subdominios: { execucao: ["historico"], historico: [] } }),
    server: regrasSinteticas({ dependeDe: ["ambiente", "sessoes"] }),
    shared: regrasSinteticas({}),
  },
};

function criarArquivos(t: TestContext, arquivos: Record<string, string>): string {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-fitness-destino-"));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  return raiz;
}

const DO_SHARED = "../../../../shared/nucleo/erros.ts";

test("a fitness dos domínios migrados acusa o import fora das fachadas, das APIs e das camadas, de valor ou de tipo", (t) => {
  const raiz = criarArquivos(t, {
    // Permitidos
    "shared/nucleo/erros.ts": 'import { z } from "zod";\n',
    "shared/armazenamento/banco.ts": 'import { e } from "../nucleo/erros.ts";\nbanco.prepare("SELECT 1");\n',
    "modulos/ambiente/publico.ts":
      'export { criar } from "./sandboxes/publico.ts";\nexport type { Rede } from "./redes/publico.ts";\n',
    "modulos/ambiente/sandboxes/publico.ts":
      'export { criar } from "./aplicacao/criar.ts";\nimport { r } from "../redes/publico.ts";\n',
    "modulos/ambiente/sandboxes/aplicacao/criar.ts": `import { s } from "../nucleo/sandbox.ts";\nimport { a } from "../armazenamento/sandboxes.ts";\nimport { r } from "../../redes/publico.ts";\nimport { e } from "${DO_SHARED}";\nimport { spawn } from "node:child_process";\n`,
    "modulos/ambiente/sandboxes/nucleo/sandbox.ts": `import { e } from "${DO_SHARED}";\nimport { z } from "zod";\n`,
    "modulos/ambiente/sandboxes/armazenamento/sandboxes.ts": `import { s } from "../nucleo/sandbox.ts";\nimport { b } from "../../../../shared/armazenamento/banco.ts";\nbanco.prepare("SELECT 1");\n`,
    "modulos/ambiente/redes/publico.ts": "export const r = 1;\n",
    "modulos/sessoes/execucao/aplicacao/lancar.ts":
      'import { criar } from "../../../ambiente/publico.ts";\nimport { h } from "../../historico/publico.ts";\n',
    "modulos/sessoes/historico/publico.ts": "export const h = 1;\n",
    "modulos/sdlc/aplicacao/usa_a_fachada.ts": 'import { criar } from "../../ambiente/publico.ts";\n',
    "modulos/sdlc/nucleo/reexporta_da_fachada.ts": 'export { criar } from "../../ambiente/publico.ts";\n',
    "server/api/rota.ts": 'import { criar } from "../../modulos/ambiente/publico.ts";\n',
    "server/web/tela.ts": 'import type { Rede } from "../../modulos/ambiente/publico.ts";\n',
    // Proibidos: de fora do domínio, só a fachada, e o tipo de pasta interna também conta.
    "modulos/sdlc/aplicacao/usa_o_interior.ts": 'import { s } from "../../ambiente/sandboxes/nucleo/sandbox.ts";\n',
    "modulos/sdlc/aplicacao/usa_a_api.ts": 'import { r } from "../../ambiente/redes/publico.ts";\n',
    "server/api/tipo_interno.ts": 'import type { S } from "../../modulos/ambiente/sandboxes/nucleo/sandbox.ts";\n',
    "modulos/sessoes/execucao/aplicacao/tipo_do_ambiente.ts":
      'import type { S } from "../../../ambiente/sandboxes/nucleo/sandbox.ts";\n',
    // A matriz do servidor ainda vale: o navegador só importa tipo da fachada.
    "server/web/fachada_valor.ts": 'import { criar } from "../../modulos/ambiente/publico.ts";\n',
    // O domínio só importa a fachada dos domínios de que depende, nunca o servidor nem o código antigo.
    "modulos/ambiente/sandboxes/aplicacao/usa_sessoes.ts": 'import { l } from "../../../sessoes/publico.ts";\n',
    "modulos/ambiente/sandboxes/aplicacao/usa_o_servidor.ts": 'import { c } from "../../../../server/contrato/x.ts";\n',
    "modulos/ambiente/sandboxes/aplicacao/usa_o_legado.ts": 'import { x } from "../../../sdlc/nucleo/x.ts";\n',
    // Entre subdomínios, só a API, e só a dos subdomínios declarados; a fachada só junta as APIs.
    "modulos/ambiente/sandboxes/aplicacao/interior_de_redes.ts": 'import { x } from "../../redes/nucleo/rede.ts";\n',
    "modulos/ambiente/sandboxes/aplicacao/usa_a_propria_fachada.ts": 'import { criar } from "../../publico.ts";\n',
    "modulos/sessoes/historico/aplicacao/usa_execucao.ts": 'import { l } from "../../execucao/publico.ts";\n',
    "modulos/sessoes/publico.ts": 'export { l } from "./execucao/aplicacao/lancar.ts";\n',
    // As camadas: o núcleo não importa infra, e só o armazenamento fala SQL.
    "modulos/ambiente/sandboxes/nucleo/usa_infra.ts": 'import { d } from "../infra/docker.ts";\n',
    "modulos/ambiente/sandboxes/aplicacao/sql.ts": 'banco.prepare("SELECT 1");\n',
    // O shared não importa domínio, servidor nem o código antigo.
    "shared/infra/usa_dominio.ts": 'import { criar } from "../../modulos/ambiente/publico.ts";\n',
    "shared/infra/usa_o_servidor.ts": 'import { c } from "../../server/contrato/x.ts";\n',
    "shared/infra/usa_o_legado.ts": 'import { e } from "../../modulos/compartilhado/nucleo/erros.ts";\n',
    // A organização do §3.
    "modulos/ambiente/solto.ts": "export const s = 1;\n",
    "modulos/ambiente/sandboxes/util.ts": "export const u = 1;\n",
    "modulos/ambiente/desconhecido/aplicacao/x.ts": "export const x = 1;\n",
    "shared/solto.ts": "export const s = 1;\n",
  });

  assert.deepEqual(acharViolacoes(raiz, ARQUITETURA_SINTETICA, []).map(descrever).sort(), [
    "modulos/ambiente/desconhecido/aplicacao/x.ts importa fora da organização: subdomínio desconhecido não declarado nas regras de ambiente",
    // O import proibido que fecha ciclo acusa também o ciclo, entre subdomínios ou entre camadas.
    "modulos/ambiente/publico.ts importa ciclo entre módulos: modulos/ambiente → modulos/ambiente/sandboxes → modulos/ambiente",
    "modulos/ambiente/sandboxes/aplicacao/interior_de_redes.ts importa ../../redes/nucleo/rede.ts (entre subdomínios, só pelo publico.ts do subdomínio)",
    "modulos/ambiente/sandboxes/aplicacao/sql.ts importa SQL .prepare(",
    "modulos/ambiente/sandboxes/aplicacao/usa_a_propria_fachada.ts importa ../../publico.ts (dentro do domínio, use a API do subdomínio, não a fachada)",
    "modulos/ambiente/sandboxes/aplicacao/usa_o_legado.ts importa ../../../sdlc/nucleo/x.ts (um domínio migrado não importa o código antigo)",
    "modulos/ambiente/sandboxes/aplicacao/usa_o_servidor.ts importa ../../../../server/contrato/x.ts (um domínio não importa src/server/)",
    "modulos/ambiente/sandboxes/aplicacao/usa_sessoes.ts importa ../../../sessoes/publico.ts (o domínio ambiente não depende de sessoes)",
    "modulos/ambiente/sandboxes/nucleo/usa_infra.ts importa ../infra/docker.ts",
    "modulos/ambiente/sandboxes/nucleo/usa_infra.ts importa ciclo entre módulos: nucleo → infra → nucleo",
    "modulos/ambiente/sandboxes/util.ts importa fora da organização: fora das camadas nucleo, aplicacao, armazenamento e infra",
    "modulos/ambiente/solto.ts importa fora da organização: na raiz do domínio só fica o publico.ts",
    "modulos/sdlc/aplicacao/usa_a_api.ts importa ../../ambiente/redes/publico.ts (de fora do domínio ambiente, só pela fachada publico.ts)",
    "modulos/sdlc/aplicacao/usa_o_interior.ts importa ../../ambiente/sandboxes/nucleo/sandbox.ts (de fora do domínio ambiente, só pela fachada publico.ts)",
    "modulos/sessoes/execucao/aplicacao/lancar.ts importa ciclo entre módulos: modulos/sessoes/execucao → modulos/sessoes/historico → modulos/sessoes/execucao",
    "modulos/sessoes/execucao/aplicacao/tipo_do_ambiente.ts importa ../../../ambiente/sandboxes/nucleo/sandbox.ts (de fora do domínio ambiente, só pela fachada publico.ts)",
    "modulos/sessoes/historico/aplicacao/usa_execucao.ts importa ../../execucao/publico.ts (o subdomínio historico não depende de execucao)",
    "modulos/sessoes/publico.ts importa ./execucao/aplicacao/lancar.ts (a fachada importa só o publico.ts dos subdomínios)",
    "server/api/tipo_interno.ts importa ../../modulos/ambiente/sandboxes/nucleo/sandbox.ts (de fora do domínio ambiente, só pela fachada publico.ts)",
    "server/web/fachada_valor.ts importa ../../modulos/ambiente/publico.ts",
    "shared/infra/usa_dominio.ts importa ../../modulos/ambiente/publico.ts (o shared não importa domínio nem o servidor)",
    "shared/infra/usa_o_legado.ts importa ../../modulos/compartilhado/nucleo/erros.ts (o shared não importa domínio nem o servidor)",
    "shared/infra/usa_o_servidor.ts importa ../../server/contrato/x.ts (o shared não importa domínio nem o servidor)",
    "shared/solto.ts importa módulo desconhecido: ",
  ]);
});

test("um domínio não migrado segue a matriz do legado, mesmo com a pasta de destino", (t) => {
  const raiz = criarArquivos(t, {
    "modulos/ambiente/nucleo/x.ts": 'import { readFileSync } from "node:fs";\n',
  });
  const naoMigrado: Arquitetura = {
    ...ARQUITETURA_SINTETICA,
    dominios: { ...ARQUITETURA_SINTETICA.dominios, ambiente: regrasSinteticas({ migrado: false }) },
  };
  // Fora dos domínios antigos que a matriz conhece, a primeira pasta é o módulo: `ambiente` não está na matriz.
  assert.deepEqual(acharViolacoes(raiz, naoMigrado, []).map(descrever), [
    "modulos/ambiente/nucleo/x.ts importa módulo desconhecido: ambiente",
  ]);
});

test("a fitness acusa ciclo entre subdomínios e entre domínios migrados, mesmo com as dependências declaradas", (t) => {
  const raiz = criarArquivos(t, {
    "modulos/ambiente/sandboxes/aplicacao/x.ts": 'import { r } from "../../redes/publico.ts";\n',
    "modulos/ambiente/redes/publico.ts": 'export { s } from "../sandboxes/publico.ts";\n',
    "modulos/ambiente/sandboxes/publico.ts": 'export { r } from "../redes/publico.ts";\n',
    "modulos/ambiente/redes/aplicacao/usa_sessoes.ts": 'import { l } from "../../../sessoes/publico.ts";\n',
    "modulos/sessoes/publico.ts": 'export { h } from "./historico/publico.ts";\n',
    "modulos/sessoes/historico/publico.ts": 'import { r } from "../../ambiente/publico.ts";\n',
  });
  const comCiclos: Arquitetura = {
    ...ARQUITETURA_SINTETICA,
    dominios: {
      ...ARQUITETURA_SINTETICA.dominios,
      ambiente: regrasSinteticas({
        dependeDe: ["sessoes"],
        subdominios: { sandboxes: ["redes"], redes: ["sandboxes"] },
      }),
    },
  };
  assert.deepEqual(acharViolacoes(raiz, comCiclos, []).map(descrever), [
    "modulos/ambiente/redes/publico.ts importa ciclo entre módulos: modulos/ambiente/redes → modulos/ambiente/sandboxes → modulos/ambiente/redes",
  ]);
  assert.deepEqual(acharCiclosEntreDominios(raiz, comCiclos, []), [
    "ciclo entre módulos: modulos/ambiente → modulos/sessoes → modulos/ambiente",
  ]);
  assert.deepEqual(acharCiclosDeclarados(comCiclos), [
    "ciclo entre módulos: ambiente → sessoes → ambiente",
    "ciclo entre módulos: ambiente/sandboxes → ambiente/redes → ambiente/sandboxes",
  ]);
});

test("as dependências declaradas nos arquivos dos domínios de src/ não têm ciclo", () => {
  assert.deepEqual(acharCiclosDeclarados(ARQUITETURA_DE_SRC), []);
});
