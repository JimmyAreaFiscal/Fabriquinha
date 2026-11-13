// Serviço Execução da demanda (comparacao-sdlc-implementacao.md §§4.1, 4.2, 6 e 7.3): junta sessão, execução, worktree,
// prompt e pi para um ticket da demanda. Conduz a execução; o ticket só muda pela condução da etapa (`etapas/`).
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import {
  resolverConfiguracaoAgente,
  formatarTicketRef,
  type FalhaDaTentativa,
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
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
import {
  ambienteDoEspaco,
  cicloDoEspaco,
  commitDoTicketDemanda,
  type EspacoDeTrabalho,
  espacoDoTicket,
  varrerCommitsHumanos,
} from "../../../../repositorio/publico.ts";
import { encontrado, existe, mensagem } from "../../../../../shared/nucleo/erros.ts";
import {
  carregarSessoesDoContexto,
  comSessoesDoContexto,
  criarSessao,
  encerrarExecucaoComUso,
  type Execucao,
  execucoesAbertas,
  gravarAmbienteDaExecucao,
  iniciarExecucao,
  type ModoTrabalho,
  retomarSessao,
  type Sessao,
} from "../../../../sessoes/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { caminhoArquivo } from "../../../../../shared/armazenamento/arquivos.ts";
import { anexosDaDemanda } from "../../../evidencias/publico.ts";
import { anotar, noLog } from "../../../../../shared/infra/registro.ts";
import { pastasDoProcesso } from "../../../../compartilhado/infra/registro.ts";
import { triarPergunta } from "../politica_dos_agentes/auditor_automatico.ts";
import { condutor } from "../politica_dos_agentes/condutor.ts";
import { encerrarProcessoOrfao, type TicketRef } from "../politica_dos_agentes/processo_do_ticket.ts";
import { lancamentoDoTicket } from "./lancamento_do_ticket.ts";
import type { ContextoDoPrompt } from "../prompt/contexto_do_prompt.ts";
import { projetosCadastrados, type ProjetoConduzido } from "../projetos_cadastrados.ts";

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
  projeto: ProjetoConduzido;
  sessao: Sessao;
  execucao: Execucao;
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
  if (buscouBase) await varrerCommitsHumanos(banco, projeto).catch(ciclo.anotarFalhaDaVarredura);
  return pasta;
}

/** Grava o grupo de processo do pi e o Ambiente que o lançou, para o reinício do serviço poder interrompê-lo (§4.2). */
function gravarGrupo({ banco, ref, execucao }: Conducao, pgid: number, ambienteId: string): void {
  comSessoesDoContexto(banco, ref, (estado) => ({
    ...estado,
    execucoes: estado.execucoes.map((e) => (e.id === execucao.id ? { ...e, grupo_processo: pgid } : e)),
  }));
  gravarAmbienteDaExecucao(banco, execucao.id, ambienteId);
}

/** As perguntas respondidas nas sessões de cada ticket anterior da rodada que foi reprovado, por ticket (só a revisão da rodada as lê). */
function perguntasDosTicketsReprovadosDaRodada({
  banco,
  ag,
  ticket,
}: Conducao): ContextoDoPrompt["perguntasDasRevisoesAnteriores"] {
  const raiz = raizDo(banco);
  const { sessoes } = carregarSessoesDoContexto(banco, { demanda_id: ag.demanda.id, ticket_id: null });
  const idsDaRodada = new Set(ag.tickets.filter((t) => t.rodada_id === ticket.rodada_id).map((t) => t.ticket_id));
  return new Map(
    ag.decisoes
      .filter((d) => d.resultado === "reprovado" && d.ticket_id < ticket.ticket_id && idsDaRodada.has(d.ticket_id))
      .map((d) => [
        d.ticket_id,
        sessoes
          .filter((s) => s.ticket_id === d.ticket_id)
          .flatMap((s) => condutor.perguntasRespondidasNaSessao(raiz, s.id)),
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
  encerrarExecucaoComUso(c, falha !== undefined, log, condutor.harness, c.relogio);
  try {
    await opcoes.fechar?.(c.banco, c.ref, { falha });
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
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
  const configuracaoAgente = resolverConfiguracaoAgente({
    ticket: ticket.configuracao_agente,
    etapaDoProjeto: projeto.etapas.find((e) => e.etapa === ticket.etapa)?.configuracao_agente,
    padrao: {},
  });
  const abrir = (trabalho_id: string): Execucao => ({
    id: randomUUID(),
    trabalho_id,
    inicio: relogio.agora(),
    falha: false,
    configuracao_agente: configuracaoAgente,
  });
  let sessao!: Sessao;
  let execucao!: Execucao;
  comSessoesDoContexto(banco, ref, (estado) => {
    // Com mais de uma sessão no ticket, retoma-se a mais recente.
    const existente = opcoes.iniciarEmSessaoNova ? undefined : estado.sessoes.at(-1);
    if (existente) {
      sessao = existente;
      execucao = abrir(sessao.id);
      return { ...estado, execucoes: retomarSessao(estado.sessoes, estado.execucoes, execucao) };
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
    const sessoes = criarSessao(estado.sessoes, sessao);
    return { ...estado, sessoes, execucoes: iniciarExecucao(sessoes, estado.execucoes, execucao) };
  });
  abrirTentativaDoTicket(banco, ref, execucao);
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
  const { execucoes } = carregarSessoesDoContexto(banco, ref);
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
    const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);
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
    falharTicketEmExecucao,
    relogio,
  );
}

/** Interrompe, uma vez por ticket, as execuções abertas das demandas `canceladas`; roda depois do commit. */
export function interromperExecucoesDasDemandas(banco: DatabaseSync, canceladas: readonly string[]): void {
  const abertas = execucoesAbertas(banco).filter((e) => canceladas.includes(e.demanda_id));
  const tickets = new Map(
    abertas.map(({ demanda_id, ticket_id }) => [`${demanda_id}.${String(ticket_id)}`, { demanda_id, ticket_id }]),
  );
  for (const ref of tickets.values()) interromperExecucaoDemanda(banco, ref);
}
