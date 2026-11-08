import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 4;
const EM = "2026-01-01T00:00:00.000Z";

const TICKET_DA_ETAPA: Record<string, number> = {
  entender_e_desenhar: 1,
  planejar: 2,
  encerrar_rodada: 3,
  revisar_rodada: 4,
  revisar_demanda: 5,
  implementar: 6,
};

/** Um banco na versão 40, com um ticket de cada etapa âncora (e um `implementar`), sem decisão. */
function bancoNaVersao40(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, 4));
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'Titulo', 'funcionalidade', 'Descricao', 'em_execucao', '${EM}', 'ferramenta', 'sessao', 1, 'fabriquinha/I-1');
    INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
      VALUES ('I-1', 1, 'Rodada', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1');
  `);
  const inserirTicket = banco.prepare(
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id) VALUES ('I-1', ?, ?, 'concluido', ?, ?)`,
  );
  for (const [etapa, ticket] of Object.entries(TICKET_DA_ETAPA)) {
    const daRodada = ["encerrar_rodada", "revisar_rodada", "implementar"].includes(etapa);
    inserirTicket.run(ticket, etapa, EM, daRodada ? 1 : null);
  }
  return banco;
}

function gravarDecisao(
  banco: DatabaseSync,
  etapa: string,
  decisaoId: number,
  resultado: "aprovado" | "recusado",
  extra: { nota?: number; motivo?: string; por?: "auditor" | "agente"; trabalho?: string } = {},
): void {
  const por = extra.por ?? "auditor";
  banco
    .prepare(
      `INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, resultado, nota, motivo, por_tipo, por_trabalho_id, em)
       VALUES ('I-1', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      TICKET_DA_ETAPA[etapa] ?? 0,
      decisaoId,
      resultado,
      extra.nota ?? null,
      extra.motivo ?? null,
      por,
      por === "agente" ? (extra.trabalho ?? "E-1") : null,
      EM,
    );
}

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((linha) => ({ ...linha }));

const gateDaDecisao = (banco: DatabaseSync, etapa: string) =>
  banco.prepare("SELECT gate FROM decisao_ticket WHERE ticket_id = ?").get(TICKET_DA_ETAPA[etapa] ?? 0)?.gate;

test("a migração 41 dá a cada decisão o gate da etapa do ticket âncora", () => {
  const banco = bancoNaVersao40();
  for (const etapa of Object.keys(TICKET_DA_ETAPA).filter((e) => e !== "implementar"))
    gravarDecisao(banco, etapa, 1, "aprovado");

  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE + 1));

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(
    ["entender_e_desenhar", "planejar", "encerrar_rodada", "revisar_rodada", "revisar_demanda"].map((e) =>
      gateDaDecisao(banco, e),
    ),
    ["gate_demanda", "gate_planejamento", "gate_pr", "gate_revisao_rodada", "gate_revisao_demanda"],
  );
});

test("a migração 41 troca o valor antigo por reprovado e preserva nota, motivo, por e em", () => {
  const banco = bancoNaVersao40();
  gravarDecisao(banco, "revisar_rodada", 1, "recusado", { motivo: "faltou teste", por: "agente", trabalho: "E-9" });
  gravarDecisao(banco, "encerrar_rodada", 1, "aprovado", { nota: 4 });
  gravarDecisao(banco, "entender_e_desenhar", 1, "recusado", { motivo: "fora do escopo" });
  const antes = linhas(
    banco,
    "SELECT ticket_id, decisao_id, nota, motivo, por_tipo, por_trabalho_id, em FROM decisao_ticket ORDER BY rowid",
  );

  migrar(banco, MIGRACOES);

  assert.deepEqual(
    linhas(
      banco,
      "SELECT ticket_id, decisao_id, nota, motivo, por_tipo, por_trabalho_id, em FROM decisao_ticket ORDER BY rowid",
    ),
    antes,
  );
  assert.deepEqual(linhas(banco, "SELECT ticket_id, resultado FROM decisao_ticket ORDER BY rowid"), [
    { ticket_id: 4, resultado: "reprovado" },
    { ticket_id: 3, resultado: "aprovado" },
    { ticket_id: 1, resultado: "reprovado" },
  ]);
});

test("a migração 41 confere o gate de cada um dos 4 gates antigos com o histórico", () => {
  const banco = bancoNaVersao40();
  const historico = [
    ["entender_e_desenhar", "registro"],
    ["planejar", "desenho"],
    ["encerrar_rodada", "pr"],
    ["revisar_rodada", "revisao"],
  ] as const;
  for (const [etapa, gateAntigo] of historico) {
    gravarDecisao(banco, etapa, 1, "aprovado");
    banco
      .prepare("INSERT INTO decisao_ticket_historico VALUES ('I-1', ?, 1, ?)")
      .run(TICKET_DA_ETAPA[etapa] ?? 0, gateAntigo);
  }
  gravarDecisao(banco, "revisar_demanda", 1, "aprovado"); // sem histórico: o gate novo não existia

  migrar(banco, MIGRACOES);

  assert.equal(banco.prepare("SELECT count(*) AS n FROM decisao_ticket").get()?.n, 5);
  assert.equal(gateDaDecisao(banco, "revisar_rodada"), "gate_revisao_rodada");
});

test("a migração 41 recusa histórico que diverge da etapa, com o banco na v40 intacto", () => {
  const banco = bancoNaVersao40();
  gravarDecisao(banco, "planejar", 1, "recusado", { motivo: "refaça" });
  banco
    .prepare("INSERT INTO decisao_ticket_historico VALUES ('I-1', ?, 1, 'registro')")
    .run(TICKET_DA_ETAPA.planejar ?? 0);

  assert.throws(
    () => {
      migrar(banco, MIGRACOES);
    },
    (erro) => erro instanceof ErroDeRegra && erro.message.includes("I-1.T2#1"),
  );

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  assert.equal(banco.prepare("SELECT resultado FROM decisao_ticket").get()?.resultado, "recusado");
  assert.equal(banco.prepare("SELECT count(*) AS n FROM decisao_ticket_historico").get()?.n, 1);
});

test("a migração 41 recusa decisão de ticket que não é de uma etapa âncora, com o banco na v40 intacto", () => {
  const banco = bancoNaVersao40();
  gravarDecisao(banco, "implementar", 1, "aprovado");

  assert.throws(
    () => {
      migrar(banco, MIGRACOES);
    },
    (erro) => erro instanceof ErroDeRegra && erro.message.includes("I-1.T6#1"),
  );

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  assert.equal(banco.prepare("SELECT count(*) AS n FROM decisao_ticket").get()?.n, 1);
});

test("depois da migração 41 não há histórico de decisão, as FKs fecham e o CHECK vale", () => {
  const banco = bancoNaVersao40();
  gravarDecisao(banco, "entender_e_desenhar", 1, "recusado", { motivo: "fora do escopo" });

  migrar(banco, MIGRACOES);

  assert.equal(
    banco.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'decisao_ticket_historico'").get()?.n,
    0,
  );
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const inserir = (gate: string | null, resultado: string) => {
    banco
      .prepare(
        `INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, motivo, por_tipo, em)
         VALUES ('I-1', 2, 9, ?, ?, 'm', 'auditor', ?)`,
      )
      .run(gate, resultado, EM);
  };
  assert.throws(() => {
    inserir("gate_planejamento", "recusado");
  }, /CHECK constraint failed/);
  assert.throws(() => {
    inserir(null, "reprovado");
  }, /NOT NULL constraint failed/);
  assert.throws(() => {
    inserir("registro", "reprovado");
  }, /CHECK constraint failed/);
  inserir("gate_planejamento", "reprovado");
});
