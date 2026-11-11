// Catálogo de evidências por etapa do ticket, produtor e dono (comparacao-sdlc-implementacao.md §§7.4, 8.1 e 8.2).
// A validação de dono, tipo, produtor e `dados` é do `AvaliadorDeEvidencia`.
import { z } from "zod";
import { type Ator } from "../../sdlc/nucleo/ator.ts";
import { TipoEvidencia } from "../../qualidade/nucleo/evidencias/evidencia.ts";
import { CATALOGO_DE_ETAPAS } from "../catalogo.ts";
import { EtapaTicket } from "../../compartilhado/nucleo/primitivos.ts";

/** Quem produz a evidência da etapa: qualquer ator, menos o Auditor. */
const Produtor = z.enum(["externo", "agente", "fabriquinha"]) satisfies z.ZodType<Ator["tipo"]>;
type Produtor = z.infer<typeof Produtor>;

/** Rótulos para o F3: o domínio não avalia nenhuma. */
const RegraAprovacaoEtapa = z.enum([
  "todos_comandos_exit_zero",
  "todas_fitness_passam",
  "sem_issue_aberta_arquivos_alterados",
  "criterios_rodada_atendidos",
  "criterios_demanda_atendidos",
  "nada_sobrou",
]);
type RegraAprovacaoEtapa = z.infer<typeof RegraAprovacaoEtapa>;

/** @testes tipo que o teste usa para montar a entrada */
export const ItemCatalogoEtapa = z.object({
  etapa: EtapaTicket,
  tipo: TipoEvidencia,
  produtor: Produtor,
  obrigatoria: z.boolean(),
  regraAprovacao: RegraAprovacaoEtapa.nullable(),
  dono: z.enum(["demanda", "ticket"]),
});
export type ItemCatalogoEtapa = z.infer<typeof ItemCatalogoEtapa>;

export const CATALOGO_ETAPAS: readonly ItemCatalogoEtapa[] = Object.values(CATALOGO_DE_ETAPAS).flatMap(
  (d) => d.evidencias,
);

export const catalogoDaEtapa = (etapa: EtapaTicket): readonly ItemCatalogoEtapa[] =>
  CATALOGO_DE_ETAPAS[etapa].evidencias;
