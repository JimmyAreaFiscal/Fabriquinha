// Regras de fronteira do domínio Ciclo de Vida (MELHORIAS §11); o motor (../motor.ts) explica os campos.
import type { RegrasDoDominio } from "../motor.ts";

/** O catálogo de Etapas, que o motor lê na carga do módulo: fora de qualquer ciclo de import de valor. */
export const ARQUIVO_DO_CATALOGO = "modulos/ciclo_de_vida/etapas/nucleo/catalogo.ts";
/**
 * As pastas que podem citar o nome de uma Etapa como dado: o subdomínio Etapas, a Condução (uma condução e um gate por
 * Etapa). Os demais subdomínios do Ciclo de Vida perguntam ao catálogo.
 */
export const PASTAS_QUE_CITAM_NOME_DE_ETAPA = ["modulos/ciclo_de_vida/etapas/", "modulos/ciclo_de_vida/conducao/"];
/** A catraca: arquivos de fora das pastas que ainda citam o nome de uma Etapa. Vazia, e assim fica. */
export const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA: string[] = [];
/** O único caso de uso que grava em `evidencia_demanda` (além do armazenamento): toda Evidência entra pela submissão. */
export const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "modulos/ciclo_de_vida/processo/aplicacao/submissao_de_evidencia.ts";
/**
 * O armazenamento das Evidências, pelo fim do caminho, e as entradas que o exportam (a API de Evidências e a fachada):
 * o `gravar*` dele só se importa da submissão do Processo e do armazenamento do agregado, por qualquer um desses caminhos.
 */
export const ARMAZENAMENTO_DE_EVIDENCIA = "armazenamento/evidencia_demanda.ts";
export const ENTRADAS_DO_ARMAZENAMENTO_DE_EVIDENCIA = [
  ARMAZENAMENTO_DE_EVIDENCIA,
  "ciclo_de_vida/evidencias/publico.ts",
  "ciclo_de_vida/publico.ts",
];
/** A interface do Ciclo de Vida (`CicloDeVida` e `CicloDeVidaDoAgente`), a única aplicação que a API do agente alcança. */
export const PASTA_DA_INTERFACE_DO_CICLO_DE_VIDA = "modulos/ciclo_de_vida/coordenacao/aplicacao/";

export const REGRAS_DO_CICLO_DE_VIDA: RegrasDoDominio = {
  dependeDe: ["sessoes", "repositorio", "ambiente"],
  subdominios: {
    etapas: [],
    planejamento: ["etapas"],
    // O agregado da demanda carrega as Evidências, e as transições as conferem antes de avançar.
    processo: ["etapas", "planejamento", "evidencias"],
    // O formato do `plano` e a escolha do último ticket concluído de uma Etapa são do Planejamento.
    evidencias: ["etapas", "planejamento"],
    verificacoes: ["etapas"],
    // As conduções leem o plano e o ticket atual de cada Etapa, e a recuperação acha os tickets presos, no Planejamento.
    // A documentação do PR da rodada e o encerramento leem a produtividade da rodada nas Métricas de Qualidade.
    conducao: ["processo", "evidencias", "verificacoes", "etapas", "planejamento", "metricas_de_qualidade"],
    // O vocabulário do SDLC e o catálogo (o executor e o papel de cada Etapa) são de Etapas.
    despacho: ["processo", "planejamento", "conducao", "etapas"],
    metricas_de_qualidade: ["etapas", "planejamento", "processo", "evidencias", "verificacoes"],
    // A montagem do Ciclo de Vida combina os outros subdomínios na interface `CicloDeVida`.
    coordenacao: [
      "etapas",
      "planejamento",
      "processo",
      "evidencias",
      "verificacoes",
      "conducao",
      "despacho",
      "metricas_de_qualidade",
    ],
  },
  // O sonar-scanner fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: ["modulos/ciclo_de_vida/verificacoes/infra/tipos_de_verificacao/sonar.ts"],
  },
};
