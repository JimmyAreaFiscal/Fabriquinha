// O esquema anterior à migração 38 (I-267.R1): os valores antigos de estado, o mapeamento para os novos e a volta de um
// banco migrado para esse esquema, para o teste que precisa de uma demanda em cada valor antigo antes de migrar.
import { DatabaseSync } from "node:sqlite";
import { migrar } from "../src/armazenamento/banco.ts";
import { ESQUEMA_V36, MIGRACOES, VERSAO_LINHA_DE_BASE } from "../src/armazenamento/migracoes.ts";

/** O valor antigo → o novo, por tabela (as etapas valem para `ticket_demanda` e `configuracao_etapa_projeto`). */
export const ESTADO_NOVO_DA_DEMANDA: Readonly<Record<string, string>> = {
  registro: "entender_e_desenhar",
  aprovacao_demanda: "gate_demanda",
  planejamento: "planejar",
  aprovacao_planejamento: "gate_planejamento",
  execucao: "em_execucao",
  revisao_demanda: "revisar_demanda",
  encerramento: "encerrar_demanda",
  concluida: "concluida",
  arquivada: "arquivada",
  cancelada: "cancelada",
};
export const ESTADO_NOVO_DA_RODADA: Readonly<Record<string, string>> = {
  desenvolvimento: "implementar",
  revisao: "revisar_rodada",
  encerramento: "encerrar_rodada",
  aprovacao_pull_request: "gate_pr",
  sessao: "ajustar_resultado",
  concluida: "concluida",
};
export const ESTADO_NOVO_DO_TICKET: Readonly<Record<string, string>> = {
  aberto: "aberto",
  em_execucao: "em_execucao",
  concluido: "concluido",
  falhou: "falhou",
  fechado: "cancelado",
  cancelado: "cancelado",
};
export const ETAPA_NOVA: Readonly<Record<string, string>> = {
  demanda: "entender_e_desenhar",
  planejar: "planejar",
  implementar: "implementar",
  revisar_rodada: "revisar_rodada",
  encerrar_rodada: "encerrar_rodada",
  sessao_em_aberto: "ajustar_resultado",
  revisar_demanda: "revisar_demanda",
  encerrar_demanda: "encerrar_demanda",
  resolver_conflito: "resolver_conflito",
};

/** Os valores antigos que não são terminais (de onde uma demanda ainda chega a `concluida`), cada um com o novo. */
export const ESTADOS_DA_DEMANDA_EM_ANDAMENTO = Object.entries(ESTADO_NOVO_DA_DEMANDA).slice(0, 7);
export const ESTADOS_DA_RODADA_EM_ANDAMENTO = Object.entries(ESTADO_NOVO_DA_RODADA).slice(0, 5);

/** `CASE coluna WHEN 'novo' THEN 'antigo' ... END`: a volta do mapeamento (os terminais e o resto passam como estão). */
function voltaDoMapeamento(coluna: string, novoDoAntigo: Readonly<Record<string, string>>): string {
  const casos = Object.entries(novoDoAntigo)
    .filter(([antigo, novo]) => antigo !== novo && antigo !== "fechado")
    .map(([antigo, novo]) => `WHEN '${novo}' THEN '${antigo}'`);
  return `CASE ${coluna} ${casos.join(" ")} ELSE ${coluna} END`;
}

/** O `CREATE TABLE` de `tabela` no esquema anterior, com o nome trocado para `nome`. */
function criacaoAnterior(esquemaAnterior: DatabaseSync, tabela: string, nome: string): string {
  const linha = esquemaAnterior.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(tabela);
  return String(linha?.sql).replace(new RegExp(`^CREATE TABLE "?${tabela}"?`), `CREATE TABLE ${nome}`);
}

/**
 * Devolve o banco migrado (e aberto) ao esquema da versão 37 (sem as Tentativas da 40, o gate da decisão da 41, os nomes do Trabalho Agêntico da 42 nem o `pull_request` da 43): devolve a `projeto` os nomes e a coluna do cursor de antes da 39, recria `demanda`, `rodada`, `ticket_demanda`,
 * `configuracao_etapa_projeto` e `sequencia` com as colunas e os valores antigos e volta o `user_version`. O próximo
 * `abrir()` aplica a migração 38 sobre as linhas que o teste montou. O que a 38 perdeu (`enviado_em`, `origem_ticket_id`,
 * a hora da Rodada) volta vazio ou some, e `fechado` não volta: ficou `cancelado`.
 */
export function rebaixarParaEsquemaAnterior(banco: DatabaseSync): void {
  const esquemaAnterior = new DatabaseSync(":memory:");
  esquemaAnterior.exec(ESQUEMA_V36);
  esquemaAnterior.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE)}`);
  migrar(esquemaAnterior, MIGRACOES.slice(0, 1));

  const colunas = (tabela: string) =>
    (esquemaAnterior.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
  const copiar = (tabela: string, expressoes: Readonly<Record<string, string>>) => {
    const antigas = colunas(tabela);
    const nova = `${tabela}_antiga`;
    const selecao = antigas.map((coluna) => expressoes[coluna] ?? coluna);
    banco.exec(criacaoAnterior(esquemaAnterior, tabela, nova));
    banco.exec(
      `INSERT INTO ${nova} (${antigas.join(", ")}) SELECT ${selecao.join(", ")} FROM ${tabela} ORDER BY rowid`,
    );
  };

  banco.exec("PRAGMA foreign_keys = OFF");
  banco.exec("BEGIN");
  try {
    copiar("demanda", {
      fase: voltaDoMapeamento("estado", ESTADO_NOVO_DA_DEMANDA),
      fase_alterada_em: "estado_alterado_em",
    });
    copiar("rodada", { fase: voltaDoMapeamento("estado", ESTADO_NOVO_DA_RODADA) });
    copiar("ticket_demanda", {
      etapa: voltaDoMapeamento("etapa", ETAPA_NOVA),
      status: "estado",
      status_alterado_em: "estado_alterado_em",
      enviado_em: "NULL",
      origem_ticket_id: "NULL",
      devolucoes: "0",
      motivo_falha: "NULL",
      retomadas_automaticas: "0",
    });
    copiar("configuracao_etapa_projeto", { etapa: voltaDoMapeamento("etapa", ETAPA_NOVA) });
    // A 41 deu o gate à decisão, trocou 'recusado' por 'reprovado' e removeu o histórico dos gates antigos.
    copiar("decisao_ticket", { resultado: "CASE resultado WHEN 'reprovado' THEN 'recusado' ELSE resultado END" });
    // A 49 renomeou a tabela dos commits humanos posteriores e os índices dela: a volta devolve os nomes antigos.
    banco.exec(`
      ALTER TABLE commit_humano_posterior RENAME TO retrabalho_demanda;
      DROP INDEX ix_commit_humano_posterior_origem;
      DROP INDEX ix_commit_humano_posterior_alterador;
      CREATE INDEX ix_retrabalho_demanda_origem ON retrabalho_demanda(demanda_id, ticket_origem_id);
      CREATE INDEX ix_retrabalho_demanda_alterador ON retrabalho_demanda(alterador_demanda_id, ticket_id);
    `);
    // A 47 criou o Plano com versões e os arquivos previstos de rodada e demanda: a volta apaga as três tabelas.
    banco.exec(`
      DROP TABLE versao_plano;
      DROP TABLE arquivo_previsto_rodada;
      DROP TABLE arquivo_previsto_demanda;
    `);
    // A 45 abriu o conjunto de Ambientes em container: a volta apaga a tabela e as colunas novas.
    banco.exec(`
      DROP TABLE ambiente;
      ALTER TABLE configuracao DROP COLUMN ambiente_tipo;
      ALTER TABLE configuracao DROP COLUMN ambiente_memoria_maxima_mb;
      ALTER TABLE configuracao DROP COLUMN ambiente_cpus;
      ALTER TABLE configuracao DROP COLUMN ambiente_ociosidade_para_eliminar_min;
      ALTER TABLE projeto DROP COLUMN imagem_do_ambiente;
      ALTER TABLE processo_do_trabalho DROP COLUMN ambiente_id;
    `);
    // A 46 criou `uso_declarado` e fez `trabalho_nao_gerenciado` apontar para ele: a volta recria a tabela sem a FK. A 42 renomeou as tabelas da sessão (e os índices delas) e deu `grupo_processo` à avaliação: a volta desfaz tudo.
    banco.exec(`
      CREATE TABLE sessao_externa_demanda (
        ferramenta TEXT NOT NULL,
        sessao     TEXT NOT NULL,
        demanda_id TEXT NOT NULL REFERENCES demanda(id),
        PRIMARY KEY (ferramenta, sessao)
      );
      INSERT INTO sessao_externa_demanda SELECT ferramenta, sessao, demanda_id FROM trabalho_nao_gerenciado;
      DROP TABLE trabalho_nao_gerenciado;
      DROP TABLE uso_declarado;
      ALTER TABLE processo_do_trabalho RENAME COLUMN trabalho_id TO sessao_id;
      ALTER TABLE processo_do_trabalho RENAME TO execucao_sessao;
      ALTER TABLE trabalho_agentico RENAME TO sessao;
      DROP INDEX ix_trabalho_agentico_ticket;
      CREATE INDEX ix_sessao_ticket ON sessao(demanda_id, ticket_id);
      DROP INDEX ix_processo_do_trabalho_trabalho;
      CREATE INDEX ix_execucao_sessao_sessao ON execucao_sessao(sessao_id);
      ALTER TABLE avaliacao DROP COLUMN grupo_processo;
    `);
    // A 40 criou `tentativa` e tirou `erro` das execuções: a volta apaga as Tentativas e devolve a coluna vazia.
    banco.exec(`
      DROP TABLE tentativa;
      ALTER TABLE execucao_sessao ADD COLUMN erro TEXT CHECK (erro IS NULL OR length(erro) > 0);
    `);
    // A 43 tirou o PR do encerramento para `pull_request`: a volta devolve o PR final às colunas e apaga a tabela.
    copiar("encerramento_demanda", {
      pr_numero:
        "(SELECT numero FROM pull_request p WHERE p.demanda_id = encerramento_demanda.demanda_id AND p.rodada_id IS NULL)",
      pr_url:
        "(SELECT url FROM pull_request p WHERE p.demanda_id = encerramento_demanda.demanda_id AND p.rodada_id IS NULL)",
    });
    banco.exec("DROP TABLE pull_request");
    copiar("sequencia", { nome: "CASE nome WHEN 'demanda' THEN 'issue' ELSE nome END" });
    for (const tabela of [
      "ticket_demanda",
      "rodada",
      "demanda",
      "configuracao_etapa_projeto",
      "sequencia",
      "decisao_ticket",
      "encerramento_demanda",
    ]) {
      banco.exec(`DROP TABLE ${tabela}`);
    }
    for (const tabela of [
      "demanda",
      "rodada",
      "ticket_demanda",
      "configuracao_etapa_projeto",
      "sequencia",
      "decisao_ticket",
      "encerramento_demanda",
    ]) {
      banco.exec(`ALTER TABLE ${tabela}_antiga RENAME TO ${tabela}`);
    }
    banco.exec(criacaoAnterior(esquemaAnterior, "decisao_ticket_historico", "decisao_ticket_historico"));
    // A 39 renomeou duas colunas de `projeto` e tirou o cursor: o cursor fica só em `varredura_base`, onde a 39 o deixa.
    banco.exec(`
      ALTER TABLE projeto RENAME COLUMN raiz_git TO repo;
      ALTER TABLE projeto RENAME COLUMN chave_sonarqube TO sonar_project_key;
      ALTER TABLE projeto ADD COLUMN cursor_commit_humano TEXT CHECK (cursor_commit_humano IS NULL OR length(cursor_commit_humano) > 0);
    `);
    banco.exec(`PRAGMA user_version = ${String(VERSAO_LINHA_DE_BASE + 1)}`);
    banco.exec("COMMIT");
  } catch (erro) {
    banco.exec("ROLLBACK");
    throw erro;
  } finally {
    banco.exec("PRAGMA foreign_keys = ON");
    esquemaAnterior.close();
  }
}
