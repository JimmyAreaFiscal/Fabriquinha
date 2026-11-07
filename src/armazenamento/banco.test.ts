import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { abrir, escrever, migrar, novoId } from "./banco.ts";
import { MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

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
  escrever(banco, () => novoId(banco, "demanda"));

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
  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_LINHA_DE_BASE + MIGRACOES.length);
  assert.equal(valor(banco, "SELECT count(*) FROM sequencia"), 0);
  banco.close();
});

test("a coluna projeto.link_produto é opcional", () => {
  const banco = abrir(raizTemp());
  banco.exec(
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
     VALUES ('p', '/r', 'main', 'github', 'k')`,
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
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
     VALUES ('p', '/r', 'main', 'github', 'k');
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
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
     VALUES ('p', '/r', 'main', 'github', 'k');
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
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
     VALUES ('p', '/r', 'main', 'github', 'k');
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
  direto.exec("PRAGMA user_version = 0"); // a tabela já existe: a linha de base vai falhar
  assert.throws(() => abrir(raiz), /table projeto already exists/);
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
  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_LINHA_DE_BASE + 2);
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
  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_LINHA_DE_BASE + 2);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master WHERE name = 'b'"), 0);
  banco.close();
});

test("migrar() recusa banco mais novo que o código, sem alterá-lo", () => {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA user_version = 40");
  assert.throws(
    () => {
      migrar(banco, ["CREATE TABLE a (x INTEGER)", "CREATE TABLE b (x INTEGER)"]);
    },
    (erro) =>
      erro instanceof ErroDeRegra &&
      erro.message ===
        "o banco está na versão 40, mais nova que a 38 que esta Fabriquinha conhece (atualize a Fabriquinha antes de abrir este banco)",
  );
  assert.equal(valor(banco, "PRAGMA user_version"), 40);
  assert.equal(valor(banco, "SELECT count(*) FROM sqlite_master"), 0);
  banco.close();
});

test("migrar() desfaz a migração e religa as FKs quando ela deixa referência órfã", () => {
  const banco = new DatabaseSync(":memory:");
  const comOrfa = `INSERT INTO varredura_base VALUES ('nao_existe', '${"0".repeat(40)}', 'x')`;
  assert.throws(
    () => {
      migrar(banco, [comOrfa]);
    },
    (erro) => erro instanceof ErroDeRegra && erro.message.includes("a migração 37 deixou 1 referência(s) órfã(s)"),
  );
  assert.equal(valor(banco, "PRAGMA user_version"), VERSAO_LINHA_DE_BASE);
  assert.equal(valor(banco, "PRAGMA foreign_keys"), 1);
  assert.equal(valor(banco, "SELECT count(*) FROM varredura_base"), 0);
  banco.close();
});

test("a sequência só aceita os tipos de id conhecidos", () => {
  const banco = abrir(raizTemp());
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
        novoId(banco, "demanda");
        throw original;
      }),
    (erro) => erro === original,
  );
  assert.equal(banco.isTransaction, false);
  assert.equal(
    escrever(banco, () => novoId(banco, "demanda")),
    1,
  );
  banco.close();
});

test("escrever() aninhada: a interna confirma junto da externa, com novoId", () => {
  const banco = abrir(raizTemp());
  const ids = escrever(banco, () => [novoId(banco, "demanda"), escrever(banco, () => novoId(banco, "demanda"))]);
  assert.deepEqual(ids, [1, 2]);
  assert.equal(banco.isTransaction, false);
  assert.equal(valor(banco, "SELECT valor FROM sequencia WHERE nome = 'demanda'"), 2);
  banco.close();
});

test("escrever() aninhada: erro na interna desfaz só a interna e a externa segue", () => {
  const banco = abrir(raizTemp());
  const original = new Error("interna");
  escrever(banco, () => {
    novoId(banco, "demanda");
    assert.throws(
      () =>
        escrever(banco, () => {
          novoId(banco, "demanda");
          escrever(banco, () => novoId(banco, "demanda"));
          throw original;
        }),
      (erro) => erro === original,
    );
    assert.equal(banco.isTransaction, true);
  });
  assert.equal(valor(banco, "SELECT valor FROM sequencia WHERE nome = 'demanda'"), 1);
  banco.close();
});

test("escrever() aninhada: erro na externa desfaz as duas", () => {
  const banco = abrir(raizTemp());
  assert.throws(() => {
    escrever(banco, () => {
      escrever(banco, () => novoId(banco, "demanda"));
      throw new Error("externa");
    });
  }, /externa/);
  assert.equal(banco.isTransaction, false);
  assert.equal(valor(banco, "SELECT count(*) FROM sequencia"), 0);
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

test("novoId() segue a sequência do tipo e só roda dentro da transação", () => {
  const banco = abrir(raizTemp());
  const ids = escrever(banco, () => [novoId(banco, "demanda"), novoId(banco, "demanda")]);
  assert.deepEqual(ids, [1, 2]);
  assert.equal(
    escrever(banco, () => novoId(banco, "demanda")),
    3,
  );
  assert.throws(() => novoId(banco, "demanda"), /fora de transação/);
  banco.close();
});
