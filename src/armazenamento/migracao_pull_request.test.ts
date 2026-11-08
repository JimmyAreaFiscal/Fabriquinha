import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 6;
const EM = "2026-01-01T00:00:00.000Z";
const MAIS_TARDE = "2026-01-02T00:00:00.000Z";

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

const dadosDoPr = (id: string) => JSON.stringify({ id, url: `https://h/pr/${id}`, head: `sha-${id}` });

/**
 * Um banco na versão 42. A I-1 tem quatro rodadas: a 1 concluída, com dois `encerrar_rodada` que abriram PR (vale o
 * último); a 2 em `gate_pr`; a 3 com a evidência na própria rodada (rodadas migradas); a 4 sem PR. Os encerramentos:
 * I-1 integrado, I-2 esperando o merge e I-3 sem PR.
 */
function bancoNaVersao42(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  const demanda = (id: string) =>
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
       VALUES ('${id}', 'loja', 'T', 'funcionalidade', 'D', 'encerrar_demanda', '${MAIS_TARDE}', 'claude', 's', 1, 'fabriquinha/${id}');`;
  const rodada = (n: number, estado: string) =>
    `INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
       VALUES ('I-1', ${String(n)}, 'R', '${estado}', '${EM}', 0, 'fabriquinha/I-1-${String(n)}');`;
  const ticket = (id: number, rodadaId: number) =>
    `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
       VALUES ('I-1', ${String(id)}, 'encerrar_rodada', 'concluido', '${EM}', ${String(rodadaId)});`;
  const prAberto = (id: string, dono: { ticket?: number; rodada?: number }, quando: string) =>
    `INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em)
       VALUES ('e-${id}', 'I-1', ${String(dono.rodada ?? null)}, ${String(dono.ticket ?? null)}, 'pr_aberto', '${dadosDoPr(id)}', '${quando}');`;
  const encerramento = (id: string, colunas: string, valores: string) =>
    `INSERT INTO encerramento_demanda (demanda_id, branch, base, ${colunas}) VALUES ('${id}', 'fabriquinha/${id}', 'main', ${valores});`;
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    ${demanda("I-1")} ${demanda("I-2")} ${demanda("I-3")}
    ${rodada(1, "concluida")} ${rodada(2, "gate_pr")} ${rodada(3, "concluida")} ${rodada(4, "implementar")}
    ${ticket(1, 1)} ${ticket(2, 1)} ${ticket(3, 2)}
    ${prAberto("11", { ticket: 1 }, EM)} ${prAberto("12", { ticket: 2 }, MAIS_TARDE)}
    ${prAberto("21", { ticket: 3 }, EM)} ${prAberto("31", { rodada: 3 }, EM)}
    ${encerramento("I-1", "pr_numero, pr_url, sha_verificado, integracao_sha", "50, 'https://h/pr/50', 'abc', 'def'")}
    ${encerramento("I-2", "pr_numero, pr_url, aguardando_merge_humano", "51, 'https://h/pr/51', 1")}
    ${encerramento("I-3", "falha_etapa, falha_motivo", "'check_final', 'ci'")}
    INSERT INTO limpeza_pendente_encerramento VALUES ('I-1', 'branch');
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

test("a migração 43 cria pull_request pela última pr_aberto de cada rodada e pelo PR do encerramento", () => {
  const banco = bancoNaVersao42();
  const encerramentosAntes = linhas(banco, "SELECT demanda_id FROM encerramento_demanda ORDER BY rowid");

  migrar(banco, MIGRACOES);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(
    linhas(
      banco,
      "SELECT demanda_id, rodada_id, numero, url, head, estado, atualizado_em FROM pull_request ORDER BY demanda_id, rodada_id",
    ),
    [
      // sem rodada vem antes: o PR final de I-1, integrado (o encerramento tem integracao_sha)
      {
        demanda_id: "I-1",
        rodada_id: null,
        numero: 50,
        url: "https://h/pr/50",
        head: "abc",
        estado: "integrado",
        atualizado_em: MAIS_TARDE,
      },
      {
        demanda_id: "I-1",
        rodada_id: 1,
        numero: 12,
        url: "https://h/pr/12",
        head: "sha-12",
        estado: "integrado",
        atualizado_em: MAIS_TARDE,
      },
      {
        demanda_id: "I-1",
        rodada_id: 2,
        numero: 21,
        url: "https://h/pr/21",
        head: "sha-21",
        estado: "aberto",
        atualizado_em: EM,
      },
      {
        demanda_id: "I-1",
        rodada_id: 3,
        numero: 31,
        url: "https://h/pr/31",
        head: "sha-31",
        estado: "integrado",
        atualizado_em: EM,
      },
      // sem sha_verificado o head é a branch
      {
        demanda_id: "I-2",
        rodada_id: null,
        numero: 51,
        url: "https://h/pr/51",
        head: "fabriquinha/I-2",
        estado: "aberto",
        atualizado_em: MAIS_TARDE,
      },
    ],
  );
  assert.deepEqual(linhas(banco, "SELECT demanda_id FROM encerramento_demanda ORDER BY rowid"), encerramentosAntes);
  const colunas = linhas(banco, "PRAGMA table_info(encerramento_demanda)").map((c) => c.name);
  assert.ok(!colunas.includes("pr_numero") && !colunas.includes("pr_url"));
  assert.deepEqual(
    linhas(
      banco,
      "SELECT demanda_id, sha_verificado, integracao_sha, aguardando_merge_humano, falha_etapa FROM encerramento_demanda",
    ),
    [
      {
        demanda_id: "I-1",
        sha_verificado: "abc",
        integracao_sha: "def",
        aguardando_merge_humano: 0,
        falha_etapa: null,
      },
      { demanda_id: "I-2", sha_verificado: null, integracao_sha: null, aguardando_merge_humano: 1, falha_etapa: null },
      {
        demanda_id: "I-3",
        sha_verificado: null,
        integracao_sha: null,
        aguardando_merge_humano: 0,
        falha_etapa: "check_final",
      },
    ],
  );
  assert.equal(linhas(banco, "SELECT * FROM limpeza_pendente_encerramento").length, 1);
});

test("a migração 43 troca o CHECK da integração pela trigger contra pull_request", () => {
  const banco = bancoNaVersao42();
  migrar(banco, MIGRACOES);
  banco.exec("PRAGMA foreign_keys = ON");

  assert.throws(() => {
    banco.exec("UPDATE encerramento_demanda SET integracao_sha = 'x' WHERE demanda_id = 'I-3'");
  }, /exige o PR final/);
  banco.exec("UPDATE encerramento_demanda SET integracao_sha = 'x' WHERE demanda_id = 'I-2'");
});
