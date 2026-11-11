// Evidência por dono da demanda SDLC (comparacao-sdlc-implementacao.md §7.4; CONCEITOS.md §5).
// `dados` segue opaco: o schema de cada tipo é do F3. Os tipos da demanda são os que a Etapa dela declara.
import { type AgregadoDemanda, donoDe } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { OBRIGATORIAS_DEMANDA } from "../../../etapas/entender_e_desenhar/definicao.ts";

/** Obrigatórias que o agregado ainda não tem, como evidência da própria demanda. */
export const pendentesDeEnvio = (ag: AgregadoDemanda): string[] =>
  OBRIGATORIAS_DEMANDA.filter((t) => !ag.evidencias.some((e) => donoDe(e) === "demanda" && e.tipo === t));
