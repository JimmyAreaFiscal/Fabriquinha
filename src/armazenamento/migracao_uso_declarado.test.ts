import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrar } from "./banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "./migracoes.ts";

const VERSAO_ANTES = VERSAO_LINHA_DE_BASE + 8;
const EM = "2026-01-01T00:00:00.000Z";

interface Soma {
  tokens: number;
  custo: number;
}
type SomaPorChave = Record<string, Soma>;

const linhas = (banco: DatabaseSync, sql: string): Record<string, unknown>[] =>
  banco
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

/** Uma linha de `custos_realizados`: os tokens são 4 × `entrada` (saída 2×, cache 1× e 0). */
const linhaExterna = (provedor: string, modelo: string, entrada: number, custo: number | null) => ({
  provedor,
  modelo,
  tokens_entrada: entrada,
  tokens_saida: entrada * 2,
  tokens_cache_leitura: entrada,
  tokens_cache_escrita: 0,
  custo,
});
const sessaoExterna = (ferramenta: string, sessao: string, ...linhasDaSessao: object[]) => ({
  ferramenta,
  sessao,
  linhas: linhasDaSessao,
});

/**
 * Um banco na versão 44 com 2 demandas de 2 projetos. Uso medido: I-1 em janeiro (um custo conhecido, um desconhecido) e
 * I-2 em fevereiro. `custos_realizados`: a I-1 informa a sessão claude/s1 (uma linha sem custo) e codex/s2 na demanda,
 * codex/s3 na rodada e codex/x num ticket (que nunca contou); a I-2 informa a mesma claude/s1 (já da I-1), pi/s4 e,
 * na rodada, uma `custos_realizados` malformada. `trabalho_nao_gerenciado` tem as donas pela regra atual.
 */
function bancoNaVersao44(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec(ESQUEMA_V36);
  banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(banco, MIGRACOES.slice(0, VERSAO_ANTES - VERSAO_LINHA_DE_BASE));
  const demanda = (id: string, projeto: string) =>
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch)
       VALUES ('${id}', '${projeto}', 'T', 'funcionalidade', 'D', 'em_execucao', '${EM}', 'claude', 's', 1, 'fabriquinha/${id}');
     INSERT INTO rodada (demanda_id, rodada_id, titulo, estado, estado_alterado_em, e2e, branch)
       VALUES ('${id}', 1, 'R', 'implementar', '${EM}', 0, 'fabriquinha/${id}-1');
     INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
       VALUES ('${id}', 1, 'implementar', 'concluido', '${EM}', 1);`;
  const medido = (id: string, mes: string, custo: string) =>
    `INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES ('t-${id}', '${id}', 1, 'autonomo', 'c');
     INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('p-${id}', 't-${id}', '2026-${mes}-10T00:00:00.000Z', '2026-${mes}-10T01:00:00.000Z', 0);
     INSERT INTO uso_modelo_execucao VALUES ('p-${id}', 'anthropic', 'a', 100, 200, 10, 0, ${custo}), ('p-${id}', 'openai', 'b', 5, 6, 0, 0, NULL);`;
  const custosRealizados = (
    id: string,
    demandaId: string,
    dono: { rodada?: number; ticket?: number },
    dados: unknown,
  ) =>
    `INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em)
       VALUES ('${id}', '${demandaId}', ${String(dono.rodada ?? null)}, ${String(dono.ticket ?? null)}, 'custos_realizados', '${JSON.stringify(dados)}', '${EM}');`;
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('loja', '/r1', 'main', 'github', 'k1');
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube) VALUES ('site', '/r2', 'main', 'github', 'k2');
    ${demanda("I-1", "loja")} ${demanda("I-2", "site")}
    ${medido("I-1", "01", "1.5")} ${medido("I-2", "02", "NULL")}
    ${custosRealizados("e1", "I-1", {}, { sessoes: [sessaoExterna("claude", "s1", linhaExterna("anthropic", "opus", 10, 1.5), linhaExterna("anthropic", "haiku", 3, null)), sessaoExterna("codex", "s2", linhaExterna("openai", "gpt", 20, 2))] })}
    ${custosRealizados("e1r", "I-1", { rodada: 1 }, { sessoes: [sessaoExterna("codex", "s3", linhaExterna("openai", "gpt", 40, 4))] })}
    ${custosRealizados("e1t", "I-1", { ticket: 1 }, { sessoes: [sessaoExterna("codex", "x", linhaExterna("openai", "gpt", 80, 8))] })}
    ${custosRealizados("e2", "I-2", {}, { sessoes: [sessaoExterna("claude", "s1", linhaExterna("anthropic", "opus", 1000, 100)), sessaoExterna("pi", "s4", linhaExterna("pi", "m", 7, 0.25))] })}
    ${custosRealizados("e2r", "I-2", { rodada: 1 }, { sessoes: { a: 1 } })}
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('e1c', 'I-1', NULL, NULL, 'criterios_aceite', '{}', '${EM}');
    INSERT INTO evidencia_historico VALUES ('e1', 1, 'agente');
    INSERT INTO trabalho_nao_gerenciado VALUES ('claude', 's1', 'I-1'), ('codex', 's2', 'I-1'), ('codex', 's3', 'I-1'), ('pi', 's4', 'I-2');
  `);
  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES);
  return banco;
}

const somarPor = (
  linhasDeUso: Record<string, unknown>[],
  chave: (l: Record<string, unknown>) => string,
): SomaPorChave => {
  const somas: SomaPorChave = {};
  for (const l of linhasDeUso) {
    const soma = (somas[chave(l)] ??= { tokens: 0, custo: 0 });
    soma.tokens += Number(l.tokens);
    soma.custo += Number(l.custo);
  }
  return somas;
};

/** O Uso medido (execuções da Fabriquinha) por demanda, projeto e mês: não é tocado pela migração. */
function medidoPorDemandaProjetoEMes(banco: DatabaseSync): Record<string, SomaPorChave> {
  const medido = linhas(
    banco,
    `SELECT d.id AS demanda, d.projeto, substr(p.inicio, 1, 7) AS mes,
            u.tokens_entrada + u.tokens_saida + u.tokens_cache_leitura + u.tokens_cache_escrita AS tokens,
            COALESCE(u.custo, 0) AS custo
     FROM uso_modelo_execucao u JOIN processo_do_trabalho p ON p.id = u.execucao_id
       JOIN trabalho_agentico t ON t.id = p.trabalho_id JOIN demanda d ON d.id = t.demanda_id`,
  );
  return {
    demanda: somarPor(medido, (l) => String(l.demanda)),
    projeto: somarPor(medido, (l) => String(l.projeto)),
    mes: somarPor(medido, (l) => String(l.mes)),
  };
}

const TOKENS_DA_LINHA_EXTERNA = `json_extract(l.value, '$.tokens_entrada') + json_extract(l.value, '$.tokens_saida')
  + json_extract(l.value, '$.tokens_cache_leitura') + json_extract(l.value, '$.tokens_cache_escrita')`;
const CUSTO_DA_LINHA_EXTERNA = "COALESCE(json_extract(l.value, '$.custo'), 0)";

/** O Uso declarado por demanda e projeto antes da migração: as `custos_realizados` das sessões que a demanda é dona. */
function declaradoAntes(banco: DatabaseSync): Record<string, SomaPorChave> {
  const declarado = linhas(
    banco,
    `SELECT e.demanda_id AS demanda, d.projeto, ${TOKENS_DA_LINHA_EXTERNA} AS tokens, ${CUSTO_DA_LINHA_EXTERNA} AS custo
     FROM evidencia_demanda e JOIN demanda d ON d.id = e.demanda_id, json_each(e.dados, '$.sessoes') s, json_each(s.value, '$.linhas') l
       JOIN trabalho_nao_gerenciado x ON x.demanda_id = e.demanda_id
         AND x.ferramenta = json_extract(s.value, '$.ferramenta') AND x.sessao = json_extract(s.value, '$.sessao')
     WHERE e.tipo = 'custos_realizados' AND e.ticket_id IS NULL
       AND json_type(e.dados, '$.sessoes') = 'array' AND json_type(s.value, '$.linhas') = 'array'`,
  );
  return {
    demanda: somarPor(declarado, (l) => String(l.demanda)),
    projeto: somarPor(declarado, (l) => String(l.projeto)),
  };
}

function declaradoDepois(banco: DatabaseSync): Record<string, SomaPorChave> {
  const declarado = linhas(
    banco,
    `SELECT u.demanda_id AS demanda, d.projeto, ${TOKENS_DA_LINHA_EXTERNA} AS tokens, ${CUSTO_DA_LINHA_EXTERNA} AS custo
     FROM uso_declarado u JOIN demanda d ON d.id = u.demanda_id, json_each(u.linhas) l`,
  );
  return {
    demanda: somarPor(declarado, (l) => String(l.demanda)),
    projeto: somarPor(declarado, (l) => String(l.projeto)),
  };
}

test("a migração 45 cria uso_declarado pelas custos_realizados das donas, sem mudar nenhuma soma", () => {
  const banco = bancoNaVersao44();
  const medidoAntes = medidoPorDemandaProjetoEMes(banco);
  const declaradoDeAntes = declaradoAntes(banco);
  assert.deepEqual(declaradoDeAntes.demanda, {
    "I-1": { tokens: 4 * 10 + 4 * 3 + 4 * 20 + 4 * 40, custo: 1.5 + 2 + 4 },
    "I-2": { tokens: 4 * 7, custo: 0.25 },
  });

  migrar(banco, MIGRACOES);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_ANTES + 1);
  assert.deepEqual(banco.prepare("PRAGMA foreign_key_check").all(), []);
  assert.deepEqual(medidoPorDemandaProjetoEMes(banco), medidoAntes);
  assert.deepEqual(declaradoDepois(banco), declaradoDeAntes);
  assert.deepEqual(
    linhas(banco, "SELECT ferramenta, sessao, demanda_id FROM uso_declarado ORDER BY rowid"),
    linhas(banco, "SELECT ferramenta, sessao, demanda_id FROM trabalho_nao_gerenciado ORDER BY rowid"),
  );
  assert.deepEqual(
    linhas(banco, "SELECT ferramenta, sessao, demanda_id FROM uso_declarado ORDER BY ferramenta, sessao"),
    [
      { ferramenta: "claude", sessao: "s1", demanda_id: "I-1" },
      { ferramenta: "codex", sessao: "s2", demanda_id: "I-1" },
      { ferramenta: "codex", sessao: "s3", demanda_id: "I-1" },
      { ferramenta: "pi", sessao: "s4", demanda_id: "I-2" },
    ],
  );
});

test("a migração 45 grava cada linha como LinhaDeUso, com custo desconhecido null e chamadas 0", () => {
  const banco = bancoNaVersao44();
  migrar(banco, MIGRACOES);
  const { linhas: linhasDaSessao } = banco
    .prepare("SELECT linhas FROM uso_declarado WHERE ferramenta = 'claude' AND sessao = 's1'")
    .get() as { linhas: string };
  assert.deepEqual(JSON.parse(linhasDaSessao), [
    {
      modelo: "anthropic/opus",
      tokens_entrada: 10,
      tokens_saida: 20,
      tokens_cache_leitura: 10,
      tokens_cache_escrita: 0,
      custo: 1.5,
      chamadas: 0,
    },
    {
      modelo: "anthropic/haiku",
      tokens_entrada: 3,
      tokens_saida: 6,
      tokens_cache_leitura: 3,
      tokens_cache_escrita: 0,
      custo: null,
      chamadas: 0,
    },
  ]);
});

test("a migração 45 tira todas as custos_realizados, com o histórico, e deixa as outras evidências", () => {
  const banco = bancoNaVersao44();
  migrar(banco, MIGRACOES);
  assert.deepEqual(linhas(banco, "SELECT id, tipo FROM evidencia_demanda"), [{ id: "e1c", tipo: "criterios_aceite" }]);
  assert.deepEqual(linhas(banco, "SELECT * FROM evidencia_historico"), []);
});

test("a migração 45 faz trabalho_nao_gerenciado apontar para o Uso declarado", () => {
  const banco = bancoNaVersao44();
  migrar(banco, MIGRACOES);
  assert.throws(() => {
    banco.exec("INSERT INTO trabalho_nao_gerenciado VALUES ('claude', 'sem-uso', 'I-1')");
  }, /FOREIGN KEY/);
});

test("a migração 45 guarda linhas vazias para a sessão cuja evidência dona não tem linhas", () => {
  const banco = bancoNaVersao44();
  banco.exec(
    `DELETE FROM evidencia_demanda WHERE id = 'e2'; INSERT INTO trabalho_nao_gerenciado VALUES ('pi', 'sem-linhas', 'I-2');`,
  );
  migrar(banco, MIGRACOES);
  assert.deepEqual(linhas(banco, "SELECT linhas FROM uso_declarado WHERE sessao IN ('s4', 'sem-linhas')"), [
    { linhas: "[]" },
    { linhas: "[]" },
  ]);
});
