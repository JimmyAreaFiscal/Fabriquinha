import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { Etapa, Fase, TipoId } from "../dominio/primitivos.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir, escrever, migrar, novoId } from "./banco.ts";
import { listaSql, MIGRACOES } from "./migracoes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-banco-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const raizTemp = () => mkdtempSync(join(base, "raiz-"));
const permissao = (caminho: string) => statSync(caminho).mode & 0o777;
const valor = (banco: DatabaseSync, sql: string): unknown => Object.values(banco.prepare(sql).get() ?? {})[0];

/** Roda `trabalho` com as variáveis de ambiente trocadas (`undefined` remove) e restaura as originais. */
function comAmbiente<T>(variaveis: Record<string, string | undefined>, trabalho: () => T): T {
  const originais = Object.fromEntries(Object.keys(variaveis).map((nome) => [nome, process.env[nome]]));
  const aplicar = (valores: Record<string, string | undefined>) => {
    for (const [nome, v] of Object.entries(valores)) {
      if (v === undefined) Reflect.deleteProperty(process.env, nome);
      else process.env[nome] = v;
    }
  };
  aplicar(variaveis);
  try {
    return trabalho();
  } finally {
    aplicar(originais);
  }
}

test("abrir() usa $FABRIQUINHA_ROOT, com diretório 0700 e banco, -wal e -shm 0600", () => {
  const raiz = join(raizTemp(), "aninhada", "fabriquinha");
  const banco = comAmbiente({ FABRIQUINHA_ROOT: raiz }, () => abrir());
  escrever(banco, () => novoId(banco, "issue"));

  assert.equal(permissao(raiz), 0o700);
  for (const arquivo of ["fabriquinha.db", "fabriquinha.db-wal", "fabriquinha.db-shm"]) {
    assert.equal(permissao(join(raiz, arquivo)), 0o600, arquivo);
  }
  banco.close();
});

test("abrir() sem $FABRIQUINHA_ROOT usa ~/fabriquinha", () => {
  const home = raizTemp();
  comAmbiente({ HOME: home, FABRIQUINHA_ROOT: undefined }, () => {
    abrir().close();
  });
  assert.ok(statSync(join(home, "fabriquinha", "fabriquinha.db")).isFile());
});

test("abrir() corrige a permissão de raiz e banco que já existiam abertos demais", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  chmodSync(raiz, 0o755);
  chmodSync(join(raiz, "fabriquinha.db"), 0o644);
  abrir(raiz).close();
  assert.equal(permissao(raiz), 0o700);
  assert.equal(permissao(join(raiz, "fabriquinha.db")), 0o600);
});

test("toda conexão aplica WAL, foreign_keys, busy_timeout=5000 e synchronous=NORMAL", () => {
  const raiz = raizTemp();
  for (const banco of [abrir(raiz), abrir(raiz)]) {
    assert.equal(valor(banco, "PRAGMA journal_mode"), "wal");
    assert.equal(valor(banco, "PRAGMA foreign_keys"), 1);
    assert.equal(valor(banco, "PRAGMA busy_timeout"), 5000);
    assert.equal(valor(banco, "PRAGMA synchronous"), 1); // NORMAL
    banco.close();
  }
});

test("abrir() aplica as migrações e grava a versão; reabrir não reaplica", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  const banco = abrir(raiz); // CREATE TABLE sem IF NOT EXISTS: reaplicar falharia
  assert.equal(valor(banco, "PRAGMA user_version"), MIGRACOES.length);
  assert.equal(valor(banco, "SELECT count(*) FROM sequencia"), 0);
  banco.close();
});

test("a coluna projeto.link_produto é opcional", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
     VALUES ('p', '/r', 'main', 'github', '["t"]', 'k', '[{}]')`,
  );
  assert.equal(valor(banco, "SELECT link_produto FROM projeto"), null);
  banco.close();
});

test("o modelo da Auditoria na configuração: nasce nulo e o CHECK exige provedor e modelo juntos", () => {
  const banco = abrir(raizTemp());
  assert.equal(valor(banco, "SELECT auditoria_provedor FROM configuracao"), null);
  assert.equal(valor(banco, "SELECT auditoria_modelo FROM configuracao"), null);
  assert.throws(() => {
    banco.exec("UPDATE configuracao SET auditoria_provedor = 'anthropic'");
  }, /CHECK constraint failed/);
  assert.throws(() => {
    banco.exec("UPDATE configuracao SET auditoria_modelo = 'claude-opus-5-5'");
  }, /CHECK constraint failed/);
  banco.exec("UPDATE configuracao SET auditoria_provedor = 'anthropic', auditoria_modelo = 'claude-opus-5-5'");
  assert.equal(valor(banco, "SELECT auditoria_modelo FROM configuracao"), "claude-opus-5-5");
  banco.close();
});

test("as tabelas do Usuário Simulado: nome único por projeto, projeto e usuário existentes, anexo com hash e tamanho válidos", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
     VALUES ('p', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
     INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'p', 'Dona Maria', 'd')`,
  );
  const sha = "a".repeat(64);
  const falha = (sql: string, erro: RegExp) => {
    assert.throws(() => {
      banco.exec(sql);
    }, erro);
  };
  falha(
    "INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('p', 'Dona Maria', 'd')",
    /UNIQUE constraint failed/,
  );
  falha("INSERT INTO usuario_simulado (projeto, nome, descricao) VALUES ('fantasma', 'x', 'd')", /FOREIGN KEY/);
  falha(`INSERT INTO usuario_simulado_anexo VALUES (2, 'm.pdf', '${sha}', 1)`, /FOREIGN KEY/);
  falha(`INSERT INTO usuario_simulado_anexo VALUES (1, 'm.pdf', '${sha.slice(1)}', 1)`, /CHECK constraint failed/);
  falha(`INSERT INTO usuario_simulado_anexo VALUES (1, 'm.pdf', '${sha}', -1)`, /CHECK constraint failed/);
  banco.exec(`INSERT INTO usuario_simulado_anexo VALUES (1, 'm.pdf', '${sha}', 0)`);
  falha(`INSERT INTO usuario_simulado_anexo VALUES (1, 'm.pdf', '${sha}', 1)`, /UNIQUE constraint failed/);
  banco.close();
});

test("as tabelas da Tarefa: N de 1 a 20, projeto e usuário existentes, alocação única", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
     VALUES ('p', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
     INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'p', 'Dona Maria', 'd')`,
  );
  const falha = (sql: string, erro: RegExp) => {
    assert.throws(() => {
      banco.exec(sql);
    }, erro);
  };
  falha("INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES ('fantasma', 't', 1, 'x')", /FOREIGN KEY/);
  falha("INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES ('p', 't', 0, 'x')", /CHECK constraint failed/);
  falha("INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES ('p', 't', 21, 'x')", /CHECK constraint failed/);
  falha("INSERT INTO tarefa (projeto, texto, n, criada_em) VALUES ('p', '', 1, 'x')", /CHECK constraint failed/);
  banco.exec("INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'p', 't', 20, 'x')");
  falha("INSERT INTO tarefa_usuario VALUES (2, 1)", /FOREIGN KEY/);
  falha("INSERT INTO tarefa_usuario VALUES (1, 2)", /FOREIGN KEY/);
  banco.exec("INSERT INTO tarefa_usuario VALUES (1, 1)");
  falha("INSERT INTO tarefa_usuario VALUES (1, 1)", /UNIQUE constraint failed/);
  banco.close();
});

test("a tabela da execução simulada: status válido, falhou exige erro, concluída exige relatório JSON, tarefa e usuário existentes", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
     VALUES ('p', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
     INSERT INTO usuario_simulado (id, projeto, nome, descricao) VALUES (1, 'p', 'Dona Maria', 'd');
     INSERT INTO tarefa (id, projeto, texto, n, criada_em) VALUES (1, 'p', 't', 1, 'x')`,
  );
  const falha = (sql: string, erro: RegExp) => {
    assert.throws(() => {
      banco.exec(sql);
    }, erro);
  };
  const inserir = (valores: string) =>
    `INSERT INTO execucao_simulada (tarefa, usuario, status, relatorio, erro) VALUES ${valores}`;
  falha(inserir("(2, 1, 'na_fila', NULL, NULL)"), /FOREIGN KEY/);
  falha(inserir("(1, 2, 'na_fila', NULL, NULL)"), /FOREIGN KEY/);
  falha(inserir("(1, 1, 'pronta', NULL, NULL)"), /CHECK constraint failed/);
  falha(inserir("(1, 1, 'falhou', NULL, NULL)"), /CHECK constraint failed/);
  falha(inserir("(1, 1, 'na_fila', NULL, 'x')"), /CHECK constraint failed/);
  falha(inserir("(1, 1, 'concluida', NULL, NULL)"), /CHECK constraint failed/);
  falha(inserir("(1, 1, 'em_andamento', '{}', NULL)"), /CHECK constraint failed/);
  falha(inserir("(1, 1, 'concluida', 'não é json', NULL)"), /CHECK constraint failed/);
  banco.exec(inserir("(1, 1, 'na_fila', NULL, NULL), (1, 1, 'falhou', NULL, 'x'), (1, 1, 'concluida', '{}', NULL)"));
  assert.equal(valor(banco, "SELECT count(*) FROM execucao_simulada"), 3);
  banco.close();
});

test("abrir() propaga a falha de migração sem deixar a versão avançar", () => {
  const raiz = raizTemp();
  abrir(raiz).close();
  const direto = new DatabaseSync(join(raiz, "fabriquinha.db"));
  direto.exec("PRAGMA user_version = 0"); // a tabela já existe: a migração 1 vai falhar
  assert.throws(() => abrir(raiz), /table sequencia already exists/);
  assert.equal(valor(direto, "PRAGMA user_version"), 0);
  direto.close();
});

test("migrar() aplica em ordem só as pendentes, cada uma na sua transação", () => {
  const banco = new DatabaseSync(":memory:");
  const v1 = "CREATE TABLE a (x INTEGER)";
  const v2 = "INSERT INTO a VALUES (2)";
  migrar(banco, [v1]);
  migrar(banco, [v1, v2]);
  migrar(banco, [v1, v2]);
  assert.equal(valor(banco, "PRAGMA user_version"), 2);
  assert.deepEqual(
    banco
      .prepare("SELECT x FROM a")
      .all()
      .map((linha) => linha.x),
    [2],
  );

  const quebrada = "CREATE TABLE b (x INTEGER); INSERT INTO nao_existe VALUES (1)";
  assert.throws(() => {
    migrar(banco, [v1, v2, quebrada]);
  }, /no such table: nao_existe/);
  assert.equal(valor(banco, "PRAGMA user_version"), 2);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'b'"), 0);
  banco.close();
});

test("migrar() recusa banco mais novo que o código, sem alterá-lo", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA user_version = 3");
  assert.throws(
    () => {
      migrar(banco, ["CREATE TABLE a (x INTEGER)", "CREATE TABLE b (x INTEGER)"]);
    },
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message ===
        "o banco está na versão 3, mais nova que a 2 que esta Fabriquinha conhece (atualize a Fabriquinha antes de abrir este banco)",
  );
  assert.equal(valor(banco, "PRAGMA user_version"), 3);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master"), 0);
  banco.close();
});

/** A migração 16 é a da proposta de issue, depois das 12 a 15 da main. */
const VERSAO_PROPOSTA = 16;

/** A migração 10 é a do cancelamento (C22); as seguintes não a movem. */
const VERSAO_CANCELAMENTO = 10;

/** Banco na versão anterior à migração do cancelamento (C22), com um ticket de cada tipo de filho que aponta para `ticket`. */
function bancoAntesDoCancelamento(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES.slice(0, VERSAO_CANCELAMENTO - 1));
  banco.exec(`
    INSERT INTO projeto VALUES ('loja', '/r', 'main', 'github', '[]', '["t"]', 'k', '[{}]', '{}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'T', 'problema', 'desenho', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES (1, 1, 'registro', 'R', 'concluido', 'fabriquinha', 'x', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, origem_ticket, erro, criado_em) VALUES (2, 1, 'desenho', 'D', 'falhou', 'agente', 1, 'e', 'x');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em) VALUES (1, 2, 'autonomo', 's', 'falha', 'e', 'x', 'y');
    INSERT INTO decisao (id, issue, ticket, gate, aprovado, por, em) VALUES (1, 1, 1, 'registro', 1, 'auditor', 'x');
    INSERT INTO evidencia (id, ticket, tipo, produtor, em) VALUES (1, 1, 'comportamento', 'agente', 'x');
    INSERT INTO evidencia_arquivo VALUES (1, 'a.txt', '${"0".repeat(64)}', 'text/plain', 1);
  `);
  return banco;
}

test("a migração do cancelamento recria ticket com os status novos sem perder linhas nem FKs", () => {
  const banco = bancoAntesDoCancelamento();
  const antes = banco.prepare("SELECT * FROM ticket ORDER BY id").all();
  assert.throws(() => {
    banco.exec("UPDATE ticket SET status = 'fechado' WHERE id = 2");
  }, /CHECK/);

  migrar(banco, MIGRACOES);

  assert.equal(valor(banco, "PRAGMA user_version"), MIGRACOES.length);
  assert.equal(valor(banco, "PRAGMA foreign_keys"), 1);
  // A migração 17 acrescenta `enviado_em` e a 19, `devolucoes`, vazios nos tickets que já existiam.
  assert.deepEqual(
    banco
      .prepare("SELECT * FROM ticket ORDER BY id")
      .all()
      .map((l) => ({ ...l })),
    antes.map((l) => ({ ...l, enviado_em: null, devolucoes: null })),
  );
  assert.equal(valor(banco, "SELECT count(*) FROM execucao"), 1);
  assert.equal(valor(banco, "SELECT count(*) FROM decisao"), 1);
  assert.equal(valor(banco, "SELECT count(*) FROM evidencia_arquivo"), 1);
  assert.equal(valor(banco, "SELECT cancelada_em FROM issue"), null);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'ticket_novo'"), 0);
  for (const filha of ["execucao", "decisao", "evidencia", "commit_ticket", "retrabalho"]) {
    const alvos = banco.prepare(`PRAGMA foreign_key_list(${filha})`).all();
    assert.ok(
      alvos.some((fk) => fk.table === "ticket"),
      filha,
    );
  }
  for (const indice of ["ux_ticket_em_execucao", "ux_ticket_etapa_unica", "ix_issue_dep_dep"]) {
    assert.equal(valor(banco, `SELECT count(*) FROM sqlite_master WHERE name = '${indice}'`), 1, indice);
  }

  banco.exec("UPDATE ticket SET status = 'fechado', erro = NULL WHERE id = 2");
  banco.exec(
    "INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (3, 1, 'sessao', 'S', 'cancelado', 'auditor', 'x')",
  );
  assert.throws(() => {
    banco.exec("UPDATE ticket SET status = 'arquivado' WHERE id = 3");
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("DELETE FROM ticket WHERE id = 1");
  }, /FOREIGN KEY/);
  assert.throws(() => {
    banco.exec("UPDATE issue SET cancelada_em = 'x', fase = 'concluida', concluida_em = 'x' WHERE id = 1");
  }, /CHECK/);
  banco.close();
});

test("a migração da proposta recria sequencia com o tipo novo, preserva os valores e cria proposta_issue", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES.slice(0, VERSAO_PROPOSTA - 1));
  banco.exec("INSERT INTO sequencia VALUES ('issue', 3), ('ticket', 5)");
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness) VALUES ('loja', '/r', 'main', 'github', '["t"]', 'k', '[{}]')`,
  );
  assert.throws(() => {
    banco.exec("INSERT INTO sequencia VALUES ('proposta', 1)");
  }, /CHECK/);

  migrar(banco, MIGRACOES.slice(0, VERSAO_PROPOSTA));

  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_PROPOSTA);
  assert.deepEqual(
    banco
      .prepare("SELECT * FROM sequencia ORDER BY nome")
      .all()
      .map((l) => [l.nome, l.valor]),
    [
      ["issue", 3],
      ["ticket", 5],
    ],
  );
  assert.equal(valor(banco, "SELECT count(*) FROM projeto"), 1);
  banco.exec("INSERT INTO sequencia VALUES ('proposta', 1)");
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'sequencia_nova'"), 0);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'ix_proposta_issue_ticket'"), 1);

  banco.exec(`
    INSERT INTO issue (id, projeto, fase, criada_em) VALUES (1, 'loja', 'registro', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (1, 1, 'registro', 'R', 'aberto', 'fabriquinha', 'x');
  `);
  const proposta = (campos: string, valores: string) => {
    banco.exec(
      `INSERT INTO proposta_issue (ticket, titulo, mensagem, arquivos, em, ${campos}) VALUES (1, 'T', 'M', 31, 'x', ${valores})`,
    );
  };
  proposta("status", "'pendente'");
  proposta("status, issue_criada, decidida_em", "'aceita', 1, 'y'");
  proposta("status, decidida_em", "'recusada', 'y'");
  for (const ruim of [
    ["status", "'outra'"],
    ["status, issue_criada, decidida_em", "'pendente', 1, NULL"],
    ["status, decidida_em", "'aceita', 'y'"],
    ["status, issue_criada, decidida_em", "'recusada', 1, 'y'"],
    ["status, decidida_em", "'pendente', 'y'"],
    ["status", "'recusada'"],
    ["status, issue_criada, decidida_em", "'aceita', 9, 'y'"],
  ] as [string, string][]) {
    assert.throws(() => {
      proposta(...ruim);
    }, /CHECK|FOREIGN KEY/);
  }
  assert.throws(() => {
    banco.exec(
      "INSERT INTO proposta_issue (ticket, titulo, mensagem, arquivos, status, em) VALUES (1, 'T', '  ', 1, 'pendente', 'x')",
    );
  }, /CHECK/);
  assert.throws(() => {
    banco.exec(
      "INSERT INTO proposta_issue (ticket, titulo, mensagem, arquivos, status, em) VALUES (1, 'T', 'M', -1, 'pendente', 'x')",
    );
  }, /CHECK/);
  assert.throws(() => {
    banco.exec(
      "INSERT INTO proposta_issue (ticket, titulo, mensagem, arquivos, status, em) VALUES (9, 'T', 'M', 1, 'pendente', 'x')",
    );
  }, /FOREIGN KEY/);
  banco.close();
});

test("a migração do envio (C25) devolve à execução o desenho que esperava o gate e troca o vídeo explicativo", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES.slice(0, VERSAO_PROPOSTA));
  // O banco antigo aceitava video_explicativo; o CHECK desta versão de teste já é o novo, então ele é ignorado aqui.
  banco.exec(`
    PRAGMA ignore_check_constraints = ON;
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'T', 'problema', 'aprovacao_desenho', 'x');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, cancelada_em) VALUES (2, 'loja', 'T', 'problema', 'aprovacao_desenho', 'x', 'y');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (3, 'loja', 'T', 'problema', 'desenvolvimento', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'desenho', 'D', 'concluido', 'fabriquinha', 'x', 'antigo'),
      (2, 1, 'desenho', 'D', 'concluido', 'fabriquinha', 'x', 'enviado'),
      (3, 2, 'desenho', 'D', 'concluido', 'fabriquinha', 'x', 'x'),
      (4, 3, 'desenho', 'D', 'concluido', 'fabriquinha', 'x', 'x'),
      (5, 3, 'encerramento', 'E', 'concluido', 'fabriquinha', 'x', 'x');
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES
      (1, 5, 'video_explicativo', 'agente', '{"roteiro":"r"}', 'x'),
      (2, 5, 'mensagem_pr', 'agente', '{}', 'x');
    INSERT INTO evidencia_arquivo VALUES (1, 'v.webm', '${"0".repeat(64)}', 'video/webm', 1);
    PRAGMA ignore_check_constraints = OFF;
  `);

  migrar(banco, MIGRACOES);

  assert.equal(valor(banco, "PRAGMA user_version"), MIGRACOES.length);
  assert.deepEqual(
    banco
      .prepare("SELECT id, status, concluido_em, enviado_em FROM ticket ORDER BY id")
      .all()
      .map((l) => Object.values(l)),
    [
      [1, "concluido", "antigo", null],
      [2, "em_execucao", null, "enviado"],
      [3, "concluido", "x", null],
      [4, "concluido", "x", null],
      [5, "concluido", "x", null],
    ],
  );
  assert.deepEqual(
    banco
      .prepare("SELECT id, tipo, dados FROM evidencia ORDER BY id")
      .all()
      .map((l) => Object.values(l)),
    [
      [1, "video_demonstracao", '{"roteiro":"r"}'],
      [2, "mensagem_pr", "{}"],
    ],
  );
  assert.equal(valor(banco, "SELECT nome FROM evidencia_arquivo WHERE evidencia = 1"), "v.webm");
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'evidencia_nova'"), 0);
  assert.ok(
    banco
      .prepare("PRAGMA foreign_key_list(evidencia_arquivo)")
      .all()
      .some((fk) => fk.table === "evidencia"),
  );
  banco.exec("INSERT INTO evidencia (ticket, tipo, produtor, em) VALUES (5, 'aula_codigo', 'agente', 'x')");
  assert.throws(() => {
    banco.exec("INSERT INTO evidencia (ticket, tipo, produtor, em) VALUES (5, 'video_explicativo', 'agente', 'x')");
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("UPDATE ticket SET enviado_em = 'x' WHERE id = 5");
  }, /CHECK/);
  banco.close();
});

/** A migração 18 é a da IA externa, depois da 17 do envio (C25). */
const VERSAO_EXTERNO = 18;

test("a migração da IA externa recria ticket e comando sem perder linhas, FKs nem índices", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES.slice(0, VERSAO_EXTERNO - 1));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'T', 'problema', 'registro', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, enviado_em)
      VALUES (1, 1, 'registro', 'R', 'em_execucao', 'fabriquinha', 'x', 'y');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em) VALUES (1, 1, 'interativo', 's', 'em_andamento', 'x');
    INSERT INTO comando (id, issue, nome, ator, fase, em) VALUES (1, 1, 'editarIssue', 'agente', 'registro', 'x');
  `);
  const antes = (tabela: string) =>
    banco
      .prepare(`SELECT * FROM ${tabela} ORDER BY id`)
      .all()
      .map((l) => ({ ...l }));
  const [tickets, comandos] = [antes("ticket"), antes("comando")];

  migrar(banco, MIGRACOES.slice(0, VERSAO_EXTERNO));

  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_EXTERNO);
  assert.deepEqual(antes("ticket"), tickets);
  assert.deepEqual(antes("comando"), comandos);
  for (const sobra of ["ticket_novo", "comando_novo"]) {
    assert.equal(valor(banco, `SELECT count(*) FROM sqlite_master WHERE name = '${sobra}'`), 0, sobra);
  }
  for (const indice of ["ux_ticket_em_execucao", "ux_ticket_etapa_unica"]) {
    assert.equal(valor(banco, `SELECT count(*) FROM sqlite_master WHERE name = '${indice}'`), 1, indice);
  }
  assert.ok(
    banco
      .prepare("PRAGMA foreign_key_list(execucao)")
      .all()
      .some((fk) => fk.table === "ticket"),
  );
  banco.exec(`
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (2, 'loja', 'T', 'problema', 'registro', 'x');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES (2, 2, 'registro', 'R', 'em_execucao', 'externo', 'x');
    INSERT INTO comando (issue, nome, ator, fase, em) VALUES (2, 'registrarEvidencia', 'externo', 'registro', 'x');
  `);
  assert.throws(() => {
    banco.exec(
      "INSERT INTO comando (issue, nome, ator, fase, em) VALUES (2, 'editarIssue', 'intruso', 'registro', 'x')",
    );
  }, /CHECK/);
  assert.throws(() => {
    banco.exec("UPDATE ticket SET enviado_em = 'x', etapa = 'revisao' WHERE id = 2");
  }, /CHECK/);
  banco.close();
});

test("migrar() desfaz a migração e religa as FKs quando ela deixa referência órfã", () => {
  const banco = bancoAntesDoCancelamento();
  banco.exec("PRAGMA foreign_keys = OFF");
  banco.exec(
    "INSERT INTO decisao (id, issue, ticket, gate, aprovado, por, em) VALUES (2, 1, 99, 'desenho', 1, 'auditor', 'x')",
  );

  assert.throws(
    () => {
      migrar(banco, MIGRACOES);
    },
    (erro) => erro instanceof ErroDeRegra && erro.message.includes("deixou 1 referência(s) órfã(s)"),
  );
  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_CANCELAMENTO - 1);
  assert.equal(valor(banco, "PRAGMA foreign_keys"), 1);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'ticket_novo'"), 0);
  assert.equal(valor(banco, "SELECT count(*) FROM pragma_table_info('issue') WHERE name = 'cancelada_em'"), 0);
  banco.close();
});

test("as listas dos CHECK ... IN (...) vêm dos enums zod", () => {
  assert.equal(listaSql(Etapa), "'registro','desenho','desenvolvimento','revisao','encerramento','sessao'");
  assert.equal(listaSql(Fase).split(",").length, Fase.options.length);

  const banco = abrir(raizTemp());
  assert.match(
    String(valor(banco, "SELECT sql FROM sqlite_master WHERE name = 'sequencia'")),
    new RegExp(listaSql(TipoId)),
  );
  assert.throws(() => {
    banco.exec("INSERT INTO sequencia VALUES ('projeto', 0)");
  }, /CHECK constraint failed/);
  banco.close();
});

test("escrever() pega o lock de escrita no início (BEGIN IMMEDIATE)", () => {
  const raiz = raizTemp();
  const banco = abrir(raiz);
  const outro = abrir(raiz);
  outro.exec("PRAGMA busy_timeout = 0");
  escrever(banco, () => {
    // Ainda nada foi escrito; com BEGIN DEFERRED a outra conexão conseguiria o lock.
    assert.throws(() => {
      outro.exec("BEGIN IMMEDIATE");
    }, /database is locked/);
  });
  outro.exec("BEGIN IMMEDIATE; ROLLBACK");
  banco.close();
  outro.close();
});

test("escrever() faz ROLLBACK e propaga o erro original", () => {
  const banco = abrir(raizTemp());
  const original = new Error("falhou no meio");
  assert.throws(
    () =>
      escrever(banco, () => {
        novoId(banco, "issue");
        throw original;
      }),
    (erro) => erro === original,
  );
  assert.equal(banco.isTransaction, false);
  assert.equal(
    escrever(banco, () => novoId(banco, "issue")),
    1,
  );
  banco.close();
});

test("escrever() desfaz e propaga quando o próprio COMMIT falha", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    "CREATE TABLE pai (id INTEGER PRIMARY KEY); CREATE TABLE filho (pai INTEGER REFERENCES pai(id) DEFERRABLE INITIALLY DEFERRED)",
  );
  assert.throws(() => {
    escrever(banco, () => {
      banco.exec("INSERT INTO filho VALUES (99)");
    });
  }, /FOREIGN KEY constraint failed/);
  assert.equal(banco.isTransaction, false);
  assert.equal(valor(banco, "SELECT count(*) FROM filho"), 0);
  banco.close();
});

test("novoId() tem uma sequência por tipo e só roda dentro da transação", () => {
  const banco = abrir(raizTemp());
  const ids = escrever(banco, () => [novoId(banco, "issue"), novoId(banco, "ticket"), novoId(banco, "issue")]);
  assert.deepEqual(ids, [1, 1, 2]);
  assert.equal(
    escrever(banco, () => novoId(banco, "ticket")),
    2,
  );
  assert.throws(() => novoId(banco, "issue"), /fora de transação/);
  banco.close();
});

/** A migração 19 acrescenta o effort por etapa ao projeto. */
const VERSAO_EFFORTS = 19;

test("a migração dos efforts dá {} ao projeto gravado antes dela", () => {
  const banco = new DatabaseSync(":memory:");
  migrar(banco, MIGRACOES.slice(0, VERSAO_EFFORTS - 1));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/r', 'main', 'github', '["t"]', 'k', '[{}]');
  `);
  migrar(banco, MIGRACOES.slice(0, VERSAO_EFFORTS));
  assert.equal(valor(banco, "SELECT efforts FROM projeto WHERE nome = 'loja'"), "{}");
  banco.close();
});
