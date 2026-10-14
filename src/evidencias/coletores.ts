// Coletores de testes, fitness functions e arquivos alterados (F3 §6): rodam os comandos do projeto ou o diff na
// worktree e registram a evidência.
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, matchesGlob } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  type Agregado,
  type ArquivoEvidencia,
  FABRIQUINHA,
  type ProblemasDoPR,
  type TipoEvidencia,
} from "../dominio/agregado.ts";
import { ErroDeRegra, existe } from "../dominio/erros.ts";
import { exigirRegistroDeEvidencia, registrarEvidencia } from "../dominio/evidencia.ts";
import type { Id } from "../dominio/primitivos.ts";
import { guardarArquivos } from "../persistencia/arquivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { ticketDoCommit } from "../persistencia/commits.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { agregadoDoTicket, comIssue } from "../persistencia/issues.ts";
import { projeto } from "../persistencia/projetos.ts";
import { ambienteSemCredenciais, executarNoShell, LIMITE_COMANDO_MS } from "../processo.ts";
import { relatorio } from "../metricas/relatorio.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { diffDaIssue } from "../repositorio/commit.ts";
import { publicarPR, verificarPR } from "../repositorio/pr.ts";
import { caminhoDaWorktree } from "../repositorio/worktree.ts";
import { LIMITE_DO_CORPO, marcaDoPR, montarPR } from "./pr.ts";
import { LIMITE, MIME_HTML, MIME_TEXTO, schemaDe } from "./schemas.ts";

type Coletado = "execucao_testes" | "matriz_fitness";

/**
 * Guarda os textos por conteúdo (F2 §5.1), cada um passando por um arquivo em `pasta`: `guardarArquivos` lê de um fd.
 * Sem `mime`, é texto puro, como os logs.
 */
function guardarTextos(
  banco: DatabaseSync,
  pasta: string,
  textos: readonly { nome: string; texto: string; mime?: string }[],
): ArquivoEvidencia[] {
  const abertos: { fd: number; nome: string; mime: string }[] = [];
  try {
    for (const { nome, texto, mime = MIME_TEXTO } of textos) {
      writeFileSync(join(pasta, nome), texto, { mode: 0o600 });
      abertos.push({ fd: openSync(join(pasta, nome), "r"), nome, mime });
    }
    return guardarArquivos(banco, abertos, (_copia, _bytes, { nome, mime }) => ({ nome, mime }), LIMITE.texto);
  } finally {
    for (const { fd } of abertos) closeSync(fd);
  }
}

/** `guardarTextos` numa pasta temporária, apagada no fim. */
function guardarNumaPasta(banco: DatabaseSync, textos: Parameters<typeof guardarTextos>[2]): ArquivoEvidencia[] {
  const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-coleta-"));
  try {
    return guardarTextos(banco, pasta, textos);
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** O agregado do ticket e o projeto da issue. */
function daIssue(banco: DatabaseSync, ticket: Id) {
  const antes = agregadoDoTicket(banco, ticket);
  // A FK de issue.projeto garante o projeto de um ticket que existe.
  const proj = antes && projeto(banco, antes.issue.projeto);
  if (!antes || !proj) throw new ErroDeRegra(`o ticket T-${String(ticket)} não existe`, "confira o número do ticket");
  return { antes, proj };
}

/**
 * As pré-condições de C17 para `tipo` e a worktree da issue, conferidas antes de coletar, para não gastar até 30
 * minutos por comando à toa.
 */
function exigirColeta(banco: DatabaseSync, ticket: Id, tipo: TipoEvidencia) {
  const { antes, proj } = daIssue(banco, ticket);
  exigirRegistroDeEvidencia(antes, FABRIQUINHA, ticket, tipo);
  const worktree = caminhoDaWorktree(raizDo(banco), proj.nome, antes.issue.id);
  if (!statSync(worktree, { throwIfNoEntry: false })?.isDirectory()) {
    throw new ErroDeRegra(
      `a worktree da I-${String(antes.issue.id)} não existe em ${worktree}`,
      "execute o ticket de novo: a execução cria a worktree antes da coleta",
    );
  }
  return { antes, proj, worktree };
}

/**
 * Roda os comandos, todos, mesmo depois de uma falha, fora de transação (F2 §3.2), e registra `tipo` em `ticket`
 * via C17, aprovada quando cada código de saída é 0. Comando não encontrado sai com 127 e reprova como qualquer outro.
 * Os comandos rodam código do agente, então rodam sem credenciais (F5 §5.0).
 */
async function coletar(banco: DatabaseSync, ticket: Id, tipo: Coletado, limiteMs: number): Promise<Agregado> {
  const { antes, proj, worktree } = exigirColeta(banco, ticket, tipo);
  const itens =
    tipo === "execucao_testes"
      ? proj.testes.map((comando, i) => ({ comando, log: `teste-${String(i + 1)}.log` }))
      : proj.fitness.map((f) => ({ ...f, log: `${f.nome}.log` }));

  const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-coleta-"));
  try {
    const vazio = join(pasta, "vazio");
    mkdirSync(vazio);
    const env = ambienteSemCredenciais(process.env, vazio);
    const linhas = [];
    const logs = [];
    for (const item of itens) {
      const r = await executarNoShell(item.comando, worktree, { env, limiteMs, limiteLog: LIMITE.texto });
      linhas.push({ ...item, codigoSaida: r.codigo, estourou: r.estourou, duracaoMs: r.duracaoMs });
      logs.push({ nome: item.log, texto: r.log });
    }
    const dados = schemaDe(tipo).dados.parse(tipo === "execucao_testes" ? { comandos: linhas } : { linhas });
    const aprovada = linhas.every((l) => l.codigoSaida === 0);
    const arquivos = guardarTextos(banco, pasta, logs);

    return comIssue(banco, antes.issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
      registrarEvidencia(ag, { ticket, tipo, aprovada, dados, arquivos }, FABRIQUINHA, ctx),
    );
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/** F3 §6, coletor de testes: cada comando de `projeto.testes` vira uma linha de `execucao_testes`. */
export const coletarTestes = (banco: DatabaseSync, ticket: Id, limiteMs = LIMITE_COMANDO_MS): Promise<Agregado> =>
  coletar(banco, ticket, "execucao_testes", limiteMs);

/** F3 §6, coletor de fitness: cada `projeto.fitness[]` vira uma linha de `matriz_fitness`. */
export const coletarFitness = (banco: DatabaseSync, ticket: Id, limiteMs = LIMITE_COMANDO_MS): Promise<Agregado> =>
  coletar(banco, ticket, "matriz_fitness", limiteMs);

/**
 * F3 §6, coletor de arquivos alterados: o diff da issue (F5 §8) cruzado, com `path.matchesGlob`, com os
 * `arquivosPrevistos` do desenho aprovado, o do último ticket de desenho concluído (F3 §4.4). `previsto` é o primeiro
 * padrão que casa com o arquivo; `previstosNaoTocados`, os padrões com que nenhum arquivo casou. A renomeação casa
 * pelos dois caminhos: o antigo, previsto para remover, também foi tocado.
 */
export async function coletarArquivosAlterados(banco: DatabaseSync, ticket: Id): Promise<Agregado> {
  const { antes, proj } = exigirColeta(banco, ticket, "arquivos_alterados");
  const desenhos = new Set(
    antes.tickets.filter((t) => t.etapa === "desenho" && t.status === "concluido").map((t) => t.id),
  );
  // O desenho_solucao foi validado na submissão: arquivosPrevistos tem pelo menos um item.
  const previstos = [
    ...new Set(
      antes.evidencias
        .filter((e) => e.tipo === "desenho_solucao" && desenhos.has(e.ticket))
        .slice(-1)
        .flatMap((e) => (e.dados.arquivosPrevistos as { caminho: string }[]).map((a) => a.caminho)),
    ),
  ];
  const { base, head, arquivos } = await diffDaIssue(raizDo(banco), proj, antes.issue.id);
  const casa = (a: (typeof arquivos)[number], padrao: string) =>
    matchesGlob(a.caminho, padrao) || (a.caminhoAnterior !== undefined && matchesGlob(a.caminhoAnterior, padrao));
  const dados = schemaDe("arquivos_alterados").dados.parse({
    base,
    head,
    arquivos: arquivos.map((a) => ({
      caminho: a.caminho,
      status: a.status,
      adicionadas: a.adicionadas,
      removidas: a.removidas,
      previsto: previstos.find((padrao) => casa(a, padrao)) ?? null,
    })),
    previstosNaoTocados: previstos.filter((padrao) => !arquivos.some((a) => casa(a, padrao))),
  });
  return comIssue(banco, antes.issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
    registrarEvidencia(ag, { ticket, tipo: "arquivos_alterados", dados, arquivos: [] }, FABRIQUINHA, ctx),
  );
}

/**
 * F3 §6, coletor de produtividade: o relatório do F6 (§6.1), com o HTML anexado. Fora da fila git do projeto: o
 * relatório refaz o retrabalho, que entra nela.
 */
export async function coletarProdutividade(banco: DatabaseSync, ticket: Id): Promise<Agregado> {
  const { antes } = exigirColeta(banco, ticket, "relatorio_produtividade");
  const { dados, html } = await relatorio(banco, antes.issue.id);
  const arquivos = guardarNumaPasta(banco, [{ nome: "relatorio.html", texto: html, mime: MIME_HTML }]);
  return comIssue(banco, antes.issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
    registrarEvidencia(ag, { ticket, tipo: "relatorio_produtividade", dados, arquivos }, FABRIQUINHA, ctx),
  );
}

/**
 * F3 §6, coletor do PR: monta título e corpo (F3 §4.6) das evidências da issue, com o `relatorio_produtividade` já
 * registrado, condensa o corpo ao limite da hospedagem (§4.7), publica (F5 §5.1) e registra `pr_aberto` com o corpo
 * completo anexado. Os PRs conhecidos são os das evidências `pr_aberto` da issue, em ordem: o último é o atual.
 */
export async function coletarPR(banco: DatabaseSync, ticket: Id, log: string): Promise<Agregado> {
  const { antes, proj } = exigirColeta(banco, ticket, "pr_aberto");
  const issue = antes.issue;
  const { titulo, completo, publicado, condensado } = montarPR(antes, ticket, LIMITE_DO_CORPO[proj.hospedagem]);
  const daIssue = new Set(antes.tickets.map((t) => t.id));
  const pr = await publicarPR(
    raizDo(banco),
    proj,
    issue.id,
    {
      titulo,
      corpo: publicado,
      conhecidos: antes.evidencias.filter((e) => e.tipo === "pr_aberto").map((e) => e.dados.id as string),
      marca: marcaDoPR(issue.id, ticket),
      // `commit_ticket` só guarda commits de tickets de desenvolvimento; o da issue é o de um ticket dela.
      registrado: (sha) => daIssue.has(ticketDoCommit(banco, sha) ?? 0),
    },
    () => varrerBase(banco, proj.nome),
    log,
  );
  anotar(log, `PR publicado: ${pr.url}`);
  const dados = schemaDe("pr_aberto").dados.parse({
    hospedagem: proj.hospedagem,
    id: pr.id,
    url: pr.url,
    branch: pr.branch,
    base: proj.branchBase,
    head: pr.head,
    condensado,
  });
  const arquivos = guardarNumaPasta(banco, [{ nome: "pr.md", texto: completo }]);
  return comIssue(banco, issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) =>
    registrarEvidencia(ag, { ticket, tipo: "pr_aberto", dados, arquivos }, FABRIQUINHA, ctx),
  );
}

/** F5 §5.1, passo 4: espera a plataforma decidir o conflito e os checks do último PR publicado da issue do ticket. */
export async function verificarOPR(banco: DatabaseSync, ticket: Id, log: string): Promise<ProblemasDoPR> {
  const { antes, proj } = daIssue(banco, ticket);
  const pr = existe(
    antes.evidencias.findLast((e) => e.tipo === "pr_aberto"),
    `a I-${String(antes.issue.id)} ainda não tem PR`,
    "o encerramento publica o PR",
  );
  return verificarPR(proj, pr.dados.id as string, log);
}
