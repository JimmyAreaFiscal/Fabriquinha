// Contratos SDLC puros (comparacao-sdlc-implementacao.md §2.2, §2.3, §4.1 e §7.2): identidades e branches.
import { z } from "zod";
import { ErroDeRegra } from "../erros.ts";
import { Id } from "../primitivos.ts";

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
export const CaminhoPrevisto = z
  .string()
  .min(1)
  .refine((c) => !c.startsWith("/") && !/^[A-Za-z]:/.test(c) && !c.includes("\\") && !c.split("/").includes(".."), {
    message: "use caminho relativo à raiz git, sem `/` inicial, drive, `\\` nem `..`",
  });

export type DemandaId = z.infer<typeof DemandaId>;
