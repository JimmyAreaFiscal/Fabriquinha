// Fitness function: a posse das tabelas (MELHORIAS §5.1). Cada tabela do banco migrado tem um dono declarado em
// fitness/fronteiras/posse_das_tabelas.ts, e só o `armazenamento/` do dono fala SQL com ela: o SQL que toca tabela fora do
// dono reprova, em qualquer domínio.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test, type TestContext } from "node:test";
import { abrirBancoDaFabriquinha } from "../src/server/system/banco_da_fabriquinha.ts";
import { ARQUITETURA_DE_SRC } from "./fronteiras/arquitetura.ts";
import { REGRAS_DO_AMBIENTE } from "./fronteiras/dominios/ambiente.ts";
import { PASTA_DO_SYSTEM } from "./fronteiras/dominios/server.ts";
import { MIGRACOES_DOS_DOMINIOS, PASTA_DO_HISTORICO_DO_ESQUEMA } from "./fronteiras/dominios/shared.ts";
import {
  acharDonosNaoDeclarados,
  acharToquesForaDoDono,
  type Arquitetura,
  descreverToque,
} from "./fronteiras/motor.ts";
import { DONO_DE_CADA_TABELA } from "./fronteiras/posse_das_tabelas.ts";

const SRC = resolve(import.meta.dirname, "../src");

const FORA_DA_POSSE = [PASTA_DO_HISTORICO_DO_ESQUEMA, ...MIGRACOES_DOS_DOMINIOS];

// A arquitetura de src/ com o Ambiente sintético, para o teste do motor não depender dos subdomínios declarados hoje.
const COM_AMBIENTE_SINTETICO: Arquitetura = {
  ...ARQUITETURA_DE_SRC,
  dominios: { ...ARQUITETURA_DE_SRC.dominios, ambiente: { ...REGRAS_DO_AMBIENTE, subdominios: { sandboxes: [] } } },
};

function criarPastaTemporaria(t: TestContext, prefixo: string): string {
  const raiz = mkdtempSync(join(tmpdir(), prefixo));
  t.after(() => {
    rmSync(raiz, { recursive: true, force: true });
  });
  return raiz;
}

// O esquema real: um banco novo, levado pelas migrações à versão atual.
function listarTabelasDoBancoMigrado(t: TestContext): string[] {
  const banco = abrirBancoDaFabriquinha(criarPastaTemporaria(t, "fabriquinha-fitness-posse-banco-"));
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

test("toda migração de domínio fora da posse existe", () => {
  assert.deepEqual(
    MIGRACOES_DOS_DOMINIOS.filter((arquivo) => !existsSync(join(SRC, arquivo))),
    [],
  );
});

test("o system (rotas, leituras das telas, comandos e montagem) não toca tabela nenhuma: lê pelas fachadas (MELHORIAS §6)", () => {
  const toques = acharToquesForaDoDono(SRC, DONO_DE_CADA_TABELA, FORA_DA_POSSE);
  assert.deepEqual(toques.filter(({ arquivo }) => arquivo.startsWith(PASTA_DO_SYSTEM)).map(descreverToque), []);
});

test("nenhum SQL de src/ toca tabela fora do armazenamento do dono", () => {
  assert.deepEqual(acharToquesForaDoDono(SRC, DONO_DE_CADA_TABELA, FORA_DA_POSSE).map(descreverToque), []);
});

test("a fitness da posse acha a tabela no SQL e no nome passado ao montador", (t) => {
  const raiz = criarPastaTemporaria(t, "fabriquinha-fitness-posse-");
  const arquivos: Record<string, string> = {
    // No armazenamento do dono, tudo vale.
    "modulos/ambiente/sandboxes/armazenamento/sandboxes.ts":
      'banco.prepare("SELECT * FROM ambiente");\nbanco.prepare(`UPDATE ambiente SET x = ${y}`);\n',
    // O histórico do esquema fica de fora.
    [`${PASTA_DO_HISTORICO_DO_ESQUEMA}migracoes.ts`]: 'banco.exec("CREATE TABLE demanda (id)");\n',
    // Fora do dono: depois de FROM/JOIN/INTO/UPDATE/TABLE/REFERENCES, em literal ou template, de qualquer caixa.
    "modulos/ciclo_de_vida/processo/armazenamento/agregado.ts":
      "banco.prepare(`SELECT d.id FROM demanda d JOIN ambiente a ON a.id = ${x} WHERE d.id IN (SELECT 1 FROM rodada)`);\n" +
      'banco.exec("insert into rodada (x) values (1)");\n',
    // O nome passado a um montador de SQL, num arquivo que fala SQL.
    "modulos/demandas/projetos/armazenamento/projetos.ts":
      'const apagar = (tabela) => banco.prepare(`DELETE FROM ${tabela}`).run();\napagar("ambiente");\n',
    // Sem SQL no arquivo, o literal igual ao nome de uma tabela é só um texto; nome desconhecido e coluna não contam.
    "modulos/ciclo_de_vida/metricas_de_qualidade/aplicacao/niveis.ts": 'export const NIVEIS = ["rodada", "demanda"];\n',
    "modulos/ciclo_de_vida/processo/armazenamento/outra.ts":
      'banco.prepare("SELECT rodada_id FROM json_each(?) WHERE demanda = 1");\n',
    "modulos/ciclo_de_vida/processo/armazenamento/outra.test.ts": 'banco.prepare("SELECT * FROM demanda");\n',
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

  const toques = acharToquesForaDoDono(raiz, donos, [PASTA_DO_HISTORICO_DO_ESQUEMA]);
  assert.deepEqual(toques.map(descreverToque), [
    "modulos/ciclo_de_vida/processo/armazenamento/agregado.ts toca ambiente (dono: ambiente/sandboxes)",
    "modulos/ciclo_de_vida/processo/armazenamento/agregado.ts toca demanda (dono: demandas/pedidos)",
    "modulos/ciclo_de_vida/processo/armazenamento/agregado.ts toca rodada (dono: ciclo_de_vida/planejamento)",
    "modulos/demandas/projetos/armazenamento/projetos.ts toca ambiente (dono: ambiente/sandboxes)",
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
        e: "server/system/api",
        f: "outro/x",
        g: "ambiente/sandboxes/armazenamento",
      },
      COM_AMBIENTE_SINTETICO,
    ),
    [
      "c: ambiente/inexistente",
      "d: ambiente",
      "e: server/system/api",
      "f: outro/x",
      "g: ambiente/sandboxes/armazenamento",
    ],
  );
});
