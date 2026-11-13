// Contratos SDLC puros (comparacao-sdlc-implementacao.md §2.2, §2.3, §4.1 e §7.2): identidades. A forma do identificador
// da demanda e as branches são do Repositório, que os usa como pasta e branch do Espaço de Trabalho.
import { z } from "zod";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { Id } from "../../../../../shared/nucleo/primitivos.ts";
import { DemandaId } from "../../../../../shared/nucleo/demanda_id.ts";

export const CriterioId = z.string().regex(/^CA-[1-9][0-9]*$/, "use o formato CA-n");

export const RodadaRef = z.object({ demanda_id: DemandaId, rodada_id: Id });
export const TicketRef = z.object({ demanda_id: DemandaId, ticket_id: Id });
/** @testes tipo que o teste usa para montar a entrada */
export const TicketIdentidade = TicketRef.extend({ rodada_id: Id.optional() });

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
