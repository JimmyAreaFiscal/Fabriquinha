// A fachada do Ciclo de Vida (MELHORIAS §11): a única entrada usada por fora do domínio. Exporta a API de cada
// subdomínio: o catálogo de Etapas, o Planejamento, o Processo (o estado do desenvolvimento e o único escritor dele), as
// Evidências, as Verificações, a Condução, o Despacho e as Métricas de Qualidade.
export * from "./etapas/publico.ts";
export * from "./planejamento/publico.ts";
export * from "./evidencias/publico.ts";
export * from "./verificacoes/publico.ts";
export * from "./processo/publico.ts";
export * from "./metricas_de_qualidade/publico.ts";
export * from "./conducao/publico.ts";
export * from "./despacho/publico.ts";
