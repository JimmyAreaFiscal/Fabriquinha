// Leitura e gravação do projeto (F2 §4 e §6): a única que toca as linhas de `projeto` e das tabelas da sua configuração.
// As recusas de negócio e o disco são do cadastro (aplicacao/projeto/cadastro.ts); as conferências externas (F5 §2,
// F4 §9) rodam antes.
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { ErroDeRegra, encontrado } from "../nucleo/erros.ts";
import { Projeto } from "../nucleo/projeto.ts";
import { escrever } from "./banco.ts";
import { lerEmSnapshot } from "./snapshot.ts";
import { colunasDaConfiguracaoAgente, linhaComConfiguracaoAgente } from "./configuracao_agente.ts";

type Linha = Record<string, unknown>;

const listar = (banco: DatabaseSync, sql: string, nome: string): Linha[] => banco.prepare(sql).all(nome);

/** Remove os `null` das linhas: opcional ausente no schema é chave ausente, não `null`. */
const semNulos = (l: Linha): Linha => Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null));

const COLUNAS_DO_PROJETO = "nome, raiz_git, branch_base, hospedagem, chave_sonarqube, link_produto, imagem_do_ambiente";

/** Monta o projeto da `linha` com as tabelas da sua configuração; quem chama garante o snapshot. */
function montarProjeto(banco: DatabaseSync, linha: Linha): Projeto {
  const nome = String(linha.nome);
  return Projeto.parse({
    ...semNulos(linha),
    etapas: listar(
      banco,
      "SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto WHERE projeto = ? ORDER BY etapa",
      nome,
    ).map(linhaComConfiguracaoAgente),
    verificacoes: {
      preparacao: listar(
        banco,
        "SELECT comando FROM comando_preparacao_projeto WHERE projeto = ? ORDER BY ordem",
        nome,
      ).map((l) => l.comando),
      fitness: listar(
        banco,
        "SELECT nome, comando, descricao FROM fitness_function_projeto WHERE projeto = ? ORDER BY nome",
        nome,
      ),
      linguagens: listar(
        banco,
        "SELECT caminho, linguagem, comando_teste FROM linguagem_projeto WHERE projeto = ? ORDER BY caminho",
        nome,
      ),
      e2e: listar(
        banco,
        "SELECT caminho_linguagem, comando_build, comando_execucao, codigo_falha FROM configuracao_e2e WHERE projeto = ? ORDER BY caminho_linguagem",
        nome,
      ),
      globs: listar(
        banco,
        "SELECT caminho_linguagem, glob FROM glob_e2e WHERE projeto = ? ORDER BY caminho_linguagem, glob",
        nome,
      ),
    },
  });
}

/** O projeto, ou `undefined` se não existe; lido num snapshot só. */
export function buscarProjeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  return lerEmSnapshot(banco, () => {
    const linha = banco.prepare(`SELECT ${COLUNAS_DO_PROJETO} FROM projeto WHERE nome = ?`).get(nome);
    return linha && montarProjeto(banco, linha);
  });
}

/** O projeto, ou ErroDeInexistente com a `orientacao`: a única checagem de "o projeto existe". */
export const projetoExistente = (
  banco: DatabaseSync,
  nome: string,
  orientacao = "confira o nome do projeto",
): Projeto => encontrado(buscarProjeto(banco, nome), `o projeto ${nome} não existe`, orientacao);

/** O projeto com a configuração SDLC (ao menos uma linguagem), ou a recusa com a orientação: a única leitura dos casos de uso. */
export function carregarProjeto(banco: DatabaseSync, nome: string): Projeto {
  const projeto = buscarProjeto(banco, nome);
  if (projeto === undefined || projeto.verificacoes.linguagens.length === 0)
    throw new ErroDeRegra(`o projeto ${nome} não tem configuração do SDLC`, "configure o projeto");
  return projeto;
}

/** Todos os projetos, em ordem de nome. */
export function listarProjetos(banco: DatabaseSync): Projeto[] {
  return lerEmSnapshot(banco, () =>
    banco
      .prepare(`SELECT ${COLUNAS_DO_PROJETO} FROM projeto ORDER BY nome`)
      .all()
      .map((linha) => montarProjeto(banco, linha)),
  );
}

/** O nome do outro projeto que já usa a `raiz_git`, se houver. */
export function donoDoRepositorio(banco: DatabaseSync, raiz_git: string, nomeDoProjeto: string): string | undefined {
  const dono = banco.prepare("SELECT nome FROM projeto WHERE raiz_git = ? AND nome <> ?").get(raiz_git, nomeDoProjeto);
  return dono && String(dono.nome);
}

/** Insere cada item de `itens` na `tabela`, com as colunas de `colunas` (nomes iguais às chaves do item). */
function inserir(banco: DatabaseSync, tabela: string, nome: string, colunas: string[], itens: Linha[]): void {
  const insert = banco.prepare(
    `INSERT INTO ${tabela} (projeto, ${colunas.join(", ")}) VALUES (${["?", ...colunas.map(() => "?")].join(", ")})`,
  );
  for (const item of itens) insert.run(nome, ...colunas.map((c) => (item[c] ?? null) as SQLInputValue));
}

/**
 * Grava o projeto inteiro numa transação só: a linha e, no lugar das que havia, cada lista da configuração. Qualquer
 * falha reverte tudo. Sem coluna de posição: a ordem das listas vem das chaves (e a da preparação, do índice).
 */
export function gravarProjeto(banco: DatabaseSync, projeto: Projeto): void {
  const { nome, verificacoes } = projeto;
  escrever(banco, () => {
    banco
      .prepare(
        `INSERT INTO projeto (${COLUNAS_DO_PROJETO}) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (nome) DO UPDATE SET raiz_git = excluded.raiz_git, branch_base = excluded.branch_base,
           hospedagem = excluded.hospedagem, chave_sonarqube = excluded.chave_sonarqube,
           link_produto = excluded.link_produto, imagem_do_ambiente = excluded.imagem_do_ambiente`,
      )
      .run(
        nome,
        projeto.raiz_git,
        projeto.branch_base,
        projeto.hospedagem,
        projeto.chave_sonarqube,
        projeto.link_produto ?? null,
        projeto.imagem_do_ambiente ?? null,
      );
    for (const tabela of [
      "glob_e2e",
      "configuracao_e2e",
      "linguagem_projeto",
      "fitness_function_projeto",
      "comando_preparacao_projeto",
      "configuracao_etapa_projeto",
    ])
      banco.prepare(`DELETE FROM ${tabela} WHERE projeto = ?`).run(nome);
    inserir(
      banco,
      "configuracao_etapa_projeto",
      nome,
      ["etapa", "modelo_provedor", "modelo_nome", "effort"],
      projeto.etapas.map(({ etapa, configuracao_agente }) => ({
        etapa,
        ...colunasDaConfiguracaoAgente(configuracao_agente),
      })),
    );
    inserir(
      banco,
      "comando_preparacao_projeto",
      nome,
      ["ordem", "comando"],
      verificacoes.preparacao.map((comando, indice) => ({ ordem: indice + 1, comando })),
    );
    inserir(banco, "fitness_function_projeto", nome, ["nome", "comando", "descricao"], verificacoes.fitness);
    inserir(banco, "linguagem_projeto", nome, ["caminho", "linguagem", "comando_teste"], verificacoes.linguagens);
    inserir(
      banco,
      "configuracao_e2e",
      nome,
      ["caminho_linguagem", "comando_build", "comando_execucao", "codigo_falha"],
      verificacoes.e2e,
    );
    inserir(banco, "glob_e2e", nome, ["caminho_linguagem", "glob"], verificacoes.globs);
  });
}

const DAS_TAREFAS = "SELECT id FROM tarefa WHERE projeto = $p";
const DAS_DEMANDAS = "SELECT id FROM demanda WHERE projeto = $p";
const DAS_TRABALHOS = `SELECT id FROM trabalho_agentico WHERE demanda_id IN (${DAS_DEMANDAS})`;
const DAS_PROCESSOS = `SELECT id FROM processo_do_trabalho WHERE trabalho_id IN (${DAS_TRABALHOS})`;
const DAS_EVIDENCIAS_DEMANDA = `SELECT id FROM evidencia_demanda WHERE demanda_id IN (${DAS_DEMANDAS})`;
const DAS_AVALIACOES = "SELECT id FROM avaliacao WHERE projeto = $p";

/** O primeiro ticket do projeto em execução, ou com execução de sessão aberta, se houver. */
export function ticketEmAndamentoDoProjeto(
  banco: DatabaseSync,
  nome: string,
): { demanda_id: string; ticket_id: number } | undefined {
  return banco
    .prepare(
      `SELECT t.demanda_id, t.ticket_id FROM ticket_demanda t
       WHERE t.demanda_id IN (${DAS_DEMANDAS}) AND (t.estado = 'em_execucao' OR EXISTS (
         SELECT 1 FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id
         WHERE s.demanda_id = t.demanda_id AND s.ticket_id = t.ticket_id AND e.fim IS NULL))
       ORDER BY t.rowid LIMIT 1`,
    )
    .get({ p: nome }) as { demanda_id: string; ticket_id: number } | undefined;
}

/** A primeira tarefa do projeto com execução simulada na fila ou em andamento, se houver. */
export function tarefaComExecucaoSimuladaPendente(banco: DatabaseSync, nome: string): string | undefined {
  const pendente = banco
    .prepare(
      `SELECT tarefa FROM execucao_simulada WHERE tarefa IN (${DAS_TAREFAS}) AND status IN ('na_fila', 'em_andamento')
       LIMIT 1`,
    )
    .get({ p: nome });
  return pendente && String(pendente.tarefa);
}

/**
 * Apaga as linhas do projeto, na ordem das chaves estrangeiras, e devolve o que sobra para apagar no disco. As
 * recusas (execução em andamento) e o apagamento no disco são do cadastro.
 */
export function apagarProjeto(banco: DatabaseSync, nome: string) {
  const p = { p: nome };
  const simuladas = (
    banco.prepare(`SELECT id FROM execucao_simulada WHERE tarefa IN (${DAS_TAREFAS})`).all(p) as { id: number }[]
  ).map((e) => e.id);
  const execucoes = (
    banco.prepare(`SELECT id FROM processo_do_trabalho WHERE id IN (${DAS_PROCESSOS})`).all(p) as {
      id: string;
    }[]
  ).map((e) => e.id);
  const sessoes = (
    banco.prepare(`SELECT conversa_referencia FROM trabalho_agentico WHERE id IN (${DAS_TRABALHOS})`).all(p) as {
      conversa_referencia: string;
    }[]
  ).map((s) => s.conversa_referencia);
  const anexos = (
    banco
      .prepare(`SELECT DISTINCT sha256 FROM arquivo_evidencia WHERE evidencia_id IN (${DAS_EVIDENCIAS_DEMANDA})`)
      .all(p) as { sha256: string }[]
  ).map((a) => a.sha256);

  const apagar = (tabela: string, onde: string) => banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(p);
  // Tabelas da demanda, filhas antes das mães. Referências de fora do projeto (dependência, commit humano posterior, achado) saem ou
  // são soltas, para não deixar FK pendurada.
  banco.prepare(`UPDATE achado_avaliacao SET demanda_id = NULL WHERE demanda_id IN (${DAS_DEMANDAS})`).run(p);
  apagar("uso_avaliacao", `avaliacao_id IN (${DAS_AVALIACOES})`);
  apagar("avaliacao_demanda", `avaliacao_id IN (${DAS_AVALIACOES}) OR demanda_id IN (${DAS_DEMANDAS})`);
  apagar("achado_avaliacao", `avaliacao_id IN (${DAS_AVALIACOES})`);
  apagar("avaliacao", "projeto = $p");
  apagar("commit_humano_posterior", `demanda_id IN (${DAS_DEMANDAS}) OR alterador_demanda_id IN (${DAS_DEMANDAS})`);
  apagar(
    "arquivo_commit_demanda",
    `sha IN (SELECT sha FROM commit_ticket_demanda WHERE demanda_id IN (${DAS_DEMANDAS}))`,
  );
  apagar("commit_ticket_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("uso_modelo_historico", `execucao_id IN (${DAS_PROCESSOS})`);
  apagar("uso_modelo_execucao", `execucao_id IN (${DAS_PROCESSOS})`);
  apagar("processo_do_trabalho", `trabalho_id IN (${DAS_TRABALHOS})`);
  apagar("trabalho_agentico", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("trabalho_nao_gerenciado", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("uso_declarado", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("iteracao_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("proposta_demanda", `demanda_id IN (${DAS_DEMANDAS}) OR demanda_criada_id IN (${DAS_DEMANDAS})`);
  apagar("decisao_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("evidencia_demanda", `demanda_id IN (${DAS_DEMANDAS})`); // arquivo_evidencia e evidencia_historico saem por ON DELETE CASCADE
  apagar("pull_request", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("limpeza_pendente_encerramento", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("encerramento_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("dependencia_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("caminho_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("arquivo_previsto_rodada", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("arquivo_previsto_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("versao_plano", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("tentativa", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("ticket_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("criterio_citado_rodada", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("dependencia_rodada", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("rodada", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("dependencia_demanda", `demanda_id IN (${DAS_DEMANDAS}) OR depende_demanda_id IN (${DAS_DEMANDAS})`);
  apagar("demanda_historico", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("demanda", "projeto = $p");
  apagar("varredura_base", "projeto = $p");
  apagar("execucao_simulada", `tarefa IN (${DAS_TAREFAS})`);
  apagar("tarefa_usuario", `tarefa IN (${DAS_TAREFAS})`);
  apagar("tarefa", "projeto = $p");
  apagar("usuario_simulado_anexo", "usuario IN (SELECT id FROM usuario_simulado WHERE projeto = $p)");
  apagar("usuario_simulado", "projeto = $p");
  apagar("projeto", "nome = $p");

  const restam = new Set(
    (
      banco
        .prepare(
          `SELECT sha256 FROM arquivo_evidencia WHERE sha256 IN (SELECT value FROM json_each($anexos))
           UNION SELECT sha256 FROM usuario_simulado_anexo WHERE sha256 IN (SELECT value FROM json_each($anexos))`,
        )
        .all({ anexos: JSON.stringify(anexos) }) as { sha256: string }[]
    ).map((a) => a.sha256),
  );
  return { execucoes, sessoes, simuladas, orfaos: anexos.filter((sha) => !restam.has(sha)) };
}
