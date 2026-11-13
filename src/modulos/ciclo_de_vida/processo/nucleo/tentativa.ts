// A Tentativa: cada execução de uma Etapa de um ticket, com o resultado tipado; a política que decide o que vem depois
// dela (devolver ao agente, retomar sozinha ou bloquear) e o retorno ao agente que a segue.
import { z } from "zod";
import { AUDITOR, CATALOGO_DE_ETAPAS, Endereco, type EtapaTicket, ResultadoDaTentativa } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { Id, Instante, Markdown } from "../../../../shared/nucleo/primitivos.ts";
import type { Modelo } from "../../../sessoes/publico.ts";
import type { EstadoTicket } from "./ciclos/ciclos.ts";

/**
 * `instrucao` só existe na Tentativa que o Auditor abriu ao reabrir o ticket: é a instrução dele e o marco a partir do
 * qual os limites contam de novo. `migrada` marca a Tentativa sintética da migração, sem horários reais.
 */
export const Tentativa = z.object({
  ticket: z.custom<Endereco>((candidato) => candidato instanceof Endereco),
  numero: Id,
  processo_id: z.string().min(1).optional(),
  inicio: Instante,
  fim: Instante.optional(),
  resultado: ResultadoDaTentativa.optional(),
  instrucao: Markdown.optional(),
  migrada: z.literal(true).optional(),
});
export type Tentativa = z.infer<typeof Tentativa>;

type ProximoPasso =
  | { tipo: "devolver_ao_agente" }
  | { tipo: "retomar_automaticamente"; trocarProvedor: boolean; esperaMs: number }
  | { tipo: "bloquear" };

const BLOQUEAR: ProximoPasso = { tipo: "bloquear" };
const ESPERA_INICIAL_MS = 2 * 60_000;

// shortcut: equivalências fixas entre os provedores em uso (a regra do Auditor: cota estourada troca para o outro
// provedor, no mesmo nível); vira configuração do projeto quando entrar outro provedor.
const claudeParaCodex = (nome: string): Modelo => ({
  provedor: "openai-codex",
  nome: nome.includes("opus") ? "gpt-6.1-sol" : "gpt-6-luna",
});
const MODELO_RESERVA: Record<string, (nome: string) => Modelo> = {
  "claude-bridge": claudeParaCodex,
  anthropic: claudeParaCodex,
  "openai-codex": () => ({ provedor: "claude-bridge", nome: "claude-opus-5-5" }),
};

/**
 * A política única das Tentativas: quantas reprovações o agente corrige, quantas falhas de infraestrutura a
 * Fabriquinha retoma sozinha, quanto espera entre elas e qual modelo assume quando a cota do provedor acaba.
 * @testes o teste monta políticas com outros limites; a produção usa só POLITICA_DE_TENTATIVAS
 */
export class PoliticaDeTentativas {
  readonly limites: { reprovacoes: number; falhasDeInfraestrutura: number };

  constructor(limites: { reprovacoes: number; falhasDeInfraestrutura: number }) {
    this.limites = limites;
  }

  /**
   * O que fazer depois da última Tentativa do histórico, que vale desde a reabertura (`desdeAReabertura`). A conta inclui
   * a última: a reprovação só devolve até o limite; a falha de infraestrutura espera 2, 8, 32... minutos e retoma até o
   * limite; o reinício do serviço não conta e retoma na hora; o resto bloqueia para o Auditor.
   */
  proximoPasso(etapa: EtapaTicket, historicoDesdeAReabertura: readonly Tentativa[]): ProximoPasso {
    const ultima = historicoDesdeAReabertura.at(-1)?.resultado;
    if (ultima?.tipo === "reprovacao") {
      const reprovacoes = historicoDesdeAReabertura.filter((t) => t.resultado?.tipo === "reprovacao").length;
      return CATALOGO_DE_ETAPAS[etapa].devolveAoAgente === true && reprovacoes <= this.limites.reprovacoes
        ? { tipo: "devolver_ao_agente" }
        : BLOQUEAR;
    }
    if (ultima?.tipo !== "falha_infraestrutura") return BLOQUEAR;
    if (ultima.causa === "servico_reiniciado") {
      return { tipo: "retomar_automaticamente", trocarProvedor: false, esperaMs: 0 };
    }
    const falhas = historicoDesdeAReabertura.filter(
      (t) => t.resultado?.tipo === "falha_infraestrutura" && t.resultado.causa !== "servico_reiniciado",
    ).length;
    if (falhas > this.limites.falhasDeInfraestrutura) return BLOQUEAR;
    const cotaEsgotada = ultima.causa === "cota";
    return {
      tipo: "retomar_automaticamente",
      trocarProvedor: cotaEsgotada,
      esperaMs: cotaEsgotada ? 0 : ESPERA_INICIAL_MS * 4 ** (falhas - 1),
    };
  }

  /** O modelo do outro provedor para o ticket cuja cota estourou; `undefined` sem modelo resolvido ou sem reserva. */
  modeloReserva(modeloAtual: Modelo | undefined): Modelo | undefined {
    return modeloAtual && MODELO_RESERVA[modeloAtual.provedor]?.(modeloAtual.nome);
  }
}

export const POLITICA_DE_TENTATIVAS = new PoliticaDeTentativas({ reprovacoes: 2, falhasDeInfraestrutura: 3 });

/** As Tentativas do ticket, na ordem em que aconteceram. */
export const tentativasDoTicket = (tentativas: readonly Tentativa[], ticket_id: number): Tentativa[] =>
  tentativas.filter((t) => t.ticket.ticket_id === ticket_id);

/** O histórico que a política lê: o que veio depois da última reabertura do Auditor. */
export const desdeAReabertura = (tentativas: readonly Tentativa[]): Tentativa[] =>
  tentativas.slice(tentativas.findLastIndex((t) => t.instrucao !== undefined) + 1);

/** O ticket como a Tentativa o lê (o agregado é de quem chama). */
interface TicketDaTentativa {
  readonly demanda_id: string;
  readonly ticket_id: number;
  readonly estado_alterado_em: string;
}

const emAberto = (tentativa: Tentativa): boolean => tentativa.fim === undefined;

/**
 * As Tentativas com a execução que começa em `agora`, gravada com o `processo_id` dela. Execução retomada na
 * Tentativa que já está aberta (a sessão interativa volta a rodar) não abre outra.
 */
export function comTentativaAberta(
  tentativas: readonly Tentativa[],
  ticket: TicketDaTentativa,
  processo_id: string,
  agora: string,
): Tentativa[] {
  const doTicket = tentativasDoTicket(tentativas, ticket.ticket_id);
  if (doTicket.some(emAberto)) return [...tentativas];
  const nova = {
    ticket: Endereco.doTicket(ticket.demanda_id, ticket.ticket_id),
    numero: doTicket.length + 1,
    processo_id,
    inicio: agora,
  };
  return [...tentativas, nova];
}

/**
 * As Tentativas com a do ticket encerrada em `agora` com o `resultado`. Sem Tentativa aberta (a etapa não rodou o
 * agente), a que acaba é a execução que começou quando o ticket entrou em execução.
 */
export function comTentativaEncerrada(
  tentativas: readonly Tentativa[],
  ticket: TicketDaTentativa,
  resultado: ResultadoDaTentativa,
  agora: string,
): Tentativa[] {
  const doTicket = tentativasDoTicket(tentativas, ticket.ticket_id);
  const aberta = doTicket.find(emAberto);
  if (aberta) return tentativas.map((t) => (t === aberta ? { ...aberta, fim: agora, resultado } : t));
  const encerrada = {
    ticket: Endereco.doTicket(ticket.demanda_id, ticket.ticket_id),
    numero: doTicket.length + 1,
    inicio: ticket.estado_alterado_em,
    fim: agora,
    resultado,
  };
  return [...tentativas, encerrada];
}

/** A reabertura do Auditor: uma Tentativa dele, com a instrução, aberta e fechada no mesmo instante. */
export function comReaberturaDoAuditor(
  tentativas: readonly Tentativa[],
  ticket: TicketDaTentativa,
  instrucao: string,
  agora: string,
): Tentativa[] {
  const reabertura = {
    ticket: Endereco.doTicket(ticket.demanda_id, ticket.ticket_id),
    numero: tentativasDoTicket(tentativas, ticket.ticket_id).length + 1,
    inicio: agora,
    fim: agora,
    resultado: { tipo: "interrompida" as const, por: AUDITOR },
    instrucao,
  };
  return [...tentativas, reabertura];
}

/** O motivo do ticket que falhou ou foi cancelado: o da última Tentativa; sem ele, quem lê vê só o estado. */
export function motivoDaFalhaDoTicket(
  tentativas: readonly Tentativa[],
  ticket: { readonly ticket_id: number; readonly estado: EstadoTicket },
): string | undefined {
  if (ticket.estado !== "falhou" && ticket.estado !== "cancelado") return undefined;
  const resultado = tentativasDoTicket(tentativas, ticket.ticket_id).at(-1)?.resultado;
  return resultado && "motivo" in resultado ? resultado.motivo : undefined;
}

/** O que o agente lê ao voltar a um ticket: o título da seção do prompt e o texto dela. */
export interface RetornoAoAgente {
  titulo: "Devolução" | "Reabertura";
  texto: string;
}

/**
 * O único montador do retorno ao agente: a Tentativa reprovada devolve o ticket com o motivo dela; qualquer outra o
 * reabre com a instrução do Auditor (ou a que a Tentativa já guarda).
 */
export function montarRetornoAoAgente(anterior: Tentativa, instrucaoDoAuditor?: string): RetornoAoAgente {
  const ticket = anterior.ticket.toString();
  if (anterior.resultado?.tipo === "reprovacao") {
    return {
      titulo: "Devolução",
      texto:
        `O ticket ${ticket} foi devolvido a você: a entrega anterior não passou. ` +
        `Corrija o que o motivo aponta e não refaça o resto.\n\nMotivo: ${anterior.resultado.motivo}`,
    };
  }
  const instrucao = instrucaoDoAuditor ?? anterior.instrucao;
  if (instrucao === undefined) {
    throw new ErroDeRegra(
      `a Tentativa ${String(anterior.numero)} de ${ticket} não tem instrução para reabrir`,
      "informe a instrução do Auditor",
    );
  }
  return {
    titulo: "Reabertura",
    texto: `O Auditor reabriu o ticket ${ticket}. Continue de onde a entrega anterior parou e atenda ao motivo.\n\nMotivo: ${instrucao}`,
  };
}

/** O retorno ao agente do ticket que volta a ser executado: o da última reprovação ou reabertura; ticket novo não tem. */
export function retornoAoAgenteDoTicket(
  tentativas: readonly Tentativa[],
  ticket_id: number,
): RetornoAoAgente | undefined {
  const anterior = tentativasDoTicket(tentativas, ticket_id).findLast(
    (t) => t.resultado?.tipo === "reprovacao" || t.instrucao !== undefined,
  );
  return anterior && montarRetornoAoAgente(anterior);
}

/**
 * A Tentativa anterior de um retorno que não vem de uma Tentativa gravada (a reprovação do plano, que fica nas decisões,
 * e a sessão de ajustes, que não reabre ticket): só o resultado e a instrução são lidos.
 * shortcut: `numero` e `inicio` são marcadores; quem não grava Tentativa não tem os reais.
 */
export function tentativaAnteriorEmMemoria(
  ticket: Endereco,
  { motivoDaReprovacao, instrucao }: { motivoDaReprovacao?: string; instrucao?: string },
): Tentativa {
  const resultado: ResultadoDaTentativa =
    motivoDaReprovacao === undefined
      ? { tipo: "interrompida", por: AUDITOR }
      : { tipo: "reprovacao", motivo: motivoDaReprovacao };
  return { ticket, numero: 0, inicio: "1970-01-01T00:00:00.000Z", resultado, instrucao };
}
