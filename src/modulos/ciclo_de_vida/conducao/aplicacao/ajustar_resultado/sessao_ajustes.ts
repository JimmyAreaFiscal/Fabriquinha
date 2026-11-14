// Sessão de ajustes do PR reprovado (comparacao-sdlc-implementacao.md §§4 e 6): depois de reprovar o PR da rodada, a
// `ConducaoDeAjustarResultado` abre na hora a conversa do Auditor com o agente, que só registra tickets corretivos. A
// conversa acontece no chat da sessão. Ela não implementa nem integra: os SHAs da rodada e da demanda são gravados ao
// abrir e restaurados quando a execução termina e quando a sessão conclui.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Ator, formatarRodadaRef, formatarTicketRef } from "../../../etapas/publico.ts";
import {
  type AgregadoDemanda,
  carregarDemanda,
  concluirSessaoDeAjustes,
  ensaiarConclusaoDaSessaoDeAjustes,
  type TicketDemanda,
} from "../../../processo/publico.ts";
import { existe } from "../../../../../shared/nucleo/erros.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../../../repositorio/publico.ts";
import { ticketAtualDaEtapa } from "../../../planejamento/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { anotar, logDaOperacao } from "../../../../../shared/infra/registro.ts";
import { type OpcoesExecucaoDemanda, iniciarExecucaoDemanda } from "../execucao/execucao_demanda.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import { execucoesDoTicket } from "../politica_dos_agentes/processo_do_ticket.ts";
import type { RefRodada } from "../encerrar_rodada/encerramento_rodada.ts";
import { projetosCadastrados } from "../projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

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
    projetosCadastrados().projetoExistente(banco, ag.demanda.projeto),
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
export async function restaurar(
  { banco, repositorio }: Pick<ModulosDoCiclo, "banco" | "repositorio">,
  ref: RefRodada,
): Promise<void> {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const raiz = raizDo(banco);
  const projeto = projetosCadastrados().projetoExistente(banco, ag.demanda.projeto);
  const marco = JSON.parse(readFileSync(arquivoDoMarco(banco, ref), "utf8")) as Marco;
  const log = logDaOperacao(raiz, `ajustes-${formatarRodadaRef(ref)}`);
  const pontas: [Ponta, EspacoDeTrabalho][] = [
    [marco.rodada, espacoDoTicket(ag, { rodada_id: ref.rodada_id }, projeto, raiz)],
    [marco.demanda, espacoDoTicket(ag, {}, projeto, raiz)],
  ];
  // A branch do marco é a do Espaço: o marco a guarda para o leitor do arquivo.
  for (const [{ sha }, espaco] of pontas) await repositorio.voltarEspaco(espaco, sha, log);
  anotar(log, `${formatarRodadaRef(ref)}: branches restauradas aos SHAs do início da sessão`);
}

/**
 * Grava o marco (os SHAs da rodada e da demanda) antes de reprovar o PR: é a ele que a sessão volta ao terminar. Fica
 * em disco, fora da transação, então vem antes da Decisão.
 */
export async function guardarMarcoDaSessao(
  { banco, repositorio }: Pick<ModulosDoCiclo, "banco" | "repositorio">,
  ref: RefRodada,
  ag: AgregadoDemanda,
): Promise<void> {
  const { branch, pr } = espacoComPrPublicado(banco, ag, ref);
  const espacoDaDemanda = espacoDoTicket(
    ag,
    {},
    projetosCadastrados().projetoExistente(banco, ag.demanda.projeto),
    raizDo(banco),
  );
  const demanda = await repositorio.gitNoEspaco(espacoDaDemanda, "rev-parse", `refs/heads/${ag.demanda.branch}`);
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
  modulos: ModulosDoCiclo,
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
  iniciarExecucaoDemanda(modulos, ticket, {
    ...opcoes,
    modo: "interativo",
    mensagem,
    fechar: () => restaurar(modulos, ref),
  });
}

/** Conclui a sessão (só o Auditor, com correção registrada): encerra o pi ocioso, restaura as branches e volta ao desenvolvimento. */
export async function concluirSessaoAjustes(
  modulos: Pick<ModulosDoCiclo, "banco" | "repositorio" | "sessoes">,
  ref: RefRodada,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): Promise<AgregadoDemanda> {
  const { banco } = modulos;
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = sessaoDaRodada(ag, ref);
  const entrada = { demanda_id: ref.demanda_id, ticket_id: ticket.ticket_id, rodada_id: ref.rodada_id };
  // Ensaio: uma conclusão rejeitada não pode derrubar a conversa; nada é gravado.
  ensaiarConclusaoDaSessaoDeAjustes(banco, ref.demanda_id, entrada, ator, relogio);

  // O pi ocioso da sessão para, e a condução dele termina antes da restauração.
  const maisRecente = execucoesDoTicket(modulos.sessoes, ticket).at(-1)?.id;
  if (maisRecente !== undefined) await modulos.sessoes.encerrar(maisRecente);
  await restaurar(modulos, ref);
  return concluirSessaoDeAjustes(banco, ref.demanda_id, entrada, ator, relogio);
}
