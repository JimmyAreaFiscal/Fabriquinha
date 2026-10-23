// Evidência por dono da demanda SDLC (comparacao-sdlc-implementacao.md §7.4; fabriquinha/03-evidencias.md §4.1).
// `dados` segue opaco: o schema de cada tipo é do F3.
import { z } from "zod";
import {
  AgregadoDemanda,
  donoDe,
  EvidenciaDemanda,
  IdDono,
  IdentidadeOrigem,
  TipoEvidenciaAgregado,
  type Demanda,
} from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { type Instante } from "./primitivos.ts";

/** Obrigatórias da demanda no envio (CA-SDLC-01). */
export const OBRIGATORIAS_DEMANDA = ["criterios_aceite", "desenho_solucao", "custos_realizados"] as const;
const OPCIONAIS_DEMANDA = [
  "comportamento",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
] as const;
export const TipoEvidenciaDemanda = z.enum([...OBRIGATORIAS_DEMANDA, ...OPCIONAIS_DEMANDA]);
export type TipoEvidenciaDemanda = z.infer<typeof TipoEvidenciaDemanda>;

/** Custos seguem liberados depois do envio (§3): são o único tipo da demanda fora da definição congelada. */
const livreDepoisDoEnvio = (tipo: string): boolean => tipo === "custos_realizados";

/** A ferramenta e a sessão que agem; só as autoras mexem na definição antes do envio (§6). */
export const AutorDemanda = z.object({ ferramenta: IdentidadeOrigem, sessao: IdentidadeOrigem });
export type AutorDemanda = z.infer<typeof AutorDemanda>;

export const EntradaEvidenciaDemanda = z.object({
  tipo: TipoEvidenciaAgregado,
  dados: EvidenciaDemanda.shape.dados,
  rodada_id: IdDono,
  ticket_id: IdDono,
});
export type EntradaEvidenciaDemanda = z.input<typeof EntradaEvidenciaDemanda>;

/** Recusa quem não é a ferramenta e a sessão autoras da demanda (CA-6). */
export function exigirAutoria(demanda: Demanda, autor: AutorDemanda, acao: string): void {
  const { ferramenta, sessao } = AutorDemanda.parse(autor);
  if (demanda.origem_ferramenta !== ferramenta || demanda.origem_sessao !== sessao) {
    throw new ErroDeEscopo(
      `só a ferramenta ${demanda.origem_ferramenta} da sessão ${demanda.origem_sessao} pode ${acao} a demanda ${demanda.id}`,
      "peça a quem registrou a demanda, na mesma sessão",
    );
  }
}

/** Obrigatórias que o agregado ainda não tem, como evidência da própria demanda. */
export const pendentesDeEnvio = (ag: AgregadoDemanda): string[] =>
  OBRIGATORIAS_DEMANDA.filter((t) => !ag.evidencias.some((e) => donoDe(e) === "demanda" && e.tipo === t));

/**
 * O agregado com a evidência acrescentada; a anterior do mesmo tipo e dono sai (CA-SDLC-18). Antes do envio só a
 * autora submete; depois, a definição fica congelada e só entram custos e evidências de rodada ou ticket.
 */
export function submeterEvidenciaDemanda(
  ag: AgregadoDemanda,
  entrada: EntradaEvidenciaDemanda,
  autor: AutorDemanda,
  agora: Instante,
): AgregadoDemanda {
  const { demanda } = ag;
  const evidencia = EvidenciaDemanda.safeParse({ ...entrada, demanda_id: demanda.id, em: agora });
  if (!evidencia.success) {
    throw new ErroDeRegra(
      `evidência ${entrada.tipo} inválida: ${evidencia.error.issues.map((i) => i.message).join("; ")}`,
      "informe só rodada_id ou só ticket_id, ou nenhum para a própria demanda",
    );
  }
  const nova = evidencia.data;
  const daDemanda = donoDe(nova) === "demanda";
  if (daDemanda && !TipoEvidenciaDemanda.safeParse(nova.tipo).success) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} não aceita evidência ${nova.tipo}`,
      `use um de ${TipoEvidenciaDemanda.options.join(", ")}`,
    );
  }
  if (nova.ticket_id !== undefined && !ag.tickets.some((t) => t.ticket_id === nova.ticket_id)) {
    throw new ErroDeRegra(
      `o ticket ${String(nova.ticket_id)} não existe na demanda ${demanda.id}`,
      "use um ticket da demanda",
    );
  }
  if (!demanda.enviada) exigirAutoria(demanda, autor, "submeter evidência da");
  else if (daDemanda && !livreDepoisDoEnvio(nova.tipo)) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já foi enviada e a evidência ${nova.tipo} da definição está congelada`,
      "só custos_realizados e evidências de rodada ou ticket entram depois do envio",
    );
  }
  const mesmoDono = (e: EvidenciaDemanda) =>
    e.tipo === nova.tipo && e.rodada_id === nova.rodada_id && e.ticket_id === nova.ticket_id;
  return { ...ag, evidencias: [...ag.evidencias.filter((e) => !mesmoDono(e)), nova] };
}
