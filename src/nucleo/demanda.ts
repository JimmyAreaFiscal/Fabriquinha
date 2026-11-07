// Contratos SDLC puros (comparacao-sdlc-implementacao.md §2.2, §2.3, §4.1 e §7.2): identidades, branches e plano.
import { z } from "zod";
import { ConfiguracaoAgente } from "./configuracao_agente.ts";
import { ErroDeRegra } from "./erros.ts";
import { GrafoDeDependencias } from "./item_de_trabalho.ts";
import { Id, Markdown, Titulo } from "./primitivos.ts";

// Letras + hífen + número (`I-196`): sem `/`, `.`, `..`, espaço ou `-` duplo, e sem colidir `fabriquinha/{demanda}-{rodada}`
// com a branch de outra demanda (uma demanda sempre termina em `-n` com prefixo só de letras).
export const DemandaId = z
  .string()
  .regex(/^[A-Za-z]{1,16}-[1-9][0-9]{0,9}$/, "use letras, hífen e número, como I-196 (sem barra, ponto ou espaço)");
export const CriterioId = z.string().regex(/^CA-[1-9][0-9]*$/, "use o formato CA-n");

export const RodadaRef = z.object({ demanda_id: DemandaId, rodada_id: Id });
export const TicketRef = z.object({ demanda_id: DemandaId, ticket_id: Id });
/** @testes tipo que o teste usa para montar a entrada */
export const TicketIdentidade = TicketRef.extend({ rodada_id: Id.optional() });

export const branchDemanda = (demandaId: string): string => `fabriquinha/${DemandaId.parse(demandaId)}`;
export const branchRodada = (demandaId: string, rodadaId: number): string => {
  const ref = RodadaRef.parse({ demanda_id: demandaId, rodada_id: rodadaId });
  return `fabriquinha/${ref.demanda_id}-${String(ref.rodada_id)}`;
};

const FORMAS = "use `{demanda}.T{n}` para ticket ou `{demanda}.R{n}` para rodada, como I-206.T3 ou I-206.R2";

const formatar = (schema: typeof TicketRef | typeof RodadaRef, ref: unknown, letra: string, campo: string): string => {
  const r = schema.safeParse(ref);
  if (!r.success)
    throw new ErroDeRegra(`referência inválida: ${r.error.issues.map((i) => i.message).join("; ")}`, FORMAS);
  const v = r.data as Record<string, string | number>;
  return `${String(v.demanda_id)}.${letra}${String(v[campo])}`;
};

/** Endereço público do ticket: `I-206.T3`. */
export const formatarTicketRef = (ref: z.infer<typeof TicketRef>): string => formatar(TicketRef, ref, "T", "ticket_id");
/** Endereço público da rodada: `I-206.R2`. */
export const formatarRodadaRef = (ref: z.infer<typeof RodadaRef>): string => formatar(RodadaRef, ref, "R", "rodada_id");

/** Caminho relativo à raiz git: sem absoluto (POSIX ou drive Windows), barra invertida nem segmento `..`. */
export const CaminhoTicket = z
  .string()
  .min(1)
  .refine((c) => !c.startsWith("/") && !/^[A-Za-z]:/.test(c) && !c.includes("\\") && !c.split("/").includes(".."), {
    message: "use caminho relativo à raiz git, sem `/` inicial, drive, `\\` nem `..`",
  });

const Rodada = RodadaRef.extend({
  titulo: Titulo,
  e2e: z.boolean(),
  criterios: z.array(CriterioId).default([]),
  depende: z.array(RodadaRef).default([]),
});
const Ticket = TicketIdentidade.extend({
  titulo: Titulo,
  descricao: Markdown,
  caminhos: z.array(CaminhoTicket).default([]),
  depende: z.array(TicketRef).default([]),
  configuracao_agente: ConfiguracaoAgente.optional(),
});

/** Plano flat de uma demanda: `criterios` são os `CA-n` da demanda; cada rodada e ticket carrega o seu `demanda_id`. */
export const Plano = z
  .object({
    demanda_id: DemandaId,
    criterios: z.array(CriterioId),
    rodadas: z.array(Rodada),
    tickets: z.array(Ticket),
  })
  .superRefine((plano, ctx) => {
    const erro = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    const { demanda_id: demanda } = plano;
    const rodadas = new Set<number>();
    for (const r of plano.rodadas) {
      if (r.demanda_id !== demanda) erro(`a rodada ${String(r.rodada_id)} é de outra demanda (${r.demanda_id})`);
      if (rodadas.has(r.rodada_id)) erro(`a rodada ${String(r.rodada_id)} se repete`);
      rodadas.add(r.rodada_id);
    }
    for (const r of plano.rodadas) {
      for (const c of r.criterios) {
        if (!plano.criterios.includes(c)) erro(`a rodada ${String(r.rodada_id)} cita o ${c}, que a demanda não tem`);
      }
      for (const d of r.depende) {
        if (d.demanda_id !== demanda)
          erro(`a rodada ${String(r.rodada_id)} depende de rodada de outra demanda (${d.demanda_id})`);
        else if (d.rodada_id === r.rodada_id) erro(`a rodada ${String(r.rodada_id)} não pode depender de si mesma`);
        else if (!rodadas.has(d.rodada_id))
          erro(`a rodada ${String(r.rodada_id)} depende da rodada ${String(d.rodada_id)}, que não existe`);
      }
    }
    const cicloDeRodadas = new GrafoDeDependencias(
      plano.rodadas.flatMap((r) => r.depende.map((d): [number, number] => [r.rodada_id, d.rodada_id])),
      "as rodadas",
    ).descreverCiclo();
    if (cicloDeRodadas) erro(cicloDeRodadas);

    const tickets = new Map<number, number | undefined>();
    for (const t of plano.tickets) {
      if (t.demanda_id !== demanda) erro(`o ticket ${String(t.ticket_id)} é de outra demanda (${t.demanda_id})`);
      if (tickets.has(t.ticket_id)) erro(`o ticket ${String(t.ticket_id)} se repete`);
      if (new Set(t.caminhos).size !== t.caminhos.length) erro(`o ticket ${String(t.ticket_id)} repete caminho`);
      if (t.rodada_id !== undefined && !rodadas.has(t.rodada_id))
        erro(`o ticket ${String(t.ticket_id)} está na rodada ${String(t.rodada_id)}, que não existe`);
      tickets.set(t.ticket_id, t.rodada_id);
    }
    for (const r of plano.rodadas) {
      if (!plano.tickets.some((t) => t.rodada_id === r.rodada_id))
        erro(`a rodada ${String(r.rodada_id)} não tem ticket de implementação`);
    }
    for (const t of plano.tickets) {
      for (const d of t.depende) {
        const alvo = tickets.get(d.ticket_id);
        const nome = `o ticket ${String(t.ticket_id)} depende do ${String(d.ticket_id)}`;
        if (d.demanda_id !== demanda) erro(`${nome}, de outra demanda (${d.demanda_id})`);
        else if (d.ticket_id === t.ticket_id) erro(`o ticket ${String(t.ticket_id)} não pode depender de si mesmo`);
        else if (!tickets.has(d.ticket_id)) erro(`${nome}, que não existe`);
        else if (t.rodada_id === undefined || alvo === undefined)
          erro(`${nome}: ticket sem rodada não participa de dependência`);
        else if (t.rodada_id !== alvo) erro(`${nome}, de outra rodada`);
      }
    }
    const cicloDeTickets = new GrafoDeDependencias(
      plano.tickets.flatMap((t) => t.depende.map((d): [number, number] => [t.ticket_id, d.ticket_id])),
      "os tickets",
    ).descreverCiclo();
    if (cicloDeTickets) erro(cicloDeTickets);
  });

export type DemandaId = z.infer<typeof DemandaId>;
export type Plano = z.infer<typeof Plano>;
