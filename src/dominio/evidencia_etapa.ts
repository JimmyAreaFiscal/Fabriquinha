// Catálogo de evidências por etapa do ticket, produtor e dono (comparacao-sdlc-implementacao.md §§7.4, 8.1 e 8.2).
// `dados` segue opaco e `aprovada` vem calculada do F3: o domínio só exige que ela exista onde há regra.
import { z } from "zod";
import { IdDono, TicketDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { OBRIGATORIAS_DEMANDA, TipoEvidenciaDemanda } from "./evidencia_demanda.ts";
import { EtapaTicket } from "./primitivos.ts";

export const TipoEvidenciaEtapa = z.enum([
  ...TipoEvidenciaDemanda.options,
  "plano",
  "execucao_testes",
  "matriz_fitness",
  "relatorio_sonar",
  "arquivos_alterados",
  "explicacao_fitness",
  "comprovacao_criterios",
  "mensagem_pr",
  "aula_codigo",
  "relatorio_produtividade",
  "pr_aberto",
  "video_demonstracao",
  "testes_estresse",
  "analise_seguranca",
  "arvore_prs_criterios_custos",
  "demonstracao_limpeza",
]);
export type TipoEvidenciaEtapa = z.infer<typeof TipoEvidenciaEtapa>;

export const ProdutorEvidenciaEtapa = z.enum(["externo", "agente", "fabriquinha"]);
export type ProdutorEvidenciaEtapa = z.infer<typeof ProdutorEvidenciaEtapa>;

/** Rótulos para o F3: o domínio não avalia nenhuma. */
export const RegraAprovacaoEtapa = z.enum([
  "todos_comandos_exit_zero",
  "todas_fitness_passam",
  "sem_issue_aberta_arquivos_alterados",
  "criterios_rodada_atendidos",
  "criterios_demanda_atendidos",
  "nada_sobrou",
]);
export type RegraAprovacaoEtapa = z.infer<typeof RegraAprovacaoEtapa>;

export const ItemCatalogoEtapa = z.object({
  etapa: EtapaTicket,
  tipo: TipoEvidenciaEtapa,
  produtor: ProdutorEvidenciaEtapa,
  obrigatoria: z.boolean(),
  regraAprovacao: RegraAprovacaoEtapa.nullable(),
  dono: z.enum(["demanda", "ticket"]),
});
export type ItemCatalogoEtapa = z.infer<typeof ItemCatalogoEtapa>;

type Produtor = ProdutorEvidenciaEtapa;
type Regra = RegraAprovacaoEtapa | null;
const item = (
  etapa: EtapaTicket,
  tipo: TipoEvidenciaEtapa,
  produtor: Produtor,
  obrigatoria = true,
  regraAprovacao: Regra = null,
): ItemCatalogoEtapa => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
  regraAprovacao,
  dono: etapa === "demanda" ? "demanda" : "ticket",
});

const verificacoes = (etapa: EtapaTicket): ItemCatalogoEtapa[] => [
  item(etapa, "execucao_testes", "fabriquinha", true, "todos_comandos_exit_zero"),
  item(etapa, "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
  item(etapa, "relatorio_sonar", "fabriquinha", true, "sem_issue_aberta_arquivos_alterados"),
];

const POR_ETAPA: Readonly<Record<EtapaTicket, readonly ItemCatalogoEtapa[]>> = {
  demanda: TipoEvidenciaDemanda.options.map((t) =>
    item("demanda", t, "externo", (OBRIGATORIAS_DEMANDA as readonly string[]).includes(t)),
  ),
  planejar: [item("planejar", "plano", "agente")],
  implementar: verificacoes("implementar"),
  revisar_rodada: [
    item("revisar_rodada", "arquivos_alterados", "fabriquinha"),
    item("revisar_rodada", "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
    item("revisar_rodada", "explicacao_fitness", "agente"),
    item("revisar_rodada", "comprovacao_criterios", "agente", true, "criterios_rodada_atendidos"),
  ],
  encerrar_rodada: [
    item("encerrar_rodada", "mensagem_pr", "agente"),
    item("encerrar_rodada", "aula_codigo", "agente"),
    item("encerrar_rodada", "relatorio_produtividade", "fabriquinha"),
    item("encerrar_rodada", "pr_aberto", "fabriquinha"),
    item("encerrar_rodada", "video_demonstracao", "agente", false),
  ],
  sessao_em_aberto: [],
  revisar_demanda: [
    item("revisar_demanda", "comprovacao_criterios", "agente", true, "criterios_demanda_atendidos"),
    item("revisar_demanda", "testes_estresse", "agente"),
    item("revisar_demanda", "analise_seguranca", "agente"),
  ],
  encerrar_demanda: [
    item("encerrar_demanda", "arvore_prs_criterios_custos", "fabriquinha"),
    item("encerrar_demanda", "demonstracao_limpeza", "fabriquinha", true, "nada_sobrou"),
  ],
  resolver_conflito: verificacoes("resolver_conflito"),
};

export const CATALOGO_ETAPAS: readonly ItemCatalogoEtapa[] = Object.values(POR_ETAPA).flat();

export const catalogoDaEtapa = (etapa: EtapaTicket): readonly ItemCatalogoEtapa[] => POR_ETAPA[etapa];

export const ContextoEvidenciaEtapa = TicketDemanda.pick({ demanda_id: true, ticket_id: true, etapa: true });
export type ContextoEvidenciaEtapa = z.infer<typeof ContextoEvidenciaEtapa>;

export const EntradaEvidenciaEtapa = z.object({
  demanda_id: ContextoEvidenciaEtapa.shape.demanda_id,
  rodada_id: IdDono,
  ticket_id: IdDono,
  tipo: TipoEvidenciaEtapa,
  produtor: ProdutorEvidenciaEtapa,
  aprovada: z.boolean().optional(),
  dados: z.unknown(),
});
export type EvidenciaEtapa = z.output<typeof EntradaEvidenciaEtapa>;
export type EntradaEvidenciaEtapa = EvidenciaEtapa;

const lerContexto = (contexto: ContextoEvidenciaEtapa): ContextoEvidenciaEtapa => {
  const lido = ContextoEvidenciaEtapa.safeParse(contexto);
  if (!lido.success) {
    throw new ErroDeRegra(
      `contexto de evidência inválido: ${lido.error.issues.map((i) => i.message).join("; ")}`,
      "informe demanda_id, ticket_id e etapa válidos",
    );
  }
  return lido.data;
};

/** Ticket executor da etapa; as evidências da etapa `demanda` pertencem à demanda (§8.1). */
const donoEsperado = (c: ContextoEvidenciaEtapa): number | undefined =>
  c.etapa === "demanda" ? undefined : c.ticket_id;

/** Metadados normalizados; produtor informado não autentica autoria e `aprovada` é calculada pelo F3. */
export function validarEvidenciaDaEtapa(contexto: ContextoEvidenciaEtapa, entrada: unknown): EvidenciaEtapa {
  const ctx = lerContexto(contexto);
  const lida = EntradaEvidenciaEtapa.safeParse(entrada);
  if (!lida.success) {
    throw new ErroDeRegra(
      `evidência inválida: ${lida.error.issues.map((i) => i.message).join("; ")}`,
      "informe demanda_id, tipo, produtor e, se houver, aprovada booleano",
    );
  }
  const e = lida.data;
  const onde = `T-${String(ctx.ticket_id)} (${ctx.etapa})`;
  if (e.demanda_id !== ctx.demanda_id) {
    throw new ErroDeRegra(
      `a evidência é da demanda ${e.demanda_id}, não da ${ctx.demanda_id}`,
      "use a demanda do ticket",
    );
  }
  if (e.rodada_id !== undefined || e.ticket_id !== donoEsperado(ctx)) {
    throw new ErroDeRegra(
      `a evidência de ${onde} tem dono errado`,
      ctx.etapa === "demanda"
        ? "evidência da etapa demanda pertence à demanda: sem rodada_id nem ticket_id"
        : `informe ticket_id ${String(ctx.ticket_id)} e nenhum rodada_id`,
    );
  }
  const alvo = catalogoDaEtapa(ctx.etapa).find((i) => i.tipo === e.tipo);
  if (alvo === undefined) {
    throw new ErroDeRegra(
      `${onde} não aceita evidência ${e.tipo}`,
      `use um de ${
        catalogoDaEtapa(ctx.etapa)
          .map((i) => i.tipo)
          .join(", ") || "nenhum tipo"
      }`,
    );
  }
  if (e.produtor !== alvo.produtor) {
    throw new ErroDeEscopo(
      `a evidência ${e.tipo} de ${onde} é produzida por ${alvo.produtor}`,
      `não por ${e.produtor}`,
    );
  }
  if (alvo.regraAprovacao !== null && e.aprovada === undefined) {
    throw new ErroDeRegra(
      `a evidência ${e.tipo} de ${onde} exige aprovada`,
      `calcule pela regra ${alvo.regraAprovacao} e informe true ou false`,
    );
  }
  return e;
}

/**
 * Pré-condição: snapshot ativo válido, com uma evidência por tipo/dono; não valida nem escolhe versões.
 * Obrigatórias ausentes e presentes reprovadas, na ordem do catálogo. O(n), espaço O(1) pelo catálogo fixo.
 */
export function pendenciasDoTicket(
  contexto: ContextoEvidenciaEtapa,
  evidencias: readonly EvidenciaEtapa[],
): { ausentes: TipoEvidenciaEtapa[]; reprovadas: TipoEvidenciaEtapa[] } {
  const ctx = lerContexto(contexto);
  const dono = donoEsperado(ctx);
  const itens = catalogoDaEtapa(ctx.etapa);
  const catalogados = new Set(itens.map((i) => i.tipo));
  const presentes = new Set<TipoEvidenciaEtapa>();
  const reprovados = new Set<TipoEvidenciaEtapa>();
  for (const e of evidencias) {
    if (
      e.demanda_id === ctx.demanda_id &&
      e.rodada_id === undefined &&
      e.ticket_id === dono &&
      catalogados.has(e.tipo)
    ) {
      presentes.add(e.tipo);
      if (e.aprovada === false) reprovados.add(e.tipo);
    }
  }
  return {
    ausentes: itens.filter((i) => i.obrigatoria && !presentes.has(i.tipo)).map((i) => i.tipo),
    reprovadas: itens.filter((i) => reprovados.has(i.tipo)).map((i) => i.tipo),
  };
}
