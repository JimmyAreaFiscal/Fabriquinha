// Gravação e leitura das linhas de projeto (F2 §4 e §6). As recusas de negócio e o disco são do cadastro
// (aplicacao/projeto/cadastro.ts); as conferências externas (F5 §2, F4 §9) rodam antes.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ConfiguracaoEtapaProjeto, Projeto as ProjetoComConfiguracao } from "../nucleo/configuracao_projeto.ts";
import { ErroDeRegra, encontrado } from "../nucleo/erros.ts";
import { Projeto } from "../nucleo/projeto.ts";
import { linhaComConfiguracaoAgente } from "./configuracao_agente.ts";

interface Linha {
  nome: string;
  raiz_git: string;
  branch_base: string;
  hospedagem: string;
  chave_sonarqube: string;
  link_produto: string | null;
}

type LinhaGenerica = Record<string, unknown>;

const listar = (banco: DatabaseSync, sql: string, nome: string): LinhaGenerica[] => banco.prepare(sql).all(nome);

/** Remove os `null` das linhas: opcional ausente no schema é chave ausente, não `null`. */
const semNulos = (l: LinhaGenerica): LinhaGenerica =>
  Object.fromEntries(Object.entries(l).filter(([, v]) => v !== null));

const SELECIONAR_PREPARACAO = "SELECT ordem, comando FROM comando_preparacao_projeto WHERE projeto = ? ORDER BY ordem";

const SELECIONAR_ETAPAS =
  "SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto WHERE projeto = ? ORDER BY etapa";

const etapasGravadas = (banco: DatabaseSync, nome: string): LinhaGenerica[] =>
  listar(banco, SELECIONAR_ETAPAS, nome).map(linhaComConfiguracaoAgente);

/** Os comandos de preparação da worktree do projeto, na ordem, mesmo sem a configuração SDLC (sem linguagens) gravada. */
const preparacaoDoProjeto = (banco: DatabaseSync, nome: string): string[] =>
  listar(banco, SELECIONAR_PREPARACAO, nome).map((l) => String(l.comando));

/** O modelo e o effort de cada etapa do projeto, mesmo sem a configuração SDLC (sem linguagens) gravada. */
export const etapasDoProjeto = (banco: DatabaseSync, nome: string): ProjetoComConfiguracao["etapas"] =>
  z.array(ConfiguracaoEtapaProjeto).parse(etapasGravadas(banco, nome));

/** Lê o projeto sem abrir transação; quem chama garante o snapshot. Sem linguagens, não há configuração nova. */
function lerProjetoComConfiguracao(banco: DatabaseSync, nome: string): ProjetoComConfiguracao | undefined {
  const base = banco
    .prepare("SELECT nome, branch_base, chave_sonarqube, raiz_git, hospedagem FROM projeto WHERE nome = ?")
    .get(nome);
  const linguagens = listar(
    banco,
    "SELECT caminho, linguagem, comando_teste FROM linguagem_projeto WHERE projeto = ? ORDER BY caminho",
    nome,
  );
  if (!base || linguagens.length === 0) return undefined;
  return ProjetoComConfiguracao.parse({
    ...semNulos(base),
    etapas: etapasGravadas(banco, nome),
    preparacao: listar(banco, SELECIONAR_PREPARACAO, nome),
    fitness: listar(
      banco,
      "SELECT nome, comando, descricao FROM fitness_function_projeto WHERE projeto = ? ORDER BY nome",
      nome,
    ),
    linguagens,
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
  });
}

/** Configuração SDLC do projeto, lida num snapshot só; `undefined` se o projeto não existe ou não tem configuração nova. */
export function configuracaoProjeto(banco: DatabaseSync, nome: string): ProjetoComConfiguracao | undefined {
  const propria = !banco.isTransaction; // dentro de `escrever` a leitura já é parte da transação
  if (propria) banco.exec("BEGIN");
  try {
    return lerProjetoComConfiguracao(banco, nome);
  } finally {
    if (propria) banco.exec("COMMIT");
  }
}

/** A configuração SDLC do projeto, ou a recusa com a orientação: a única leitura dos casos de uso. */
export function carregarProjeto(banco: DatabaseSync, nome: string): ProjetoComConfiguracao {
  const projetoCarregado = configuracaoProjeto(banco, nome);
  if (projetoCarregado === undefined)
    throw new ErroDeRegra(`o projeto ${nome} não tem configuração do SDLC`, "configure o projeto");
  return projetoCarregado;
}

/** A preparação vem de `comando_preparacao_projeto`, a mesma tabela que o fluxo da demanda lê. */
const deLinha = (banco: DatabaseSync, l: Linha): Projeto =>
  Projeto.parse({
    nome: l.nome,
    repo: l.raiz_git,
    branchBase: l.branch_base,
    hospedagem: l.hospedagem,
    preparacao: preparacaoDoProjeto(banco, l.nome),
    sonar: { projectKey: l.chave_sonarqube },
    ...(l.link_produto && { linkProduto: l.link_produto }),
  });

/** O projeto, ou ErroDeInexistente com a `orientacao`: a única checagem de "o projeto existe". */
export const projetoExistente = (
  banco: DatabaseSync,
  nome: string,
  orientacao = "confira o nome do projeto",
): Projeto => encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, orientacao);

/** O nome do outro projeto que já usa a `raiz_git`, se houver. */
export function donoDoRepositorio(banco: DatabaseSync, raiz_git: string, nomeDoProjeto: string): string | undefined {
  const dono = banco.prepare("SELECT nome FROM projeto WHERE raiz_git = ? AND nome <> ?").get(raiz_git, nomeDoProjeto);
  return dono && String(dono.nome);
}

/** Insere o projeto; `false` se o nome já existe (nada é alterado). A preparação é gravada à parte. */
export function inserirProjeto(banco: DatabaseSync, p: Projeto): boolean {
  const { changes } = banco
    .prepare(
      `INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube, link_produto)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (nome) DO NOTHING`,
    )
    .run(p.nome, p.repo, p.branchBase, p.hospedagem, p.sonar.projectKey, p.linkProduto ?? null);
  return changes > 0;
}

/** Substitui o cadastro de um projeto que existe; a chave do SonarQube (da configuração SDLC) fica como está. */
export function atualizarProjeto(banco: DatabaseSync, p: Projeto): void {
  banco
    .prepare("UPDATE projeto SET raiz_git = ?, branch_base = ?, hospedagem = ?, link_produto = ? WHERE nome = ?")
    .run(p.repo, p.branchBase, p.hospedagem, p.linkProduto ?? null, p.nome);
}

export function projeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  const linha = banco.prepare("SELECT * FROM projeto WHERE nome = ?").get(nome) as Linha | undefined;
  return linha && deLinha(banco, linha);
}

/** Todos os projetos, em ordem de nome. */
export function projetos(banco: DatabaseSync): Projeto[] {
  return (banco.prepare("SELECT * FROM projeto ORDER BY nome").all() as unknown as Linha[]).map((l) =>
    deLinha(banco, l),
  );
}

const DAS_TAREFAS = "SELECT id FROM tarefa WHERE projeto = $p";
const DAS_DEMANDAS = "SELECT id FROM demanda WHERE projeto = $p";
const DAS_SESSOES = `SELECT id FROM sessao WHERE demanda_id IN (${DAS_DEMANDAS})`;
const DAS_EXECUCOES_SESSAO = `SELECT id FROM execucao_sessao WHERE sessao_id IN (${DAS_SESSOES})`;
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
         SELECT 1 FROM execucao_sessao e JOIN sessao s ON s.id = e.sessao_id
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
    banco.prepare(`SELECT id FROM execucao_sessao WHERE id IN (${DAS_EXECUCOES_SESSAO})`).all(p) as { id: string }[]
  ).map((e) => e.id);
  const sessoes = (
    banco.prepare(`SELECT conversa_referencia FROM sessao WHERE id IN (${DAS_SESSOES})`).all(p) as {
      conversa_referencia: string;
    }[]
  ).map((s) => s.conversa_referencia);
  const anexos = (
    banco
      .prepare(`SELECT DISTINCT sha256 FROM arquivo_evidencia WHERE evidencia_id IN (${DAS_EVIDENCIAS_DEMANDA})`)
      .all(p) as { sha256: string }[]
  ).map((a) => a.sha256);

  const apagar = (tabela: string, onde: string) => banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(p);
  // Tabelas da demanda, filhas antes das mães. Referências de fora do projeto (dependência, retrabalho, achado) saem ou
  // são soltas, para não deixar FK pendurada.
  banco.prepare(`UPDATE achado_avaliacao SET demanda_id = NULL WHERE demanda_id IN (${DAS_DEMANDAS})`).run(p);
  apagar("uso_avaliacao", `avaliacao_id IN (${DAS_AVALIACOES})`);
  apagar("avaliacao_demanda", `avaliacao_id IN (${DAS_AVALIACOES}) OR demanda_id IN (${DAS_DEMANDAS})`);
  apagar("achado_avaliacao", `avaliacao_id IN (${DAS_AVALIACOES})`);
  apagar("avaliacao", "projeto = $p");
  apagar("retrabalho_demanda", `demanda_id IN (${DAS_DEMANDAS}) OR alterador_demanda_id IN (${DAS_DEMANDAS})`);
  apagar(
    "arquivo_commit_demanda",
    `sha IN (SELECT sha FROM commit_ticket_demanda WHERE demanda_id IN (${DAS_DEMANDAS}))`,
  );
  apagar("commit_ticket_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("uso_modelo_historico", `execucao_id IN (${DAS_EXECUCOES_SESSAO})`);
  apagar("uso_modelo_execucao", `execucao_id IN (${DAS_EXECUCOES_SESSAO})`);
  apagar("execucao_sessao", `sessao_id IN (${DAS_SESSOES})`);
  apagar("sessao", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("sessao_externa_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("iteracao_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("proposta_demanda", `demanda_id IN (${DAS_DEMANDAS}) OR demanda_criada_id IN (${DAS_DEMANDAS})`);
  apagar("decisao_ticket_historico", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("decisao_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("evidencia_demanda", `demanda_id IN (${DAS_DEMANDAS})`); // arquivo_evidencia e evidencia_historico saem por ON DELETE CASCADE
  apagar("limpeza_pendente_encerramento", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("encerramento_demanda", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("dependencia_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
  apagar("caminho_ticket", `demanda_id IN (${DAS_DEMANDAS})`);
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
