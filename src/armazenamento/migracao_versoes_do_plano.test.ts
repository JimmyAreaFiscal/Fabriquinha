import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { OrigemDaVersao } from "../nucleo/plano.ts";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const EM = "2026-01-01T00:00:00.000Z";
const VERSAO_46 = VERSAO_LINHA_DE_BASE + 10;

function bancoNaVersao46(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_46 - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    PRAGMA foreign_keys = ON;
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/I-1');
    INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', '${EM}', 0, 'fabriquinha/I-1-1');
  `);
  return banco;
}

const inserirVersao = (banco: DatabaseSync, campos: string, valores: string): void => {
  banco.exec(
    `INSERT INTO versao_plano (demanda_id, numero, ${campos}, criada_em, dados) VALUES ('I-1', 1, ${valores}, '${EM}', '{}')`,
  );
};

test("a migração 46 cria o Plano com versões e os arquivos previstos de rodada e demanda, sem linha nas demandas que existem", () => {
  const banco = bancoNaVersao46();
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_46);
  for (const tabela of ["versao_plano", "arquivo_previsto_rodada", "arquivo_previsto_demanda"]) {
    assert.equal(banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n, 0);
  }
  banco.close();
});

test("versao_plano aceita cada origem do núcleo e recusa origem desconhecida, agente sem trabalho e rodada inexistente", () => {
  const banco = bancoNaVersao46();
  OrigemDaVersao.options.forEach((origem, i) => {
    banco.exec(
      `INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados) VALUES ('I-1', ${String(i + 1)}, '${origem}', 'fabriquinha', '${EM}', '{}')`,
    );
  });
  banco.exec("DELETE FROM versao_plano");
  assert.throws(() => {
    inserirVersao(banco, "origem, autor_tipo", "'replanejamento', 'fabriquinha'");
  });
  assert.throws(() => {
    inserirVersao(banco, "origem, autor_tipo", "'revisao_rodada', 'agente'");
  });
  assert.throws(() => {
    inserirVersao(banco, "origem, autor_tipo, rodada_id", "'revisao_rodada', 'fabriquinha', 9");
  });
  inserirVersao(banco, "origem, autor_tipo, rodada_id", "'revisao_rodada', 'fabriquinha', 1");
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  banco.close();
});
