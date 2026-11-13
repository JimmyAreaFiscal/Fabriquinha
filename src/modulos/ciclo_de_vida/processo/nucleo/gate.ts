// A mecânica comum dos pontos em que o SDLC só avança depois de uma Decisão: cada Gate decide pelo mesmo caminho (valida a
// entrada → localiza o ticket âncora → monta a Decisão → aprova ou reprova). Decidir o gate é do Processo; aceitar a
// evidência que o gate lê é de Evidências. Os efeitos de cada Gate ficam no `gate.ts` da Etapa dona dele.
// Funções puras (estado, endereço, entrada, ator, contexto) → estado; o estado de entrada nunca é mutado.
import { z } from "zod";
import {
  Ator,
  DemandaId,
  type DefinicaoDoCatalogo,
  type Endereco,
  type EtapaTicket,
  exigirAtor,
  NomeGate,
} from "../../etapas/publico.ts";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
import { Id, Instante, Motivo } from "../../../../shared/nucleo/primitivos.ts";

/** A Decisão sabe de qual gate é: o resultado, a nota e o motivo que o decisor informou. */
export const Decisao = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  decisao_id: Id,
  gate: NomeGate,
  resultado: z.enum(["aprovado", "reprovado"]),
  nota: z.number().int().min(1).max(5).optional(),
  motivo: Motivo.optional(),
  por: Ator,
  em: Instante,
});
export type Decisao = z.infer<typeof Decisao>;

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

/** O que o Gate lê e grava no estado do desenvolvimento: a demanda, pelo id, e as Decisões dela. */
interface EstadoQueOGateDecide {
  readonly demanda: { readonly id: string };
  readonly decisoes: readonly Decisao[];
}

/** O ticket âncora, pelo id. */
interface TicketAncora {
  readonly ticket_id: number;
}

/** A sequência de `decisao_id` é local ao ticket: máximo das decisões dele + 1 (1 sem decisão anterior). */
const proximaDecisaoId = (estado: EstadoQueOGateDecide, ticket: TicketAncora): number =>
  estado.decisoes.reduce((maior, d) => (d.ticket_id === ticket.ticket_id ? Math.max(maior, d.decisao_id) : maior), 0) +
  1;

export abstract class Gate<Estado extends EstadoQueOGateDecide, Ticket extends TicketAncora> {
  readonly nome: NomeGate;
  readonly decisor: "auditor" | "agente";
  /** A etapa do ticket que o gate conclui ao decidir; o endereço do gate aponta a demanda ou a rodada dele. */
  readonly etapaAncora: EtapaTicket;

  /** O nome, o decisor e a âncora são os que a Etapa dona do Gate declara. */
  constructor({ nome: etapa, gate }: DefinicaoDoCatalogo) {
    const declarado = existe(gate, `a etapa ${etapa} não declara gate`, "declare o gate na definição da etapa");
    this.nome = declarado.nome;
    this.decisor = declarado.decisor;
    this.etapaAncora = etapa;
  }

  /** O ticket âncora, ou a recusa de quem não pode decidir agora: estado, falha e ticket ativo. */
  abstract ancora(estado: Estado, endereco: Endereco): Ticket;
  /** O que a aprovação faz, com a Decisão já gravada em `estado`. */
  protected abstract aoAprovar(estado: Estado, ticket: Ticket, decisao: Decisao): Estado;
  /** O que a reprovação faz, com a Decisão já gravada em `estado`. */
  protected abstract aoReprovar(estado: Estado, ticket: Ticket, decisao: Decisao, entrada: EntradaReprovada): Estado;

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

  /** Ensaio: lança o mesmo erro que `decidir` lançaria, sem gravar nada; o estado nunca é mutado. */
  ensaiar(estado: Estado, endereco: Endereco, entrada: unknown, ator: Ator, ctx: { readonly agora: Instante }): void {
    this.decidir(estado, endereco, entrada, ator, ctx);
  }

  /** O único montador da Decisão: grava-a no estado e segue pelo que a aprovação ou a reprovação faz. */
  decidir(estado: Estado, endereco: Endereco, entrada: unknown, ator: Ator, ctx: { readonly agora: Instante }): Estado {
    const e = this.validarEntrada(entrada, ator);
    const ticket = this.ancora(estado, endereco);
    const decisao: Decisao = {
      demanda_id: estado.demanda.id,
      ticket_id: ticket.ticket_id,
      decisao_id: proximaDecisaoId(estado, ticket),
      gate: this.nome,
      resultado: e.resultado,
      ...(e.nota !== undefined && { nota: e.nota }),
      ...(e.motivo !== undefined && { motivo: e.motivo }),
      por: ator,
      em: ctx.agora,
    };
    const decidido = { ...estado, decisoes: [...estado.decisoes, decisao] };
    return e.resultado === "aprovado"
      ? this.aoAprovar(decidido, ticket, decisao)
      : this.aoReprovar(decidido, ticket, decisao, e);
  }
}
