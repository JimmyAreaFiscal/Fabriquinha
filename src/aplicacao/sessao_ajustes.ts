// Sessão de ajustes do PR reprovado (comparacao-sdlc-implementacao.md §§4 e 6): depois de reprovar o PR da rodada, abre
// na hora a conversa do Auditor com o agente, que só registra tickets corretivos. A conversa acontece no chat da sessão.
// Ela não implementa nem integra: os SHAs da rodada e da demanda são gravados ao abrir e restaurados quando a execução
// termina e quando a sessão conclui.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ator } from "../nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { existe } from "../nucleo/erros.ts";
import { Endereco, ticketAtualDaEtapa } from "../nucleo/item_de_trabalho.ts";
import { montarRetornoAoAgente, tentativaAnteriorEmMemoria } from "../nucleo/tentativa.ts";
import { concluirSessaoRodada } from "../nucleo/transicoes_rodada.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { anotar, logDaOperacao } from "../infra/registro.ts";
import { carregarTrabalhosDoTicket } from "../armazenamento/trabalho_agentico.ts";
import { caminhoDaWorktreeDemanda, caminhoDaWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { descartarAlteracoes, exigirGit } from "../infra/repositorio/worktree.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "./execucao_demanda.ts";
import { condutor } from "./trabalho/condutor.ts";
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

const arquivoDoMarco = (banco: DatabaseSync, ref: RefRodada): string =>
  join(raizDo(banco), "execucoes", `ajustes-${formatarRodadaRef(ref)}.json`);

/** O `encerrar_rodada` atual (o de maior id) da rodada e o `pr_aberto` dele. */
function prDaRodada(ag: AgregadoDemanda, ref: RefRodada) {
  const ticket = existe(
    ticketAtualDaEtapa(ag, "encerrar_rodada", ref.rodada_id),
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
    ticketAtualDaEtapa(ag, "ajustar_resultado", ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem sessão de ajustes`,
    "só a rodada reprovada tem sessão de ajustes",
  );

/** Volta as duas branches aos SHAs do marco e descarta o que a conversa deixou nas worktrees, sem verificar nem commitar. */
async function restaurar(banco: DatabaseSync, ref: RefRodada): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const raiz = raizDo(banco);
  const marco = JSON.parse(readFileSync(arquivoDoMarco(banco, ref), "utf8")) as Marco;
  const log = logDaOperacao(raiz, `ajustes-${formatarRodadaRef(ref)}`);
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

/** A execução com pi vivo neste serviço na sessão do ticket, se há, e a mais recente, que a conclusão espera terminar. */
function execucoesDaSessao(
  banco: DatabaseSync,
  ticket: TicketDemanda,
): { viva: string | number | undefined; maisRecente: string | undefined } {
  const { sessoes, execucoes } = carregarTrabalhosDoTicket(banco, ticket);
  const sessao = existe(
    sessoes[0],
    `o ticket ${formatarTicketRef(ticket)} não tem sessão`,
    "a sessão nasce ao abrir os ajustes",
  );
  return { viva: condutor.situacao(sessao.id)?.execucao, maisRecente: execucoes.at(-1)?.id };
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
): ReturnType<typeof iniciarExecucaoDemanda> {
  return iniciarExecucaoDemanda(banco, ticket, {
    ...opcoes,
    modo: "interativo",
    fechar: () => restaurar(banco, ref),
  });
}

/**
 * Grava o marco (os SHAs da rodada e da demanda) antes de reprovar o PR: é a ele que a sessão volta ao terminar. Fica
 * em disco, fora da transação, então vem antes da Decisão.
 */
export async function guardarMarcoDaSessao(banco: DatabaseSync, ref: RefRodada, ag: AgregadoDemanda): Promise<void> {
  const { pr } = prDaRodada(ag, ref);
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
}

/** Abre a sessão de ajustes da rodada com o PR já reprovado (interativa, sem esperar o agendador), levando o `motivo` ao agente. */
export function abrirSessaoDeAjustes(
  banco: DatabaseSync,
  ref: RefRodada,
  reprovada: AgregadoDemanda,
  motivo: string,
  opcoes: Opcoes,
): ReturnType<typeof iniciarExecucaoDemanda> {
  const { pr } = prDaRodada(reprovada, ref);
  const sessao = sessaoDaRodada(reprovada, ref);
  return executar(banco, ref, sessao, {
    ...opcoes,
    retomada: montarRetornoAoAgente(
      tentativaAnteriorEmMemoria(Endereco.doTicket(ref.demanda_id, sessao.ticket_id), {
        instrucao:
          `Esta é a sessão de ajustes da rodada ${formatarRodadaRef(ref)} (ticket ${formatarTicketRef(sessao)}): ` +
          `converse e registre tickets corretivos, sem implementar nem integrar.\n` +
          `O Auditor reprovou o PR ${pr.url} da rodada. Motivo: ${motivo}`,
      }),
    ),
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
  // Ensaio: uma conclusão rejeitada não pode derrubar a conversa; o agregado volta como veio, então nada é gravado.
  comDemanda(banco, ref.demanda_id, (a) => {
    concluirSessaoRodada(a, entrada, ator, contexto());
    return a;
  });

  const { viva, maisRecente } = execucoesDaSessao(banco, ticket);
  if (viva !== undefined) condutor.encerrar(viva);
  if (maisRecente !== undefined) await condutor.aguardarFim(maisRecente);
  await restaurar(banco, ref);
  return comDemanda(banco, ref.demanda_id, (a) => concluirSessaoRodada(a, entrada, ator, contexto()));
}
