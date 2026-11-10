import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { conformidadeDaRodada } from "../aplicacao/conformidade.ts";
import { CorrecaoDoPlano, lerPlanoGravado, Plano } from "../nucleo/plano.ts";
import { migrar } from "./banco.ts";
import { planoDaDemanda } from "./metricas_demanda.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_47 = VERSAO_LINHA_DE_BASE + 11;
const EM = "2026-01-01T00:00:00.000Z";
const APROVADO_EM = "2026-01-02T00:00:00.000Z";

const ticketDoPlano = (ticket_id: number, caminhos: string[], depende: object[] = []) => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id: 1,
  titulo: `plano ${String(ticket_id)}`,
  descricao: "d",
  caminhos,
  depende,
});
/** O plano como as demandas antigas o gravaram: `caminhos` no ticket e nada de arquivos em Rodada e Demanda. */
const PLANO_ANTIGO = {
  demanda_id: "I-1",
  criterios: ["CA-1"],
  rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
  tickets: [ticketDoPlano(1, ["src/a.ts"]), ticketDoPlano(2, ["src/b.ts"], [{ demanda_id: "I-1", ticket_id: 1 }])],
};
const planoDeUmTicket = (demanda: string) => ({
  demanda_id: demanda,
  criterios: ["CA-1"],
  rodadas: [{ demanda_id: demanda, rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
  tickets: [{ ...ticketDoPlano(1, ["src/z.ts"]), demanda_id: demanda }],
});

/**
 * Tickets da I-1 (planejar T1; implementar do plano T2 e T3; revisar T4; ajustar T6; corretivos T5, T7 a T12):
 * T5 do agente E-rev (revisar), T7 do agente E-aju (ajustar), T8 do Auditor, T9 da Fabriquinha (rodada 1) e T10, T11 do
 * agente E-dem na rodada 2, que o plano não tem.
 */
const TICKETS_DA_I_1 = [
  [1, "planejar", "NULL", "'fabriquinha'", "NULL", "NULL"],
  [2, "implementar", 1, "'fabriquinha'", "NULL", "'p2'"],
  [3, "implementar", 1, "'fabriquinha'", "NULL", "'p3'"],
  [4, "revisar_rodada", 1, "'fabriquinha'", "NULL", "NULL"],
  [5, "implementar", 1, "'agente'", "'E-rev'", "'corrige c'"],
  [6, "ajustar_resultado", 1, "'fabriquinha'", "NULL", "NULL"],
  [7, "implementar", 1, "'agente'", "'E-aju'", "'ajusta d'"],
  [8, "implementar", 1, "'auditor'", "NULL", "'ajusta d de novo'"],
  [9, "implementar", 1, "'fabriquinha'", "NULL", "'conflito e'"],
  [10, "implementar", 2, "'agente'", "'E-dem'", "'rodada nova f'"],
  [11, "implementar", 2, "'agente'", "'E-dem'", "'rodada nova g'"],
] as const;

function bancoNaVersao46(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - 1 - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
  `);
  const estados = { "I-1": "em_execucao", "I-2": "gate_planejamento", "I-3": "em_execucao" };
  for (const [id, estado] of Object.entries(estados)) {
    banco.exec(`
      INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
        VALUES ('${id}', 'loja', 'T', 'funcionalidade', 'D', '${estado}', '${EM}', 'claude', 's', 1, 'fabriquinha/${id}');
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('${id}', 1, 'planejar', 'concluido', '${EM}');
    `);
  }
  banco.exec(`
    INSERT INTO rodada VALUES ('I-1', 1, 'r1', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1'), ('I-1', 2, 'r2', 'implementar', '${EM}', 1, 'fabriquinha/I-1-2'),
      ('I-3', 1, 'r1', 'implementar', '${EM}', 0, 'fabriquinha/I-3-1');
    INSERT INTO criterio_citado_rodada VALUES ('I-1', 1, 'CA-1'), ('I-1', 2, 'CA-1');
    INSERT INTO dependencia_rodada VALUES ('I-1', 2, 1);
  `);
  for (const [ticket, etapa, rodada, autor, processo, titulo] of TICKETS_DA_I_1.slice(1)) {
    banco.exec(`
      INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id, titulo, descricao, criado_por_tipo, criado_por_trabalho_id)
        VALUES ('I-1', ${String(ticket)}, '${etapa}', 'concluido', '${EM}', ${String(rodada)}, ${titulo}, ${titulo === "NULL" ? "NULL" : "'descrição'"}, ${autor}, ${processo});
    `);
  }
  banco.exec(`
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id, titulo, descricao)
      VALUES ('I-3', 2, 'implementar', 'concluido', '${EM}', 1, 'plano 1', 'd');
    INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES
      ('W-rev', 'I-1', 4, 'autonomo', 'c1'), ('W-aju', 'I-1', 6, 'interativo', 'c2'), ('W-dem', 'I-1', 1, 'autonomo', 'c3');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES
      ('E-rev', 'W-rev', '${EM}', 0), ('E-aju', 'W-aju', '${EM}', 0), ('E-dem', 'W-dem', '${EM}', 0);
    INSERT INTO dependencia_ticket VALUES ('I-1', 3, 2, 1), ('I-1', 11, 10, 2);
    INSERT INTO caminho_ticket VALUES
      ('I-1', 2, 'src/a.ts'), ('I-1', 3, 'src/b.ts'), ('I-1', 5, 'src/c.ts'), ('I-1', 7, 'src/d.ts'), ('I-1', 8, 'src/d.ts'),
      ('I-1', 9, 'src/e.ts'), ('I-1', 10, 'src/f.ts'), ('I-1', 11, 'src/g.ts'), ('I-3', 2, 'src/z.ts');
    INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, por_tipo, em)
      VALUES ('I-1', 1, 1, 'gate_planejamento', 'aprovado', 'auditor', '${APROVADO_EM}');
  `);
  const inserirPlano = banco.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES (?, ?, 1, 'plano', ?, ?)",
  );
  inserirPlano.run("ev-1", "I-1", JSON.stringify(PLANO_ANTIGO), EM);
  inserirPlano.run("ev-2", "I-2", JSON.stringify(planoDeUmTicket("I-2")), EM);
  inserirPlano.run("ev-3", "I-3", JSON.stringify(planoDeUmTicket("I-3")), EM);
  return banco;
}

const contar = (banco: DatabaseSync, tabela: string): number =>
  Number(banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n);

const versoes = (banco: DatabaseSync, demanda: string) =>
  banco.prepare("SELECT * FROM versao_plano WHERE demanda_id = ? ORDER BY numero").all(demanda);

test("a migração 47 grava a versão 1 igual à evidência aprovada e só nas demandas com plano materializado", () => {
  const banco = bancoNaVersao46();
  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - VERSAO_LINHA_DE_BASE));

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_47);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(contar(banco, "sqlite_temp_master"), 0, "a tabela de trabalho não fica no banco");
  const [primeira] = versoes(banco, "I-1");
  assert.ok(primeira);
  assert.equal(primeira.origem, "aprovacao_do_planejamento");
  assert.equal(primeira.autor_tipo, "fabriquinha");
  assert.equal(primeira.criada_em, APROVADO_EM);
  assert.deepEqual(JSON.parse(String(primeira.dados)), PLANO_ANTIGO);
  assert.equal(lerPlanoGravado(JSON.parse(String(primeira.dados))).arquivos_previstos.length, 2);
  assert.deepEqual(versoes(banco, "I-2"), [], "plano ainda não aprovado nem materializado");
  const [semDecisao, ...correcoesDaI3] = versoes(banco, "I-3");
  assert.equal(semDecisao?.criada_em, EM, "sem decisão gravada, vale a data da evidência");
  assert.deepEqual(correcoesDaI3, [], "os tickets do plano não são correções");
  banco.close();
});

test("a migração 47 reconstrói uma correção por origem, autor e rodada, e a revisão da demanda traz as rodadas novas", () => {
  const banco = bancoNaVersao46();
  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - VERSAO_LINHA_DE_BASE));

  const [, ...correcoes] = versoes(banco, "I-1");
  assert.deepEqual(
    correcoes.map((v) => [v.numero, v.origem, v.autor_tipo, v.autor_trabalho_id, v.rodada_id]),
    [
      [2, "revisao_rodada", "agente", "E-rev", 1],
      [3, "ajustar_resultado", "agente", "E-aju", 1],
      [4, "ajustar_resultado", "auditor", null, 1],
      [5, "conferencia_do_pr", "fabriquinha", null, 1],
      [6, "revisao_demanda", "agente", "E-dem", null],
    ],
  );
  const dados = correcoes.map((v) => CorrecaoDoPlano.parse(JSON.parse(String(v.dados))));
  assert.deepEqual(
    dados.map((c) => c.tickets_novos.map((t) => t.ticket_id)),
    [[5], [7], [8], [9], [10, 11]],
  );
  assert.deepEqual(dados[0]?.autor, { tipo: "agente", trabalho_id: "E-rev" });
  assert.deepEqual(dados[1]?.arquivos_acrescentados, ["src/d.ts"]);
  assert.deepEqual(dados[2]?.autor, { tipo: "auditor" });
  const revisaoDaDemanda = dados[4];
  assert.equal(revisaoDaDemanda?.rodada, undefined);
  assert.deepEqual(revisaoDaDemanda?.tickets_novos[1]?.depende, [{ demanda_id: "I-1", ticket_id: 10 }]);
  assert.deepEqual(revisaoDaDemanda.rodadas_novas, [
    {
      demanda_id: "I-1",
      rodada_id: 2,
      titulo: "r2",
      e2e: true,
      criterios: ["CA-1"],
      depende: [{ demanda_id: "I-1", rodada_id: 1 }],
      arquivos_previstos: ["src/f.ts", "src/g.ts"],
    },
  ]);
  banco.close();
});

test("a Conformidade vê o mesmo plano: o original é a referência e as correções são os extras", () => {
  const banco = bancoNaVersao46();
  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - VERSAO_LINHA_DE_BASE));

  const [original, ...correcoes] = versoes(banco, "I-1").map((v) => JSON.parse(String(v.dados)) as unknown);
  const plano = new Plano(
    lerPlanoGravado(original),
    correcoes.map((c) => CorrecaoDoPlano.parse(c)),
  );
  assert.deepEqual(plano.extras().sort(), ["src/c.ts", "src/d.ts", "src/e.ts", "src/f.ts", "src/g.ts"]);
  assert.deepEqual(plano.original.arquivos_previstos.sort(), ["src/a.ts", "src/b.ts"]);
  banco.close();
});

test("a migração 47 preenche os arquivos de rodada e demanda pela união dos caminho_ticket, sem mexer no resto", () => {
  const banco = bancoNaVersao46();
  const antes = Object.fromEntries(
    ["demanda", "rodada", "ticket_demanda", "caminho_ticket", "evidencia_demanda", "decisao_ticket"].map((t) => [
      t,
      contar(banco, t),
    ]),
  );
  assert.equal(contar(banco, "arquivo_previsto_rodada") + contar(banco, "arquivo_previsto_demanda"), 0);

  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - VERSAO_LINHA_DE_BASE));

  for (const [tabela, quantas] of Object.entries(antes)) assert.equal(contar(banco, tabela), quantas, tabela);
  const caminhos = (sql: string): string[] =>
    banco
      .prepare(sql)
      .all()
      .map((l) => String(l.caminho));
  assert.deepEqual(
    caminhos("SELECT caminho FROM arquivo_previsto_rodada WHERE demanda_id = 'I-1' AND rodada_id = 1 ORDER BY caminho"),
    ["src/a.ts", "src/b.ts", "src/c.ts", "src/d.ts", "src/e.ts"],
  );
  assert.deepEqual(
    caminhos("SELECT caminho FROM arquivo_previsto_rodada WHERE demanda_id = 'I-1' AND rodada_id = 2 ORDER BY caminho"),
    ["src/f.ts", "src/g.ts"],
  );
  assert.deepEqual(caminhos("SELECT caminho FROM arquivo_previsto_demanda WHERE demanda_id = 'I-1' ORDER BY caminho"), [
    "src/a.ts",
    "src/b.ts",
    "src/c.ts",
    "src/d.ts",
    "src/e.ts",
    "src/f.ts",
    "src/g.ts",
  ]);
  assert.deepEqual(caminhos("SELECT caminho FROM arquivo_previsto_demanda WHERE demanda_id = 'I-2'"), []);
  const foraDaRodada = banco
    .prepare(
      `SELECT c.caminho FROM caminho_ticket c JOIN ticket_demanda t USING (demanda_id, ticket_id)
       WHERE NOT EXISTS (SELECT 1 FROM arquivo_previsto_rodada r WHERE r.demanda_id = c.demanda_id AND r.rodada_id = t.rodada_id AND r.caminho = c.caminho)`,
    )
    .all();
  assert.deepEqual(foraDaRodada, [], "Ticket ⊆ Rodada");
  const foraDaDemanda = banco
    .prepare(
      `SELECT r.caminho FROM arquivo_previsto_rodada r
       WHERE NOT EXISTS (SELECT 1 FROM arquivo_previsto_demanda d WHERE d.demanda_id = r.demanda_id AND d.caminho = r.caminho)`,
    )
    .all();
  assert.deepEqual(foraDaDemanda, [], "Rodada ⊆ Demanda");
  banco.close();
});

/** O caminho de antes da migração: o planejado da rodada sai dos tickets da evidência `plano`, sem `Plano`. */
function conformidadeDoCaminhoAntigo(banco: DatabaseSync, demanda: string, rodada: number) {
  const evidencia = banco
    .prepare("SELECT dados FROM evidencia_demanda WHERE demanda_id = ? AND tipo = 'plano'")
    .get(demanda);
  const planejado = new Set(
    lerPlanoGravado(JSON.parse(String(evidencia?.dados)))
      .tickets.filter((t) => t.rodada_id === rodada)
      .flatMap((t) => t.arquivos_previstos),
  );
  const alterado = new Set(
    banco
      .prepare(
        `SELECT a.caminho FROM arquivo_commit_demanda a
         JOIN commit_ticket_demanda c ON c.sha = a.sha
         JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
         WHERE c.demanda_id = ? AND t.rodada_id = ?`,
      )
      .all(demanda, rodada)
      .map((l) => String(l.caminho)),
  );
  const ausentes = [...planejado].filter((c) => !alterado.has(c)).sort();
  const extras = [...alterado].filter((c) => !planejado.has(c)).sort();
  const comuns = planejado.size - ausentes.length;
  return { percentual: (comuns / (comuns + ausentes.length + extras.length)) * 100, ausentes, extras };
}

test("a Conformidade da demanda concluída com tickets corretivos é a mesma antes e depois da migração 47", () => {
  const banco = bancoNaVersao46();
  const commits: [number, string][] = [
    [2, "src/a.ts"],
    [5, "src/c.ts"],
    [7, "src/d.ts"],
    [9, "src/e.ts"],
  ];
  for (const [ticket, caminho] of commits) {
    const sha = String(ticket).padStart(40, "0");
    banco.exec(`
      INSERT INTO commit_ticket_demanda VALUES ('${sha}', 'I-1', ${String(ticket)}, 'm', '${EM}');
      INSERT INTO arquivo_commit_demanda VALUES ('${sha}', '${caminho}', NULL, 'M', 1, 1);
    `);
  }
  banco.exec("UPDATE demanda SET estado = 'concluida' WHERE id = 'I-1'");
  const antes = conformidadeDoCaminhoAntigo(banco, "I-1", 1);
  assert.deepEqual(antes.extras, ["src/c.ts", "src/d.ts", "src/e.ts"], "as correções são extras");

  migrar(banco, MIGRACOES.slice(0, VERSAO_47 - VERSAO_LINHA_DE_BASE));

  const depois = conformidadeDaRodada(banco, "I-1", 1, planoDaDemanda(banco, "I-1"));
  assert.deepEqual(
    { percentual: depois?.percentual, ausentes: depois?.ausentes.sort(), extras: depois?.extras.sort() },
    antes,
  );
  banco.close();
});
