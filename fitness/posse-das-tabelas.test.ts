// Fitness function: a posse das tabelas (MELHORIAS §5.1). Cada tabela do banco migrado tem um dono declarado em
// fitness/fronteiras/posse_das_tabelas.ts, e só o `armazenamento/` do dono fala SQL com ela. Em modo inventário (o padrão
// de cada domínio), o SQL que toca tabela fora do dono só é listado no relatório do teste; o domínio que declarar
// `posseDasTabelas: "estrita"` no seu arquivo em fitness/fronteiras/dominios/ reprova (o ticket 22 liga todos).
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { abrir } from "../src/modulos/compartilhado/armazenamento/banco.ts";
import { ARQUITETURA_DE_SRC } from "./fronteiras/arquitetura.ts";
import { REGRAS_DO_AMBIENTE } from "./fronteiras/dominios/ambiente.ts";
import { PASTA_DO_HISTORICO_DO_ESQUEMA } from "./fronteiras/dominios/shared.ts";
import {
  acharDonosNaoDeclarados,
  acharToquesForaDoDono,
  acharToquesNosDominiosEstritos,
  type Arquitetura,
  descreverToque,
} from "./fronteiras/motor.ts";
import { DONO_DE_CADA_TABELA } from "./fronteiras/posse_das_tabelas.ts";

const SRC = resolve(import.meta.dirname, "../src");

// A arquitetura de src/ com o Ambiente sintético, para os testes do motor não dependerem dos subdomínios declarados hoje.
const comAmbiente = (posseDasTabelas: "inventario" | "estrita"): Arquitetura => ({
  ...ARQUITETURA_DE_SRC,
  dominios: {
    ...ARQUITETURA_DE_SRC.dominios,
    ambiente: { ...REGRAS_DO_AMBIENTE, subdominios: { sandboxes: [] }, posseDasTabelas },
  },
});

function criarPastaTemporaria(t: TestContext, prefixo: string): string {
  const raiz = mkdtempSync(join(tmpdir(), prefixo));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  return raiz;
}

// O esquema real: um banco novo, levado pelas migrações à versão atual.
function listarTabelasDoBancoMigrado(t: TestContext): string[] {
  const banco = abrir(criarPastaTemporaria(t, "fabriquinha-fitness-posse-banco-"));
  try {
    return (
      banco
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .all() as { name: string }[]
    ).map(({ name }) => name);
  } finally {
    banco.close();
  }
}

test("toda tabela do banco migrado tem um dono, e todo dono declarado é uma tabela que existe", (t) => {
  const tabelas = listarTabelasDoBancoMigrado(t);
  const declaradas = Object.keys(DONO_DE_CADA_TABELA);
  assert.deepEqual(
    tabelas.filter((tabela) => !declaradas.includes(tabela)),
    [],
    "tabela sem dono",
  );
  assert.deepEqual(
    declaradas.filter((tabela) => !tabelas.includes(tabela)),
    [],
    "dono de tabela que não existe",
  );
});

test("todo dono é `shared` ou um subdomínio declarado no arquivo do domínio", () => {
  assert.deepEqual(acharDonosNaoDeclarados(DONO_DE_CADA_TABELA, ARQUITETURA_DE_SRC), []);
});

test("inventário: o SQL de src/ que toca tabela fora do armazenamento do dono, reprovado só nos domínios estritos", (t) => {
  const toques = acharToquesForaDoDono(SRC, DONO_DE_CADA_TABELA, [PASTA_DO_HISTORICO_DO_ESQUEMA]);
  t.diagnostic(`${String(toques.length)} toques de tabela fora do armazenamento do dono (modo inventário):`);
  for (const toque of toques) t.diagnostic(descreverToque(toque));
  assert.deepEqual(acharToquesNosDominiosEstritos(toques, ARQUITETURA_DE_SRC).map(descreverToque), []);
});

test("a fitness da posse acha a tabela no SQL e no nome passado ao montador, e o modo estrito reprova", (t) => {
  const raiz = criarPastaTemporaria(t, "fabriquinha-fitness-posse-");
  const arquivos: Record<string, string> = {
    // No armazenamento do dono, tudo vale.
    "modulos/ambiente/sandboxes/armazenamento/sandboxes.ts":
      'banco.prepare("SELECT * FROM ambiente");\nbanco.prepare(`UPDATE ambiente SET x = ${y}`);\n',
    // O histórico do esquema fica de fora.
    "modulos/compartilhado/armazenamento/migracoes/migracoes.ts": 'banco.exec("CREATE TABLE demanda (id)");\n',
    // Fora do dono: depois de FROM/JOIN/INTO/UPDATE/TABLE/REFERENCES, em literal ou template, de qualquer caixa.
    "modulos/sdlc/armazenamento/demandas.ts":
      "banco.prepare(`SELECT d.id FROM demanda d JOIN ambiente a ON a.id = ${x} WHERE d.id IN (SELECT 1 FROM rodada)`);\n" +
      'banco.exec("insert into rodada (x) values (1)");\n',
    // O nome passado a um montador de SQL, num arquivo que fala SQL.
    "modulos/projeto/armazenamento/projetos.ts":
      'const apagar = (tabela) => banco.prepare(`DELETE FROM ${tabela}`).run();\napagar("ambiente");\n',
    // Sem SQL no arquivo, o literal igual ao nome de uma tabela é só um texto; nome desconhecido e coluna não contam.
    "modulos/metricas/aplicacao/niveis.ts": 'export const NIVEIS = ["rodada", "demanda"];\n',
    "modulos/sdlc/armazenamento/outra.ts": 'banco.prepare("SELECT rodada_id FROM json_each(?) WHERE demanda = 1");\n',
    "modulos/sdlc/armazenamento/outra.test.ts": 'banco.prepare("SELECT * FROM demanda");\n',
    // O shared é dono da sequência em qualquer pasta dele.
    "shared/armazenamento/banco.ts": 'banco.prepare("UPDATE sequencia SET valor = valor + 1");\n',
  };
  for (const [caminho, conteudo] of Object.entries(arquivos)) {
    mkdirSync(dirname(join(raiz, caminho)), { recursive: true });
    writeFileSync(join(raiz, caminho), conteudo);
  }
  const donos = {
    ambiente: "ambiente/sandboxes",
    demanda: "demandas/pedidos",
    rodada: "ciclo_de_vida/planejamento",
    sequencia: "shared",
  };

  const toques = acharToquesForaDoDono(raiz, donos, ["modulos/compartilhado/armazenamento/migracoes/"]);
  assert.deepEqual(toques.map(descreverToque), [
    "modulos/projeto/armazenamento/projetos.ts toca ambiente (dono: ambiente/sandboxes)",
    "modulos/sdlc/armazenamento/demandas.ts toca ambiente (dono: ambiente/sandboxes)",
    "modulos/sdlc/armazenamento/demandas.ts toca demanda (dono: demandas/pedidos)",
    "modulos/sdlc/armazenamento/demandas.ts toca rodada (dono: ciclo_de_vida/planejamento)",
  ]);

  assert.deepEqual(acharToquesNosDominiosEstritos(toques, comAmbiente("inventario")), []);
  assert.deepEqual(acharToquesNosDominiosEstritos(toques, comAmbiente("estrita")).map(descreverToque), [
    "modulos/projeto/armazenamento/projetos.ts toca ambiente (dono: ambiente/sandboxes)",
    "modulos/sdlc/armazenamento/demandas.ts toca ambiente (dono: ambiente/sandboxes)",
  ]);
});

test("a fitness da posse acusa o dono que não é `shared` nem subdomínio declarado", () => {
  assert.deepEqual(
    acharDonosNaoDeclarados(
      {
        a: "shared",
        b: "ambiente/sandboxes",
        c: "ambiente/inexistente",
        d: "ambiente",
        e: "server/api",
        f: "outro/x",
        g: "ambiente/sandboxes/armazenamento",
      },
      comAmbiente("inventario"),
    ),
    ["c: ambiente/inexistente", "d: ambiente", "e: server/api", "f: outro/x", "g: ambiente/sandboxes/armazenamento"],
  );
});
