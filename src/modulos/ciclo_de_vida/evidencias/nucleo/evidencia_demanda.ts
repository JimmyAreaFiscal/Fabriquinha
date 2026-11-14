// A Evidência registrada, de qualquer dono da demanda SDLC (comparacao-sdlc-implementacao.md §7.4; CONCEITOS.md §5).
// `dados` segue opaco aqui: o schema de cada tipo é o de `formatos.ts`. Os tipos da demanda são os que a Etapa dela declara.
import { z } from "zod";
import { Ator, OBRIGATORIAS_DEMANDA, TipoEvidencia } from "../../etapas/publico.ts";
import { DemandaId } from "../../../../shared/nucleo/demanda/demanda_id.ts";
import { Id, Instante } from "../../../../shared/nucleo/primitivos.ts";

/** Dono opcional: nulo e omitido viram `undefined`, a única representação interna (CA-11). */
const IdDono = Id.nullish().transform((v) => v ?? undefined);

/** Evidência de qualquer dono: `rodada_id` e `ticket_id` nulos indicam a própria demanda; `dados` segue opaco (F3 valida). */
export const EvidenciaDemanda = z
  .object({
    demanda_id: DemandaId,
    rodada_id: IdDono,
    ticket_id: IdDono,
    tipo: TipoEvidencia,
    dados: z.record(z.string(), z.json()),
    autor: Ator,
    em: Instante,
  })
  .refine((e) => e.rodada_id === undefined || e.ticket_id === undefined, {
    message: "rodada_id e ticket_id não podem estar preenchidos juntos (use só um dono)",
  });
export type EvidenciaDemanda = z.infer<typeof EvidenciaDemanda>;

type DonoEvidencia = "demanda" | "rodada" | "ticket";

/** Quem é dono da evidência: a rodada, o ticket ou, com ambos nulos, a própria demanda (CA-11). */
export const donoDe = (e: Pick<EvidenciaDemanda, "rodada_id" | "ticket_id">): DonoEvidencia =>
  e.rodada_id !== undefined ? "rodada" : e.ticket_id !== undefined ? "ticket" : "demanda";

/** Obrigatórias que as evidências registradas ainda não têm, como evidência da própria demanda. */
export const pendentesDeEnvio = (registradas: { readonly evidencias: readonly EvidenciaDemanda[] }): string[] =>
  OBRIGATORIAS_DEMANDA.filter((t) => !registradas.evidencias.some((e) => donoDe(e) === "demanda" && e.tipo === t));
