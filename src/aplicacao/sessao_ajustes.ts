// Sessão de ajustes do PR reprovado (comparacao-sdlc-implementacao.md §§4 e 6): reprova o PR da rodada e abre na hora a
// conversa do Auditor com o agente, que só registra tickets corretivos. A conversa acontece no chat da sessão do ticket.
// Ela não implementa nem integra: os SHAs da rodada e da demanda são gravados ao abrir e restaurados quando a execução
// termina e quando a sessão conclui.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ator } from "../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { existe } from "../nucleo/erros.ts";
import { concluirSessaoRodada, reprovarPullRequestRodada } from "../nucleo/transicoes_rodada.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { anotar } from "../infra/registro.ts";
import { carregarSessoesDoTicket } from "../armazenamento/sessoes.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { descartarAlteracoes, exigirGit } from "../infra/repositorio/worktree.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { encerrar, situacao } from "./gerente.ts";
import type { RefRodada } from "./encerramento_rodada.ts";

type Opcoes = Pick<OpcoesExecucaoDemanda, "limiteMin">;

interface Ponta {
  branch: string;
  sha: string;
}
interface Marco {
  rodada: Ponta;
  demanda: Ponta;
}

const contexto = () => ({ agora: new Date().toISOString() });

/** Fim da execução em curso por rodada; a conclusão da sessão espera por ele para restaurar depois do pi. */
const fins = new Map<string, Promise<void>>();

const arquivoDoMarco = (banco: DatabaseSync, ref: RefRodada): string =>
  join(raizDo(banco), "execucoes", `ajustes-${formatarRodadaRef(ref)}.json`);

/** O `encerrar_rodada` atual (o de maior id) da rodada e o `pr_aberto` dele. */
function prDaRodada(ag: AgregadoDemanda, ref: RefRodada) {
  const ticket = existe(
    ag.tickets
      .filter((t) => t.rodada_id === ref.rodada_id && t.etapa === "encerrar_rodada")
      .sort((a, b) => b.ticket_id - a.ticket_id)[0],
    `a rodada ${formatarRodadaRef(ref)} não tem ticket encerrar_rodada`,
    "confira o estado da rodada",
  );
  const pr = existe(
    ag.evidencias.findLast((e) => e.ticket_id === ticket.ticket_id && e.tipo === "pr_aberto"),
    `a rodada ${formatarRodadaRef(ref)} não tem PR publicado`,
    "o encerramento publica o PR",
  );
  return { ticket, pr: pr.dados as { url: string; branch: string; head: string } };
}

/** O ticket `ajustar_resultado` mais recente da rodada. */
const sessaoDaRodada = (ag: AgregadoDemanda, ref: RefRodada): TicketDemanda =>
  existe(
    ag.tickets.findLast((t) => t.rodada_id === ref.rodada_id && t.etapa === "ajustar_resultado"),
    `a rodada ${formatarRodadaRef(ref)} não tem sessão de ajustes`,
    "só a rodada reprovada tem sessão de ajustes",
  );

/** Volta as duas branches aos SHAs do marco e descarta o que a conversa deixou nas worktrees, sem verificar nem commitar. */
async function restaurar(banco: DatabaseSync, ref: RefRodada): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const raiz = raizDo(banco);
  const marco = JSON.parse(readFileSync(arquivoDoMarco(banco, ref), "utf8")) as Marco;
  const log = join(raiz, "execucoes", `ajustes-${formatarRodadaRef(ref)}.log`);
  const pontas: [Ponta, string][] = [
    [marco.rodada, caminhoDaWorktreeRodada(raiz, ag.demanda.projeto, ref)],
    [marco.demanda, caminhoDaWorktreeDemanda(raiz, ag.demanda.projeto, ref.demanda_id)],
  ];
  for (const [{ branch, sha }, worktree] of pontas) {
    await exigirGit(worktree, "update-ref", `refs/heads/${branch}`, sha);
    await descartarAlteracoes(worktree, log);
  }
  anotar(log, `${formatarRodadaRef(ref)}: branches restauradas aos SHAs do início da sessão`);
}

/** A execução com pi vivo neste serviço na sessão do ticket, se há. */
function execucaoViva(banco: DatabaseSync, ticket: TicketDemanda): string | number | undefined {
  const sessao = existe(
    carregarSessoesDoTicket(banco, ticket).sessoes[0],
    `o ticket ${formatarTicketRef(ticket)} não tem sessão`,
    "a sessão nasce ao abrir os ajustes",
  );
  return situacao(sessao.id)?.execucao;
}

/**
 * Inicia ou retoma a execução interativa do ticket da sessão; ao terminar, restaura as branches em vez de fechar o
 * ticket, que só conclui com a sessão.
 */
function executar(
  banco: DatabaseSync,
  ref: RefRodada,
  ticket: TicketDemanda,
  opcoes: Opcoes & Pick<OpcoesExecucaoDemanda, "retomada" | "mensagem">,
): { id: string; fim: Promise<void> } {
  const { id, fim } = iniciarExecucaoDemanda(banco, ticket, {
    ...opcoes,
    modo: "interativo",
    fechar: () => restaurar(banco, ref),
  });
  fins.set(`${ref.demanda_id}.${String(ref.rodada_id)}`, fim);
  return { id, fim };
}

/**
 * Reprova o PR da rodada com `motivo` e abre a sessão de ajustes na hora (interativa, sem esperar o agendador). A
 * recusa do domínio (motivo vazio, ator, estado) lança antes de gravar o marco ou mudar o banco.
 */
export async function reprovarPRRodada(
  banco: DatabaseSync,
  ref: RefRodada,
  motivo: string,
  ator: Ator,
  opcoes: Opcoes,
): Promise<{ id: string; fim: Promise<void> }> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const { ticket, pr } = prDaRodada(ag, ref);
  const entrada = { demanda_id: ref.demanda_id, rodada_id: ref.rodada_id, ticket_id: ticket.ticket_id, motivo };
  reprovarPullRequestRodada(ag, entrada, ator, contexto());

  const demanda = await exigirGit(
    caminhoDaWorktreeDemanda(raizDo(banco), ag.demanda.projeto, ref.demanda_id),
    "rev-parse",
    `refs/heads/${ag.demanda.branch}`,
  );
  const marco: Marco = {
    rodada: { branch: pr.branch, sha: pr.head },
    demanda: { branch: ag.demanda.branch, sha: demanda.trim() },
  };
  mkdirSync(dirname(arquivoDoMarco(banco, ref)), { recursive: true });
  writeFileSync(arquivoDoMarco(banco, ref), JSON.stringify(marco));

  const depois = comDemanda(banco, ref.demanda_id, (a) => reprovarPullRequestRodada(a, entrada, ator, contexto()));
  const sessao = sessaoDaRodada(depois, ref);
  return executar(banco, ref, sessao, {
    ...opcoes,
    retomada: {
      tipo: "reabertura",
      motivo:
        `Esta é a sessão de ajustes da rodada ${formatarRodadaRef(ref)} (ticket ${formatarTicketRef(sessao)}): ` +
        `converse e registre tickets corretivos, sem implementar nem integrar.\n` +
        `O Auditor reprovou o PR ${pr.url} da rodada. Motivo: ${motivo}`,
    },
  });
}

/**
 * Retoma a sessão de ajustes parada com a mensagem do Auditor, enviada pelo chat da sessão. A mensagem é o prompt, como
 * em qualquer retomada interativa; o fim da execução restaura as branches.
 */
export function retomarSessaoAjustes(
  banco: DatabaseSync,
  ticket: TicketDemanda,
  mensagem: string,
  opcoes: Opcoes,
): void {
  const rodada_id = existe(
    ticket.rodada_id,
    `o ticket ${formatarTicketRef(ticket)} não é de rodada`,
    "confira o banco",
  );
  executar(banco, { demanda_id: ticket.demanda_id, rodada_id }, ticket, { ...opcoes, mensagem });
}

/** Conclui a sessão (só o Auditor, com correção registrada): encerra o pi ocioso, restaura as branches e volta ao desenvolvimento. */
export async function concluirSessaoAjustes(banco: DatabaseSync, ref: RefRodada, ator: Ator): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = sessaoDaRodada(ag, ref);
  const entrada = { demanda_id: ref.demanda_id, ticket_id: ticket.ticket_id, rodada_id: ref.rodada_id };
  // Valida antes de encerrar o pi: uma conclusão recusada não pode derrubar a conversa.
  concluirSessaoRodada(ag, entrada, ator, contexto());

  const chave = `${ref.demanda_id}.${String(ref.rodada_id)}`;
  const viva = execucaoViva(banco, ticket);
  if (viva !== undefined) encerrar(viva);
  await fins.get(chave);
  fins.delete(chave);
  await restaurar(banco, ref);
  return comDemanda(banco, ref.demanda_id, (a) => concluirSessaoRodada(a, entrada, ator, contexto()));
}
