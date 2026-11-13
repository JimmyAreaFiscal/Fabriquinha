// A fachada do Ciclo de Vida (MELHORIAS §11): a única entrada usada por fora do domínio. Por ora, o catálogo de Etapas,
// o vocabulário do SDLC, a configuração do agente e os tipos que validam a configuração do projeto (`EtapaTicket`,
// `ConfiguracaoAgente`); os demais subdomínios entram aqui quando migrarem.
export * from "./etapas/publico.ts";
export * from "./planejamento/publico.ts";
export * from "./evidencias/publico.ts";
export * from "./verificacoes/publico.ts";
