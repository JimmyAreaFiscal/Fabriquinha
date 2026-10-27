// Sessão de ajustes do PR reprovado (comparacao-sdlc-implementacao.md §§4 e 6): reprova o PR da rodada e abre na hora a
// conversa do Auditor com o agente, que só registra tickets corretivos. A conversa não implementa nem integra: os SHAs
// da rodada e da demanda são gravados ao abrir e restaurados quando a execução termina e quando a sessão conclui.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Ator, exigirAuditor } from "../dominio/agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../dominio/demanda.ts";
import { existe } from "../dominio/erros.ts";
import { concluirSessaoRodada, reprovarPullRequestRodada } from "../dominio/transicoes_rodada.ts";
import { raizDo } from "../persistencia/banco.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { descartarAlteracoes, exigirGit } from "../repositorio/worktree.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { encerrar, mandar, situacao } from "./gerente.ts";
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

/** O ticket `sessao_em_aberto` mais recente da rodada. */
const sessaoDaRodada = (ag: AgregadoDemanda, ref: RefRodada): TicketDemanda =>
  existe(
    ag.tickets.findLast((t) => t.rodada_id === ref.rodada_id && t.etapa === "sessao_em_aberto"),
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

/** Retoma ou inicia a execução interativa do ticket da sessão; ao terminar, restaura as branches. */
function executar(
  banco: DatabaseSync,
  ref: RefRodada,
  ticket: TicketDemanda,
  opcoes: Opcoes,
  retomada: OpcoesExecucaoDemanda["retomada"],
): { id: string; fim: Promise<void> } {
  const { id, fim } = iniciarExecucaoDemanda(banco, ticket, {
    ...opcoes,
    modo: "interativo",
    retomada,
    fechar: () => restaurar(banco, ref),
  });
  fins.set(`${ref.demanda_id}.${String(ref.rodada_id)}`, fim);
  return { id, fim };
}

/**
 * Reprova o PR da rodada com `motivo` e abre a sessão de ajustes na hora (interativa, sem esperar o agendador). A
 * recusa do domínio (motivo vazio, ator, fase) lança antes de gravar o marco ou mudar o banco.
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
  return executar(banco, ref, sessao, opcoes, {
    tipo: "reabertura",
    motivo:
      `Esta é a sessão de ajustes da rodada ${formatarRodadaRef(ref)} (ticket ${formatarTicketRef(sessao)}): ` +
      `converse e registre tickets corretivos, sem implementar nem integrar.\n` +
      `O Auditor reprovou o PR ${pr.url} da rodada. Motivo: ${motivo}`,
  });
}

/** Mensagem do Auditor ao agente: vai ao pi vivo; sem pi vivo, retoma a mesma sessão com a mensagem. */
export function enviarMensagemAjustes(
  banco: DatabaseSync,
  ref: RefRodada,
  texto: string,
  ator: Ator,
  opcoes: Opcoes,
): void {
  exigirAuditor(ator, "conversar na sessão de ajustes");
  const ticket = sessaoDaRodada(carregarDemanda(banco, ref.demanda_id), ref);
  const viva = execucaoViva(banco, ticket);
  if (viva !== undefined) {
    mandar(viva, { type: "prompt", message: texto });
    return;
  }
  executar(banco, ref, ticket, opcoes, { tipo: "reabertura", motivo: texto });
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
