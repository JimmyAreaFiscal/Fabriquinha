// O Despacho (CONCEITOS.md §9): a regra única do que roda agora. Seleciona os prontos, ordena, respeita o limite de
// paralelismo e diz, para cada item parado, por que não foi despachado. Pura: a aplicação monta a situação e reserva.
import { z } from "zod";
import { type AgregadoDemanda, NomeGate, type TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { etapaDoEstado } from "../../fluxo/nucleo/ciclo_de_vida/ciclos.ts";
import { Endereco, estaOcupado, GrafoDeDependencias } from "../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { Motivo, motivo, type EstadoRodada } from "../../compartilhado/nucleo/primitivos.ts";
import { motivoDaFalhaDoTicket, tentativasDoTicket } from "./tentativa.ts";
import { podeTentarEncerramento } from "../../fluxo/nucleo/transicoes/transicoes_encerramento.ts";

const ehEndereco = z.custom<Endereco>((candidato) => candidato instanceof Endereco);

/** Por que um item não foi despachado; o Auditor o vê, em vez de só o log do serviço. */
/** @testes o teste confere cada motivo; a produção o usa pelo tipo `MotivoDeRecusa` */
export const MotivoDeRecusa = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("limite_de_paralelismo"), em_uso: z.number().int(), limite: z.number() }),
  z.object({ tipo: z.literal("dependencia_pendente"), aguarda: z.array(ehEndereco) }),
  z.object({ tipo: z.literal("gate_aguardando"), gate: NomeGate }),
  z.object({ tipo: z.literal("ocupado"), por: ehEndereco }),
  z.object({ tipo: z.literal("bloqueado"), motivo: Motivo }),
  z.object({ tipo: z.literal("aguarda_acao_externa") }),
]);
export type MotivoDeRecusa = z.infer<typeof MotivoDeRecusa>;

/** Uma demanda em andamento com os ids das predecessoras que ainda não satisfazem a Dependência. */
export interface DemandaParaDespacho {
  agregado: AgregadoDemanda;
  predecessoras_pendentes: readonly string[];
}

/** O que o Despacho lê: as demandas em andamento e os tickets com trabalho vivo (execução aberta), num snapshot só. */
export interface SituacaoDoDespacho {
  demandas: readonly DemandaParaDespacho[];
  vivos: readonly Endereco[];
}

/** O ticket que pode rodar agora. */
type ItemPronto = TicketDemanda;

export interface ResultadoDoDespacho {
  prontos: ItemPronto[];
  recusas: Map<Endereco, MotivoDeRecusa>;
}

type Recusar = (ticket: TicketDemanda, motivoDaRecusa: MotivoDeRecusa) => void;

// Rodada nesses estados espera gente (o Gate do PR e a sessão de ajustes): o Despacho não despacha o ticket dela.
const ESTADOS_QUE_ESPERAM_GENTE: readonly EstadoRodada[] = ["gate_pr", "ajustar_resultado"];

const enderecoDoTicket = (t: TicketDemanda): Endereco => Endereco.doTicket(t.demanda_id, t.ticket_id);

/** `recusas` é indexado pela instância de `Endereco`; quem procura um item usa esta busca pelo endereço público. */
export const motivoDeRecusaDoItem = (
  recusas: ReadonlyMap<Endereco, MotivoDeRecusa>,
  item: Endereco,
): MotivoDeRecusa | undefined => [...recusas].find(([endereco]) => endereco.toString() === item.toString())?.[1];

const menorAberto = (ag: AgregadoDemanda, etapa: TicketDemanda["etapa"] | undefined): TicketDemanda[] =>
  ag.tickets
    .filter((t) => t.etapa === etapa && t.estado === "aberto")
    .sort((a, b) => a.ticket_id - b.ticket_id)
    .slice(0, 1);

const estaVivo = (vivos: readonly Endereco[], t: TicketDemanda): boolean =>
  vivos.some((v) => v.demanda_id === t.demanda_id && v.ticket_id === t.ticket_id);

const decisaoMaisRecente = (ag: AgregadoDemanda, t: TicketDemanda) =>
  ag.decisoes.filter((d) => d.ticket_id === t.ticket_id).at(-1);

const ehPlanejamentoReprovado = (ag: AgregadoDemanda, t: TicketDemanda): boolean =>
  t.etapa === "planejar" && decisaoMaisRecente(ag, t)?.resultado === "reprovado";

/**
 * O `planejar` reprovado em execução, sem trabalho vivo e sem Tentativa nova desde a última recusa, é pronto como os
 * outros: a retomada abre a Tentativa seguinte, e é ela que o tira daqui (o agente que sai sem submeter não retoma em laço).
 */
function aguardaRetomada(ag: AgregadoDemanda, t: TicketDemanda, vivos: readonly Endereco[]): boolean {
  const recusa = decisaoMaisRecente(ag, t);
  if (t.etapa !== "planejar" || t.estado !== "em_execucao" || recusa?.resultado !== "reprovado" || estaVivo(vivos, t)) {
    return false;
  }
  return !tentativasDoTicket(ag.tentativas, t.ticket_id).some((x) => Date.parse(x.inicio) >= Date.parse(recusa.em));
}

function prontosDoPlanejamento(
  { agregado: ag, predecessoras_pendentes: pendentes }: DemandaParaDespacho,
  vivos: readonly Endereco[],
  recusar: Recusar,
): TicketDemanda[] {
  const [aberto] = menorAberto(ag, "planejar");
  const retomado = ag.tickets.find((t) => aguardaRetomada(ag, t, vivos));
  const prontos = retomado ? [retomado] : [];
  if (aberto === undefined) return prontos;
  if (pendentes.length === 0) return [aberto, ...prontos];
  recusar(aberto, { tipo: "dependencia_pendente", aguarda: pendentes.map((id) => Endereco.daDemanda(id)) });
  return prontos;
}

function prontosDoEncerramento(ag: AgregadoDemanda, recusar: Recusar): TicketDemanda[] {
  const encerrar = podeTentarEncerramento(ag) ? menorAberto(ag, "encerrar_demanda") : [];
  // O agendador relê o PR a cada ciclo; o Auditor, não: a ação dele é o merge na plataforma.
  if (ag.encerramento?.aguardando_merge_humano) {
    for (const t of encerrar) recusar(t, { tipo: "aguarda_acao_externa" });
  }
  return [...encerrar, ...menorAberto(ag, "resolver_conflito")];
}

/** Em `em_execucao`, um ticket por rodada livre: a rodada sem Dependência pendente e sem ticket ocupando-a. */
function prontosDaExecucao(ag: AgregadoDemanda, recusar: Recusar): TicketDemanda[] {
  const { id: demandaId } = ag.demanda;
  const ticketConcluido = (ticketId: number) =>
    ag.tickets.some((t) => t.ticket_id === ticketId && t.estado === "concluido");
  const rodadaConcluida = (rodadaId: number) =>
    ag.rodadas.some((r) => r.rodada_id === rodadaId && r.estado === "concluida");
  const dependenciasDosTickets = GrafoDeDependencias.dosTickets(ag);
  const dependenciasDasRodadas = GrafoDeDependencias.dasRodadas(ag);
  const ticketOcupandoARodada = (rodadaId: number | undefined) =>
    ag.tickets.find((t) => t.rodada_id === rodadaId && estaOcupado(ag, enderecoDoTicket(t)));
  const ticketOcupandoADemanda = ticketOcupandoARodada(undefined);
  return ag.rodadas.flatMap((rodada) => {
    const abertos = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.estado === "aberto");
    if (ESTADOS_QUE_ESPERAM_GENTE.includes(rodada.estado)) {
      for (const t of abertos) recusar(t, { tipo: "gate_aguardando", gate: "gate_pr" });
      return [];
    }
    const etapa = etapaDoEstado(rodada.estado);
    const rodadasPendentes = dependenciasDasRodadas
      .pendentes(rodada.rodada_id, rodadaConcluida)
      .map((rodadaId) => Endereco.daRodada(demandaId, rodadaId));
    const ticketOcupandoARodadaAtual = ticketOcupandoARodada(rodada.rodada_id);
    const impedimentoDoTicket = (t: TicketDemanda): MotivoDeRecusa | undefined => {
      if (ticketOcupandoADemanda) return { tipo: "ocupado", por: enderecoDoTicket(ticketOcupandoADemanda) };
      const aguarda = [
        ...dependenciasDosTickets.pendentes(t.ticket_id, ticketConcluido).map((id) => Endereco.doTicket(demandaId, id)),
        ...rodadasPendentes,
      ];
      if (aguarda.length > 0) return { tipo: "dependencia_pendente", aguarda };
      if (ticketOcupandoARodadaAtual) return { tipo: "ocupado", por: enderecoDoTicket(ticketOcupandoARodadaAtual) };
      return undefined;
    };
    const livres = abertos
      .filter((t) => t.etapa === etapa)
      .filter((t) => {
        const impedimento = impedimentoDoTicket(t);
        if (impedimento) recusar(t, impedimento);
        return impedimento === undefined;
      });
    return livres.sort((a, b) => a.ticket_id - b.ticket_id).slice(0, 1);
  });
}

function avaliarDemanda(demanda: DemandaParaDespacho, vivos: readonly Endereco[], recusar: Recusar): TicketDemanda[] {
  const { agregado: ag } = demanda;
  for (const t of ag.tickets.filter((x) => x.estado === "falhou")) {
    const causa = motivoDaFalhaDoTicket(ag.tentativas, t);
    recusar(t, {
      tipo: "bloqueado",
      motivo: motivo(causa === undefined ? "Tentativas esgotadas" : `Tentativas esgotadas: ${causa}`),
    });
  }
  switch (ag.demanda.estado) {
    case "planejar":
      return prontosDoPlanejamento(demanda, vivos, recusar);
    case "revisar_demanda":
      return ag.rodadas.every((r) => r.estado === "concluida") ? menorAberto(ag, "revisar_demanda") : [];
    case "encerrar_demanda":
      return prontosDoEncerramento(ag, recusar);
    case "em_execucao":
      return prontosDaExecucao(ag, recusar);
    default:
      return [];
  }
}

/** Ocupa vaga do limite o ticket em execução, menos o que espera gente e o `planejar` reprovado sem trabalho vivo. */
function ocupaVaga(ag: AgregadoDemanda, t: TicketDemanda, vivos: readonly Endereco[]): boolean {
  const rodadaEmGate = ag.rodadas.some((r) => r.rodada_id === t.rodada_id && r.estado === "gate_pr");
  return (
    t.estado === "em_execucao" &&
    t.etapa !== "ajustar_resultado" &&
    !(t.etapa === "encerrar_rodada" && rodadaEmGate) &&
    !(ehPlanejamentoReprovado(ag, t) && !estaVivo(vivos, t))
  );
}

const numeroDaDemanda = (id: string): [number, string] => {
  const i = id.lastIndexOf("-");
  return [Number(id.slice(i + 1)), id.slice(0, i)];
};

/** Por demanda (número, depois prefixo), rodada e ticket. */
function porDemandaRodadaETicket(a: TicketDemanda, b: TicketDemanda): number {
  const [na, pa] = numeroDaDemanda(a.demanda_id);
  const [nb, pb] = numeroDaDemanda(b.demanda_id);
  return na - nb || pa.localeCompare(pb) || (a.rodada_id ?? 0) - (b.rodada_id ?? 0) || a.ticket_id - b.ticket_id;
}

export class Despacho {
  private readonly limiteDeParalelismo: number;

  /** Sem limite, só a seleção importa: é o que a reserva, a Pendência e a página da demanda precisam. */
  constructor(limiteDeParalelismo: number = Number.POSITIVE_INFINITY) {
    this.limiteDeParalelismo = limiteDeParalelismo;
  }

  /** Seleciona os prontos, ordena e corta no limite; o resto vai a `recusas` com o motivo. */
  selecionar({ demandas, vivos }: SituacaoDoDespacho): ResultadoDoDespacho {
    const recusas = new Map<Endereco, MotivoDeRecusa>();
    const recusar: Recusar = (ticket, motivoDaRecusa) => recusas.set(enderecoDoTicket(ticket), motivoDaRecusa);
    const selecionados = demandas
      .flatMap((demanda) => avaliarDemanda(demanda, vivos, recusar))
      .sort(porDemandaRodadaETicket);
    const emUso = demandas.reduce(
      (total, { agregado }) => total + agregado.tickets.filter((t) => ocupaVaga(agregado, t, vivos)).length,
      0,
    );
    const vagas = Math.max(0, this.limiteDeParalelismo - emUso);
    for (const excedente of selecionados.slice(vagas)) {
      recusar(excedente, { tipo: "limite_de_paralelismo", em_uso: emUso, limite: this.limiteDeParalelismo });
    }
    return { prontos: selecionados.slice(0, vagas), recusas };
  }
}

/** A situação de uma demanda só, para quem sabe apenas se as predecessoras estão satisfeitas, não quais faltam. */
export const situacaoDeUmaDemanda = (
  agregado: AgregadoDemanda,
  predecessorasSatisfeitas: boolean,
): SituacaoDoDespacho => ({
  // shortcut: sem a lista das predecessoras, o id da própria demanda marca a pendência; passa a lista real quando o chamador a tiver.
  demandas: [{ agregado, predecessoras_pendentes: predecessorasSatisfeitas ? [] : [agregado.demanda.id] }],
  vivos: [],
});

/**
 * O que o Auditor pode mandar executar agora: o ticket aberto, sem ação externa à espera. A retomada do planejamento
 * (ticket em execução) é do agendador, e o merge do PR final é do humano, na plataforma.
 */
export const prontosParaExecutarAgora = ({ prontos, recusas }: ResultadoDoDespacho): ItemPronto[] =>
  prontos.filter((t) => t.estado === "aberto" && motivoDeRecusaDoItem(recusas, enderecoDoTicket(t)) === undefined);
