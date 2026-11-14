// Serviço Execução da demanda (comparacao-sdlc-implementacao.md §§4.1, 4.2, 6 e 7.3): junta sessão, execução, worktree,
// prompt e pi para um ticket da demanda. Conduz a execução; o ticket só muda pela condução da etapa (`etapas/`).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  resolverConfiguracaoAgente,
  formatarTicketRef,
  type FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaQueExigeOAuditor,
  CATALOGO_DE_ETAPAS,
  oAgenteDecideOGate,
} from "../../../etapas/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../../shared/nucleo/relogio.ts";
import {
  abrirTentativaDoTicket,
  type AgregadoDemanda,
  carregarDemanda,
  falharTicketEmExecucao,
  type TicketDemanda,
} from "../../../processo/publico.ts";
import { type EspacoDeTrabalho, espacoDoTicket, ocupanteDoDono } from "../../../../repositorio/publico.ts";
import type { Ambiente } from "../../../../ambiente/publico.ts";
import { encontrado, existe, mensagem } from "../../../../../shared/nucleo/erros.ts";
import type {
  ExecucaoAberta,
  FalhaDaExecucao,
  ModoTrabalho,
  PreparoDoLancamento,
} from "../../../../sessoes/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { caminhoArquivo } from "../../../../../shared/armazenamento/arquivos.ts";
import { anexosDaDemanda } from "../../../evidencias/publico.ts";
import { anotar } from "../../../../../shared/infra/registro.ts";
import { triarPergunta } from "../politica_dos_agentes/auditor_automatico.ts";
import { falhaDaTentativaDaExecucao } from "../politica_dos_agentes/condutor.ts";
import { execucoesDoTicket, type TicketRef } from "../politica_dos_agentes/processo_do_ticket.ts";
import { lancamentoDoTicket } from "./lancamento_do_ticket.ts";
import type { ContextoDoPrompt } from "../prompt/contexto_do_prompt.ts";
import { projetosCadastrados, type ProjetoConduzido } from "../projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

interface OpcoesComunsDaExecucao {
  limiteMin: number;
  modo?: Exclude<ModoTrabalho, "consulta">;
  /** Devolução ou reabertura do Auditor: o motivo vai ao prompt. */
  retomada?: ContextoDoPrompt["retomada"];
  /** Abre sessão nova mesmo com sessão no ticket: a conversa anterior foi descartada (plano aprovado e reaberto). */
  iniciarEmSessaoNova?: boolean;
  /** O que fazer com o ticket depois do encerramento do processo; sem ele, quem conduz a etapa o fecha. */
  fechar?: (banco: DatabaseSync, ref: TicketRef, resultado: { falha?: FalhaDaTentativa }) => Promise<void>;
  /** O Espaço que a condução já criou, com o Ambiente dele; sem ele, a execução o cria. */
  espaco?: { pasta: string; ambiente: Ambiente };
}

/** O prompt da execução: a mensagem do Auditor ou a montagem da Etapa, com o contexto que a execução junta. */
export type OpcoesExecucaoDemanda = OpcoesComunsDaExecucao &
  (
    | {
        /** Mensagem do Auditor ao retomar a sessão interativa: é o prompt da execução, sem remontar o contexto. */
        mensagem: string;
        montarPrompt?: undefined;
      }
    | { mensagem?: undefined; montarPrompt: (contexto: ContextoDoPrompt) => string }
  );

interface Conducao extends ModulosDoCiclo {
  ref: TicketRef;
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: ProjetoConduzido;
  opcoes: OpcoesExecucaoDemanda;
  relogio: Relogio;
}

/** O ticket roda na worktree do seu Espaço de Trabalho, no Ambiente que o Repositório alocou a ele. */
async function espacoPreparadoDoTicket(
  { repositorio, projeto, opcoes }: Conducao,
  espaco: EspacoDeTrabalho,
  log: string,
): Promise<{ pasta: string; ambiente: Ambiente }> {
  return opcoes.espaco ?? (await repositorio.prepararEspaco(projeto, espaco, log));
}

/** As perguntas respondidas nas sessões de cada ticket anterior da rodada que foi reprovado, por ticket (só a revisão da rodada as lê). */
function perguntasDosTicketsReprovadosDaRodada({
  sessoes,
  ag,
  ticket,
}: Conducao): ContextoDoPrompt["perguntasDasRevisoesAnteriores"] {
  const sessoesDaDemanda = sessoes.listar({ demandas: [ag.demanda.id] });
  const idsDaRodada = new Set(ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id).map((t) => t.ticket_id));
  return new Map(
    ag.decisoes
      .filter((d) => d.resultado === "reprovado" && d.ticket_id < ticket.ticket_id && idsDaRodada.has(d.ticket_id))
      .map((d) => [
        d.ticket_id,
        sessoesDaDemanda
          .filter((s) => s.ticket_id === d.ticket_id)
          .flatMap((s) => sessoes.conversa(s.id).perguntasRespondidas),
      ]),
  );
}

/** O SHA do commit de cada ticket da demanda que tem um (as revisões leem o que a Fabriquinha já verificou nele). */
function commitsDosTickets({ repositorio, ag }: Conducao): ContextoDoPrompt["commitsDosTickets"] {
  const { commits } = repositorio.metricas({ demandas: [ag.demanda.id], periodo: {} });
  return new Map(commits.map((commit) => [commit.ticket_id, commit.sha] as const));
}

/** O Espaço, o prompt e o lançamento do agente do ticket, na execução que Sessões abriu. */
async function prepararOAgente(
  c: Conducao,
  { sessao, execucao, dir, log }: ExecucaoAberta,
): Promise<PreparoDoLancamento> {
  const raiz = raizDo(c.banco);
  const { projeto, opcoes } = c;
  // `gh` e `az` olham diretórios vazios: o agente não acha credencial de hospedagem.
  for (const sub of ["saida", "vazio"]) mkdirSync(join(dir, sub), { recursive: true });
  anotar(log, `E-${execucao.id} iniciada: ${c.ref.demanda_id}.T${String(c.ref.ticket_id)}, sessão ${sessao.id}`);
  const espaco = espacoDoTicket(c.ag, c.ticket, projeto, raiz);
  // O agente enxerga o Espaço pelo Ambiente (o container, depois de alocado): no host local os caminhos são os do host.
  const { pasta: worktree, ambiente } = await espacoPreparadoDoTicket(c, espaco, log);
  // O container só enxerga a pasta do processo e a da sessão que o core pôs nas pastas montadas dele.
  ambiente.abrigarProcesso(dir, sessao.id);
  const caminhoNoAmbiente = (caminhoNoHost: string): string => ambiente.caminhoNoAmbiente(caminhoNoHost);
  const prompt =
    opcoes.mensagem ??
    opcoes.montarPrompt({
      ag: c.ag,
      ticket: c.ticket,
      projeto: { nome: projeto.nome, branch_base: projeto.branch_base },
      worktree: caminhoNoAmbiente(worktree),
      saida: caminhoNoAmbiente(join(dir, "saida")),
      retomada: opcoes.retomada,
      // A revisão da rodada confere as perguntas que as revisões reprovadas antes dela fizeram.
      ...(oAgenteDecideOGate(c.ticket.etapa) &&
        CATALOGO_DE_ETAPAS[c.ticket.etapa].escopo === "rodada" && {
          perguntasDasRevisoesAnteriores: perguntasDosTicketsReprovadosDaRodada(c),
        }),
      commitsDosTickets: commitsDosTickets(c), // só as revisões leem
      anexos: anexosDaDemanda(c.banco, c.ref.demanda_id).map((a) => ({
        ...a,
        caminho: caminhoNoAmbiente(caminhoArquivo(c.banco, a.sha256)),
      })),
    });
  return {
    lancamento: lancamentoDoTicket({
      raiz,
      sessao: sessao.id,
      dir,
      repositorio: projeto.raiz_git,
      modo: sessao.modo,
      ticket: c.ticket,
      etapasDoProjeto: projeto.etapas,
    }),
    cwd: worktree,
    ambiente,
    prompt,
    triarPergunta: (pergunta) =>
      triarPergunta(
        c.sessoes,
        execucao.configuracao_agente?.modelo,
        { ticket: formatarTicketRef(c.ref), etapa: c.ticket.etapa, demanda: c.ag.demanda.titulo },
        pergunta,
        execucao.id,
      ),
  };
}

/** A preparação que falha anota o motivo no log da execução, e o erro segue para Sessões encerrá-la. */
async function prepararOAgenteAnotandoAFalha(c: Conducao, aberta: ExecucaoAberta): Promise<PreparoDoLancamento> {
  try {
    return await prepararOAgente(c, aberta);
  } catch (erro) {
    anotar(aberta.log, `preparação falhou: ${falhaDoErro(erro).motivo}`);
    throw erro;
  }
}

/** Depois do fim gravado: o que fazer com o ticket; a falha do fechamento falha o ticket, sem derrubar a condução. */
async function fecharOTicket(c: Conducao, log: string, falha: FalhaDaTentativa | undefined): Promise<void> {
  try {
    await c.opcoes.fechar?.(c.banco, c.ref, { falha });
  } catch (error_) {
    anotar(log, `fechamento falhou: ${mensagem(error_)}`);
    try {
      falharTicketEmExecucao(
        c.banco,
        c.ref,
        falhaQueExigeOAuditor(`fechamento falhou: ${mensagem(error_)}`),
        c.relogio,
      );
    } catch (erroFalha) {
      anotar(log, `falhar o ticket também falhou: ${mensagem(erroFalha)}`);
    }
  }
}

const daTentativa = (falha: FalhaDaExecucao | undefined): FalhaDaTentativa | undefined =>
  falha && falhaDaTentativaDaExecucao(falha);

/**
 * Inicia o ticket da demanda (sessão nova) ou o retoma (a sessão mais recente e a conversa dela, §7.3). Síncrona até
 * gravar a execução aberta: a recusa lança já. O pi roda em segundo plano; `fim` resolve com a execução encerrada e o
 * uso gravado.
 */
export function iniciarExecucaoDemanda(
  modulos: ModulosDoCiclo,
  ref: TicketRef,
  opcoes: OpcoesExecucaoDemanda,
  relogio: Relogio = relogioDoSistema,
): { id: string; fim: Promise<FalhaDaTentativa | undefined> } {
  const { banco } = modulos;
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não existe`,
    "confira o endereço do ticket",
  );
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
  const configuracaoAgente = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: projeto.etapas.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  const c: Conducao = { ...modulos, ref, ag, ticket, projeto, opcoes, relogio };
  const { execucao, fim } = modulos.sessoes.lancar({
    contexto: { demanda_id: ref.demanda_id, ticket_id: ref.ticket_id },
    modo: opcoes.modo ?? "autonomo",
    ...(opcoes.iniciarEmSessaoNova && { sessaoNova: true }),
    configuracao_agente: configuracaoAgente,
    limiteMin: opcoes.limiteMin,
    relogio,
    aoAbrir: (aberta) => {
      abrirTentativaDoTicket(banco, ref, aberta.execucao);
    },
    preparar: (aberta) => prepararOAgenteAnotandoAFalha(c, aberta),
    aoEncerrar: (aberta, falha) => fecharOTicket(c, aberta.log, daTentativa(falha)),
  });
  return { id: execucao.id, fim: fim.then(daTentativa) };
}

/**
 * Interrompe a execução aberta do ticket. Com condução viva, o SIGTERM no grupo faz Sessões gravar a falha; órfã (sem
 * condução, ex.: serviço reiniciado), SIGKILL pelo Ambiente do Espaço e encerra direto. Sem execução aberta, recusa antes
 * de escrever.
 */
export function interromperExecucaoDemanda(
  { banco, ambientes, sessoes }: Pick<ModulosDoCiclo, "banco" | "ambientes" | "sessoes">,
  ref: TicketRef,
  relogio: Relogio = relogioDoSistema,
): void {
  const execucao = existe(
    execucoesDoTicket(sessoes, ref).find((e) => e.fim == null),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não tem execução em andamento`,
    "só se interrompe uma execução aberta",
  );
  sessoes.interromper(execucao.id, {
    ambiente: () => {
      const ag = carregarDemanda(banco, ref.demanda_id);
      const ticket = encontrado(
        ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
        `o ticket ${formatarTicketRef(ref)} não existe`,
        "use um ticket da demanda",
      );
      const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
      return ambientes.ambienteDo(ocupanteDoDono(espacoDoTicket(ag, ticket, projeto, raizDo(banco)).dono));
    },
    aoEncerrar: () => {
      falharTicketEmExecucao(banco, ref, falhaInterrompidaPeloAuditor, relogio);
    },
    relogio,
  });
}

/** Interrompe, uma vez por ticket, as execuções abertas das demandas `canceladas`; roda depois do commit. */
export function interromperExecucoesDasDemandas(
  modulos: Pick<ModulosDoCiclo, "banco" | "ambientes" | "sessoes">,
  canceladas: readonly string[],
): void {
  const abertas = modulos.sessoes.listar({ demandas: canceladas, abertas: true });
  const tickets = new Map(
    abertas.map(({ demanda_id, ticket_id }) => [`${demanda_id}.${String(ticket_id)}`, { demanda_id, ticket_id }]),
  );
  for (const ref of tickets.values()) interromperExecucaoDemanda(modulos, ref);
}
