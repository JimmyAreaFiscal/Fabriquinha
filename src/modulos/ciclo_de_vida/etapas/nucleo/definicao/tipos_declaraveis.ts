// Os tipos do que uma Etapa declara na definição dela (CONCEITOS.md §2): as evidências que exige, quem as produz e a regra
// que as aprova, as verificações que roda e as métricas que mede. Ficam com a definição, sem I/O, para o catálogo e quem o
// lê não dependerem de quem implementa cada tipo (a avaliação da evidência, a verificação, o cálculo da métrica).
import { z } from "zod";
import type { Ator } from "../vocabulario/ator.ts";

/** Os tipos de evidência de qualquer dono: da demanda, da rodada ou do ticket. */
export const TipoEvidencia = z.enum([
  "comportamento",
  "criterios_aceite",
  "desenho_solucao",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
  "execucao_testes",
  "matriz_fitness",
  "relatorio_sonar",
  "arquivos_alterados",
  "explicacao_fitness",
  "comprovacao_criterios",
  "mensagem_pr",
  "aula_codigo",
  "video_demonstracao",
  "relatorio_produtividade",
  "pr_aberto",
  "plano",
  "testes_estresse",
  "analise_seguranca",
  "arvore_prs_criterios_custos",
  "demonstracao_limpeza",
]);
export type TipoEvidencia = z.infer<typeof TipoEvidencia>;

/** Quem produz a evidência da etapa: qualquer ator, menos o Auditor. */
export const ProdutorDaEvidencia = z.enum(["externo", "agente", "fabriquinha"]) satisfies z.ZodType<Ator["tipo"]>;
export type ProdutorDaEvidencia = z.infer<typeof ProdutorDaEvidencia>;

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

/** Os tipos de Verificação que uma Etapa declara. */
export type TipoVerificacao = "testes" | "e2e" | "fitness" | "sonar" | "hooks_do_commit" | "conferencia_do_pr";

/** Os tipos de Métrica de Sucesso que as Etapas declaram (CONCEITOS.md §16). */
export type TipoMetrica =
  | "uso"
  | "aprovacoes_e_reprovacoes"
  | "conformidade_com_o_plano"
  | "alteracoes_posteriores"
  | "exigencias_de_alteracao"
  | "bugs_nos_arquivos_revisados"
  | "nota_humana";
