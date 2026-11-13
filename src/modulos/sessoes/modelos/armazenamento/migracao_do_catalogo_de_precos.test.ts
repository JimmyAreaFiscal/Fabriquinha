// A migração do catálogo de preços sobre um banco com Uso antigo gravado: o catálogo nasce vazio, o Uso antigo não ganha
// referência de preço e o custo dele não muda, nem quando o catálogo passa a ter o preço do modelo.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { lerUsoDasExecucoes } from "../../metricas_de_execucao/armazenamento/uso_das_execucoes.ts";
import { gravarCatalogoDePrecos } from "./catalogo_de_precos.ts";
import { MIGRACOES_DE_SESSOES, VERSAO_DO_CATALOGO_DE_PRECOS } from "./migracao_do_catalogo_de_precos.ts";

test("a migração cria o catálogo vazio e não muda o custo do Uso já gravado", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, VERSAO_DO_CATALOGO_DE_PRECOS - 1);
  const T = "2026-10-01T12:00:00.000Z";
  banco.exec(`
    INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('loja', '/nao/existe/loja', 'main', 'github', 'loja');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta,
      criada_por_sessao, enviada, branch)
      VALUES ('I-1', 'loja', 'Busca', 'problema', 'd', 'em_execucao', '${T}', 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch)
      VALUES ('I-1', 'em_execucao', '${T}', 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', '${T}');
    INSERT INTO trabalho_agentico VALUES ('s1', 'I-1', 1, 'autonomo', 'c1');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha)
      VALUES ('E-1', 's1', '${T}', '${T}', 0), ('E-2', 's1', '${T}', '${T}', 0);
    INSERT INTO uso_modelo_execucao VALUES
      ('E-1', 'anthropic', 'claude-sonnet-5-5', 1000, 500, 0, 0, 4.2),
      ('E-2', 'anthropic', 'claude-sonnet-5-5', 2000, 500, 0, 0, NULL);`);
  const usoAntes = banco.prepare("SELECT * FROM uso_modelo_execucao ORDER BY rowid").all();

  migrarBancoDaFabriquinha(banco, VERSAO_DO_CATALOGO_DE_PRECOS);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, VERSAO_DO_CATALOGO_DE_PRECOS);
  assert.deepEqual(banco.prepare("SELECT * FROM preco_do_modelo").all(), []);
  assert.deepEqual(
    banco
      .prepare("SELECT * FROM uso_modelo_execucao ORDER BY rowid")
      .all()
      .map((uso) => ({ ...uso })),
    usoAntes.map((uso) => ({ ...uso, preco_id: null })),
  );
  gravarCatalogoDePrecos(
    banco,
    [
      {
        modelo: { provedor: "anthropic", nome: "claude-sonnet-5-5" },
        usd_por_milhao: { entrada: 2, saida: 10, cache_leitura: 0.1, cache_escrita: 2.5 },
        origem: "pi",
      },
    ],
    "2026-11-13T10:00:00.000Z",
  );
  const [informado, desconhecido] = lerUsoDasExecucoes(banco, ["E-1", "E-2"]);
  assert.deepEqual([informado?.custo, informado?.preco_id], [4.2, undefined]);
  assert.equal(desconhecido?.custo, undefined, "a execução antiga sem custo segue desconhecida");
  assert.deepEqual(
    MIGRACOES_DE_SESSOES.migracoes.map(({ versao }) => versao),
    [VERSAO_DO_CATALOGO_DE_PRECOS],
  );
  banco.close();
});

test("a referência do preço só existe com custo: o banco recusa estimativa sem valor", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  banco.exec("PRAGMA foreign_keys = OFF");
  assert.throws(() => {
    banco.exec(`INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida,
        tokens_cache_leitura, tokens_cache_escrita, custo, preco_id) VALUES ('E-1', 'a', 'm', 1, 1, 0, 0, NULL, 1)`);
  }, /CHECK constraint failed/);
  banco.close();
});
