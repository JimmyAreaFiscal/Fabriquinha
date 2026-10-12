// Sessões (F4 §5, §6.5, §6.6): estado calculado, lista e histórico, chat, mensagens conforme o estado, e as sessões
// interativas e de consulta, que param por ociosidade e retomam na próxima mensagem no mesmo modo.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  type Agregado,
  AUDITOR,
  type Contexto,
  type Execucao,
  FABRIQUINHA,
  type ModoExecucao,
  type Ticket,
} from "../dominio/agregado.ts";
import { concluirTicket } from "../dominio/conclusao.ts";
import { encontrado, ErroDeRegra, existe, mensagem } from "../dominio/erros.ts";
import { evidenciasFaltando } from "../dominio/evidencia.ts";
import {
  iniciarConsulta,
  iniciarExecucao,
  naSessaoPrincipal,
  reabrirTicket,
  terminarExecucao,
  ticketDe,
} from "../dominio/execucao.ts";
import { decidirPR, decidirRegistro } from "../dominio/gates.ts";
import { type Etapa, type Fase, type Id, type Instante, type Modelo, motivo } from "../dominio/primitivos.ts";
import { varrerBase } from "../metricas/retrabalho.ts";
import { depoisDoC6 } from "../metricas/uso.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { raizDo } from "../persistencia/banco.ts";
import { anotar, arquivoDaSessao, issueDaSessao, issuesComSessao, logDaExecucao } from "../persistencia/execucoes.ts";
import {
  agregadoExistente,
  comIssue,
  issueDoTicket,
  registrarIssue,
  ultimaEdicaoDoAgente,
} from "../persistencia/issues.ts";
import { projeto as lerProjeto } from "../persistencia/projetos.ts";
import { estadoPR, type LeituraDoPR } from "../repositorio/pr.ts";
import { caminhoDaWorktree, descartarAlteracoes, limpar } from "../repositorio/worktree.ts";
import {
  assinar,
  avisar,
  type Dialogo,
  encerrar,
  estaEncerrando,
  iniciarNaSessaoPrincipal,
  mandar,
  type Rodada,
  rodarExecucao,
  type Situacao,
  situacao,
} from "./gerente.ts";
import type { EventoPi } from "./pi.ts";
import { montarPrompt } from "./prompt.ts";

export type Estado = "rodando" | "aguardando_humano" | "terminada";
export type MotivoEspera = "conversa" | "dialogo" | "falha" | "gate_registro" | "gate_desenho" | "gate_pr";

/** Uma sessão (F4 §5.1) com o estado calculado (F4 §5.2). `sessao` é o `sessaoPi`. */
export interface InfoSessao {
  sessao: string;
  issue: Id;
  projeto: string;
  ticket: Id;
  etapa: Etapa;
  modo: ModoExecucao;
  /** A última execução da sessão. */
  execucao: Id;
  /** O modelo da última execução; sem ele, valeu o padrão do pi. */
  modelo?: Modelo;
  estado: Estado;
  motivo?: MotivoEspera;
  /** Desde quando a sessão está neste estado. */
  desde: Instante;
  dialogos: Dialogo[];
  /** Rodando com o pi vivo neste serviço: o que o agente está fazendo agora (F7 §4.4, Início). */
  atividade?: string;
}

export interface OpcoesInterativa {
  /** Minutos sem mensagem até o processo parar (F4 §3, §6.6). */
  ociosidadeMin: number;
}

/** Gate que depende do último ticket concluído da etapa, e a fase em que ele está aberto (F4 §5.2). */
const GATES: Partial<Record<Etapa, [Fase, MotivoEspera]>> = {
  desenho: ["aprovacao_desenho", "gate_desenho"],
  encerramento: ["aprovacao_pr", "gate_pr"],
};

function gateDe(ag: Agregado, ticket: Ticket): MotivoEspera | undefined {
  const gate = GATES[ticket.etapa];
  const ultimo = ag.tickets.findLast((t) => t.etapa === ticket.etapa && t.status === "concluido");
  return gate?.[0] === ag.issue.fase && ultimo?.id === ticket.id ? gate[1] : undefined;
}

/** O que o estado lê de fora do agregado. */
export interface Fatos {
  /** A execução viva da sessão neste serviço. */
  viva: Situacao | undefined;
  /** Quando o agente editou a issue pela última vez (C2 a C4), ou `""`. */
  edicaoDoAgente: string;
}

/**
 * O registro espera a decisão do Auditor: tem o que C10 aprovado exige (título, tipo e as evidências da etapa) e,
 * se já foi devolvido, o agente trabalhou depois da última devolução: submeteu evidência ou editou a issue. Sem
 * isso, a conversa continua: um agente que só pergunta depois de Devolver não volta ao gate.
 */
function registroParaDecidir(ag: Agregado, ticket: Ticket, edicaoDoAgente: string): boolean {
  const devolvido = ag.decisoes.findLast((d) => d.gate === "registro" && !d.aprovado)?.em;
  return (
    ag.issue.titulo !== null &&
    ag.issue.tipo !== null &&
    evidenciasFaltando(ag, ticket).length === 0 &&
    (devolvido === undefined ||
      edicaoDoAgente > devolvido ||
      ag.evidencias.some((e) => e.ticket === ticket.id && e.em > devolvido))
  );
}

type Calculado = [Estado, MotivoEspera | undefined, string];

/**
 * F4 §6.5: a falha e os gates do ticket se resolvem na sessão principal; a consulta só conversa e, parada, termina com
 * o ticket, como as outras sessões (§5.2).
 * ponytail: o §6.6 diz que a consulta parada por ociosidade segue em conversa, o que a deixaria para sempre entre as
 * ativas quando o ticket já terminou; aqui vale o §5.2. A conversa fica no JSONL, para exportar ou anexar a uma
 * consulta nova. Se a spec decidir pelo §6.6, falta um jeito de encerrar a consulta.
 */
const consultaParada = (ag: Agregado, ticket: Ticket, viva: boolean, parada: string): Calculado =>
  !viva && ticket.status === "concluido" && gateDe(ag, ticket) === undefined
    ? ["terminada", undefined, parada]
    : ["aguardando_humano", "conversa", parada];

/** A sessão principal sem o agente trabalhando: o estado sai do ticket e da issue. */
function principalParada(
  ag: Agregado,
  ticket: Ticket,
  autonoma: boolean,
  parada: string,
  edicaoDoAgente: string,
): Calculado {
  // Depois do C6 a autônoma ainda roda a coleta do F3 e o C7.
  if (autonoma && ticket.status === "em_execucao") return ["rodando", undefined, parada];
  if (ticket.status === "falhou") return ["aguardando_humano", "falha", parada];
  if (ticket.etapa === "registro" && ag.issue.fase === "registro") {
    return [
      "aguardando_humano",
      registroParaDecidir(ag, ticket, edicaoDoAgente) ? "gate_registro" : "conversa",
      parada,
    ];
  }
  if (ticket.status === "concluido") {
    const gate = gateDe(ag, ticket);
    return gate
      ? ["aguardando_humano", gate, String(ticket.concluidoEm)]
      : ["terminada", undefined, String(ticket.concluidoEm)];
  }
  // ponytail: a autônoma reaberta (C9) que espera o agendador conta como rodando, porque o Auditor já respondeu.
  return autonoma ? ["rodando", undefined, parada] : ["aguardando_humano", "conversa", parada];
}

function calcular(ag: Agregado, ticket: Ticket, execucao: Execucao, { viva, edicaoDoAgente }: Fatos): Calculado {
  const [dialogo] = viva?.dialogos ?? [];
  if (dialogo) return ["aguardando_humano", "dialogo", dialogo.em];
  // Interativa com o pi vivo esperando a próxima mensagem: decide como se estivesse parada.
  const ociosa = viva?.ocupado === false;
  if (execucao.resultado === "em_andamento" && !ociosa)
    return ["rodando", undefined, viva?.desde ?? execucao.iniciadaEm];
  const parada = viva?.desde ?? String(execucao.terminadaEm);
  return execucao.modo === "consulta"
    ? consultaParada(ag, ticket, viva !== undefined, parada)
    : principalParada(ag, ticket, execucao.modo === "autonomo", parada, edicaoDoAgente);
}

/** F4 §5.2: o estado da sessão, calculado do agregado e dos fatos de fora dele. */
export function estadoDaSessao(ag: Agregado, sessao: string, fatos: Fatos): InfoSessao {
  const execucao = existe(
    ag.execucoes.findLast((e) => e.sessaoPi === sessao),
    `a sessão ${sessao} não é da I-${String(ag.issue.id)}`,
    "confira o endereço do chat",
  );
  const ticket = ticketDe(ag, execucao.ticket);
  const [estado, motivoEspera, desde] = calcular(ag, ticket, execucao, fatos);
  return {
    sessao,
    issue: ag.issue.id,
    projeto: ag.issue.projeto,
    ticket: ticket.id,
    etapa: ticket.etapa,
    modo: execucao.modo,
    execucao: execucao.id,
    ...(execucao.modelo && { modelo: execucao.modelo }),
    estado,
    ...(motivoEspera && { motivo: motivoEspera }),
    desde,
    dialogos: fatos.viva?.dialogos ?? [],
    ...(estado === "rodando" && fatos.viva?.atividade && { atividade: fatos.viva.atividade }),
  };
}

export interface FiltroSessoes {
  /** `ativas`: rodando e aguardando o Auditor; `historico`: terminadas (F4 §5.3). */
  escopo: "ativas" | "historico";
  projeto?: string;
  issue?: Id;
  etapa?: Etapa;
}

/** Execuções interativas deste serviço, com a issue delas, até o C6. */
const tarefas = new Map<Id, { issue: Id; tarefa: Promise<void> }>();

/**
 * O agregado depois do C6 das execuções interativas da issue cujo pi está parando: sem isso, a sessão pareceria
 * `rodando` nos até 10 s entre a ordem de parar e o C6, e as ações seriam recusadas.
 */
async function agregadoAssentado(banco: DatabaseSync, issue: Id): Promise<Agregado> {
  await Promise.all([...tarefas].filter(([id, t]) => t.issue === issue && estaEncerrando(id)).map(([, t]) => t.tarefa));
  return agregadoExistente(banco, issue);
}

/** O estado da sessão com os fatos lidos agora: a execução viva e a última edição do agente na issue. */
const estadoNoBanco = (banco: DatabaseSync, ag: Agregado, sessao: string): InfoSessao =>
  estadoDaSessao(ag, sessao, { viva: situacao(sessao), edicaoDoAgente: ultimaEdicaoDoAgente(banco, ag.issue.id) });

const issueDe = (banco: DatabaseSync, sessao: string): Id =>
  encontrado(issueDaSessao(banco, sessao), `a sessão ${sessao} não existe`, "confira o endereço do chat");

/**
 * F4 §5.3: as sessões do escopo, da que está assim há mais tempo para a mais recente.
 * ponytail: carrega o agregado de cada issue com sessão; filtrar o histórico no SQL quando ele pesar.
 */
export async function sessoes(banco: DatabaseSync, filtro: FiltroSessoes): Promise<InfoSessao[]> {
  const todas: InfoSessao[] = [];
  for (const issue of issuesComSessao(banco, filtro)) {
    const ag = await agregadoAssentado(banco, issue);
    for (const s of new Set(ag.execucoes.map((e) => e.sessaoPi))) todas.push(estadoNoBanco(banco, ag, s));
  }
  return todas
    .filter(
      (s) =>
        (filtro.etapa === undefined || s.etapa === filtro.etapa) &&
        (s.estado === "terminada") === (filtro.escopo === "historico"),
    )
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}

/** A sessão pelo `sessaoPi`, com o estado. */
export async function infoDaSessao(banco: DatabaseSync, sessao: string): Promise<InfoSessao> {
  return estadoNoBanco(banco, await agregadoAssentado(banco, issueDe(banco, sessao)), sessao);
}

/** As entradas do JSONL da sessão, divididas só em `\n` (F4 §6.1.2); linha incompleta do fim fica de fora. */
export function lerConversa(raiz: string, sessao: string): unknown[] {
  const arquivo = arquivoDaSessao(raiz, sessao);
  if (!arquivo) return [];
  return readFileSync(arquivo, "utf8")
    .split("\n")
    .flatMap((linha) => {
      try {
        return [JSON.parse(linha) as unknown];
      } catch {
        return [];
      }
    });
}

export interface Chat {
  sessao: InfoSessao;
  /** O que já aconteceu, do JSONL da sessão do pi. */
  conversa: unknown[];
  /** Os eventos ao vivo; `{ type: "estado", sessao }` traz o estado novo. Devolve a função que cancela. */
  assinar(ouvinte: (evento: EventoPi) => void): () => void;
}

/**
 * F4 §5.4: a conversa da sessão até agora e o fluxo de eventos das execuções dela. A consulta começa com a conversa da
 * principal (F4 §6.5): até o pi gravar a cópia, logo depois de subir, o chat lê a principal, e a consulta recém-aberta
 * não aparece vazia.
 */
export async function abrirChat(banco: DatabaseSync, sessao: string): Promise<Chat> {
  const ag = await agregadoAssentado(banco, issueDe(banco, sessao));
  const info = estadoNoBanco(banco, ag, sessao);
  const raiz = raizDo(banco);
  const semCopia = info.modo === "consulta" && arquivoDaSessao(raiz, sessao) === undefined;
  return {
    sessao: info,
    conversa: lerConversa(raiz, semCopia ? principalDe(banco, ag, info.ticket)[0] : sessao),
    // O aviso de estado não espera o C6: o aviso seguinte, logo depois dele, corrige.
    assinar: (ouvinte) =>
      assinar(sessao, (evento) => {
        ouvinte(
          evento.type === "estado"
            ? { type: "estado", sessao: estadoNoBanco(banco, agregadoExistente(banco, issueDe(banco, sessao)), sessao) }
            : evento,
        );
      }),
  };
}

/**
 * F4 §6.6: C5 interativo na sessão principal do ticket e, em segundo plano, worktree, pi e C6 quando o processo
 * para. A primeira mensagem de uma sessão leva o contexto da etapa (F4 §6.3); a retomada leva só a mensagem.
 * Devolve a sessão.
 */
export function iniciarInterativa(banco: DatabaseSync, ticket: Id, texto: string, opcoes: OpcoesInterativa): string {
  const { ag, execucao } = iniciarNaSessaoPrincipal(banco, issueDoTicket(banco, ticket), ticket, "interativo");
  return acompanharInterativa(banco, ag, execucao, texto, opcoes);
}

/** A execução interativa já iniciada (C5), em segundo plano, com `texto` como mensagem. Devolve a sessão. */
function acompanharInterativa(
  banco: DatabaseSync,
  ag: Agregado,
  execucao: Execucao,
  texto: string,
  opcoes: OpcoesInterativa,
): string {
  const raiz = raizDo(banco);
  return acompanhar(banco, ag, execucao, opcoes, {
    // Dentro da execução: sessão com dois arquivos (F6 §3.1) vira falha dela, não execução presa em andamento.
    prompt: (c) => {
      if (arquivoDaSessao(raiz, execucao.sessaoPi) !== undefined) return texto;
      const contexto = montarPrompt({
        ag,
        ticket: ticketDe(ag, execucao.ticket),
        instrucao: undefined,
        ...c,
        modo: "interativo",
      });
      return `${contexto}\n${texto}\n`;
    },
  });
}

/** C21 na sessão `sessao` e, em segundo plano, o pi da consulta até o C6 (F4 §6.5, §6.6). Devolve a sessão. */
function iniciarNaConsulta(
  banco: DatabaseSync,
  ticket: Id,
  sessao: string,
  opcoes: OpcoesInterativa,
  abertura: Pick<Rodada, "prompt" | "fork">,
): string {
  const issue = issueDoTicket(banco, ticket);
  const ag = comIssue(banco, issue, "iniciarConsulta", AUDITOR, (a, ctx) =>
    iniciarConsulta(a, { ticket, sessaoPi: sessao }, AUDITOR, ctx),
  );
  const execucao = existe(
    ag.execucoes.findLast((e) => e.sessaoPi === sessao),
    `C21 não abriu a consulta ${sessao}`,
    "confira o banco",
  );
  return acompanhar(banco, ag, execucao, opcoes, abertura);
}

/**
 * O arquivo da sessão principal que a consulta `sessao` deve copiar com `--fork`: nenhum se a cópia já existe. Uma
 * consulta cuja primeira execução falhou antes de o pi subir ainda não tem cópia, e a retomada a faz (F4 §6.5).
 * Sem sessão principal também não há o que copiar, e o C21 recusa.
 */
function copiaDaPrincipal(raiz: string, ag: Agregado, ticket: Id, sessao: string): string | undefined {
  const principal = ag.execucoes.find(naSessaoPrincipal(ticket));
  if (arquivoDaSessao(raiz, sessao) || !principal) return undefined;
  return existe(
    arquivoDaSessao(raiz, principal.sessaoPi),
    `a sessão de T-${String(ticket)} ainda não tem conversa gravada`,
    "espere o agente responder",
  );
}

/**
 * F4 §6.5: Conversar sobre esta sessão. Para o pi ocioso do ticket, abre a consulta (C21) numa sessão nova, que o pi
 * copia da principal (`--fork`), e sobe o pi ocioso, à espera da primeira pergunta. Devolve a sessão da consulta.
 *
 * O pi recebe o id da cópia por `--session-id`, que ele aceita junto com `--fork`: assim o C21 grava a execução
 * antes de o pi subir, com o ambiente dela (F4 §6.1.2), em vez de esperar o id pelo `get_state`.
 */
export async function conversarSobre(banco: DatabaseSync, ticket: Id, opcoes: OpcoesInterativa): Promise<string> {
  const ag = await agregadoAssentado(banco, issueDoTicket(banco, ticket));
  const sessao = randomUUID();
  const fork = copiaDaPrincipal(raizDo(banco), ag, ticket, sessao);
  await pararOciosa(ag, ticket);
  return iniciarNaConsulta(banco, ticket, sessao, opcoes, { prompt: () => undefined, fork });
}

/** Roda em segundo plano a execução interativa ou de consulta já iniciada, até o C6 quando o pi para. */
function acompanhar(
  banco: DatabaseSync,
  ag: Agregado,
  execucao: Execucao,
  opcoes: OpcoesInterativa,
  abertura: Pick<Rodada, "prompt" | "fork">,
): string {
  const issue = ag.issue.id;
  const log = logDaExecucao(raizDo(banco), execucao.id);
  const e = `E-${String(execucao.id)}`;
  const tarefa = rodarExecucao({
    banco,
    ag,
    execucao,
    limiteMin: opcoes.ociosidadeMin,
    ...abertura,
  })
    .then(({ falha }) => {
      // Ticket interativo nunca falha (F1 §4.2): só a execução termina; a próxima mensagem retoma a sessão.
      comIssue(banco, issue, "terminarExecucao", FABRIQUINHA, (a, ctx) =>
        terminarExecucao(
          a,
          falha === undefined
            ? { execucao: execucao.id, resultado: "sucesso" }
            : { execucao: execucao.id, resultado: "falha", erro: motivo(falha) },
          FABRIQUINHA,
          ctx,
        ),
      );
      depoisDoC6(banco, execucao.id);
      anotar(log, falha === undefined ? `${e} terminou` : `${e} terminou com falha: ${falha}`);
    })
    .catch((error_: unknown) => {
      anotar(log, `${e} não gravou o término: ${mensagem(error_)}`);
    })
    .finally(() => {
      tarefas.delete(execucao.id);
      avisar(execucao.sessaoPi, log);
    });
  tarefas.set(execucao.id, { issue, tarefa });
  return execucao.sessaoPi;
}

/** F4 §6.6: C1, worktree, sessão interativa e a mensagem inicial. Devolve a sessão para o chat. */
export function registrarNecessidade(
  banco: DatabaseSync,
  projeto: string,
  deps: Id[],
  opcoes: OpcoesInterativa,
): string {
  const ag = registrarIssue(banco, { projeto, deps }, AUDITOR);
  const [ticket] = ag.tickets;
  const i = `I-${String(ag.issue.id)}`;
  return iniciarInterativa(
    banco,
    existe(ticket, `a ${i} nasceu sem ticket de registro`, "confira o C1").id,
    `Vamos registrar uma necessidade no projeto ${projeto} (issue ${i}).`,
    opcoes,
  );
}

/** Por que a sessão não recebe mensagem em cada estado (F4 §5.4). */
const SEM_MENSAGEM: Record<string, string> = {
  dialogo: "responda o diálogo aberto pelo agente",
  falha: "responda e retome o ticket",
  gate_registro: "aprove o registro, ou devolva-o com o motivo, que vai ao agente como mensagem",
  gate_desenho: "decida na página da issue",
  gate_pr: "decida na página da issue",
  terminada: "a sessão é só leitura; converse sobre ela numa consulta",
};

export type ModoEnvio = "prompt" | "steer" | "follow_up";

/** Por que uma sessão `rodando` ainda não tem pi para receber `steer` ou `follow_up`. */
function semPi(ag: Agregado, info: InfoSessao): ErroDeRegra {
  const t = `T-${String(info.ticket)}`;
  if (ag.execucoes.some((e) => e.sessaoPi === info.sessao && e.resultado === "em_andamento")) {
    return new ErroDeRegra(`o pi da sessão de ${t} ainda não subiu`, "espere a preparação da worktree");
  }
  if (ticketDe(ag, info.ticket).status === "aberto") {
    return new ErroDeRegra(
      `${t} espera o agendador para a próxima execução, que já leva a resposta do Auditor`,
      "use Executar agora para não esperar",
    );
  }
  return new ErroDeRegra(`o agente de ${t} já terminou, e a Fabriquinha confere as evidências`, "espere o resultado");
}

/**
 * F4 §5.4: `steer` ou `follow_up` com a sessão rodando; `prompt` com ela esperando a conversa, retomando-a numa
 * nova execução no mesmo modo se o processo parou (ociosidade ou reinício).
 */
export async function enviar(
  banco: DatabaseSync,
  sessao: string,
  texto: string,
  modo: ModoEnvio,
  opcoes: OpcoesInterativa,
): Promise<void> {
  const ag = await agregadoAssentado(banco, issueDe(banco, sessao));
  const info = estadoNoBanco(banco, ag, sessao);
  const t = `T-${String(info.ticket)}`;
  let aceitos: ModoEnvio[] = [];
  if (info.estado === "rodando") aceitos = ["steer", "follow_up"];
  else if (info.motivo === "conversa") aceitos = ["prompt"];
  const rotulo = info.motivo ? `${info.estado}: ${info.motivo}` : info.estado;
  if (aceitos.length === 0) {
    throw new ErroDeRegra(
      `a sessão de ${t} está ${rotulo} e não recebe mensagem`,
      String(SEM_MENSAGEM[info.motivo ?? info.estado]),
    );
  }
  if (!aceitos.includes(modo)) {
    throw new ErroDeRegra(`a sessão de ${t} está ${rotulo} e não recebe ${modo}`, `envie com ${aceitos.join(" ou ")}`);
  }
  const viva = situacao(sessao);
  if (viva) {
    mandar(viva.execucao, { type: modo, message: texto });
    return;
  }
  if (info.estado === "rodando") throw semPi(ag, info);
  if (info.modo === "consulta") {
    const fork = copiaDaPrincipal(raizDo(banco), ag, info.ticket, sessao);
    iniciarNaConsulta(banco, info.ticket, sessao, opcoes, { prompt: () => texto, fork });
  } else iniciarInterativa(banco, info.ticket, texto, opcoes);
}

/**
 * Para o pi ocioso do ticket e espera o C6 dele: C7 e C10 exigem o ticket sem execução em andamento. Recusa se o
 * agente ainda trabalha ou espera um diálogo.
 */
async function pararOciosa(ag: Agregado, ticket: Id): Promise<void> {
  const execucao = ag.execucoes.find((e) => e.ticket === ticket && e.resultado === "em_andamento");
  if (!execucao) return;
  const viva = situacao(execucao.sessaoPi);
  if (viva?.ocupado !== false || viva.dialogos.length > 0) {
    throw new ErroDeRegra(`a sessão de T-${String(ticket)} ainda está rodando`, "espere o agente terminar");
  }
  encerrar(execucao.id);
  await tarefas.get(execucao.id)?.tarefa;
}

/** A sessão principal de um ticket que já executou, com o log da última execução dela. */
function principalDe(banco: DatabaseSync, ag: Agregado, ticket: Id): [string, string] {
  const execucao = existe(
    ag.execucoes.findLast(naSessaoPrincipal(ticket)),
    `T-${String(ticket)} ainda não tem sessão`,
    "confira o banco",
  );
  return [execucao.sessaoPi, logDaExecucao(raizDo(banco), execucao.id)];
}

/**
 * F4 §6.6: Aprovar registro e Devolver, no chat. Para o pi ocioso, grava C10 e, se devolvido, retoma a sessão com o
 * motivo como mensagem ao agente.
 */
export async function decidirRegistroNoChat(
  banco: DatabaseSync,
  issue: Id,
  decisao: { aprovado: boolean; motivo?: string },
  opcoes: OpcoesInterativa,
): Promise<void> {
  const ag = await agregadoAssentado(banco, issue);
  const ticket = ag.tickets.find((t) => t.etapa === "registro" && t.status !== "concluido");
  if (ticket) await pararOciosa(ag, ticket.id);
  if (ticket && decisao.aprovado) await descartarDaSessao(banco, ag, ticket.id);
  comIssue(banco, issue, "decidirRegistro", AUDITOR, (a, ctx) => decidirRegistro(a, decisao, AUDITOR, ctx));
  // C10 só passa com o ticket de registro aberto; aprovar exige as evidências de uma execução, e devolver, o motivo.
  const t = existe(ticket, "C10 passou sem ticket de registro", "confira o banco");
  if (!decisao.aprovado) {
    iniciarInterativa(banco, t.id, `O Auditor devolveu o registro. Motivo: ${String(decisao.motivo)}`, opcoes);
    return;
  }
  avisar(...principalDe(banco, ag, t.id));
}

/**
 * F3 §7 nas etapas interativas (registro e sessão em aberto), que não mudam código: descarta o que ficou na worktree,
 * com o log da última execução do ticket. Vem antes do comando que encerra a etapa: se falhar, nada muda.
 */
async function descartarDaSessao(banco: DatabaseSync, ag: Agregado, ticket: Id): Promise<void> {
  const [, log] = principalDe(banco, ag, ticket);
  await descartarAlteracoes(caminhoDaWorktree(raizDo(banco), ag.issue.projeto, ag.issue.id), log);
}

/** F4 §6.6: Concluir sessão, na sessão em aberto. Para o pi ocioso, descarta as alterações (F3 §7) e chama C7. */
export async function concluirSessao(banco: DatabaseSync, ticket: Id): Promise<void> {
  const ag = await agregadoAssentado(banco, issueDoTicket(banco, ticket));
  const t = ticketDe(ag, ticket);
  if (t.etapa !== "sessao") {
    throw new ErroDeRegra(`T-${String(ticket)} é da etapa ${t.etapa}`, "só a sessão em aberto se conclui pelo chat");
  }
  await pararOciosa(ag, ticket);
  await descartarDaSessao(banco, ag, ticket);
  comIssue(banco, ag.issue.id, "concluirTicket", FABRIQUINHA, (a, ctx) =>
    concluirTicket(a, { ticket }, FABRIQUINHA, ctx),
  );
  // C7 exige o ticket em execução, então ele já tem sessão.
  avisar(...principalDe(banco, ag, ticket));
}

/**
 * F4 §6.4: Responder e retomar. C9 grava a instrução do Auditor e devolve o ticket que falhou a `aberto`; a próxima
 * execução da sessão principal, pelo agendador ou pelo Executar agora, a leva antes do prompt da etapa. O aviso tira o
 * chat da falha.
 */
export function reabrir(banco: DatabaseSync, ticket: Id, instrucao?: string): void {
  const ag = comIssue(banco, issueDoTicket(banco, ticket), "reabrirTicket", AUDITOR, (a) =>
    reabrirTicket(a, { ticket, instrucao }, AUDITOR),
  );
  // C9 só reabre ticket que falhou, e só falha o que executou: a sessão principal existe.
  avisar(...principalDe(banco, ag, ticket));
}

/** Para os pis ociosos da issue (as consultas, no gate do PR) e espera o C6; recusa se algum agente trabalha. */
async function pararOciosasDaIssue(banco: DatabaseSync, issue: Id): Promise<void> {
  const ag = await agregadoAssentado(banco, issue);
  for (const e of ag.execucoes.filter((x) => x.resultado === "em_andamento")) await pararOciosa(ag, e.ticket);
}

/** O que o `conferirC16` lança para desfazer a transação depois de o C16 aceitar. */
class Aceito extends Error {}

/** Roda o C16 numa transação sempre desfeita: lança a recusa dele e não grava nada. */
function conferirC16(banco: DatabaseSync, issue: Id, decidir: (a: Agregado, ctx: Contexto) => Agregado): void {
  try {
    comIssue(banco, issue, "decidirPR", AUDITOR, (a, ctx) => {
      decidir(a, ctx);
      throw new Aceito();
    });
  } catch (error_) {
    if (!(error_ instanceof Aceito)) throw error_;
  }
}

/**
 * C16 com o PR lido na plataforma agora, logo antes da transação (F5 §5.2), e o aviso à sessão do encerramento, que
 * sai do gate. `depois` aplica, na mesma transação, o que vem com a decisão. Antes da transação, para as consultas
 * ociosas da issue, que rodam na worktree, mas só depois de o PR lido e de o C16 aceitar a decisão: a falha do `gh` ou
 * do `az` e a recusa não mexem em nada (F7 §4.2). Devolve o agregado e o PR lido.
 */
async function decidirComPR(
  banco: DatabaseSync,
  issue: Id,
  decisao: { aprovado: true; nota: number } | { aprovado: false; motivo: string },
  depois: (ag: Agregado, ctx: Contexto) => Agregado = (ag) => ag,
): Promise<[Agregado, LeituraDoPR, Projeto]> {
  const antes = await agregadoAssentado(banco, issue);
  const projeto = existe(
    lerProjeto(banco, antes.issue.projeto),
    `o projeto ${antes.issue.projeto} não existe`,
    "cadastre-o na Configuração",
  );
  const pr = await estadoPR(projeto, antes);
  const decidir = (a: Agregado, ctx: Contexto) => decidirPR(a, decisao, AUDITOR, { ...ctx, estadoPR: pr.estado });
  conferirC16(banco, issue, decidir);
  await pararOciosasDaIssue(banco, issue);
  const ag = comIssue(banco, issue, "decidirPR", AUDITOR, (a, ctx) => depois(decidir(a, ctx), ctx));
  // C16 só passa com um encerramento concluído, que já executou.
  const encerramento = existe(
    ag.tickets.findLast((t) => t.etapa === "encerramento"),
    "C16 passou sem encerramento",
    "confira o banco",
  );
  avisar(...principalDe(banco, ag, encerramento.id));
  return [ag, pr, projeto];
}

/**
 * F5 §5.2 e §5.3: encerrar a issue com a nota (C16 aprovado), com o PR lido como mergeado agora, e remover a
 * worktree. Devolve os avisos da limpeza, que não desfazem o encerramento.
 */
export async function encerrarIssue(banco: DatabaseSync, issue: Id, nota: number): Promise<string[]> {
  const [ag, , projeto] = await decidirComPR(banco, issue, { aprovado: true, nota });
  return limpar(raizDo(banco), projeto, ag.issue, () => varrerBase(banco, projeto.nome));
}

/**
 * F4 §6.6: pedir mudanças no PR (C16 reprovado), com o PR lido como não mergeado agora, e abrir a sessão em aberto,
 * cuja mensagem inicial traz o motivo e a URL do PR. C16 e o C5 da sessão vão numa transação só: se o C5 recusar,
 * nada é gravado, e uma queda depois deixa a execução que o reinício do serviço recupera (F4 §7). Devolve a sessão.
 */
export async function pedirMudancas(
  banco: DatabaseSync,
  issue: Id,
  pedido: string,
  opcoes: OpcoesInterativa,
): Promise<string> {
  const [ag, pr] = await decidirComPR(banco, issue, { aprovado: false, motivo: pedido }, (decidido, ctx) => {
    const sessao = existe(
      decidido.tickets.find((t) => t.etapa === "sessao" && t.status === "aberto"),
      "C16 reprovado não criou a sessão em aberto",
      "confira o banco",
    );
    return iniciarExecucao(
      decidido,
      { ticket: sessao.id, modo: "interativo", sessaoPi: randomUUID() },
      FABRIQUINHA,
      ctx,
    );
  });
  // O C5 só passa sem outra execução em andamento na issue: a única é a da sessão em aberto.
  const execucao = existe(
    ag.execucoes.find((e) => e.resultado === "em_andamento"),
    "C5 não deixou a sessão em aberto em andamento",
    "confira o banco",
  );
  // A descrição do ticket é o motivo já validado (F1 C16).
  const motivoPedido = ticketDe(ag, execucao.ticket).descricao;
  return acompanharInterativa(
    banco,
    ag,
    execucao,
    `O Auditor pediu mudanças no PR ${pr.url}. Motivo: ${motivoPedido}`,
    opcoes,
  );
}
