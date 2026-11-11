// Serviço Execução da demanda (comparacao-sdlc-implementacao.md §§4.1, 4.2, 6 e 7.3): junta sessão, execução, worktree,
// prompt e pi para um ticket da demanda. Conduz a execução; o ticket só muda pela condução da etapa (`etapas/`).
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { type Relogio, relogioDoSistema } from "../../../compartilhado/nucleo/relogio.ts";
import type { AgregadoDemanda, TicketDemanda } from "../../nucleo/demanda/agregado_demanda.ts";
import { resolverConfiguracaoAgente } from "../../../compartilhado/nucleo/configuracao_agente.ts";
import { type EspacoDeTrabalho, espacoDoTicket } from "../../../repositorio/nucleo/espaco_de_trabalho.ts";
import type { Projeto } from "../../../projeto/nucleo/projeto.ts";
import { formatarTicketRef } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { encontrado, existe, mensagem } from "../../../compartilhado/nucleo/erros.ts";
import { iniciarTentativaDoTicket } from "../../nucleo/despacho/reserva_ticket.ts";
import {
  type FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
} from "../../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import {
  criarTrabalho,
  iniciarProcesso,
  retomarTrabalho,
  type ProcessoDoTrabalho,
  type TrabalhoGerenciado,
} from "../../../trabalho_agentico/nucleo/trabalho_agentico.ts";
import { varrerCommitsHumanos } from "../../../projeto/aplicacao/varredura_de_commits_humanos.ts";
import { raizDo } from "../../../compartilhado/armazenamento/banco.ts";
import { carregarProjeto } from "../../../projeto/armazenamento/projetos.ts";
import { caminhoArquivo } from "../../../compartilhado/armazenamento/arquivos.ts";
import { carregarDemanda, comDemanda } from "../../armazenamento/demandas.ts";
import { commitDoTicketDemanda } from "../../../repositorio/armazenamento/commits_demanda.ts";
import { anexosDaDemanda } from "../../armazenamento/evidencia_demanda.ts";
import { anotar, noLog, pastasDoProcesso } from "../../../compartilhado/infra/registro.ts";
import {
  carregarTrabalhosDaDemanda,
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
  gravarAmbienteDoProcesso,
} from "../../../trabalho_agentico/armazenamento/trabalho_agentico.ts";
import { ambienteDoEspaco } from "../../../repositorio/aplicacao/espaco/ambiente_do_espaco.ts";
import { cicloDoEspaco } from "../../../repositorio/aplicacao/espaco/ciclo_do_espaco.ts";
import { falharTicketDemanda } from "../despacho/fechamento_ticket.ts";
import { triarPergunta } from "../../../trabalho_agentico/aplicacao/trabalho/auditor_automatico.ts";
import { condutor } from "../../../trabalho_agentico/aplicacao/trabalho/condutor.ts";
import {
  encerrarProcessoDoTicket,
  encerrarProcessoOrfao,
  type TicketRef,
} from "../../../trabalho_agentico/aplicacao/trabalho/processo_do_ticket.ts";
import { lancamentoDoTicket } from "./lancamento_do_ticket.ts";
import type { ContextoDoPrompt } from "../../nucleo/contexto_do_prompt.ts";
import { perguntasRespondidasNaSessao } from "../../../trabalho_agentico/aplicacao/sessoes/conversa.ts";
import type { ModoTrabalho } from "../../../compartilhado/nucleo/primitivos.ts";
import { CATALOGO_DE_ETAPAS, oAgenteDecideOGate } from "../../../etapas/catalogo.ts";

interface OpcoesComunsDaExecucao {
  limiteMin: number;
  modo?: Exclude<ModoTrabalho, "consulta">;
  /** Devolução ou reabertura do Auditor: o motivo vai ao prompt. */
  retomada?: ContextoDoPrompt["retomada"];
  /** Abre sessão nova mesmo com sessão no ticket: a conversa anterior foi descartada (plano aprovado e reaberto). */
  iniciarEmSessaoNova?: boolean;
  /** O que fazer com o ticket depois do encerramento do processo; sem ele, quem conduz a etapa o fecha. */
  fechar?: (banco: DatabaseSync, ref: TicketRef, resultado: { falha?: FalhaDaTentativa }) => Promise<void>;
  /** O Espaço que a condução já criou (e se buscou a base); sem ele, a execução o cria. */
  espaco?: { pasta: string; buscouBase: boolean };
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

interface Conducao {
  banco: DatabaseSync;
  ref: TicketRef;
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  projeto: Projeto;
  sessao: TrabalhoGerenciado;
  execucao: ProcessoDoTrabalho;
  opcoes: OpcoesExecucaoDemanda;
  relogio: Relogio;
}

/** O ticket roda na worktree do seu Espaço de Trabalho. */
async function worktreeDoEspacoDoTicket(
  { banco, projeto, opcoes }: Conducao,
  espaco: EspacoDeTrabalho,
  log: string,
): Promise<string> {
  const raiz = raizDo(banco);
  const ciclo = cicloDoEspaco(espaco, projeto, { raiz, log }, ambienteDoEspaco(espaco));
  const { pasta, buscouBase } = opcoes.espaco ?? (await ciclo.criar());
  if (buscouBase) await varrerCommitsHumanos(banco, projeto.nome).catch(ciclo.anotarFalhaDaVarredura);
  return pasta;
}

/** Grava o grupo de processo do pi e o Ambiente que o lançou, para o reinício do serviço poder interrompê-lo (§4.2). */
function gravarGrupo({ banco, ref, execucao }: Conducao, pgid: number, ambienteId: string): void {
  comTrabalhosDoTicket(banco, ref, (estado) => ({
    ...estado,
    execucoes: estado.execucoes.map((e) => (e.id === execucao.id ? { ...e, grupo_processo: pgid } : e)),
  }));
  gravarAmbienteDoProcesso(banco, execucao.id, ambienteId);
}

/** As perguntas respondidas nas sessões de cada ticket anterior da rodada que foi reprovado, por ticket (só a revisão da rodada as lê). */
function perguntasDosTicketsReprovadosDaRodada({
  banco,
  ag,
  ticket,
}: Conducao): ContextoDoPrompt["perguntasDasRevisoesAnteriores"] {
  const raiz = raizDo(banco);
  const { sessoes } = carregarTrabalhosDaDemanda(banco, ag.demanda.id);
  const idsDaRodada = new Set(ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id).map((t) => t.ticket_id));
  return new Map(
    ag.decisoes
      .filter((d) => d.resultado === "reprovado" && d.ticket_id < ticket.ticket_id && idsDaRodada.has(d.ticket_id))
      .map((d) => [
        d.ticket_id,
        sessoes.filter((s) => s.ticket_id === d.ticket_id).flatMap((s) => perguntasRespondidasNaSessao(raiz, s.id)),
      ]),
  );
}

/** O SHA do commit de cada ticket da demanda que tem um (as revisões leem o que a Fabriquinha já verificou nele). */
function commitsDosTickets({ banco, ag }: Conducao): ContextoDoPrompt["commitsDosTickets"] {
  return new Map(
    ag.tickets.flatMap((t) => {
      const commit = commitDoTicketDemanda(banco, ag.demanda.id, t.ticket_id);
      return commit ? [[t.ticket_id, commit.sha] as const] : [];
    }),
  );
}

async function conduzir(c: Conducao): Promise<FalhaDaTentativa | undefined> {
  const raiz = raizDo(c.banco);
  const { execucao, sessao, projeto, opcoes } = c;
  const { dir, log } = pastasDoProcesso(raiz, execucao.id);
  let falha: FalhaDaTentativa | undefined;
  try {
    // `gh` e `az` olham diretórios vazios: o agente não acha credencial de hospedagem.
    for (const sub of ["saida", "vazio"]) mkdirSync(join(dir, sub), { recursive: true });
    anotar(log, `E-${execucao.id} iniciada: ${c.ref.demanda_id}.T${String(c.ref.ticket_id)}, sessão ${sessao.id}`);
    const espaco = espacoDoTicket(c.ag, c.ticket, projeto, raiz);
    const worktree = await worktreeDoEspacoDoTicket(c, espaco, log);
    // O agente enxerga o Espaço pelo Ambiente (o container, depois de alocado): no host local os caminhos são os do host.
    const ambiente = ambienteDoEspaco(espaco);
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
    writeFileSync(join(dir, "prompt.md"), prompt);
    // Parada em curso durante a preparação: não lança um pi novo; a falha vira reinício do serviço abaixo.
    if (condutor.emParada()) throw new Error("o serviço está parando");
    falha = await condutor.iniciar({
      execucao: { id: execucao.id, sessao: sessao.id, modo: sessao.modo },
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
      banco: c.banco,
      log,
      prompt,
      limiteMin: opcoes.limiteMin,
      triarPergunta: (pergunta) =>
        triarPergunta(
          execucao.configuracao_agente?.modelo,
          { ticket: formatarTicketRef(c.ref), etapa: c.ticket.etapa, demanda: c.ag.demanda.titulo },
          pergunta,
          { banco: c.banco, ticket: c.ref, execucao: execucao.id },
        ),
      aoLancar: (pgid, ambienteId) => {
        gravarGrupo(c, pgid, ambienteId);
      },
    });
  } catch (error_) {
    falha = falhaDoErro(error_);
    anotar(log, `preparação falhou: ${falha.motivo}`);
  }
  // Interrompida pelo Auditor: o pi saiu pelo SIGTERM, mas a causa verdadeira é a interrupção.
  if (condutor.foiInterrompido(execucao.id)) falha = falhaInterrompidaPeloAuditor;
  else if (condutor.emParada()) falha = falhaPorServicoReiniciado;
  condutor.deixarDeAcompanhar(execucao.id);
  encerrarProcessoDoTicket(c, falha !== undefined, log, condutor.harness, c.relogio);
  try {
    await opcoes.fechar?.(c.banco, c.ref, { falha });
  } catch (error_) {
    anotar(log, `fechamento falhou: ${mensagem(error_)}`);
    try {
      falharTicketDemanda(c.banco, c.ref, falhaQueExigeOAuditor(`fechamento falhou: ${mensagem(error_)}`), c.relogio);
    } catch (erroFalha) {
      anotar(log, `falhar o ticket também falhou: ${mensagem(erroFalha)}`);
    }
  }
  // O último `estado` do SSE sai com o pi, antes do fim gravado e do fechamento: o chat precisa do cabeçalho novo.
  condutor.avisar(sessao.id, log);
  return falha;
}

/**
 * Inicia o ticket da demanda (sessão nova) ou o retoma (a sessão mais recente e a conversa dela, §7.3). Síncrona até
 * gravar a execução aberta: a recusa lança já. O pi roda em segundo plano; `fim` resolve com a execução encerrada e o
 * uso gravado.
 */
export function iniciarExecucaoDemanda(
  banco: DatabaseSync,
  ref: TicketRef,
  opcoes: OpcoesExecucaoDemanda,
  relogio: Relogio = relogioDoSistema,
): { id: string; fim: Promise<FalhaDaTentativa | undefined> } {
  const ag = carregarDemanda(banco, ref.demanda_id);
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não existe`,
    "confira o endereço do ticket",
  );
  const projeto = carregarProjeto(banco, ag.demanda.projeto);
  const configuracaoAgente = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: projeto.etapas.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  const abrir = (trabalho_id: string): ProcessoDoTrabalho => ({
    id: randomUUID(),
    trabalho_id,
    inicio: relogio.agora(),
    falha: false,
    configuracao_agente: configuracaoAgente,
  });
  let sessao!: TrabalhoGerenciado;
  let execucao!: ProcessoDoTrabalho;
  comTrabalhosDoTicket(banco, ref, (estado) => {
    // Com mais de uma sessão no ticket, retoma-se a mais recente.
    const existente = opcoes.iniciarEmSessaoNova ? undefined : estado.sessoes.at(-1);
    if (existente) {
      sessao = existente;
      execucao = abrir(sessao.id);
      return { ...estado, execucoes: retomarTrabalho(estado.sessoes, estado.execucoes, execucao) };
    }
    const id = randomUUID();
    sessao = {
      demanda_id: ref.demanda_id,
      ticket_id: ref.ticket_id,
      id,
      modo: opcoes.modo ?? "autonomo",
      conversa_referencia: id,
    };
    execucao = abrir(id);
    const sessoes = criarTrabalho(estado.sessoes, sessao);
    return { ...estado, sessoes, execucoes: iniciarProcesso(sessoes, estado.execucoes, execucao) };
  });
  comDemanda(banco, ref.demanda_id, (a) =>
    iniciarTentativaDoTicket(a, { ticket_id: ref.ticket_id, processo_id: execucao.id }, FABRIQUINHA, {
      agora: execucao.inicio,
    }),
  );
  const fim = condutor.acompanhar(execucao.id, () =>
    conduzir({ banco, ref, ag, ticket, projeto, sessao, execucao, opcoes, relogio }),
  );
  return { id: execucao.id, fim };
}

/**
 * Interrompe a execução aberta do ticket. Com condutor vivo, o SIGTERM no grupo faz o condutor gravar a falha; órfã
 * (sem condutor, ex.: serviço reiniciado), SIGKILL e encerra direto. Sem execução aberta, recusa antes de escrever.
 */
export function interromperExecucaoDemanda(
  banco: DatabaseSync,
  ref: TicketRef,
  relogio: Relogio = relogioDoSistema,
): void {
  const { execucoes } = carregarTrabalhosDoTicket(banco, ref);
  const execucao = existe(
    execucoes.find((e) => e.fim == null),
    `o ticket ${ref.demanda_id}.T${String(ref.ticket_id)} não tem execução em andamento`,
    "só se interrompe uma execução aberta",
  );
  if (condutor.interromper(execucao.id)) return;
  if (execucao.grupo_processo != null) {
    const ag = carregarDemanda(banco, ref.demanda_id);
    const ticket = encontrado(
      ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
      `o ticket ${formatarTicketRef(ref)} não existe`,
      "use um ticket da demanda",
    );
    const projeto = carregarProjeto(banco, ag.demanda.projeto);
    const ambiente = ambienteDoEspaco(espacoDoTicket(ag, ticket, projeto, raizDo(banco)));
    // O host local sinaliza na hora; o encerramento abaixo não depende da resposta.
    ambiente.sinalizar({ ambiente_id: ambiente.id, grupo_processo: execucao.grupo_processo }, "SIGKILL").catch(noLog);
  }
  encerrarProcessoOrfao(
    banco,
    ref,
    execucao.id,
    falhaInterrompidaPeloAuditor,
    condutor.avisar,
    condutor.harness,
    falharTicketDemanda,
    relogio,
  );
}
