import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  ESTADO_NOVO_DA_DEMANDA,
  ESTADO_NOVO_DA_RODADA,
  ESTADO_NOVO_DO_TICKET,
  ETAPA_NOVA,
} from "../../../../../apoio-testes/esquema_anterior.ts";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES as MIGRACOES_DISPONIVEIS, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const MIGRACOES = MIGRACOES_DISPONIVEIS.slice(0, 2);

const EM = "2026-01-01T00:00:00.000Z";
const DEPOIS_DO_TICKET_4 = "2026-01-02T00:00:00.000Z";
const DEPOIS_DO_TICKET_5 = "2026-01-03T00:00:00.000Z";
const ALTERACAO_DA_DEMANDA = "2026-01-04T00:00:00.000Z";

/** Uma demanda em cada estado antigo, repartidas em dois projetos. */
const DEMANDAS = Object.keys(ESTADO_NOVO_DA_DEMANDA).map((estadoAntigo, i) => ({
  id: `I-${String(i + 1)}`,
  projeto: i % 2 === 0 ? "loja" : "site",
  estadoAntigo,
}));
/** A `I-5` (execucao, do projeto loja) tem uma rodada em cada estado antigo e os tickets abaixo. */
const DEMANDA_COM_RODADAS = "I-5";
const RODADAS = Object.keys(ESTADO_NOVO_DA_RODADA).map((estadoAntigo, i) => ({ rodada_id: i + 1, estadoAntigo }));
const RODADA_COM_DOIS_TICKETS = 1;
const RODADA_COM_UM_TICKET = 2;
const RODADA_SEM_TICKET = 3;
const TICKETS = [
  // ticket_id, etapa, estado antigo, rodada
  [1, "demanda", "concluido", undefined],
  [2, "planejar", "fechado", undefined],
  [3, "sessao_em_aberto", "cancelado", undefined],
  [4, "implementar", "aberto", RODADA_COM_DOIS_TICKETS],
  [5, "revisar_rodada", "em_execucao", RODADA_COM_DOIS_TICKETS],
  [6, "encerrar_rodada", "falhou", RODADA_COM_UM_TICKET],
] as const;
const ALTERACAO_DO_TICKET: Record<number, string> = { 4: DEPOIS_DO_TICKET_4, 5: DEPOIS_DO_TICKET_5 };

/** Um banco na v37 (esquema antigo) com o que a migração 38 precisa transformar. */
function bancoNaVersao37(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, 1));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES
      ('loja', '/r1', 'main', 'github', 'k1'), ('site', '/r2', 'main', 'github', 'k2');
    INSERT INTO sequencia (nome, valor) VALUES ('issue', 7);
    INSERT INTO configuracao_etapa_projeto (projeto, etapa) VALUES
      ('loja', 'demanda'), ('loja', 'sessao_em_aberto'), ('loja', 'implementar'), ('site', 'demanda');
  `);
  const inserirDemanda = banco.prepare(
    "INSERT INTO demanda VALUES (?, ?, 't', 'problema', 'd', ?, ?, 'claude', 's', 1, ?)",
  );
  for (const d of DEMANDAS) {
    inserirDemanda.run(d.id, d.projeto, d.estadoAntigo, ALTERACAO_DA_DEMANDA, `fabriquinha/${d.id}`);
  }
  const inserirRodada = banco.prepare("INSERT INTO rodada VALUES (?, ?, 'r', ?, 0, ?)");
  for (const r of RODADAS) {
    inserirRodada.run(DEMANDA_COM_RODADAS, r.rodada_id, r.estadoAntigo, `fabriquinha/r${String(r.rodada_id)}`);
  }
  const inserirTicket = banco.prepare(`
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id, motivo_falha, criado_em, concluido_em, enviado_em, origem_ticket_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const [ticket_id, etapa, estadoAntigo, rodada_id] of TICKETS) {
    const motivo = estadoAntigo === "fechado" ? "timeout" : null;
    inserirTicket.run(
      DEMANDA_COM_RODADAS,
      ticket_id,
      etapa,
      estadoAntigo,
      ALTERACAO_DO_TICKET[ticket_id] ?? EM,
      rodada_id ?? null,
      motivo,
      EM,
      EM,
      EM,
      1,
    );
  }
  return banco;
}

type Contagem = Record<string, number>;

/** Quantas linhas há por (projeto, estado), no esquema antigo (`fase`, `status`) ou no novo (`estado`). */
function contagensPorEstado(
  banco: DatabaseSync,
  colunaDoEstado: { demanda: string; ticket: string },
): Record<"demanda" | "rodada" | "ticket", Contagem> {
  const agrupar = (sql: string): Contagem =>
    Object.fromEntries(
      banco
        .prepare(sql)
        .all()
        .map((l) => [`${String(l.projeto)}|${String(l.estado)}`, Number(l.n)]),
    );
  return {
    demanda: agrupar(`SELECT projeto, ${colunaDoEstado.demanda} AS estado, count(*) AS n FROM demanda GROUP BY 1, 2`),
    rodada: agrupar(
      `SELECT d.projeto, r.${colunaDoEstado.demanda} AS estado, count(*) AS n FROM rodada r JOIN demanda d ON d.id = r.demanda_id GROUP BY 1, 2`,
    ),
    ticket: agrupar(
      `SELECT d.projeto, t.${colunaDoEstado.ticket} AS estado, count(*) AS n FROM ticket_demanda t JOIN demanda d ON d.id = t.demanda_id GROUP BY 1, 2`,
    ),
  };
}

/** A contagem de antes com o estado traduzido; estados que passam a ser o mesmo somam. */
function traduzir(contagem: Contagem, estadoNovo: Record<string, string>): Contagem {
  const traduzida: Contagem = {};
  for (const [chave, quantas] of Object.entries(contagem)) {
    const [projeto, estado] = chave.split("|") as [string, string];
    const chaveTraduzida = `${projeto}|${estadoNovo[estado] ?? estado}`;
    traduzida[chaveTraduzida] = (traduzida[chaveTraduzida] ?? 0) + quantas;
  }
  return traduzida;
}

test("a migração 38 traduz cada estado de Demanda, Rodada e Ticket sem mudar as contagens por projeto", () => {
  const banco = bancoNaVersao37();
  const antes = contagensPorEstado(banco, { demanda: "fase", ticket: "status" });
  const configuracoesAntes = banco.prepare("SELECT count(*) AS n FROM configuracao_etapa_projeto").get()?.n;

  migrar(banco, MIGRACOES);

  const depois = contagensPorEstado(banco, { demanda: "estado", ticket: "estado" });
  assert.deepEqual(depois.demanda, traduzir(antes.demanda, ESTADO_NOVO_DA_DEMANDA));
  assert.deepEqual(depois.rodada, traduzir(antes.rodada, ESTADO_NOVO_DA_RODADA));
  assert.deepEqual(depois.ticket, traduzir(antes.ticket, ESTADO_NOVO_DO_TICKET));
  assert.equal(depois.ticket["loja|cancelado"], 2, "fechado e cancelado somam em cancelado");
  assert.equal(banco.prepare("SELECT count(*) AS n FROM configuracao_etapa_projeto").get()?.n, configuracoesAntes);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_LINHA_DE_BASE + MIGRACOES.length);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
});

test("cada estado antigo de Demanda e de Rodada vira o estado novo da tabela de renomes", () => {
  const banco = bancoNaVersao37();
  migrar(banco, MIGRACOES);

  for (const d of DEMANDAS) {
    const demanda = banco.prepare("SELECT estado, estado_alterado_em FROM demanda WHERE id = ?").get(d.id);
    assert.deepEqual(
      { ...demanda },
      { estado: ESTADO_NOVO_DA_DEMANDA[d.estadoAntigo], estado_alterado_em: ALTERACAO_DA_DEMANDA },
      d.estadoAntigo,
    );
  }
  for (const r of RODADAS) {
    const rodada = banco
      .prepare("SELECT estado FROM rodada WHERE demanda_id = ? AND rodada_id = ?")
      .get(DEMANDA_COM_RODADAS, r.rodada_id);
    assert.equal(rodada?.estado, ESTADO_NOVO_DA_RODADA[r.estadoAntigo], r.estadoAntigo);
  }
  for (const [ticket_id, etapa, estadoAntigo] of TICKETS) {
    const ticket = banco.prepare("SELECT etapa, estado FROM ticket_demanda WHERE ticket_id = ?").get(ticket_id);
    assert.deepEqual(
      { ...ticket },
      { etapa: ETAPA_NOVA[etapa], estado: ESTADO_NOVO_DO_TICKET[estadoAntigo] },
      `ticket ${String(ticket_id)}`,
    );
  }
});

test("a Rodada recebe o maior estado_alterado_em dos tickets dela, ou o da demanda se não tem ticket", () => {
  const banco = bancoNaVersao37();
  migrar(banco, MIGRACOES);

  const alteradaEm = (rodada_id: number) =>
    banco.prepare("SELECT estado_alterado_em AS em FROM rodada WHERE rodada_id = ?").get(rodada_id)?.em;
  assert.equal(alteradaEm(RODADA_COM_DOIS_TICKETS), DEPOIS_DO_TICKET_5);
  assert.equal(alteradaEm(RODADA_COM_UM_TICKET), EM);
  assert.equal(alteradaEm(RODADA_SEM_TICKET), ALTERACAO_DA_DEMANDA);
});

test("o ticket perde enviado_em e origem_ticket_id, mantém criado_em, concluido_em e o motivo da falha", () => {
  const banco = bancoNaVersao37();
  migrar(banco, MIGRACOES);

  const colunas = banco
    .prepare("PRAGMA table_info(ticket_demanda)")
    .all()
    .map((c) => c.name);
  assert.ok(!colunas.includes("enviado_em") && !colunas.includes("origem_ticket_id"));
  assert.ok(!colunas.includes("status") && !colunas.includes("status_alterado_em"));
  assert.ok(
    colunas.includes("criado_em") && colunas.includes("concluido_em") && colunas.includes("estado_alterado_em"),
  );
  const antigoFechado = banco
    .prepare("SELECT estado, motivo_falha, criado_em, concluido_em FROM ticket_demanda WHERE ticket_id = 2")
    .get();
  assert.deepEqual(
    { ...antigoFechado },
    { estado: "cancelado", motivo_falha: "timeout", criado_em: EM, concluido_em: EM },
  );
});

test("configuracao_etapa_projeto traduz as etapas demanda e sessao_em_aberto, e a sequência issue vira demanda", () => {
  const banco = bancoNaVersao37();
  migrar(banco, MIGRACOES);

  const etapas = banco
    .prepare("SELECT projeto, etapa FROM configuracao_etapa_projeto ORDER BY projeto, etapa")
    .all()
    .map((l) => `${String(l.projeto)}|${String(l.etapa)}`);
  assert.deepEqual(etapas, [
    "loja|ajustar_resultado",
    "loja|entender_e_desenhar",
    "loja|implementar",
    "site|entender_e_desenhar",
  ]);
  assert.equal(banco.prepare("SELECT valor FROM sequencia WHERE nome = 'demanda'").get()?.valor, 7);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM sequencia WHERE nome = 'issue'").get()?.n, 0);
});

test("o esquema novo recusa os estados e as etapas antigos", () => {
  const banco = bancoNaVersao37();
  migrar(banco, MIGRACOES);

  assert.throws(() => {
    banco.exec("UPDATE demanda SET estado = 'execucao' WHERE id = 'I-1'");
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("UPDATE rodada SET estado = 'desenvolvimento'");
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("UPDATE ticket_demanda SET estado = 'fechado'");
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("UPDATE ticket_demanda SET etapa = 'sessao_em_aberto'");
  }, /CHECK/);
});
