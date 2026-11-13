import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import type { Pedido } from "../../../server/api/rotas.ts";
import type { DadosDoChatDemanda } from "../../../server/contrato/sessoes/chat.ts";
import { ROTAS_DO_CHAT } from "../../../server/api/rotas/sessoes/chat.ts";
import { migrar } from "../banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 5;
const EM = "2026-01-01T00:00:00.000Z";
const raizes: string[] = [];
after(() => {
  for (const raiz of raizes) rmSync(raiz, { recursive: true, force: true });
});

const contagem = (banco: DatabaseSync, tabela: string) =>
  Number(banco.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n);

/** Um banco em arquivo (o chat acha a conversa pela raiz dele) na versão 41, com a demanda I-1 concluída e dependentes. */
function bancoNaVersao41(): { banco: DatabaseSync; raiz: string } {
  const raiz = mkdtempSync(join(tmpdir(), "fabriquinha-migracao-42-"));
  raizes.push(raiz);
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'Titulo', 'funcionalidade', 'Descricao', 'concluida', '${EM}', 'claude', 'ext-1', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'entender_e_desenhar', 'concluido', '${EM}');
    INSERT INTO sessao (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('s-1', 'I-1', 1, 'interativo', 's-1'), ('s-2', 'I-1', 1, 'autonomo', 's-2');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha, grupo_processo) VALUES
      ('e-1', 's-1', '${EM}', '${EM}', 0, NULL), ('e-2', 's-1', '${EM}', '${EM}', 0, 4242), ('e-3', 's-2', '${EM}', '${EM}', 1, NULL);
    INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo)
      VALUES ('e-1', 'p', 'm', 10, 20, 0, 0, 0.5);
    INSERT INTO sessao_externa_demanda (ferramenta, sessao, demanda_id) VALUES ('claude', 'ext-1', 'I-1'), ('codex', 'ext-2', 'I-1');
    INSERT INTO avaliacao (id, projeto, de, ate, pedido, criada_em) VALUES ('av-1', 'loja', '2026-01-01', '2026-01-02', '', '${EM}');
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return { banco, raiz };
}

test("a migração 42 mantém as linhas das três tabelas, o uso por processo e as FKs, e troca os nomes", () => {
  const { banco } = bancoNaVersao41();
  const antes = ["sessao", "execucao_sessao", "sessao_externa_demanda", "uso_modelo_execucao"].map((t) =>
    contagem(banco, t),
  );
  const processosAntes = JSON.stringify(banco.prepare("SELECT * FROM execucao_sessao ORDER BY id").all());

  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE + 1));

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(
    ["trabalho_agentico", "processo_do_trabalho", "trabalho_nao_gerenciado", "uso_modelo_execucao"].map((t) =>
      contagem(banco, t),
    ),
    antes,
  );
  assert.deepEqual(antes, [2, 3, 2, 1]);
  assert.equal(
    JSON.stringify(banco.prepare("SELECT * FROM processo_do_trabalho ORDER BY id").all()).replaceAll(
      "trabalho_id",
      "sessao_id",
    ),
    processosAntes,
  );
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  const nomes = banco
    .prepare("SELECT name FROM sqlite_master WHERE name LIKE '%sessao%' AND name NOT LIKE 'sqlite_%'")
    .all();
  assert.deepEqual(nomes, []);
  assert.equal(banco.prepare("SELECT grupo_processo FROM avaliacao").get()?.grupo_processo, null);
});

test("depois da migração 42 o chat da demanda concluída mostra a conversa e as FKs seguem valendo", () => {
  const { banco, raiz } = bancoNaVersao41();
  migrar(banco, MIGRACOES);
  mkdirSync(join(raiz, "sessoes"));
  writeFileSync(
    join(raiz, "sessoes", "2026-01-01T00-00-00-000Z_s-1.jsonl"),
    `${JSON.stringify({ type: "message", message: { role: "user", content: "oi da demanda" } })}\n`,
  );

  const rota = ROTAS_DO_CHAT.find((r) => r.caminho === "/api/sessoes/:sessao");
  assert.ok(rota);
  const chat = rota.tratar({ banco, params: { sessao: "s-1" } } as unknown as Pedido) as DadosDoChatDemanda;

  assert.equal(chat.sessao.estado, "terminada");
  assert.equal((chat.conversa[0]?.message as { content: string }).content, "oi da demanda");
  banco.exec("PRAGMA foreign_keys = ON");
  assert.throws(() => {
    banco.exec("INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, falha) VALUES ('x', 'nao-existe', 't', 0)");
  }, /FOREIGN KEY/);
  assert.throws(() => {
    banco.exec("DELETE FROM processo_do_trabalho WHERE id = 'e-1'");
  }, /FOREIGN KEY/);
});
