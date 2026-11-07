// Chat das sessões dos tickets da demanda (comparacao-sdlc-implementacao.md §9.1): acha a sessão em `sessao`, calcula o
// estado, monta o cabeçalho com os endereços públicos, abre a conversa com o fluxo ao vivo e exporta o histórico. A
// leitura do JSONL e a mensagem em Markdown servem também à avaliação e à sessão de ajustes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, type Ator } from "../nucleo/ator.ts";
import type { ModoExecucao } from "../nucleo/sessoes.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { FASES_TERMINADAS } from "../nucleo/cancelamento_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { encontrado, ErroDeRegra } from "../nucleo/erros.ts";
import type { Modelo } from "../nucleo/configuracao_agente.ts";
import type { EtapaTicket, Instante } from "../nucleo/primitivos.ts";
import type { ExecucaoSessao, Sessao } from "../nucleo/sessoes.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { arquivoDaSessao } from "../infra/registro.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { carregarSessoesDoTicket } from "../armazenamento/sessoes.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "./execucao_demanda.ts";
import { retomarSessaoAjustes } from "./sessao_ajustes.ts";
import {
  abortar,
  type Dialogo,
  assinar,
  mandar,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAutomatica,
  responderDialogo,
  type Situacao,
  situacao,
} from "./gerente.ts";
import type { EventoPi } from "../infra/agente/pi.ts";

/** O estado de uma sessão (F4 §5.2). */
export type Estado = "rodando" | "aguardando_humano" | "terminada";

/** Como a mensagem do Auditor chega ao pi: nova, redirecionando ou enfileirada. */
type ModoEnvio = "prompt" | "steer" | "follow_up";

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

// Sem espaço no fim: a seleção múltipla vem como "User selected:\n- 1. ...\n- 2. ..." (pacote-pi/extensions/pergunta.ts).
const PREFIXOS_DE_RESPOSTA = ["User answered:", "User selected:"];

/**
 * As perguntas que o agente fez com `perguntar` e que o Auditor respondeu: casa a chamada com o resultado pelo
 * `toolCallId`. Cancelamento e resposta vazia ficam de fora; sessão sem arquivo não tem perguntas.
 */
export function perguntasRespondidasNaSessao(raiz: string, sessao: string): { pergunta: string; resposta: string }[] {
  const mensagens = lerConversa(raiz, sessao).flatMap((entrada) => {
    const message = (entrada as { message?: Mensagem & { toolCallId?: string } } | null)?.message;
    // Linha fora da forma esperada (null, sem message, message sem content) não é conversa.
    if (typeof message?.content === "string") return [message];
    if (!Array.isArray(message?.content)) return [];
    // Bloco que não é objeto (null, número, texto solto) também não é conversa.
    return [
      {
        ...message,
        content: (message.content as unknown[]).filter((b) => typeof b === "object" && b !== null),
      },
    ];
  });
  const perguntaPorChamada = new Map<string, string>();
  for (const m of mensagens.filter((m) => m.role === "assistant")) {
    for (const b of blocos(m)) {
      const { id, arguments: args } = b as Bloco & { id?: string };
      if (b.type === "toolCall" && b.name === "perguntar" && id) {
        perguntaPorChamada.set(id, (args as { question?: string } | undefined)?.question ?? "");
      }
    }
  }
  return mensagens.flatMap((m) => {
    const pergunta = m.role === "toolResult" && perguntaPorChamada.get(String(m.toolCallId));
    const prefixo = PREFIXOS_DE_RESPOSTA.find((p) => texto(m).startsWith(p));
    const resposta = prefixo ? texto(m).slice(prefixo.length).trim() : "";
    return pergunta && resposta ? [{ pergunta, resposta }] : [];
  });
}

/** ponytail: o corte é fixo (F4 §6.8); se algum resultado longo fizer falta, aumentar o limite. */
const CORTE = 2000;

interface Bloco {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
}

/** A parte de uma mensagem do pi que o histórico mostra (formato da sessão do pi). */
export interface Mensagem {
  role?: string;
  content: string | Bloco[];
  toolName?: string;
  isError?: boolean;
  provider?: string;
  model?: string;
}

const blocos = (m: Mensagem): Bloco[] =>
  typeof m.content === "string" ? [{ type: "text", text: m.content }] : m.content;

/** O texto da mensagem; imagens e raciocínio ficam de fora. */
export const texto = (m: Mensagem): string =>
  blocos(m)
    .filter((b) => b.type === "text")
    .map((b) => String(b.text))
    .join("\n");

/** Bloco de código com uma cerca maior que qualquer sequência de crases do conteúdo, para ele não fechá-la. */
function cerca(conteudo: string, lingua = ""): string {
  const crases = "`".repeat(Math.max(2, ...(conteudo.match(/`+/g) ?? []).map((c) => c.length)) + 1);
  return `${crases}${lingua}\n${conteudo}\n${crases}`;
}

const cortar = (t: string): string =>
  t.length <= CORTE ? t : `${t.slice(0, CORTE)}\n… (cortado em ${String(CORTE)} de ${String(t.length)} caracteres)`;

/** Uma mensagem em Markdown: Fabriquinha, Auditor e agente na íntegra, chamadas e resultados cortados. */
export function emMarkdown(m: Mensagem, daFabriquinha: Set<string>): string[] {
  if (m.role === "user") return [`## ${daFabriquinha.has(texto(m)) ? "Fabriquinha" : "Auditor"}\n\n${texto(m)}`];
  if (m.role === "toolResult") {
    const erro = m.isError ? " (erro)" : "";
    return [`**Resultado de \`${String(m.toolName)}\`${erro}**\n\n${cerca(cortar(texto(m)))}`];
  }
  if (m.role !== "assistant") return [];
  const chamadas = blocos(m).filter((b) => b.type === "toolCall");
  return [
    `## Agente\n\n${texto(m)}`.trimEnd(),
    ...chamadas.map(
      (c) => `**Chamada de \`${String(c.name)}\`**\n\n${cerca(JSON.stringify(c.arguments ?? {}, null, 2), "json")}`,
    ),
  ];
}

export type MotivoDemanda = "conversa" | "dialogo" | "falha" | "gate_demanda";

/** A sessão do ticket da demanda com o estado calculado; `execucao` é o id (uuid) da última execução. */
interface InfoSessaoDemanda {
  sessao: string;
  projeto: string;
  modo: ModoExecucao;
  execucao: string;
  modelo?: Modelo;
  estado: Estado;
  motivo?: MotivoDemanda;
  desde: Instante;
  dialogos: Dialogo[];
}

/** O que a barra de estado e as linhas do sistema do chat leem; demanda, rodada e ticket pelo endereço público (D09). */
export interface CabecalhoDemanda {
  origem: "demanda";
  sessao: InfoSessaoDemanda;
  demanda: string;
  rodada?: string;
  ticket: string;
  etapa: EtapaTicket;
  /** O `motivo_falha` do ticket, na falha. */
  erro?: string;
  /** As execuções da sessão, em ordem. */
  execucoes: ExecucaoSessao[];
}

/** Uma entrada do JSONL; o prompt montado pela Fabriquinha vem com `fabriquinha`. */
type EntradaDemanda = Record<string, unknown> & { fabriquinha?: true };

export interface ChatDemanda {
  cabecalho: CabecalhoDemanda;
  conversa: EntradaDemanda[];
  /** Os eventos ao vivo; `{ type: "estado", ...cabecalho }` traz o cabeçalho novo. Devolve a função que cancela. */
  assinar(ouvinte: (evento: EventoPi) => void): () => void;
}

/** @testes tipo que o teste usa para montar a entrada */
export interface Carregada {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  sessao: Sessao;
  execucoes: ExecucaoSessao[];
}

type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

/** O ticket dono da sessão; `undefined` se o id não é de uma sessão da demanda. */
const donoDaSessao = (banco: DatabaseSync, id: string): TicketRef | undefined =>
  banco.prepare("SELECT demanda_id, ticket_id FROM sessao WHERE id = ?").get(id) as TicketRef | undefined;

const ultimaDe = ({ sessao, execucoes }: Carregada, quando: "primeira" | "ultima" = "ultima"): ExecucaoSessao =>
  encontrado(
    quando === "ultima" ? execucoes.at(-1) : execucoes[0],
    `a sessão ${sessao.id} não tem execução`,
    "confira o banco",
  );

function carregar(banco: DatabaseSync, ref: TicketRef, id: string): Carregada {
  const erro = [`a sessão ${id} não existe`, "confira o endereço do chat"] as const;
  const ag = carregarDemanda(banco, ref.demanda_id);
  const { sessoes, execucoes } = carregarSessoesDoTicket(banco, ref);
  return {
    ag,
    ticket: encontrado(
      ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
      ...erro,
    ),
    sessao: encontrado(
      sessoes.find((s) => s.id === id),
      ...erro,
    ),
    execucoes: execucoes.filter((e) => e.sessao_id === id),
  };
}

type Calculado = [Estado, MotivoDemanda | undefined, Instante];

/**
 * O estado da sessão: diálogo pendente espera o Auditor; execução aberta com o pi trabalhando roda; parada, a demanda
 * encerrada (concluída, cancelada, arquivada) termina, o ticket decide (falha, terminada) e a autônoma ainda roda; a
 * interativa espera a conversa, ou o gate de aprovação do plano.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function calcular(c: Carregada, viva: Situacao | undefined): Calculado {
  const { ag, ticket, sessao } = c;
  const [dialogo] = viva?.dialogos ?? [];
  if (dialogo) return ["aguardando_humano", "dialogo", dialogo.em];
  const ultima = ultimaDe(c);
  if (ultima.fim == null && viva?.ocupado !== false) return ["rodando", undefined, viva?.desde ?? ultima.inicio];
  // Sem fim, só o pi ocioso chega aqui, e ele tem `desde`.
  const parada = viva?.desde ?? String(ultima.fim);
  if (FASES_TERMINADAS.includes(ag.demanda.fase)) return ["terminada", undefined, parada];
  if (ticket.status === "falhou") return ["aguardando_humano", "falha", parada];
  if (ticket.status === "concluido") return ["terminada", undefined, parada];
  if (sessao.modo === "autonomo") return ["rodando", undefined, parada];
  return ["aguardando_humano", ag.demanda.fase === "aprovacao_planejamento" ? "gate_demanda" : "conversa", parada];
}

function montarCabecalho(c: Carregada): CabecalhoDemanda {
  const { ag, ticket, sessao, execucoes } = c;
  const viva = situacao(sessao.id);
  const [estado, motivo, desde] = calcular(c, viva);
  const ultima = ultimaDe(c);
  return {
    origem: "demanda",
    sessao: {
      sessao: sessao.id,
      projeto: ag.demanda.projeto,
      modo: sessao.modo,
      execucao: ultima.id,
      ...(ultima.configuracao_agente?.modelo && { modelo: ultima.configuracao_agente.modelo }),
      estado,
      ...(motivo && { motivo }),
      desde,
      dialogos: viva?.dialogos ?? [],
    },
    demanda: ag.demanda.id,
    ...(ticket.rodada_id !== undefined && {
      rodada: formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id }),
    }),
    ticket: formatarTicketRef(ticket),
    etapa: ticket.etapa,
    ...(motivo === "falha" && { erro: ticket.motivo_falha }),
    execucoes,
  };
}

/**
 * Os prompts que a Fabriquinha montou: o da primeira execução e os das autônomas. Os das retomadas interativas são a
 * mensagem do Auditor.
 */
function promptsDaFabriquinha(raiz: string, { sessao, execucoes }: Carregada): Set<string> {
  const arquivos = execucoes
    .filter((e, i) => i === 0 || sessao.modo === "autonomo")
    .map((e) => join(raiz, "execucoes", `E-${e.id}`, "prompt.md"));
  return new Set(arquivos.filter((a) => existsSync(a)).map((a) => readFileSync(a, "utf8")));
}

/** Os Agentes que o Auditor automático fez responder, por chamada de `perguntar`: o gerente os anota no log da execução. */
function atoresDasRespostasAutomaticas(
  raiz: string,
  { execucoes }: Carregada,
): Map<string, RespostaAutomatica["ator"]> {
  const registros = execucoes
    .map((e) => join(raiz, "execucoes", `E-${e.id}`, "log"))
    .filter((log) => existsSync(log))
    .flatMap((log) => readFileSync(log, "utf8").split("\n"))
    .filter((linha) => linha.includes(PREFIXO_DA_RESPOSTA_AUTOMATICA))
    .map(
      (linha) =>
        JSON.parse(
          linha.slice(linha.indexOf(PREFIXO_DA_RESPOSTA_AUTOMATICA) + PREFIXO_DA_RESPOSTA_AUTOMATICA.length),
        ) as RespostaAutomatica,
    );
  return new Map(registros.map((r) => [r.chamada, r.ator]));
}

/**
 * A marca da mensagem: o prompt montado pela Fabriquinha vira linha do sistema no chat; a resposta de `perguntar` leva o
 * `ator` de quem respondeu, o Agente (Auditor automático) ou o Auditor.
 */
function marcador(
  raiz: string,
  c: Carregada,
): (mensagem: unknown) => { fabriquinha: true } | { ator: Ator } | undefined {
  const prompts = promptsDaFabriquinha(raiz, c);
  const automaticas = atoresDasRespostasAutomaticas(raiz, c);
  return (mensagem) => {
    const m = mensagem as (Partial<Mensagem> & { toolCallId?: string }) | undefined;
    if (m?.role === "toolResult" && m.toolName === "perguntar") {
      return { ator: automaticas.get(String(m.toolCallId)) ?? AUDITOR };
    }
    return m?.role === "user" && prompts.has(texto(m as Mensagem)) ? { fabriquinha: true } : undefined;
  };
}

/** O cabeçalho da sessão da demanda; `undefined` se o id não é de uma sessão da demanda. */
export function cabecalhoDaDemanda(banco: DatabaseSync, id: string): CabecalhoDemanda | undefined {
  const ref = donoDaSessao(banco, id);
  return ref && montarCabecalho(carregar(banco, ref, id));
}

/** A conversa do JSONL com o fluxo ao vivo; `undefined` se o id não é de uma sessão da demanda. */
export function abrirChatDemanda(banco: DatabaseSync, id: string): ChatDemanda | undefined {
  const ref = donoDaSessao(banco, id);
  if (!ref) return undefined;
  const raiz = raizDo(banco);
  const c = carregar(banco, ref, id);
  const marcar = marcador(raiz, c);
  return {
    cabecalho: montarCabecalho(c),
    conversa: lerConversa(raiz, id).map((e) => ({
      ...(e as EntradaDemanda),
      ...marcar((e as EntradaDemanda).message),
    })),
    assinar: (ouvinte) =>
      assinar(id, (evento) => {
        if (evento.type === "estado") ouvinte({ type: "estado", ...montarCabecalho(carregar(banco, ref, id)) });
        else if (evento.type === "message_end") {
          ouvinte({ ...evento, ...marcador(raiz, carregar(banco, ref, id))(evento.message) });
        } else ouvinte(evento);
      }),
  };
}

/** O histórico da sessão em Markdown, na ordem da conversa, e o nome do arquivo; `undefined` se o id não é da demanda. */
export function exportarHistoricoDemanda(
  banco: DatabaseSync,
  id: string,
): { nome: string; markdown: string } | undefined {
  const ref = donoDaSessao(banco, id);
  if (!ref) return undefined;
  const raiz = raizDo(banco);
  const c = carregar(banco, ref, id);
  const { ag, ticket } = c;
  const enderecoDoTicket = formatarTicketRef(ticket);
  const mensagens = lerConversa(raiz, id).flatMap((entrada) => {
    const { type, message } = entrada as { type?: string; message?: Mensagem };
    return type === "message" && message ? [message] : [];
  });
  const modelos = new Set(
    mensagens.filter((m) => m.role === "assistant").map((m) => `${String(m.provider)}/${String(m.model)}`),
  );
  const cabecalho = [
    `# Histórico da sessão ${enderecoDoTicket} (${ticket.etapa})`,
    "",
    `- Projeto: ${ag.demanda.projeto}`,
    `- Demanda: ${ag.demanda.id} — ${ag.demanda.titulo}`,
    ...(ticket.rodada_id === undefined
      ? []
      : [`- Rodada: ${formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id })}`]),
    `- Ticket: ${enderecoDoTicket} — ${ticket.titulo ?? ticket.etapa}`,
    `- Etapa: ${ticket.etapa}`,
    `- Modelo: ${[...modelos].join(", ") || "—"}`,
    `- Início: ${ultimaDe(c, "primeira").inicio}`,
    `- Fim: ${ultimaDe(c).fim ?? "em andamento"}`,
  ].join("\n");
  const daFabriquinha = promptsDaFabriquinha(raiz, c);
  return {
    nome: `historico-${enderecoDoTicket}.md`,
    markdown: [cabecalho, ...mensagens.flatMap((m) => emMarkdown(m, daFabriquinha))].join("\n\n") + "\n",
  };
}

/** Envia a mensagem do Auditor; `false` se o id não é de uma sessão da demanda. */
export function enviarDemanda(
  banco: DatabaseSync,
  id: string,
  texto: string,
  modo: ModoEnvio,
  limiteMin: number,
): boolean {
  const ref = donoDaSessao(banco, id);
  if (!ref) return false;
  const c = carregar(banco, ref, id);
  const viva = situacao(id);
  const [estado, motivo] = calcular(c, viva);
  const rotulo = motivo ? `${estado}: ${motivo}` : estado;
  const aceitos: ModoEnvio[] = estado === "rodando" ? ["steer", "follow_up"] : motivo === "conversa" ? ["prompt"] : [];
  if (!aceitos.includes(modo)) {
    throw new ErroDeRegra(
      `a sessão de ${formatarTicketRef(c.ticket)} está ${rotulo} e não recebe ${modo}`,
      aceitos.length > 0 ? `envie com ${aceitos.join(" ou ")}` : SEM_MENSAGEM[motivo ?? estado],
    );
  }
  // Em conversa, o pi vivo está ocioso. A sessão de ajustes retoma pelo caminho dela, que restaura as branches no fim.
  if (estado === "rodando" || viva) mandar(ultimaDe(c).id, { type: modo, message: texto });
  else if (c.ticket.etapa === "sessao_em_aberto") retomarSessaoAjustes(banco, c.ticket, texto, { limiteMin });
  else iniciarExecucaoDemanda(banco, ref, { limiteMin, modo: "interativo", mensagem: texto });
  return true;
}

const SEM_MENSAGEM: Record<string, string> = {
  dialogo: "responda o diálogo aberto pelo agente",
  falha: "reabra o ticket na página da demanda",
  gate_demanda: "decida o gate na página da demanda",
  terminada: "a sessão é só leitura",
};

/** Responde o diálogo `dialogo` do agente; `false` se o id não é de uma sessão da demanda. */
export function responderDialogoDemanda(
  banco: DatabaseSync,
  id: string,
  dialogo: string,
  resposta: Parameters<typeof responderDialogo>[2],
): boolean {
  const ref = donoDaSessao(banco, id);
  if (!ref) return false;
  responderDialogo(ultimaDe(carregar(banco, ref, id)).id, dialogo, resposta);
  return true;
}

/** Aborta a execução em andamento (pi vivo: `abort`; aberta sem pi: interrupção); `false` se o id não é da demanda. */
export function abortarDemanda(banco: DatabaseSync, id: string): boolean {
  const ref = donoDaSessao(banco, id);
  if (!ref) return false;
  const ultima = ultimaDe(carregar(banco, ref, id));
  if (situacao(id)) abortar(ultima.id);
  else if (ultima.fim == null) interromperExecucaoDemanda(banco, ref);
  else throw new ErroDeRegra("não há execução para abortar", "a sessão não está rodando");
  return true;
}
