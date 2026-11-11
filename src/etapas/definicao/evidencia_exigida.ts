// Catálogo de evidências por etapa do ticket, produtor e dono (comparacao-sdlc-implementacao.md §§7.4, 8.1 e 8.2).
// A validação de dono, tipo, produtor e `dados` é do `AvaliadorDeEvidencia`.
import { z } from "zod";
import { ProdutorDaEvidencia, RegraAprovacaoEtapa, TipoEvidencia } from "./tipos_declaraveis.ts";
import type { EvidenciaExigida } from "./definicao_da_etapa.ts";
import { CATALOGO_DE_ETAPAS, EtapaTicket } from "../catalogo.ts";

/** @testes tipo que o teste usa para montar a entrada */
export const ItemCatalogoEtapa = z.object({
  etapa: EtapaTicket,
  tipo: TipoEvidencia,
  produtor: ProdutorDaEvidencia,
  obrigatoria: z.boolean(),
  regraAprovacao: RegraAprovacaoEtapa.nullable(),
  dono: z.enum(["demanda", "ticket"]),
}) satisfies z.ZodType<EvidenciaExigida<EtapaTicket>>;
export type ItemCatalogoEtapa = z.infer<typeof ItemCatalogoEtapa>;

export const CATALOGO_ETAPAS: readonly ItemCatalogoEtapa[] = Object.values(CATALOGO_DE_ETAPAS).flatMap(
  (d) => d.evidencias,
);

export const catalogoDaEtapa = (etapa: EtapaTicket): readonly ItemCatalogoEtapa[] =>
  CATALOGO_DE_ETAPAS[etapa].evidencias;
