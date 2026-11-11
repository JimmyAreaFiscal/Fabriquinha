// Sessão de ajustes do PR reprovado (comparacao-sdlc-implementacao.md §§4 e 6): depois de reprovar o PR da rodada, a
// `ConducaoDeAjustarResultado` abre na hora a conversa do Auditor com o agente, que só registra tickets corretivos. A
// conversa acontece no chat da sessão. Ela não implementa nem integra: os SHAs da rodada e da demanda são gravados ao
// abrir e restaurados quando a execução termina e quando a sessão conclui.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { Ator } from "../../fluxo/nucleo/ator.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../demanda/nucleo/demanda.ts";
import { existe } from "../../compartilhado/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../repositorio/nucleo/espaco_de_trabalho.ts";
import { ticketAtualDaEtapa } from "../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { concluirSessaoRodada } from "../../fluxo/nucleo/transicoes/transicoes_rodada.ts";
import { raizDo } from "../../compartilhado/armazenamento/banco.ts";
import { carregarDemanda, comDemanda } from "../../demanda/armazenamento/demandas.ts";
import { projetoExistente } from "../../projeto/armazenamento/projetos.ts";
import { anotar, logDaOperacao } from "../../compartilhado/infra/registro.ts";
import { carregarTrabalhosDoTicket } from "../../execucao/armazenamento/trabalho_agentico.ts";
import { descartarAlteracoes, exigirGitNoAmbiente } from "../../repositorio/infra/worktree/worktree.ts";
import { ambienteDoEspaco } from "../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "../../execucao/aplicacao/execucao_demanda.ts";
import { encerrarPiVivo } from "../conducao/pi_vivo.ts";
import { type Relogio, relogioDoSistema } from "../../compartilhado/nucleo/relogio.ts";
import { condutor } from "../../execucao/aplicacao/trabalho/condutor.ts";
import type { RefRodada } from "../encerrar_rodada/encerramento_rodada.ts";

interface Ponta {
  branch: string;
  sha: string;
}
interface Marco {
  rodada: Ponta;
  demanda: Ponta;
}

const arquivoDoMarco = (banco: DatabaseSync, ref: RefRodada): string =>
  join(raizDo(banco), "execucoes", `ajustes-${formatarRodadaRef(ref)}.json`);

/** O Espaço da rodada, com o PR que o encerramento publicou. */
export function espacoComPrPublicado(banco: DatabaseSync, ag: AgregadoDemanda, ref: RefRodada) {
  const espaco = espacoDoTicket(
    ag,
    { rodada_id: ref.rodada_id },
    projetoExistente(banco, ag.demanda.projeto),
    raizDo(banco),
  );
  const pr = existe(
    espaco.pr,
    `a rodada ${formatarRodadaRef(ref)} não tem PR publicado`,
    "o encerramento publica o PR",
  );
  return { branch: espaco.branch, pr };
}

/** O ticket `ajustar_resultado` mais recente da rodada. */
export const sessaoDaRodada = (ag: AgregadoDemanda, ref: RefRodada): TicketDemanda =>
  existe(
    ticketAtualDaEtapa(ag, "ajustar_resultado", ref.rodada_id),
    `a rodada ${formatarRodadaRef(ref)} não tem sessão de ajustes`,
    "só a rodada reprovada tem sessão de ajustes",
  );

/** Volta as duas branches aos SHAs do marco e descarta o que a conversa deixou nas worktrees, sem verificar nem commitar. */
export async function restaurar(banco: DatabaseSync, ref: RefRodada): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const raiz = raizDo(banco);
  const projeto = projetoExistente(banco, ag.demanda.projeto);
  const marco = JSON.parse(readFileSync(arquivoDoMarco(banco, ref), "utf8")) as Marco;
  const log = logDaOperacao(raiz, `ajustes-${formatarRodadaRef(ref)}`);
  const pontas: [Ponta, EspacoDeTrabalho][] = [
    [marco.rodada, espacoDoTicket(ag, { rodada_id: ref.rodada_id }, projeto, raiz)],
    [marco.demanda, espacoDoTicket(ag, {}, projeto, raiz)],
  ];
  for (const [{ branch, sha }, espaco] of pontas) {
    const ambiente = ambienteDoEspaco(espaco);
    await exigirGitNoAmbiente(ambiente, espaco.pasta, "update-ref", `refs/heads/${branch}`, sha);
    await descartarAlteracoes(ambiente, espaco.pasta, log);
  }
  anotar(log, `${formatarRodadaRef(ref)}: branches restauradas aos SHAs do início da sessão`);
}

/**
 * Grava o marco (os SHAs da rodada e da demanda) antes de reprovar o PR: é a ele que a sessão volta ao terminar. Fica
 * em disco, fora da transação, então vem antes da Decisão.
 */
export async function guardarMarcoDaSessao(banco: DatabaseSync, ref: RefRodada, ag: AgregadoDemanda): Promise<void> {
  const { branch, pr } = espacoComPrPublicado(banco, ag, ref);
  const espacoDaDemanda = espacoDoTicket(ag, {}, projetoExistente(banco, ag.demanda.projeto), raizDo(banco));
  const demanda = await exigirGitNoAmbiente(
    ambienteDoEspaco(espacoDaDemanda),
    espacoDaDemanda.pasta,
    "rev-parse",
    `refs/heads/${ag.demanda.branch}`,
  );
  const marco: Marco = {
    rodada: { branch, sha: pr.head },
    demanda: { branch: ag.demanda.branch, sha: demanda.trim() },
  };
  mkdirSync(dirname(arquivoDoMarco(banco, ref)), { recursive: true });
  writeFileSync(arquivoDoMarco(banco, ref), JSON.stringify(marco));
}

/**
 * Retoma a sessão de ajustes parada com a mensagem do Auditor, enviada pelo chat da sessão. A mensagem é o prompt, como
 * em qualquer retomada interativa; o fim da execução restaura as branches, como o da execução que a abriu.
 */
export function retomarSessaoAjustes(
  banco: DatabaseSync,
  ticket: TicketDemanda,
  mensagem: string,
  opcoes: Pick<OpcoesExecucaoDemanda, "limiteMin">,
): void {
  const rodada_id = existe(
    ticket.rodada_id,
    `o ticket ${formatarTicketRef(ticket)} não é de rodada`,
    "confira o banco",
  );
  const ref = { demanda_id: ticket.demanda_id, rodada_id };
  iniciarExecucaoDemanda(banco, ticket, {
    ...opcoes,
    modo: "interativo",
    mensagem,
    fechar: () => restaurar(banco, ref),
  });
}

/** Conclui a sessão (só o Auditor, com correção registrada): encerra o pi ocioso, restaura as branches e volta ao desenvolvimento. */
export async function concluirSessaoAjustes(
  banco: DatabaseSync,
  ref: RefRodada,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): Promise<AgregadoDemanda> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = sessaoDaRodada(ag, ref);
  const entrada = { demanda_id: ref.demanda_id, ticket_id: ticket.ticket_id, rodada_id: ref.rodada_id };
  const concluir = (a: AgregadoDemanda) => concluirSessaoRodada(a, entrada, ator, { agora: relogio.agora() });
  // Ensaio: uma conclusão rejeitada não pode derrubar a conversa; o agregado volta como veio, então nada é gravado.
  comDemanda(banco, ref.demanda_id, (a) => {
    concluir(a);
    return a;
  });

  const maisRecente = carregarTrabalhosDoTicket(banco, ticket).execucoes.at(-1)?.id;
  encerrarPiVivo(banco, ticket);
  if (maisRecente !== undefined) await condutor.aguardarFim(maisRecente);
  await restaurar(banco, ref);
  return comDemanda(banco, ref.demanda_id, concluir);
}
