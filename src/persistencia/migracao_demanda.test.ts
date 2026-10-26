import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";

const V23 = 23;
const T = "'2026-01-01T00:00:00.000Z'";

const versao = (banco: DatabaseSync) =>
  (banco.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;

const tabelas = (banco: DatabaseSync): string[] =>
  banco
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((t) => String(t.name));

const fotografia = (banco: DatabaseSync) =>
  tabelas(banco).map((t) => [t, JSON.stringify(banco.prepare(`SELECT * FROM "${t}"`).all())]);

// Uma linha em cada tabela legada, para provar que a migração aditiva não toca em nada.
const LEGADO = `
  INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
    VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
  INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'p', 't', 'problema', 'desenho', ${T}), (2, 'p', 't', 'problema', 'desenho', ${T});
  INSERT INTO issue_dep VALUES (2, 1);
  INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (1, 1, 'desenho', 't', 'aberto', 'auditor', ${T});
  INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em) VALUES (1, 1, 'autonomo', 's', 'em_andamento', ${T});
  INSERT INTO decisao (id, issue, ticket, gate, aprovado, por, em) VALUES (1, 1, 1, 'desenho', 1, 'auditor', ${T});
  INSERT INTO evidencia (id, ticket, tipo, produtor, em) VALUES (1, 1, 'comportamento', 'agente', ${T});
  INSERT INTO evidencia_arquivo VALUES (1, 'a', '${"0".repeat(64)}', 'text/plain', 1);
  UPDATE configuracao SET intervalo_min = 7;
  INSERT INTO commit_ticket VALUES ('${"a".repeat(40)}', 1, 'm', ${T});
  INSERT INTO arquivo_commit VALUES ('${"a".repeat(40)}', 'x', NULL, 'A', 1, 0);
  INSERT INTO uso VALUES (1, 'p', 'm', 1, 1, 1, 1, 1, 0.5);
  INSERT INTO retrabalho VALUES ('c', NULL, 'autor', 1, 1);
  INSERT INTO varredura_base VALUES ('p', '${"a".repeat(40)}', ${T});
  INSERT INTO usuario_simulado VALUES (1, 'p', 'u', 'd');
  INSERT INTO usuario_simulado_anexo VALUES (1, 'a', '${"0".repeat(64)}', 1);
  INSERT INTO tarefa VALUES (1, 'p', 'x', 1, ${T});
  INSERT INTO tarefa_usuario VALUES (1, 1);
  INSERT INTO execucao_simulada (id, tarefa, usuario, status) VALUES (1, 1, 1, 'na_fila');
  INSERT INTO proposta_issue (id, ticket, titulo, mensagem, arquivos, status, em) VALUES (1, 1, 't', 'm', 0, 'pendente', ${T});
  INSERT INTO comando VALUES (1, 1, 'c', 'auditor', 'desenho', ${T});
  INSERT INTO iteracao VALUES (1, 1, 'mensagem', ${T});
  INSERT INTO configuracao_etapa_projeto VALUES ('p', 'demanda', NULL, NULL, NULL);
  INSERT INTO comando_preparacao_projeto VALUES ('p', 1, 'x');
  INSERT INTO fitness_function_projeto VALUES ('p', 'f', 'c', 'd');
  INSERT INTO linguagem_projeto VALUES ('p', '.', 'ts', 't');
  INSERT INTO configuracao_e2e VALUES ('p', '.', 'b', 'r', 1);
  INSERT INTO glob_e2e VALUES ('p', '.', 'g');
  UPDATE sequencia SET valor = 5;`;

const NOVAS = [
  "caminho_ticket",
  "criterio_citado_rodada",
  "decisao_ticket",
  "demanda",
  "dependencia_rodada",
  "dependencia_ticket",
  "evidencia_demanda",
  "rodada",
  "ticket_demanda",
];

// Demanda D-1: rodadas 1 e 2; tickets 1 e 2 na rodada 1, 3 na rodada 2, 4 sem rodada.
const banco = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`${LEGADO}
    INSERT INTO demanda VALUES ('D-1', 'p', 't', 'problema', 'd', 'execucao', ${T}, 'f', 's', 0, 'fabriquinha/D-1');
    INSERT INTO rodada VALUES ('D-1', 1, 't', 'desenvolvimento', 0, 'fabriquinha/D-1-1'), ('D-1', 2, 't', 'desenvolvimento', 0, 'fabriquinha/D-1-2');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id) VALUES
      ('D-1', 1, 'implementar', 'aberto', ${T}, 1), ('D-1', 2, 'implementar', 'aberto', ${T}, 1),
      ('D-1', 3, 'implementar', 'aberto', ${T}, 2), ('D-1', 4, 'demanda', 'aberto', ${T}, NULL);`);
  return b;
};

const recusa = (b: DatabaseSync, sql: string, padrao: RegExp) => {
  assert.throws(() => {
    b.exec(sql);
  }, padrao);
};

test("CA-1: migrar v23 → v24 só acrescenta as tabelas novas e deixa as legadas iguais", () => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES.slice(0, V23));
  b.exec(LEGADO);
  const antes = fotografia(b);
  assert.equal(versao(b), V23);
  migrar(b, MIGRACOES.slice(0, 24));
  assert.equal(versao(b), 24);
  assert.deepEqual(
    fotografia(b).filter(([t]) => !NOVAS.includes(String(t))),
    antes,
  );
  assert.deepEqual(
    tabelas(b).filter((t) => !antes.some(([a]) => a === t)),
    NOVAS,
  );
  for (const t of NOVAS) assert.deepEqual(b.prepare(`SELECT * FROM ${t}`).all(), []);
});

test("CA-5: dependência de ticket só liga tickets da mesma rodada", () => {
  const b = banco();
  b.exec("INSERT INTO dependencia_ticket VALUES ('D-1', 2, 1, 1)");
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 3, 1, 2)", /FOREIGN KEY/);
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 1, 3, 1)", /FOREIGN KEY/);
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 4, 1, 1)", /FOREIGN KEY/);
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 1, 4, 1)", /FOREIGN KEY/);
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 4, 1, NULL)", /NOT NULL/);
});

test("CA-6: ticket com rodada inexistente é recusado por chave estrangeira", () => {
  const b = banco();
  recusa(
    b,
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id)
     VALUES ('D-1', 9, 'implementar', 'aberto', ${T}, 99)`,
    /FOREIGN KEY/,
  );
});

test("CA-7: nota fora de 1 a 5 é recusada", () => {
  const b = banco();
  const decisao = (nota: number) =>
    `INSERT INTO decisao_ticket VALUES ('D-1', 1, ${String(nota)}, 'aprovado', ${String(nota)}, NULL, 'auditor', ${T})`;
  recusa(b, decisao(0), /CHECK/);
  recusa(b, decisao(6), /CHECK/);
  b.exec(decisao(1));
  b.exec(decisao(5));
});

test("CA-8: ninguém depende de si mesmo", () => {
  const b = banco();
  recusa(b, "INSERT INTO dependencia_ticket VALUES ('D-1', 1, 1, 1)", /CHECK/);
  recusa(b, "INSERT INTO dependencia_rodada VALUES ('D-1', 1, 1)", /CHECK/);
  b.exec("INSERT INTO dependencia_rodada VALUES ('D-1', 2, 1)");
  recusa(b, "INSERT INTO dependencia_rodada VALUES ('D-1', 2, 99)", /FOREIGN KEY/);
});

test("filhos de rodada e de ticket exigem o pai da mesma demanda", () => {
  const b = banco();
  recusa(b, "INSERT INTO criterio_citado_rodada VALUES ('D-1', 99, 'CA-1')", /FOREIGN KEY/);
  recusa(b, "INSERT INTO caminho_ticket VALUES ('D-1', 99, 'a')", /FOREIGN KEY/);
  recusa(b, "INSERT INTO decisao_ticket VALUES ('D-1', 99, 1, 'aprovado', NULL, NULL, 'auditor', 'x')", /FOREIGN KEY/);
  recusa(b, "INSERT INTO rodada VALUES ('D-9', 1, 't', 'revisao', 0, 'b')", /FOREIGN KEY/);
});

test("CA-9: evidência não pode ter rodada e ticket ao mesmo tempo", () => {
  const b = banco();
  recusa(b, `INSERT INTO evidencia_demanda VALUES ('e', 'D-1', 1, 1, 'comportamento', '{}', ${T})`, /CHECK/);
});

test("CA-10: dono de evidência inexistente é recusado por chave estrangeira composta", () => {
  const b = banco();
  recusa(b, `INSERT INTO evidencia_demanda VALUES ('e', 'D-1', 99, NULL, 'comportamento', '{}', ${T})`, /FOREIGN KEY/);
  recusa(b, `INSERT INTO evidencia_demanda VALUES ('e', 'D-1', NULL, 99, 'comportamento', '{}', ${T})`, /FOREIGN KEY/);
  recusa(b, `INSERT INTO evidencia_demanda VALUES ('e', NULL, NULL, NULL, 'comportamento', '{}', ${T})`, /NOT NULL/);
  recusa(b, `INSERT INTO evidencia_demanda VALUES ('e', 'D-1', NULL, NULL, 'comportamento', 'x', ${T})`, /CHECK/);
});

test("CA-12: o índice único parcial do dono recusa a segunda evidência do mesmo tipo", () => {
  const b = banco();
  const ins = (id: string, r: string, t: string, tipo = "comportamento") =>
    `INSERT INTO evidencia_demanda VALUES ('${id}', 'D-1', ${r}, ${t}, '${tipo}', '{}', ${T})`;
  for (const [r, t] of [
    ["NULL", "NULL"],
    ["1", "NULL"],
    ["NULL", "1"],
  ] as const) {
    b.exec(ins(`a${r}${t}`, r, t));
    recusa(b, ins(`b${r}${t}`, r, t), /UNIQUE/);
    b.exec(ins(`c${r}${t}`, r, t, "prototipo"));
  }
  b.exec(ins("outro", "2", "NULL"));
  b.exec(ins("outro-ticket", "NULL", "2"));
});
