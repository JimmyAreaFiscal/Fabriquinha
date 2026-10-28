// Chat das sessões dos tickets da demanda (comparacao-sdlc-implementacao.md §9.1): acha a sessão em `sessao`, calcula o
// estado, monta o cabeçalho com os endereços públicos, abre a conversa com o fluxo ao vivo e exporta o histórico. O
// chat das issues (`sessoes.ts`) segue à parte; as rotas tentam esta sessão primeiro e caem naquele caminho.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ModoExecucao } from "../dominio/agregado.ts";
import type { AgregadoDemanda, TicketDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../dominio/demanda.ts";
import { encontrado, ErroDeRegra } from "../dominio/erros.ts";
import type { EtapaTicket, Instante, Modelo } from "../dominio/primitivos.ts";
import type { ExecucaoSessao, Sessao } from "../dominio/sessoes.ts";
import { raizDo } from "../persistencia/banco.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { carregarSessoesDoTicket } from "../persistencia/sessoes.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "./execucao_demanda.ts";
import { abortar, type Dialogo, assinar, mandar, responderDialogo, type Situacao, situacao } from "./gerente.ts";
import { emMarkdown, type Mensagem, texto } from "./historico.ts";
import type { EventoPi } from "./pi.ts";
import { type Estado, lerConversa, type ModoEnvio } from "./sessoes.ts";

export type MotivoDemanda = "conversa" | "dialogo" | "falha" | "gate_demanda";

/** A sessão do ticket da demanda com o estado calculado; `execucao` é o id (uuid) da última execução. */
export interface InfoSessaoDemanda {
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
export type EntradaDemanda = Record<string, unknown> & { fabriquinha?: true };

export interface ChatDemanda {
  cabecalho: CabecalhoDemanda;
  conversa: EntradaDemanda[];
  /** Os eventos ao vivo; `{ type: "estado", ...cabecalho }` traz o cabeçalho novo. Devolve a função que cancela. */
  assinar(ouvinte: (evento: EventoPi) => void): () => void;
}

export interface Carregada {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  sessao: Sessao;
  execucoes: ExecucaoSessao[];
}

type TicketRef = Pick<Sessao, "demanda_id" | "ticket_id">;

/** O ticket dono da sessão; `undefined` se o id não é de uma sessão da demanda (então vale o caminho das issues). */
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
 * O estado da sessão: diálogo pendente espera o Auditor; execução aberta com o pi trabalhando roda; parada, o ticket
 * decide (falha, terminada) e a autônoma ainda roda; a interativa espera a conversa, ou o gate de aprovação do plano.
 */
export function calcular(c: Carregada, viva: Situacao | undefined): Calculado {
  const { ag, ticket, sessao } = c;
  const [dialogo] = viva?.dialogos ?? [];
  if (dialogo) return ["aguardando_humano", "dialogo", dialogo.em];
  const ultima = ultimaDe(c);
  if (ultima.fim == null && viva?.ocupado !== false) return ["rodando", undefined, viva?.desde ?? ultima.inicio];
  // Sem fim, só o pi ocioso chega aqui, e ele tem `desde`.
  const parada = viva?.desde ?? String(ultima.fim);
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
      ...(ultima.modelo_nome && { modelo: { provedor: String(ultima.modelo_provedor), modelo: ultima.modelo_nome } }),
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

/** A marca da mensagem do usuário que é o prompt montado pela Fabriquinha: o chat a mostra como linha do sistema. */
function marcador(raiz: string, c: Carregada): (mensagem: unknown) => { fabriquinha: true } | undefined {
  const prompts = promptsDaFabriquinha(raiz, c);
  return (mensagem) => {
    const m = mensagem as Partial<Mensagem> | undefined;
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
  // Em conversa, o pi vivo está ocioso.
  if (estado === "rodando" || viva) mandar(ultimaDe(c).id, { type: modo, message: texto });
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
