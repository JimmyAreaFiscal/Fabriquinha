// Catálogo de evidências por etapa do ticket, produtor e dono (comparacao-sdlc-implementacao.md §§7.4, 8.1 e 8.2).
// A validação de dono, tipo, produtor e `dados` é do `AvaliadorDeEvidencia`.
import { z } from "zod";
import { type Ator } from "./ator.ts";
import { TipoEvidencia } from "./evidencia.ts";
import { OBRIGATORIAS_DEMANDA, TIPOS_DA_DEMANDA } from "./evidencia_demanda.ts";
import { EtapaTicket } from "./primitivos.ts";

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

type Regra = RegraAprovacaoEtapa | null;
const item = (
  etapa: EtapaTicket,
  tipo: TipoEvidencia,
  produtor: Produtor,
  obrigatoria = true,
  regraAprovacao: Regra = null,
): ItemCatalogoEtapa => ({
  etapa,
  tipo,
  produtor,
  obrigatoria,
  regraAprovacao,
  dono: etapa === "entender_e_desenhar" ? "demanda" : "ticket",
});

const verificacoes = (etapa: EtapaTicket): ItemCatalogoEtapa[] => [
  item(etapa, "execucao_testes", "fabriquinha", true, "todos_comandos_exit_zero"),
  item(etapa, "matriz_fitness", "fabriquinha", true, "todas_fitness_passam"),
  item(etapa, "relatorio_sonar", "fabriquinha", true, "sem_issue_aberta_arquivos_alterados"),
];

const POR_ETAPA: Readonly<Record<EtapaTicket, readonly ItemCatalogoEtapa[]>> = {
  entender_e_desenhar: TIPOS_DA_DEMANDA.map((t) =>
    item("entender_e_desenhar", t, "externo", (OBRIGATORIAS_DEMANDA as readonly string[]).includes(t)),
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
  ajustar_resultado: [],
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
