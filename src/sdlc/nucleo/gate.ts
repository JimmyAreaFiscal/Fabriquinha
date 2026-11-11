// A mecânica comum dos pontos em que o SDLC só avança depois de uma Decisão: cada Gate decide pelo mesmo caminho (valida a
// entrada → localiza o ticket âncora → monta a Decisão → aprova ou reprova). Os efeitos de cada um ficam no `gate.ts` da
// Etapa dona dele, e `etapas/gates.ts` os junta.
// Funções puras (agregado, endereço, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import type { AgregadoDemanda, Decisao, NomeGate, TicketDemanda } from "./demanda/agregado_demanda.ts";
import { type Ator, exigirAtor } from "./ator.ts";
import { ErroDeRegra, existe } from "../../compartilhado/nucleo/erros.ts";
import { type Endereco, ticketAtualDaEtapa } from "./item_de_trabalho/item_de_trabalho.ts";
import {
  type EstadoDemanda,
  type EstadoRodada,
  type EtapaTicket,
  Motivo,
} from "../../compartilhado/nucleo/primitivos.ts";
import type { DefinicaoDaEtapa } from "../../etapas/definicao/definicao_da_etapa.ts";
import { type ContextoDemanda, exigirDemandaDaEntrada } from "./transicoes/transicoes_demanda.ts";
import { rodadaNoEstado, ticketAtivoDaEtapa } from "./transicoes/transicoes_rodada.ts";

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
export type EntradaReprovada = Extract<EntradaDoGate, { resultado: "reprovado" }>;

/** O motivo gravado na aprovação automática do PR da rodada, para a decisão não passar por uma do Auditor. */
export const MOTIVO_APROVACAO_AUTOMATICA_PR =
  "aprovado automaticamente pela Fabriquinha: a revisão da rodada aprovou e o PR não tem conflito nem check falho";

/** A sequência de `decisao_id` é local ao ticket: máximo das decisões dele + 1 (1 sem decisão anterior). */
const proximaDecisaoId = (ag: AgregadoDemanda, ticket: TicketDemanda): number =>
  ag.decisoes.reduce((m, d) => (d.ticket_id === ticket.ticket_id ? Math.max(m, d.decisao_id) : m), 0) + 1;

/** O ticket âncora de um gate que decide na demanda: ela no estado do gate e o ticket atual da etapa. */
export function ancoraNaDemanda(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoDemanda, etapa: EtapaTicket) {
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
export function ancoraNaRodada(ag: AgregadoDemanda, endereco: Endereco, estado: EstadoRodada, etapa: EtapaTicket) {
  const rodada_id = existe(
    endereco.rodada_id,
    `o endereço ${endereco.toString()} não é de uma rodada`,
    "use o endereço da rodada, como I-206.R2",
  );
  const rodada = rodadaNoEstado(ag, { demanda_id: endereco.demanda_id, rodada_id }, estado);
  return ticketAtivoDaEtapa(ag, rodada, etapa);
}

export abstract class Gate {
  readonly nome: NomeGate;
  readonly decisor: "auditor" | "agente";
  /** A etapa do ticket que o gate conclui ao decidir; o endereço do gate aponta a demanda ou a rodada dele. */
  readonly etapaAncora: EtapaTicket;

  /** O nome, o decisor e a âncora são os que a Etapa dona do Gate declara. */
  constructor({ nome: etapa, gate }: DefinicaoDaEtapa) {
    const declarado = existe(gate, `a etapa ${etapa} não declara gate`, "declare o gate na definição da etapa");
    this.nome = declarado.nome;
    this.decisor = declarado.decisor;
    this.etapaAncora = etapa;
  }

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
