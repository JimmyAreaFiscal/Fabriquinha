// Chat das sessões dos tickets da demanda (comparacao-sdlc-implementacao.md §9.1): acha a sessão em `sessao`, calcula o
// estado, monta o cabeçalho com os endereços públicos, abre a conversa com o fluxo ao vivo e exporta o histórico. A
// leitura do JSONL e a mensagem em Markdown servem também à avaliação e à sessão de ajustes.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { AUDITOR, Ator } from "../nucleo/ator.ts";
import type { ModoTrabalho } from "../nucleo/trabalho_agentico.ts";
import type { AgregadoDemanda, TicketDemanda } from "../nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclos.ts";
import { formatarRodadaRef, formatarTicketRef } from "../nucleo/demanda.ts";
import { predecessorasPendentes } from "../nucleo/dependencia_demanda.ts";
import { encontrado, ErroDeRegra } from "../nucleo/erros.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { type Pendencia, pendenciasDaDemanda, type TrabalhoVivo } from "../nucleo/pendencia.ts";
import type { Modelo } from "../nucleo/configuracao_agente.ts";
import type { EtapaTicket, Instante } from "../nucleo/primitivos.ts";
import type { ProcessoDoTrabalho, TrabalhoGerenciado } from "../nucleo/trabalho_agentico.ts";
import { motivoDaFalhaDoTicket } from "../nucleo/tentativa.ts";
import { raizDo } from "../armazenamento/banco.ts";
import { pastasDoProcesso } from "../infra/registro.ts";
import { HarnessPi } from "../infra/agente/harness_pi.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../armazenamento/dependencias_demanda.ts";
import { configuracao } from "../armazenamento/servico.ts";
import {
  carregarTrabalhosDoTicket,
  ticketDoTrabalho,
  trabalhosComTicketDaDemanda,
} from "../armazenamento/trabalho_agentico.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "./execucao_demanda.ts";
import { retomarSessaoAjustes } from "./sessao_ajustes.ts";
import {
  condutor,
  type CondutorDeTrabalhos,
  type Dialogo,
  PREFIXO_DA_RESPOSTA_AUTOMATICA,
  type RespostaAutomatica,
  type Situacao,
} from "./trabalho/condutor.ts";
import type { EventoPi } from "../infra/agente/pi.ts";

/** O estado de uma sessão (F4 §5.2). */
export type Estado = "rodando" | "aguardando_humano" | "terminada";

/** Como a mensagem do Auditor chega ao pi: nova, redirecionando ou enfileirada. */
type ModoEnvio = "prompt" | "steer" | "follow_up";

/** As entradas do JSONL da sessão, divididas só em `\n` (F4 §6.1.2); linha incompleta do fim fica de fora. */
export function lerConversa(raiz: string, sessao: string): unknown[] {
  const arquivo = new HarnessPi().arquivoDaSessao(raiz, sessao);
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

/** A Pendência como o chat a leva: `item` pelo endereço público (D09). */
export type PendenciaDoChat = Omit<Pendencia, "item"> & { item: string };

const pendenciaDoChat = (p: Pendencia): PendenciaDoChat => ({ ...p, item: p.item.toString() });

/** A sessão do ticket da demanda com o estado calculado; `execucao` é o id (uuid) da última execução. */
interface InfoSessaoDemanda {
  sessao: string;
  projeto: string;
  modo: ModoTrabalho;
  execucao: string;
  modelo?: Modelo;
  estado: Estado;
  /** A Pendência que segura a sessão enquanto ela espera o Auditor. */
  pendencia?: PendenciaDoChat;
  desde: Instante;
  dialogos: Dialogo[];
}

/** A execução como o chat a mostra: o motivo da falha é o da Tentativa que ela abriu. */
export type ExecucaoDoChat = ProcessoDoTrabalho & { motivo?: string };

/** O que o Histórico lê da sessão; demanda, rodada e ticket pelo endereço público (D09). */
interface CabecalhoDaSessao {
  origem: "demanda";
  sessao: InfoSessaoDemanda;
  demanda: string;
  rodada?: string;
  ticket: string;
  etapa: EtapaTicket;
  /** O motivo da última Tentativa do ticket, na falha. */
  erro?: string;
  /** As execuções da sessão, em ordem, cada uma com o motivo da Tentativa que ela abriu, se essa falhou. */
  execucoes: ExecucaoDoChat[];
}

/** O que a barra de estado e as linhas do sistema do chat leem: a sessão e as Pendências da demanda dela. */
export interface CabecalhoDemanda extends CabecalhoDaSessao {
  pendencias: PendenciaDoChat[];
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
  sessao: TrabalhoGerenciado;
  execucoes: ProcessoDoTrabalho[];
}

type TicketRef = Pick<TrabalhoGerenciado, "demanda_id" | "ticket_id">;

const ultimaDe = ({ sessao, execucoes }: Carregada, quando: "primeira" | "ultima" = "ultima"): ProcessoDoTrabalho =>
  encontrado(
    quando === "ultima" ? execucoes.at(-1) : execucoes[0],
    `a sessão ${sessao.id} não tem execução`,
    "confira o banco",
  );

function carregar(
  banco: DatabaseSync,
  ref: TicketRef,
  id: string,
  ag = carregarDemanda(banco, ref.demanda_id),
): Carregada {
  const erro = [`a sessão ${id} não existe`, "confira o endereço do chat"] as const;
  const { sessoes, execucoes } = carregarTrabalhosDoTicket(banco, ref);
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
    execucoes: execucoes.filter((e) => e.trabalho_id === id),
  };
}

/**
 * O estado da sessão e desde quando: diálogo pendente espera o Auditor; execução aberta com o pi trabalhando roda;
 * parada, a demanda encerrada (concluída, cancelada, arquivada) termina, o ticket decide (falha, terminada) e a
 * autônoma ainda roda; a interativa espera o Auditor, na conversa ou no gate do plano. Por que espera é a Pendência.
 */
/** @testes o teste exercita direto; a produção a usa só dentro do módulo */
export function estadoEDesdeDaSessao(c: Carregada, viva: Situacao | undefined): [Estado, Instante] {
  const { ag, ticket, sessao } = c;
  const [dialogo] = viva?.dialogos ?? [];
  if (dialogo) return ["aguardando_humano", dialogo.em];
  const ultima = ultimaDe(c);
  if (ultima.fim == null && viva?.ocupado !== false) return ["rodando", viva?.desde ?? ultima.inicio];
  // Sem fim, só o pi ocioso chega aqui, e ele tem `desde`.
  const parada = viva?.desde ?? String(ultima.fim);
  if (CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)) return ["terminada", parada];
  if (ticket.estado === "falhou") return ["aguardando_humano", parada];
  if (ticket.estado === "concluido") return ["terminada", parada];
  if (sessao.modo === "autonomo") return ["rodando", parada];
  return ["aguardando_humano", parada];
}

/**
 * A sessão parada no diálogo (com a pergunta) ou na conversa, que `pendenciasDaDemanda` pede. A do ticket que falhou e a
 * do gate do plano não são: a Pendência delas é o ticket bloqueado e o gate.
 */
function trabalhoVivoDaSessao(
  { ag, ticket }: Carregada,
  viva: Situacao | undefined,
  [estado, desde]: [Estado, Instante],
): TrabalhoVivo | undefined {
  const [dialogo] = viva?.dialogos ?? [];
  const esperaOGate = ticket.estado === "falhou" || ag.demanda.estado === "gate_planejamento";
  if (estado !== "aguardando_humano" || (!dialogo && esperaOGate)) return undefined;
  return {
    ticket: Endereco.doTicket(ag.demanda.id, ticket.ticket_id),
    ...(typeof dialogo?.title === "string" && { pergunta: dialogo.title }),
    desde,
  };
}

/** A Pendência que segura a sessão parada: a do ticket dela (diálogo, conversa ou bloqueio) ou, no plano, o gate. */
function pendenciaDaSessao(
  c: Carregada,
  viva: Situacao | undefined,
  estadoEDesde: [Estado, Instante],
): PendenciaDoChat | undefined {
  if (estadoEDesde[0] !== "aguardando_humano") return undefined;
  const vivo = trabalhoVivoDaSessao(c, viva, estadoEDesde);
  // Agendador ligado: o despacho parado não segura sessão nenhuma.
  const pendencias = pendenciasDaDemanda(c.ag, vivo ? [vivo] : [], c.ag.pull_requests, true);
  const daSessao =
    pendencias.find((p) => p.item.ticket_id === c.ticket.ticket_id) ?? pendencias.find((p) => p.tipo === "gate_humano");
  return pendenciaDoChat(encontrado(daSessao, `a sessão ${c.sessao.id} espera sem Pendência`, "confira o banco"));
}

/** As sessões da demanda paradas no diálogo ou na conversa: o que `pendenciasDaDemanda` pede dos trabalhos vivos. */
function trabalhosVivosDaDemanda(banco: DatabaseSync, ag: AgregadoDemanda): TrabalhoVivo[] {
  const sessoes = trabalhosComTicketDaDemanda(banco, ag.demanda.id);
  return sessoes
    .map((s) => carregar(banco, s, s.id, ag))
    .filter((c) => c.execucoes.length > 0)
    .flatMap((c) => {
      const viva = condutor.situacao(c.sessao.id);
      return trabalhoVivoDaSessao(c, viva, estadoEDesdeDaSessao(c, viva)) ?? [];
    });
}

/** As Pendências da demanda, as mesmas do Início, para o chat mostrar o que a demanda espera do Auditor. */
function pendenciasDoChat(banco: DatabaseSync, ag: AgregadoDemanda): PendenciaDoChat[] {
  const predecessorasSatisfeitas = predecessorasPendentes(predecessorasDaDemanda(banco, ag.demanda.id)).length === 0;
  return pendenciasDaDemanda(
    ag,
    trabalhosVivosDaDemanda(banco, ag),
    ag.pull_requests,
    configuracao(banco).agendadorAtivo,
    { predecessorasSatisfeitas },
  ).map(pendenciaDoChat);
}

function montarCabecalhoDaSessao(c: Carregada): CabecalhoDaSessao {
  const { ag, ticket, sessao, execucoes } = c;
  const viva = condutor.situacao(sessao.id);
  const estadoEDesde = estadoEDesdeDaSessao(c, viva);
  const [estado, desde] = estadoEDesde;
  const pendencia = pendenciaDaSessao(c, viva, estadoEDesde);
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
      ...(pendencia && { pendencia }),
      desde,
      dialogos: viva?.dialogos ?? [],
    },
    demanda: ag.demanda.id,
    ...(ticket.rodada_id !== undefined && {
      rodada: formatarRodadaRef({ demanda_id: ag.demanda.id, rodada_id: ticket.rodada_id }),
    }),
    ticket: formatarTicketRef(ticket),
    etapa: ticket.etapa,
    ...(pendencia?.tipo === "item_bloqueado" && { erro: motivoDaFalhaDoTicket(ag.tentativas, ticket) }),
    execucoes: execucoes.map((e) => {
      const resultado = ag.tentativas.find((t) => t.processo_id === e.id)?.resultado;
      return resultado && "motivo" in resultado && resultado.motivo !== undefined
        ? { ...e, motivo: resultado.motivo }
        : e;
    }),
  };
}

/**
 * Os prompts que a Fabriquinha montou: o da primeira execução e os das autônomas. Os das retomadas interativas são a
 * mensagem do Auditor.
 */
function promptsDaFabriquinha(raiz: string, { sessao, execucoes }: Carregada): Set<string> {
  const arquivos = execucoes
    .filter((e, i) => i === 0 || sessao.modo === "autonomo")
    .map((e) => join(pastasDoProcesso(raiz, e.id).dir, "prompt.md"));
  return new Set(arquivos.filter((a) => existsSync(a)).map((a) => readFileSync(a, "utf8")));
}

const registroDaRespostaAutomatica = new RegExp(`^\\S+ ${PREFIXO_DA_RESPOSTA_AUTOMATICA}(\\{.*\\})$`);

/** Os Agentes que o Auditor automático fez responder, por chamada de `perguntar`: o condutor os anota no log da execução. */
function atoresDasRespostasAutomaticas(
  raiz: string,
  { execucoes }: Carregada,
): Map<string, RespostaAutomatica["ator"]> {
  const registros = execucoes
    .map((e) => pastasDoProcesso(raiz, e.id).log)
    .filter((log) => existsSync(log))
    .flatMap((log) => readFileSync(log, "utf8").split("\n"))
    // Só a linha cujo texto começa com o prefixo é o registro; as livres do condutor citam a pergunta crua do agente.
    .map((linha) => registroDaRespostaAutomatica.exec(linha)?.[1])
    .filter((json) => json !== undefined)
    .map((json) => JSON.parse(json) as RespostaAutomatica)
    .filter((registro) => Ator.safeParse(registro.ator).success);
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
export function cabecalhoDaSessao(banco: DatabaseSync, id: string): CabecalhoDaSessao | undefined {
  const ref = ticketDoTrabalho(banco, id);
  return ref && montarCabecalhoDaSessao(carregar(banco, ref, id));
}

const montarCabecalho = (banco: DatabaseSync, c: Carregada): CabecalhoDemanda => ({
  ...montarCabecalhoDaSessao(c),
  pendencias: pendenciasDoChat(banco, c.ag),
});

/** A conversa do JSONL com o fluxo ao vivo; `undefined` se o id não é de uma sessão da demanda. */
export function abrirChatDemanda(banco: DatabaseSync, id: string): ChatDemanda | undefined {
  const ref = ticketDoTrabalho(banco, id);
  if (!ref) return undefined;
  const raiz = raizDo(banco);
  const c = carregar(banco, ref, id);
  const marcar = marcador(raiz, c);
  return {
    cabecalho: montarCabecalho(banco, c),
    conversa: lerConversa(raiz, id).map((e) => ({
      ...(e as EntradaDemanda),
      ...marcar((e as EntradaDemanda).message),
    })),
    assinar: (ouvinte) =>
      condutor.assinar(id, (evento) => {
        if (evento.type === "estado") ouvinte({ type: "estado", ...montarCabecalho(banco, carregar(banco, ref, id)) });
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
  const ref = ticketDoTrabalho(banco, id);
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
  const ref = ticketDoTrabalho(banco, id);
  if (!ref) return false;
  const c = carregar(banco, ref, id);
  const viva = condutor.situacao(id);
  const estadoEDesde = estadoEDesdeDaSessao(c, viva);
  const [estado] = estadoEDesde;
  const tipoDaPendencia = pendenciaDaSessao(c, viva, estadoEDesde)?.tipo;
  const rotulo = tipoDaPendencia ? `${estado}: ${tipoDaPendencia}` : estado;
  // Diálogo aberto só se responde; sem ele, a Pendência do ticket é a conversa.
  const emConversa = tipoDaPendencia === "dialogo_do_agente" && !viva?.dialogos.length;
  const aceitos: ModoEnvio[] = estado === "rodando" ? ["steer", "follow_up"] : emConversa ? ["prompt"] : [];
  if (!aceitos.includes(modo)) {
    throw new ErroDeRegra(
      `a sessão de ${formatarTicketRef(c.ticket)} está ${rotulo} e não recebe ${modo}`,
      aceitos.length > 0 ? `envie com ${aceitos.join(" ou ")}` : SEM_MENSAGEM[tipoDaPendencia ?? estado],
    );
  }
  // Em conversa, o pi vivo está ocioso. A sessão de ajustes retoma pelo caminho dela, que restaura as branches no fim.
  if (estado === "rodando" || viva) condutor.mandar(ultimaDe(c).id, { type: modo, message: texto });
  else if (c.ticket.etapa === "ajustar_resultado") retomarSessaoAjustes(banco, c.ticket, texto, { limiteMin });
  else iniciarExecucaoDemanda(banco, ref, { limiteMin, modo: "interativo", mensagem: texto });
  return true;
}

const SEM_MENSAGEM: Record<string, string> = {
  dialogo_do_agente: "responda o diálogo aberto pelo agente",
  item_bloqueado: "reabra o ticket na página da demanda",
  gate_humano: "decida o gate na página da demanda",
  terminada: "a sessão é só leitura",
};

/** Responde o diálogo `dialogo` do agente; `false` se o id não é de uma sessão da demanda. */
export function responderDialogoDemanda(
  banco: DatabaseSync,
  id: string,
  dialogo: string,
  resposta: Parameters<CondutorDeTrabalhos["responder"]>[2],
): boolean {
  const ref = ticketDoTrabalho(banco, id);
  if (!ref) return false;
  condutor.responder(ultimaDe(carregar(banco, ref, id)).id, dialogo, resposta);
  return true;
}

/** Aborta a execução em andamento (pi vivo: `abort`; aberta sem pi: interrupção); `false` se o id não é da demanda. */
export function abortarDemanda(banco: DatabaseSync, id: string): boolean {
  const ref = ticketDoTrabalho(banco, id);
  if (!ref) return false;
  const ultima = ultimaDe(carregar(banco, ref, id));
  if (condutor.situacao(id)) condutor.abortar(ultima.id);
  else if (ultima.fim == null) interromperExecucaoDemanda(banco, ref);
  else throw new ErroDeRegra("não há execução para abortar", "a sessão não está rodando");
  return true;
}
