// Regras de fronteira do domínio Ciclo de Vida (MELHORIAS §11). Os tickets 10 a 17 mudam só este arquivo; o motor
// (../motor.ts) explica os campos e como declarar o domínio migrado.
import type { RegrasDoDominio } from "../motor.ts";

/** O catálogo de Etapas, que o motor lê na carga do módulo: fora de qualquer ciclo de import de valor. */
export const ARQUIVO_DO_CATALOGO = "modulos/etapas/catalogo.ts";
/** As pastas que podem citar o nome de uma Etapa como dado. */
export const PASTAS_QUE_CITAM_NOME_DE_ETAPA = ["modulos/etapas/"];
/** A catraca: arquivos de fora das pastas que ainda citam o nome de uma Etapa. Vazia; o que entrar sai no ticket indicado. */
export const ARQUIVOS_QUE_CITAM_NOME_DE_ETAPA: string[] = [];
/** O único caso de uso que grava em `evidencia_demanda` (além do armazenamento): toda Evidência entra pela submissão. */
export const ARQUIVO_QUE_SUBMETE_EVIDENCIA = "modulos/sdlc/aplicacao/evidencias/submeter.ts";
/** O armazenamento das Evidências, pelo fim do caminho (o `gravar*` dele só se importa de `submeter.ts`). */
export const ARMAZENAMENTO_DE_EVIDENCIA = "armazenamento/evidencia_demanda.ts";
/** Os casos de uso do agente, os únicos que a API do agente alcança. */
export const PASTA_DOS_CASOS_DE_USO_DO_AGENTE = "modulos/etapas/agente/";

export const REGRAS_DO_CICLO_DE_VIDA: RegrasDoDominio = {
  migrado: false,
  dependeDe: ["sessoes", "repositorio", "ambiente"],
  subdominios: {
    etapas: [],
    planejamento: ["etapas"],
    processo: ["etapas", "planejamento"],
    evidencias: ["etapas"],
    verificacoes: ["etapas"],
    conducao: ["processo", "evidencias", "verificacoes", "etapas"],
    despacho: ["processo", "planejamento", "conducao"],
    metricas_de_qualidade: ["planejamento", "processo", "evidencias", "verificacoes"],
  },
  posseDasTabelas: "inventario",
  excecoes: [],
  dependenciasToleradas: [],
  // O sonar-scanner fala com o host.
  processoDoHost: {
    pastasLiberadas: [],
    importamChildProcess: [],
    chamadoresDiretos: ["modulos/verificacao/infra/tipos_de_verificacao/sonar.ts"],
  },
};
