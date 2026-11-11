import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 3;
const EM = "2026-01-01T00:00:00.000Z";
const SEM_MOTIVO = "(motivo anterior à migração 40)";

interface TicketAntigo {
  id: number;
  estado: "aberto" | "em_execucao" | "concluido" | "falhou" | "cancelado";
  devolucoes?: number;
  retomadas?: number;
  instrucao?: string;
  motivoFalha?: string;
  /** O `erro` de cada execução do ticket, da mais antiga à mais recente. */
  erros?: string[];
}

/** Um banco na versão 39 (com `devolucoes`, `retomadas_automaticas`, `motivo_falha` e `erro`) com os tickets dados. */
function bancoNaVersao39(tickets: TicketAntigo[]): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, 3));
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'Titulo', 'funcionalidade', 'Descricao', 'em_execucao', '${EM}', 'ferramenta', 'sessao', 1, 'fabriquinha/I-1');
    INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
      VALUES ('I-1', 1, 'Rodada', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1');
  `);
  const inserirTicket = banco.prepare(
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id, instrucao, devolucoes, motivo_falha, retomadas_automaticas)
     VALUES ('I-1', ?, 'implementar', ?, ?, 1, ?, ?, ?, ?)`,
  );
  const inserirSessao = banco.prepare(
    `INSERT INTO sessao (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES (?, 'I-1', ?, 'autonomo', ?)`,
  );
  const inserirExecucao = banco.prepare(
    `INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha, erro) VALUES (?, ?, ?, ?, 1, ?)`,
  );
  for (const t of tickets) {
    inserirTicket.run(
      t.id,
      t.estado,
      EM,
      t.instrucao ?? null,
      t.devolucoes ?? 0,
      t.motivoFalha ?? null,
      t.retomadas ?? 0,
    );
    if (t.erros === undefined) continue;
    inserirSessao.run(`S-${String(t.id)}`, t.id, `S-${String(t.id)}`);
    t.erros.forEach((erro, i) => {
      const quando = `2026-01-01T00:0${String(i)}:00.000Z`;
      inserirExecucao.run(`E-${String(t.id)}-${String(i)}`, `S-${String(t.id)}`, quando, quando, erro);
    });
  }
  return banco;
}

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

const tentativasDoTicket = (banco: DatabaseSync, ticket: number) =>
  linhas(
    banco,
    `SELECT numero, resultado_tipo, causa, motivo, instrucao, migrada FROM tentativa WHERE ticket_id = ${String(ticket)} ORDER BY numero`,
  );

const colunas = (banco: DatabaseSync, tabela: string): string[] =>
  linhas(banco, `SELECT name FROM pragma_table_info('${tabela}')`).map((l) => String(l.name));

const TICKETS: TicketAntigo[] = [
  { id: 1, estado: "aberto", devolucoes: 2, instrucao: "corrija X" },
  { id: 2, estado: "falhou", retomadas: 3, motivoFalha: "final", erros: ["e1", "e2", "e3", "final"] },
  { id: 3, estado: "aberto", retomadas: 1, instrucao: "reabra", erros: ["e1"] },
  { id: 4, estado: "falhou", motivoFalha: "quebrou" },
  { id: 5, estado: "concluido", retomadas: 2 },
  { id: 6, estado: "cancelado", devolucoes: 1, motivoFalha: "foi cancelado" },
  { id: 7, estado: "aberto" },
  { id: 8, estado: "aberto", devolucoes: 1, instrucao: "dev", erros: ["velho"] },
  { id: 9, estado: "falhou", devolucoes: 2, instrucao: "terceira", motivoFalha: "terceira" },
  { id: 10, estado: "falhou", instrucao: "reaberto", motivoFalha: "novo" },
  { id: 11, estado: "em_execucao", retomadas: 1, erros: ["x".repeat(2500)] },
];

test("a migração 40 reproduz devolucoes e retomadas_automaticas como Tentativas, ticket a ticket", () => {
  const banco = bancoNaVersao39(TICKETS);
  const antes = linhas(
    banco,
    "SELECT ticket_id, devolucoes, retomadas_automaticas FROM ticket_demanda ORDER BY ticket_id",
  );
  migrar(banco, MIGRACOES.slice(0, 4));

  assert.equal((banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version, VERSAO_ANTES + 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const depois = linhas(
    banco,
    `SELECT ticket_id,
       (SELECT count(*) FROM tentativa x WHERE x.ticket_id = t.ticket_id AND x.resultado_tipo = 'reprovacao') AS devolucoes,
       (SELECT count(*) FROM tentativa x WHERE x.ticket_id = t.ticket_id AND x.resultado_tipo = 'falha_infraestrutura') AS retomadas_automaticas
     FROM ticket_demanda t ORDER BY ticket_id`,
  );
  assert.deepEqual(depois, antes);
  assert.equal(linhas(banco, "SELECT * FROM tentativa WHERE migrada = 0").length, 0);
});

test("a migração 40 põe o motivo_falha na última Tentativa e guarda o que não tinha lugar", () => {
  const banco = bancoNaVersao39(TICKETS);
  migrar(banco, MIGRACOES.slice(0, 4));

  const reprovacao = (numero: number, motivo: string) => ({
    numero,
    resultado_tipo: "reprovacao",
    causa: null,
    motivo,
    instrucao: null,
    migrada: 1,
  });
  const falhaDeInfraestrutura = (numero: number, motivo: string) => ({
    numero,
    resultado_tipo: "falha_infraestrutura",
    causa: "tempo_limite",
    motivo,
    instrucao: null,
    migrada: 1,
  });
  const interrompida = (numero: number, causa: string, motivo: string | null, instrucao: string | null = null) => ({
    numero,
    resultado_tipo: "interrompida",
    causa,
    motivo,
    instrucao,
    migrada: 1,
  });

  assert.deepEqual(tentativasDoTicket(banco, 1), [reprovacao(1, SEM_MOTIVO), reprovacao(2, "corrija X")]);
  assert.deepEqual(tentativasDoTicket(banco, 2), [
    falhaDeInfraestrutura(1, "e1"),
    falhaDeInfraestrutura(2, "e2"),
    falhaDeInfraestrutura(3, "final"),
  ]);
  assert.deepEqual(tentativasDoTicket(banco, 3), [
    interrompida(1, "auditor", null, "reabra"),
    falhaDeInfraestrutura(2, "e1"),
  ]);
  assert.deepEqual(tentativasDoTicket(banco, 4), [interrompida(1, "fabriquinha", "quebrou")]);
  assert.deepEqual(tentativasDoTicket(banco, 5), [
    falhaDeInfraestrutura(1, SEM_MOTIVO),
    falhaDeInfraestrutura(2, SEM_MOTIVO),
  ]);
  assert.deepEqual(tentativasDoTicket(banco, 6), [reprovacao(1, "foi cancelado")]);
  assert.deepEqual(tentativasDoTicket(banco, 7), []);
  assert.deepEqual(tentativasDoTicket(banco, 8), [interrompida(1, "fabriquinha", "velho"), reprovacao(2, "dev")]);
  assert.deepEqual(tentativasDoTicket(banco, 9), [reprovacao(1, SEM_MOTIVO), reprovacao(2, "terceira")]);
  assert.deepEqual(tentativasDoTicket(banco, 10), [
    interrompida(1, "auditor", null, "reaberto"),
    interrompida(2, "fabriquinha", "novo"),
  ]);
  assert.deepEqual(
    tentativasDoTicket(banco, 11).map((t) => String(t.motivo).length),
    [2000],
  );
});

test("a migração 40 tira as colunas antigas, e as Tentativas ficam ligadas ao ticket", () => {
  const banco = bancoNaVersao39(TICKETS);
  migrar(banco, MIGRACOES.slice(0, 4));
  const doTicket = colunas(banco, "ticket_demanda");
  for (const antiga of ["devolucoes", "retomadas_automaticas", "motivo_falha"]) assert.ok(!doTicket.includes(antiga));
  assert.ok(doTicket.includes("instrucao"));
  assert.ok(!colunas(banco, "execucao_sessao").includes("erro"));
  assert.deepEqual(colunas(banco, "tentativa"), [
    "demanda_id",
    "ticket_id",
    "numero",
    "processo_id",
    "inicio",
    "fim",
    "resultado_tipo",
    "causa",
    "motivo",
    "instrucao",
    "migrada",
  ]);
  assert.throws(() => {
    banco.exec(`INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio) VALUES ('I-1', 999, 1, '${EM}')`);
  });
});

test("a migração 40 deixa a métrica de exigências de alteração igual", () => {
  const banco = bancoNaVersao39(TICKETS);
  const antes = linhas(banco, "SELECT ticket_id, devolucoes FROM ticket_demanda ORDER BY ticket_id").map((l) =>
    Number(l.devolucoes),
  );
  migrar(banco, MIGRACOES.slice(0, 4));
  const depois = linhas(
    banco,
    `SELECT (SELECT COUNT(*) FROM tentativa x WHERE x.demanda_id = t.demanda_id AND x.ticket_id = t.ticket_id
       AND x.resultado_tipo = 'reprovacao') AS reprovacoes FROM ticket_demanda t ORDER BY t.ticket_id`,
  ).map((l) => Number(l.reprovacoes));
  assert.deepEqual(depois, antes);
});

test("a migração 40 num banco sem ticket só cria a tabela", () => {
  const banco = bancoNaVersao39([]);
  migrar(banco, MIGRACOES.slice(0, 4));
  assert.deepEqual(linhas(banco, "SELECT * FROM tentativa"), []);
});
