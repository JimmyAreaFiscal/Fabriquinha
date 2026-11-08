// Os cinco pontos em que o SDLC só avança depois de uma Decisão: cada um é uma instância de `Gate`, que decide pelo
// mesmo caminho (valida a entrada → localiza o ticket âncora → monta a Decisão → aprova ou reprova).
// Funções puras (agregado, endereço, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import type { AgregadoDemanda, Decisao, NomeGate, TicketDemanda } from "./agregado_demanda.ts";
import { AUDITOR, type Ator, exigirAtor, FABRIQUINHA } from "./ator.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "./ciclos.ts";
import { materializarCorrecoesRodada, materializarRodadasCorretivas } from "./correcoes_demanda.ts";
import { ErroDeRegra, existe } from "./erros.ts";
import { criarTicket, type Endereco, ticketAtualDaEtapa } from "./item_de_trabalho.ts";
import { type EstadoDemanda, type EstadoRodada, type EtapaTicket, Motivo } from "./primitivos.ts";
import { falhaQueExigeOAuditor } from "./tentativa.ts";
import {
  type ContextoDemanda,
  exigirDemandaDaEntrada,
  exigirSemFalha,
  exigirSemPendencias,
  materializarPlano,
  mudarTicket,
  planoSubmetido,
  reabrirTicket,
  tentativasAposSair,
} from "./transicoes_demanda.ts";
import {
  montarMotivoFalhaDaTerceiraReprovacao,
  REPROVACOES_ATE_O_AUDITOR,
  rodadaNoEstado,
  rodadasComEstadoMudado,
  ticketAtivoDaEtapa,
} from "./transicoes_rodada.ts";

const NOTA = "a nota vai de 1 a 5";
const Nota = z.number({ error: NOTA }).int(NOTA).min(1, NOTA).max(5, NOTA);
const MOTIVO_OBRIGATORIO = "informe o motivo da reprovação";

/** O que o decisor informa: o resultado, a nota e o motivo; as correções só a reprovação de uma revisão traz. */
const EntradaDoGate = z.discriminatedUnion("resultado", [
  z.strictObject({
    resultado: z.literal("aprovado"),
    nota: Nota.optional(),
    motivo: Motivo.optional(),
  }),
  z.strictObject({
    resultado: z.literal("reprovado"),
    nota: Nota.optional(),
    motivo: z
      .string({ error: MOTIVO_OBRIGATORIO })
      .trim()
      .min(1, MOTIVO_OBRIGATORIO)
      .max(2000, "o motivo passa de 2000 caracteres"),
    // Os tickets corretivos da rodada (revisão da rodada) ou o plano das rodadas corretivas (revisão da demanda).
    correcoes: z.unknown().optional(),
  }),
]);
export type EntradaDoGate = z.infer<typeof EntradaDoGate>;
type EntradaReprovada = Extract<EntradaDoGate, { resultado: "reprovado" }>;

/** O motivo gravado na aprovação automática do PR da rodada, para a decisão não passar por uma do Auditor. */
export const MOTIVO_APROVACAO_AUTOMATICA_PR =
  "aprovado automaticamente pela Fabriquinha: a revisão da rodada aprovou e o PR não tem conflito nem check falho";

/** A sequência de `decisao_id` é local ao ticket: máximo das decisões dele + 1 (1 sem decisão anterior). */
const proximaDecisaoId = (ag: AgregadoDemanda, ticket: TicketDemanda): number =>
  ag.decisoes.reduce((m, d) => (d.ticket_id === ticket.ticket_id ? Math.max(m, d.decisao_id) : m), 0) + 1;

/** O ticket âncora de um gate que decide na demanda: ela no estado do gate e o ticket atual da etapa. */
function ancoraNaDemanda(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoDemanda, etapa: EtapaTicket) {
  exigirDemandaDaEntrada(ag, endereco.demanda_id);
  if (ag.demanda.estado !== estado) {
    throw new ErroDeRegra(
      `a demanda ${ag.demanda.id} está em ${ag.demanda.estado} e não espera decisão`,
      `decida só no estado ${estado}`,
    );
  }
  return existe(
    ticketAtualDaEtapa(ag, etapa),
    `a demanda ${ag.demanda.id} não tem ticket de etapa ${etapa}`,
    "confira o estado da demanda",
  );
}

/** O ticket âncora de um gate que decide na rodada: ela no estado do gate e o ticket atual da etapa, ainda ativo. */
function ancoraNaRodada(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoRodada, etapa: EtapaTicket) {
  const rodada_id = existe(
    endereco.rodada_id,
    `o endereço ${endereco.toString()} não é de uma rodada`,
    "use o endereço da rodada, como I-206.R2",
  );
  const rodada = rodadaNoEstado(ag, { demanda_id: endereco.demanda_id, rodada_id }, estado);
  return ticketAtivoDaEtapa(ag, rodada, etapa);
}

abstract class Gate {
  abstract readonly nome: NomeGate;
  abstract readonly decisor: "auditor" | "agente";
  /** A etapa do ticket que o gate conclui ao decidir; o endereço do gate aponta a demanda ou a rodada dele. */
  abstract readonly etapaAncora: EtapaTicket;

  /** O ticket âncora, ou a recusa de quem não pode decidir agora: estado, falha e ticket ativo. */
  abstract ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda;
  /** O que a aprovação faz, com a Decisão já gravada em `ag`. */
  protected abstract aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda;
  /** O que a reprovação faz, com a Decisão já gravada em `ag`. */
  protected abstract aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    entrada: EntradaReprovada,
  ): AgregadoDemanda;

  protected exigirDecisor(ator: Ator): void {
    exigirAtor(ator, `decidir o ${this.nome}`, this.decisor);
  }

  /** D03: só o decisor do gate decide, reprovar exige o motivo e a nota, quando vem, vai de 1 a 5. */
  validarEntrada(entrada: unknown, ator: Ator): EntradaDoGate {
    this.exigirDecisor(ator);
    const lida = EntradaDoGate.safeParse(entrada);
    if (!lida.success) {
      const campos = lida.error.issues.map((i) => [i.path.join("."), i.message].filter(Boolean).join(": "));
      throw new ErroDeRegra(campos.join("; "), "corrija o campo indicado e decida de novo");
    }
    return lida.data;
  }

  /** Ensaio: lança o mesmo erro que `decidir` lançaria, sem gravar nada; o agregado nunca é mutado. */
  ensaiar(ag: AgregadoDemanda, endereco: Endereco, entrada: unknown, ator: Ator, ctx: ContextoDemanda): void {
    this.decidir(ag, endereco, entrada, ator, ctx);
  }

  /** O único montador da Decisão: grava-a no agregado e segue pelo que a aprovação ou a reprovação faz. */
  decidir(
    ag: AgregadoDemanda,
    endereco: Endereco,
    entrada: unknown,
    ator: Ator,
    ctx: ContextoDemanda,
  ): AgregadoDemanda {
    const e = this.validarEntrada(entrada, ator);
    const ticket = this.ancora(ag, endereco);
    const decisao: Decisao = {
      demanda_id: ag.demanda.id,
      ticket_id: ticket.ticket_id,
      decisao_id: proximaDecisaoId(ag, ticket),
      gate: this.nome,
      resultado: e.resultado,
      ...(e.nota !== undefined && { nota: e.nota }),
      ...(e.motivo !== undefined && { motivo: e.motivo }),
      por: ator,
      em: ctx.agora,
    };
    const decidido = { ...ag, decisoes: [...ag.decisoes, decisao] };
    return e.resultado === "aprovado"
      ? this.aoAprovar(decidido, ticket, decisao)
      : this.aoReprovar(decidido, ticket, decisao, e);
  }
}

/** CA-4 e CA-5: o Auditor aprova (vai a `planejar`) ou reprova com motivo (vai a `cancelada`, sem desenho interno). */
class GateDaDemanda extends Gate {
  readonly nome = "gate_demanda";
  readonly decisor = "auditor";
  readonly etapaAncora = "entender_e_desenhar";

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "gate_demanda", this.etapaAncora);
    exigirSemFalha(ag, this.etapaAncora);
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    // Aprovar libera o planejamento: sem o ticket `planejar` aberto a seleção não tem o que despachar.
    const abrirPlanejar = !ag.tickets.some((t) => t.etapa === "planejar");
    return {
      ...concluido,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "planejar", decisao.em),
      tickets: abrirPlanejar
        ? [...concluido.tickets, criarTicket(ag, { etapa: "planejar", criado_por: FABRIQUINHA, agora: decisao.em })]
        : concluido.tickets,
    };
  }

  protected aoReprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    return {
      ...mudarTicket(ag, ticket, "cancelado", decisao.em),
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "cancelada", decisao.em),
    };
  }
}

/** CA-4 a CA-7: o Auditor reprova (volta a `planejar` com o mesmo ticket) ou aprova (materializa o Plano e vai a `em_execucao`). */
class GateDoPlanejamento extends Gate {
  readonly nome = "gate_planejamento";
  readonly decisor = "auditor";
  readonly etapaAncora = "planejar";

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "gate_planejamento", this.etapaAncora);
    planoSubmetido(ag, ticket); // recusa se não há plano submetido
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    exigirSemFalha(ag, this.etapaAncora);
    return materializarPlano(ag, ticket, decisao.em);
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { motivo }: EntradaReprovada,
  ): AgregadoDemanda {
    const reprovada = {
      ...ag,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "planejar", decisao.em),
      tentativas: tentativasAposSair(ag, ticket, { tipo: "interrompida", por: AUDITOR, motivo }, decisao.em),
    };
    // Planejar falhou (serviço reiniciado com o gate aberto): a reprovação o reabre com o motivo.
    return ticket.estado === "falhou"
      ? reabrirTicket(reprovada, { ticket_id: ticket.ticket_id, instrucao: motivo }, AUDITOR, { agora: decisao.em })
      : reprovada;
  }
}

/**
 * CA-6 e CA-7: o Auditor aprova com nota (a rodada vai a `concluida`) ou reprova com motivo (abre `ajustar_resultado`).
 * A Fabriquinha também aprova, sem nota, no projeto que ligou a aprovação automática.
 */
class GateDoPR extends Gate {
  readonly nome = "gate_pr";
  readonly decisor = "auditor";
  readonly etapaAncora = "encerrar_rodada";

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    return ancoraNaRodada(ag, endereco, "gate_pr", this.etapaAncora);
  }

  protected override exigirDecisor(ator: Ator): void {
    exigirAtor(ator, "decidir o gate_pr", "auditor", "fabriquinha");
  }

  override validarEntrada(entrada: unknown, ator: Ator): EntradaDoGate {
    const e = super.validarEntrada(entrada, ator);
    if (ator.tipo === "fabriquinha" && (e.resultado === "reprovado" || e.nota !== undefined)) {
      throw new ErroDeRegra("a Fabriquinha só aprova o PR, e sem nota", "a nota é do Auditor");
    }
    if (ator.tipo === "auditor" && e.resultado === "aprovado" && e.nota === undefined) {
      throw new ErroDeRegra("aprovar o PR exige a nota", "informe a nota de 1 a 5");
    }
    if (e.resultado === "reprovado" && e.nota !== undefined) {
      throw new ErroDeRegra("a reprovação do PR não leva nota", "omita a nota");
    }
    return e;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return { ...concluido, rodadas: rodadasComEstadoMudado(concluido, ticket, "concluida", decisao.em) };
  }

  protected aoReprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, {
          etapa: "ajustar_resultado",
          rodada: ticket.rodada_id,
          criado_por: FABRIQUINHA,
          agora: decisao.em,
        }),
      ],
      rodadas: rodadasComEstadoMudado(concluido, ticket, "ajustar_resultado", decisao.em),
    };
  }
}

/**
 * CA-2 e CA-3: só o agente do ticket `revisar_rodada` atual. Reprovada, as exigências vão inteiras em `motivo` e as
 * correções nascem na mesma operação (volta a `implementar`); aceita, abre `encerrar_rodada` e vai a `encerrar_rodada`.
 * Na terceira reprovação da rodada (as já gravadas mais esta) não há corretivos: o ticket falha e o estado segue em `revisar_rodada`.
 */
class GateDaRevisaoDaRodada extends Gate {
  readonly nome = "gate_revisao_rodada";
  readonly decisor = "agente";
  readonly etapaAncora = "revisar_rodada";

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    return ancoraNaRodada(ag, endereco, "revisar_rodada", this.etapaAncora);
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, {
          etapa: "encerrar_rodada",
          rodada: ticket.rodada_id,
          criado_por: FABRIQUINHA,
          agora: decisao.em,
        }),
      ],
      rodadas: rodadasComEstadoMudado(concluido, ticket, "encerrar_rodada", decisao.em),
    };
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { correcoes }: EntradaReprovada,
  ): AgregadoDemanda {
    const idsDeRevisaoDaRodada = new Set(
      ag.tickets
        .filter((t) => t.rodada_id === ticket.rodada_id && t.etapa === "revisar_rodada")
        .map((t) => t.ticket_id),
    );
    const motivosDasReprovacoes = ag.decisoes
      .filter((d) => idsDeRevisaoDaRodada.has(d.ticket_id) && d.resultado === "reprovado")
      .map((d) => String(d.motivo)); // reprovado sempre tem motivo (invariante do agregado)
    if (motivosDasReprovacoes.length >= REPROVACOES_ATE_O_AUDITOR) {
      const motivo = montarMotivoFalhaDaTerceiraReprovacao(motivosDasReprovacoes.reverse());
      return mudarTicket(ag, ticket, "falhou", decisao.em, {}, falhaQueExigeOAuditor(motivo));
    }
    // Os mesmos erros de correção vazia ou inválida recusam antes de qualquer retorno.
    const base = materializarCorrecoesRodada(
      ag,
      { demanda_id: ticket.demanda_id, rodada_id: ticket.rodada_id },
      correcoes,
      decisao.por,
      decisao.em,
    );
    const concluido = mudarTicket(base, ticket, "concluido", decisao.em);
    return { ...concluido, rodadas: rodadasComEstadoMudado(concluido, ticket, "implementar", decisao.em) };
  }
}

/**
 * CA-13 e CA-14: só o agente do `revisar_demanda` atual. Reprovada, as exigências vão em `motivo` e o plano corretivo
 * cria só rodadas novas (as integradas ficam como estão) e a demanda volta a `em_execucao`; aceita, abre
 * `encerrar_demanda` e vai a `encerrar_demanda`.
 */
class GateDaRevisaoDaDemanda extends Gate {
  readonly nome = "gate_revisao_demanda";
  readonly decisor = "agente";
  readonly etapaAncora = "revisar_demanda";

  ancora(ag: AgregadoDemanda, endereco: Endereco): TicketDemanda {
    const ticket = ancoraNaDemanda(ag, endereco, "revisar_demanda", this.etapaAncora);
    if (!CICLO_DO_TICKET.estaEmAndamento(ticket.estado)) {
      throw new ErroDeRegra(
        `o ticket ${String(ticket.ticket_id)} está ${ticket.estado}`,
        "só ticket aberto ou em execução age",
      );
    }
    exigirSemPendencias(ag, ticket.ticket_id);
    return ticket;
  }

  protected aoAprovar(ag: AgregadoDemanda, ticket: TicketDemanda, decisao: Decisao): AgregadoDemanda {
    const concluido = mudarTicket(ag, ticket, "concluido", decisao.em);
    return {
      ...concluido,
      demanda: CICLO_DA_DEMANDA.mudar(ag.demanda, "encerrar_demanda", decisao.em),
      tickets: [
        ...concluido.tickets,
        criarTicket(ag, { etapa: "encerrar_demanda", criado_por: FABRIQUINHA, agora: decisao.em }),
      ],
    };
  }

  protected aoReprovar(
    ag: AgregadoDemanda,
    ticket: TicketDemanda,
    decisao: Decisao,
    { correcoes }: EntradaReprovada,
  ): AgregadoDemanda {
    // Plano corretivo vazio ou inválido recusa aqui, antes de qualquer retorno.
    const base = materializarRodadasCorretivas(ag, correcoes, decisao.por, decisao.em);
    return {
      ...mudarTicket(base, ticket, "concluido", decisao.em),
      demanda: CICLO_DA_DEMANDA.mudar(base.demanda, "em_execucao", decisao.em),
    };
  }
}

export const GATES: Record<NomeGate, Gate> = {
  gate_demanda: new GateDaDemanda(),
  gate_planejamento: new GateDoPlanejamento(),
  gate_pr: new GateDoPR(),
  gate_revisao_rodada: new GateDaRevisaoDaRodada(),
  gate_revisao_demanda: new GateDaRevisaoDaDemanda(),
};
