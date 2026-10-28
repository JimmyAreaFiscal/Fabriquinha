// Gravação e leitura de projetos (C19: registrar e editar; F2 §4 e §6).
// As conferências externas (F5 §2, F4 §9) rodam antes, fora daqui.
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { Projeto } from "../dominio/projeto.ts";
import { caminhoArquivo } from "./arquivos.ts";
import { escrever, raizDo } from "./banco.ts";
import { dirDaExecucao, dirDaExecucaoSimulada } from "./execucoes.ts";

interface Linha {
  nome: string;
  repo: string;
  branch_base: string;
  hospedagem: string;
  preparacao: string;
  testes: string;
  sonar_project_key: string;
  fitness: string;
  modelos: string;
  efforts: string;
  link_produto: string | null;
}

const json = (texto: string): unknown => JSON.parse(texto);

const deLinha = (l: Linha): Projeto =>
  Projeto.parse({
    nome: l.nome,
    repo: l.repo,
    branchBase: l.branch_base,
    hospedagem: l.hospedagem,
    preparacao: json(l.preparacao),
    testes: json(l.testes),
    sonar: { projectKey: l.sonar_project_key },
    fitness: json(l.fitness),
    modelos: json(l.modelos),
    efforts: json(l.efforts),
    ...(l.link_produto && { linkProduto: l.link_produto }),
  });

/**
 * Valida o schema do F1 (§3.3) e grava numa transação. O repositório só pode ser de um projeto; `sql` usa os
 * parâmetros nomeados das colunas e devolve quantas linhas mudou.
 */
function gravar(banco: DatabaseSync, entrada: unknown, sql: string, conferir: (p: Projeto, mudou: boolean) => void) {
  const p = Projeto.parse(entrada);
  escrever(banco, () => {
    const dono = banco.prepare("SELECT nome FROM projeto WHERE repo = ? AND nome <> ?").get(p.repo, p.nome);
    if (dono) {
      throw new ErroDeRegra(
        `o repositório ${p.repo} já é do projeto ${String(dono.nome)}`,
        `edite o projeto ${String(dono.nome)} em vez de cadastrar outro para o mesmo repositório`,
      );
    }
    const comando = banco.prepare(sql);
    // A edição não toca as colunas legadas: os parâmetros que o `sql` não usa ficam de fora.
    comando.setAllowUnknownNamedParameters(true);
    const { changes } = comando.run({
      nome: p.nome,
      repo: p.repo,
      branch_base: p.branchBase,
      hospedagem: p.hospedagem,
      preparacao: JSON.stringify(p.preparacao),
      testes: JSON.stringify(p.testes),
      sonar_project_key: p.sonar.projectKey,
      fitness: JSON.stringify(p.fitness),
      modelos: JSON.stringify(p.modelos),
      efforts: JSON.stringify(p.efforts ?? {}),
      link_produto: p.linkProduto ?? null,
    });
    conferir(p, changes > 0);
  });
  return p;
}

/** C19: cadastra um projeto novo. */
export const registrarProjeto = (banco: DatabaseSync, entrada: unknown): Projeto =>
  gravar(
    banco,
    entrada,
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, preparacao, testes, sonar_project_key, fitness, modelos, efforts, link_produto)
     VALUES ($nome, $repo, $branch_base, $hospedagem, $preparacao, $testes, $sonar_project_key, $fitness, $modelos, $efforts,
       $link_produto)
     ON CONFLICT (nome) DO NOTHING`,
    (p, mudou) => {
      if (!mudou) throw new ErroDeRegra(`já existe o projeto ${p.nome}`, "edite-o na Configuração");
    },
  );

/**
 * C19: substitui o cadastro de um projeto que já existe; o nome é a chave e não muda. As colunas legadas e a chave do
 * SonarQube (da configuração SDLC) ficam como estão.
 */
export const editarProjeto = (banco: DatabaseSync, entrada: unknown): Projeto =>
  gravar(
    banco,
    entrada,
    `UPDATE projeto SET repo = $repo, branch_base = $branch_base, hospedagem = $hospedagem, preparacao = $preparacao,
       link_produto = $link_produto
     WHERE nome = $nome`,
    (p, mudou) => {
      if (!mudou) throw new ErroDeInexistente(`o projeto ${p.nome} não existe`, "cadastre-o na Configuração");
    },
  );

export function projeto(banco: DatabaseSync, nome: string): Projeto | undefined {
  const linha = banco.prepare("SELECT * FROM projeto WHERE nome = ?").get(nome) as Linha | undefined;
  return linha && deLinha(linha);
}

/** Todos os projetos, em ordem de nome. */
export function projetos(banco: DatabaseSync): Projeto[] {
  return (banco.prepare("SELECT * FROM projeto ORDER BY nome").all() as unknown as Linha[]).map(deLinha);
}

const DOS_TICKETS = "SELECT t.id FROM ticket t JOIN issue i ON i.id = t.issue WHERE i.projeto = $p";
const DAS_EXECUCOES = `SELECT id FROM execucao WHERE ticket IN (${DOS_TICKETS})`;
const DOS_COMMITS = `SELECT sha FROM commit_ticket WHERE ticket IN (${DOS_TICKETS})`;
const DAS_EVIDENCIAS = `SELECT id FROM evidencia WHERE ticket IN (${DOS_TICKETS})`;
const DAS_ISSUES = "SELECT id FROM issue WHERE projeto = $p";
const DAS_TAREFAS = "SELECT id FROM tarefa WHERE projeto = $p";
const DAS_DEMANDAS = "SELECT id FROM demanda WHERE projeto = $p";
const DAS_SESSOES = `SELECT id FROM sessao WHERE demanda_id IN (${DAS_DEMANDAS})`;
const DAS_EXECUCOES_SESSAO = `SELECT id FROM execucao_sessao WHERE sessao_id IN (${DAS_SESSOES})`;
const DAS_EVIDENCIAS_DEMANDA = `SELECT id FROM evidencia_demanda WHERE demanda_id IN (${DAS_DEMANDAS})`;
const DAS_AVALIACOES = "SELECT id FROM avaliacao WHERE projeto = $p";

/** Apaga as linhas do projeto, na ordem das chaves estrangeiras, e devolve o que sobra para apagar no disco. */
function apagarLinhas(banco: DatabaseSync, nome: string) {
  const p = { p: nome };
  const emAndamento = banco
    .prepare(
      `SELECT t.id FROM ticket t JOIN issue i ON i.id = t.issue
       WHERE i.projeto = $p AND (t.status = 'em_execucao'
         OR EXISTS (SELECT 1 FROM execucao e WHERE e.ticket = t.id AND e.resultado = 'em_andamento'))
       ORDER BY t.id LIMIT 1`,
    )
    .get(p);
  if (emAndamento) {
    throw new ErroDeRegra(
      `o projeto ${nome} tem execução em andamento no T-${String(emAndamento.id)}`,
      "espere ela terminar ou pare a sessão, e remova de novo",
    );
  }
  const pendente = banco
    .prepare(
      `SELECT tarefa FROM execucao_simulada WHERE tarefa IN (${DAS_TAREFAS}) AND status IN ('na_fila', 'em_andamento')
       LIMIT 1`,
    )
    .get(p);
  if (pendente) {
    throw new ErroDeRegra(
      `o projeto ${nome} tem execução simulada pendente na Tarefa ${String(pendente.tarefa)}`,
      "espere ela terminar, e remova de novo",
    );
  }
  const simuladas = (
    banco.prepare(`SELECT id FROM execucao_simulada WHERE tarefa IN (${DAS_TAREFAS})`).all(p) as { id: number }[]
  ).map((e) => e.id);
  const execucoes = banco.prepare(`SELECT id, sessao_pi FROM execucao WHERE id IN (${DAS_EXECUCOES})`).all(p) as {
    id: number;
    sessao_pi: string;
  }[];
  const anexos = (
    banco.prepare(`SELECT DISTINCT sha256 FROM evidencia_arquivo WHERE evidencia IN (${DAS_EVIDENCIAS})`).all(p) as {
      sha256: string;
    }[]
  ).map((a) => a.sha256);
  anexos.push(
    ...(
      banco
        .prepare(`SELECT DISTINCT sha256 FROM arquivo_evidencia WHERE evidencia_id IN (${DAS_EVIDENCIAS_DEMANDA})`)
        .all(p) as { sha256: string }[]
    ).map((a) => a.sha256),
  );

  const apagar = (tabela: string, onde: string) => banco.prepare(`DELETE FROM ${tabela} WHERE ${onde}`).run(p);
  apagar("uso", `execucao IN (${DAS_EXECUCOES})`);
  apagar("retrabalho", `ticket IN (${DOS_TICKETS}) OR ticket_origem IN (${DOS_TICKETS})`);
  apagar("arquivo_commit", `sha IN (${DOS_COMMITS})`);
  apagar("commit_ticket", `ticket IN (${DOS_TICKETS})`);
  apagar("evidencia", `ticket IN (${DOS_TICKETS})`); // evidencia_arquivo sai por ON DELETE CASCADE
  apagar("proposta_issue", `ticket IN (${DOS_TICKETS})`);
  apagar("decisao", `issue IN (${DAS_ISSUES})`);
  apagar("execucao", `ticket IN (${DOS_TICKETS})`);
  apagar("comando", `issue IN (${DAS_ISSUES})`);
  apagar("issue_dep", `issue IN (${DAS_ISSUES}) OR dep IN (${DAS_ISSUES})`);
  apagar("ticket", `issue IN (${DAS_ISSUES})`);
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
  apagar("issue", "projeto = $p");
  apagar("projeto", "nome = $p");

  const restam = new Set(
    (
      banco
        .prepare(
          `SELECT sha256 FROM evidencia_arquivo WHERE sha256 IN (SELECT value FROM json_each($anexos))
           UNION SELECT sha256 FROM arquivo_evidencia WHERE sha256 IN (SELECT value FROM json_each($anexos))
           UNION SELECT sha256 FROM usuario_simulado_anexo WHERE sha256 IN (SELECT value FROM json_each($anexos))`,
        )
        .all({ anexos: JSON.stringify(anexos) }) as { sha256: string }[]
    ).map((a) => a.sha256),
  );
  return { execucoes, simuladas, orfaos: anexos.filter((sha) => !restam.has(sha)) };
}

/**
 * Remove o projeto e tudo o que depende dele, em qualquer fase (I-4): primeiro o banco, numa transação; depois,
 * com o banco já commitado, as pastas de execução, as sessões do pi e os anexos que nenhum outro projeto usa.
 * Falha no disco vira aviso: o banco não volta atrás.
 * ponytail: janela de corrida. Uma submissão de outro projeto com o mesmo conteúdo copia o anexo fora da transação
 * (F2 §5.2); se ela cair entre a consulta dos órfãos e o `rm`, o arquivo some sob a evidência nova. É rara
 * (mesmo hash, no mesmo instante); se importar, trocar o `rm` por uma conferência no banco imediatamente antes.
 */
export async function removerProjeto(
  banco: DatabaseSync,
  nome: string,
): Promise<{ projeto: Projeto; avisos: string[] }> {
  const { removido, execucoes, simuladas, orfaos } = escrever(banco, () => {
    const removido = projeto(banco, nome);
    if (!removido) throw new ErroDeInexistente(`o projeto ${nome} não existe`, "confira o nome do projeto");
    return { removido, ...apagarLinhas(banco, nome) };
  });

  const raiz = raizDo(banco);
  const avisos: string[] = [];
  const apagar = (caminho: string) =>
    rm(caminho, { recursive: true, force: true }).catch((error_: unknown) => {
      avisos.push(`não foi possível apagar ${caminho}: ${(error_ as Error).message}`);
    });

  // `<instante>_<sessaoPi>.jsonl`: o instante não tem `_`, então o ID é o que vem depois do primeiro.
  const sessoes = new Set(execucoes.map((e) => e.sessao_pi));
  const dirSessoes = join(raiz, "sessoes");
  const arquivosDeSessao = (await readdir(dirSessoes).catch(() => [])).filter(
    (arquivo) => arquivo.endsWith(".jsonl") && sessoes.has(arquivo.slice(arquivo.indexOf("_") + 1, -".jsonl".length)),
  );
  await Promise.all([
    ...execucoes.map((e) => apagar(dirDaExecucao(raiz, e.id))),
    ...simuladas.map((id) => apagar(dirDaExecucaoSimulada(raiz, id))),
    ...arquivosDeSessao.map((arquivo) => apagar(join(dirSessoes, arquivo))),
    ...orfaos.map((sha) => apagar(caminhoArquivo(banco, sha))),
  ]);
  return { projeto: removido, avisos };
}
