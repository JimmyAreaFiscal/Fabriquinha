// Evidência por dono da demanda SDLC (comparacao-sdlc-implementacao.md §7.4; CONCEITOS.md §5).
// `dados` segue opaco: o schema de cada tipo é do F3.
import { type AgregadoDemanda, donoDe } from "./agregado_demanda.ts";

/** Obrigatórias da demanda no envio (CA-SDLC-01). */
export const OBRIGATORIAS_DEMANDA = ["criterios_aceite", "desenho_solucao"] as const;
const OPCIONAIS_DEMANDA = [
  "comportamento",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
] as const;
/** Os tipos que a própria demanda recebe, as obrigatórias primeiro. */
export const TIPOS_DA_DEMANDA = [...OBRIGATORIAS_DEMANDA, ...OPCIONAIS_DEMANDA] as const;
export type TipoDaDemanda = (typeof TIPOS_DA_DEMANDA)[number];

/** Obrigatórias que o agregado ainda não tem, como evidência da própria demanda. */
export const pendentesDeEnvio = (ag: AgregadoDemanda): string[] =>
  OBRIGATORIAS_DEMANDA.filter((t) => !ag.evidencias.some((e) => donoDe(e) === "demanda" && e.tipo === t));
