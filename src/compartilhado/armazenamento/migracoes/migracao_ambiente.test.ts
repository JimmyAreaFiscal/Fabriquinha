import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 8;
const EM = "2026-01-01T00:00:00.000Z";

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

/**
 * Um banco na versão 44, com a configuração mexida, um projeto e três processos do trabalho: dois terminados e um
 * ainda em voo (sem `fim`).
 */
function bancoNaVersao44(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    PRAGMA foreign_keys = ON;
    UPDATE configuracao SET intervalo_min = 7, agendador_ativo = 1;
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('I-1', 1, 'implementar', 'em_execucao', '${EM}');
    INSERT INTO trabalho_agentico VALUES ('s-1', 'I-1', 1, 'autonomo', 'c');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('p-1', 's-1', '${EM}', '${EM}', 0);
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('p-2', 's-1', '${EM}', '${EM}', 1);
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES ('p-3', 's-1', '${EM}', NULL, 0, 4321);
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

test("a migração 45 acrescenta o conjunto e deixa tudo o que existe no host local, sem perder linha nem processo em voo", () => {
  const banco = bancoNaVersao44();
  const processosAntes = linhas(
    banco,
    "SELECT id, trabalho_id, inicio, fim, falha, grupo_processo FROM processo_do_trabalho ORDER BY id",
  );
  const projetosAntes = linhas(banco, "SELECT * FROM projeto");

  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES + 1 - VERSAO_LINHA_DE_BASE));

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    linhas(banco, "SELECT id, trabalho_id, inicio, fim, falha, grupo_processo FROM processo_do_trabalho ORDER BY id"),
    processosAntes,
  );
  assert.deepEqual(
    linhas(banco, "SELECT id, ambiente_id FROM processo_do_trabalho ORDER BY id"),
    ["p-1", "p-2", "p-3"].map((id) => ({ id, ambiente_id: "host_local" })),
  );
  assert.deepEqual(
    linhas(banco, "SELECT * FROM projeto"),
    projetosAntes.map((p) => ({ ...p, imagem_do_ambiente: null })),
  );
  assert.deepEqual(
    linhas(
      banco,
      "SELECT agendador_ativo, intervalo_min, ambiente_tipo, ambiente_memoria_maxima_mb, ambiente_cpus, ambiente_ociosidade_para_eliminar_min FROM configuracao",
    ),
    [
      {
        agendador_ativo: 1,
        intervalo_min: 7,
        ambiente_tipo: "host_local",
        ambiente_memoria_maxima_mb: 2048,
        ambiente_cpus: 2,
        ambiente_ociosidade_para_eliminar_min: 60,
      },
    ],
  );
  assert.deepEqual(linhas(banco, "SELECT * FROM ambiente"), []);
  banco.close();
});

test("a tabela ambiente recusa estado inválido, alocado sem Espaço, Espaço fora do alocado e dois alocados no mesmo Espaço", () => {
  const banco = bancoNaVersao44();
  migrar(banco, MIGRACOES);
  const inserir = (id: string, estado: string, alocadoPara: string | null) => {
    banco
      .prepare(
        "INSERT INTO ambiente (id, container_id, imagem, estado, alocado_para, criado_em) VALUES (?, ?, 'img', ?, ?, ?)",
      )
      .run(id, `c-${id}`, estado, alocadoPara, EM);
  };

  assert.throws(() => {
    inserir("a", "quebrado", null);
  });
  assert.throws(() => {
    inserir("a", "alocado", null);
  });
  assert.throws(() => {
    inserir("a", "livre", "I-1/1");
  });
  inserir("a", "alocado", "I-1/1");
  assert.throws(() => {
    inserir("b", "alocado", "I-1/1");
  });
  inserir("b", "livre", null);
  inserir("c", "sujo", null);
  inserir("d", "eliminado", null);
  assert.equal(linhas(banco, "SELECT id FROM ambiente").length, 4);
  banco.close();
});

test("as colunas novas da configuração recusam tipo desconhecido, memória abaixo de 512, cpus não positivo e ociosidade abaixo de 5", () => {
  const banco = bancoNaVersao44();
  migrar(banco, MIGRACOES);
  for (const invalido of [
    "ambiente_tipo = 'vm'",
    "ambiente_memoria_maxima_mb = 511",
    "ambiente_memoria_maxima_mb = 1024.5",
    "ambiente_cpus = 0",
    "ambiente_ociosidade_para_eliminar_min = 4",
  ]) {
    assert.throws(() => {
      banco.exec(`UPDATE configuracao SET ${invalido}`);
    }, invalido);
  }
  banco.exec(
    "UPDATE configuracao SET ambiente_tipo = 'container', ambiente_memoria_maxima_mb = 512, ambiente_cpus = 0.5, ambiente_ociosidade_para_eliminar_min = 5",
  );
  banco.close();
});
