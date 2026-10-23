// Ciclo da rodada (comparacao-sdlc-implementacao.md §4): implementações concluídas, revisão e conferência técnica do PR.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { type Ator, exigirFabriquinha } from "./agregado.ts";
import type { AgregadoDemanda, DecisaoDemanda, RodadaDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { materializarCorrecoesRodada } from "./correcoes_demanda.ts";
import { DemandaId } from "./demanda.ts";
import { ErroDeEscopo, ErroDeRegra, existe } from "./erros.ts";
import { type EtapaTicket, type FaseRodada, Id, type Instante, Motivo } from "./primitivos.ts";
import type { ContextoDemanda } from "./transicoes_demanda.ts";

const RodadaRef = { demanda_id: DemandaId, rodada_id: Id };
const TicketRef = { ...RodadaRef, ticket_id: Id };

const EntradaConclusao = z.strictObject(RodadaRef);
const EntradaRevisao = z.discriminatedUnion("aprovado", [
  z.strictObject({ ...TicketRef, aprovado: z.literal(true) }),
  z.strictObject({ ...TicketRef, aprovado: z.literal(false), exigencias: Motivo, correcoes: z.array(z.unknown()) }),
]);
// Sem defaults: fato ausente nunca vira "sem problema".
const EntradaConferencia = z.strictObject({
  ...TicketRef,
  documentacao_entregue: z.boolean(),
  conflito: z.boolean(),
  check_falho: z.boolean(),
  correcoes: z.array(z.unknown()).optional(),
});

const maximo = (ns: number[]): number => ns.reduce((m, n) => Math.max(m, n), 0);

function rodadaEmFase(ag: AgregadoDemanda, ref: { demanda_id: string; rodada_id: number }, fase: FaseRodada) {
  const { demanda } = ag;
  if (ref.demanda_id !== demanda.id) {
    throw new ErroDeRegra(
      `a referência é da demanda ${ref.demanda_id}, não da ${demanda.id}`,
      "use o demanda_id certo",
    );
  }
  if (demanda.fase !== "execucao") {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} está em ${demanda.fase}`,
      "só a demanda em execucao tem ciclo de rodada",
    );
  }
  const rodada = existe(
    ag.rodadas.find((r) => r.rodada_id === ref.rodada_id),
    `a rodada ${String(ref.rodada_id)} não existe na demanda ${demanda.id}`,
    "use uma rodada da demanda",
  );
  if (rodada.fase !== fase) {
    throw new ErroDeRegra(`a rodada ${String(rodada.rodada_id)} está em ${rodada.fase}`, `só na fase ${fase}`);
  }
  return rodada;
}

/** O ticket atual da etapa na rodada (o de maior ID), que precisa ser o citado e estar aberto ou em execução. */
function ticketAtual(ag: AgregadoDemanda, rodada: RodadaDemanda, etapa: EtapaTicket, ticket_id: number): TicketDemanda {
  const da_etapa = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === etapa);
  const atual = da_etapa.find((t) => t.ticket_id === maximo(da_etapa.map((x) => x.ticket_id)));
  if (atual?.ticket_id !== ticket_id) {
    throw new ErroDeRegra(
      `o ticket ${String(ticket_id)} não é o ${etapa} atual da rodada ${String(rodada.rodada_id)}`,
      "use o ticket atual da etapa",
    );
  }
  if (atual.status !== "aberto" && atual.status !== "em_execucao") {
    throw new ErroDeRegra(`o ticket ${String(ticket_id)} está ${atual.status}`, "só ticket aberto ou em execução age");
  }
  return atual;
}

const novoTicket = (
  ag: AgregadoDemanda,
  rodada: RodadaDemanda,
  etapa: EtapaTicket,
  agora: Instante,
): TicketDemanda => ({
  demanda_id: ag.demanda.id,
  ticket_id: maximo(ag.tickets.map((t) => t.ticket_id)) + 1,
  rodada_id: rodada.rodada_id,
  etapa,
  status: "aberto",
  status_alterado_em: agora,
});

const concluir = (ag: AgregadoDemanda, alvo: TicketDemanda, agora: Instante): TicketDemanda[] =>
  ag.tickets.map((t) =>
    t.ticket_id === alvo.ticket_id ? { ...t, status: "concluido", status_alterado_em: agora } : t,
  );

const comFase = (ag: AgregadoDemanda, rodada: RodadaDemanda, fase: FaseRodada): RodadaDemanda[] =>
  ag.rodadas.map((r) => (r.rodada_id === rodada.rodada_id ? { ...r, fase } : r));

/** CA-1: todas as implementações `concluido` (processo encerrado não conta) levam a rodada a `revisao`, com um `revisar_rodada` novo. */
export function concluirImplementacoesRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirFabriquinha(ator, "concluir as implementações da rodada");
  const e = EntradaConclusao.parse(entrada);
  const rodada = rodadaEmFase(ag, e, "desenvolvimento");
  const impl = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id && t.etapa === "implementar");
  if (impl.length === 0) {
    throw new ErroDeRegra(
      `a rodada ${String(rodada.rodada_id)} não tem ticket de implementar`,
      "não há o que concluir",
    );
  }
  const pendente = impl.find((t) => t.status !== "concluido");
  if (pendente) {
    throw new ErroDeRegra(
      `o ticket ${String(pendente.ticket_id)} está ${pendente.status}`,
      "todas as implementações da rodada precisam estar concluído",
    );
  }
  return {
    ...ag,
    tickets: [...ag.tickets, novoTicket(ag, rodada, "revisar_rodada", ctx.agora)],
    rodadas: comFase(ag, rodada, "revisao"),
  };
}

/**
 * CA-2 e CA-3: só o agente do ticket `revisar_rodada` atual. Reprovada, as exigências vão inteiras em `motivo` e as
 * correções nascem na mesma operação (volta a `desenvolvimento`); aprovada, abre `encerrar_rodada` e vai a `encerramento`.
 */
export function registrarRevisaoRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  const e = EntradaRevisao.parse(entrada);
  const rodada = rodadaEmFase(ag, e, "revisao");
  const ticket = ticketAtual(ag, rodada, "revisar_rodada", e.ticket_id);
  if (ator.tipo !== "agente" || ator.ticket !== ticket.ticket_id) {
    throw new ErroDeEscopo("só o agente do ticket revisar_rodada atual decide a revisão", "peça à sessão de revisão");
  }
  const decisao: DecisaoDemanda = {
    demanda_id: ag.demanda.id,
    ticket_id: ticket.ticket_id,
    decisao_id: 1, // o ticket revisor decide uma vez só: a decisão o conclui
    resultado: e.aprovado ? "aprovado" : "recusado",
    ...(!e.aprovado && { motivo: e.exigencias }),
    por: "agente",
    em: ctx.agora,
  };
  // Os mesmos erros de correção vazia ou inválida recusam antes de qualquer retorno.
  const base = e.aprovado ? ag : materializarCorrecoesRodada(ag, e, e.correcoes, ctx.agora);
  const fechado: AgregadoDemanda = {
    ...base,
    tickets: concluir(base, ticket, ctx.agora),
    decisoes: [...ag.decisoes, decisao],
  };
  return {
    ...fechado,
    ...(e.aprovado && { tickets: [...fechado.tickets, novoTicket(ag, rodada, "encerrar_rodada", ctx.agora)] }),
    rodadas: comFase(fechado, rodada, e.aprovado ? "encerramento" : "desenvolvimento"),
  };
}

/**
 * CA-4 e CA-5: a Fabriquinha confere o PR depois da documentação, com fatos explícitos. Com conflito ou check falho exige
 * correções, conclui a etapa técnica e volta a `desenvolvimento` sem decisão humana; sem problema, vai a
 * `aprovacao_pull_request` e o `encerrar_rodada` segue como âncora do gate.
 */
export function conferirPullRequestRodada(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirFabriquinha(ator, "conferir o PR da rodada");
  const e = EntradaConferencia.parse(entrada);
  const rodada = rodadaEmFase(ag, e, "encerramento");
  const ticket = ticketAtual(ag, rodada, "encerrar_rodada", e.ticket_id);
  if (!e.documentacao_entregue) {
    throw new ErroDeRegra("a documentação ainda não foi entregue", "confira o PR só depois da entrega");
  }
  if (!e.conflito && !e.check_falho) {
    if (e.correcoes !== undefined) {
      throw new ErroDeRegra("o PR sem conflito nem check falho não leva correções", "omita as correções");
    }
    return { ...ag, rodadas: comFase(ag, rodada, "aprovacao_pull_request") };
  }
  const base = materializarCorrecoesRodada(ag, e, e.correcoes ?? [], ctx.agora);
  return { ...base, tickets: concluir(base, ticket, ctx.agora), rodadas: comFase(base, rodada, "desenvolvimento") };
}
