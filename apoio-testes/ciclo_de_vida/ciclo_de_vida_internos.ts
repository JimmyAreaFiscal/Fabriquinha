// Os internos do Ciclo de Vida que os testes de fora do módulo usam para montar cenário e conferir o motor: a API de
// cada subdomínio, como a fachada exportava antes da interface mínima (PROPOSTA §4.2). Só os testes importam daqui.
export * from "../../src/modulos/ciclo_de_vida/etapas/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/planejamento/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/evidencias/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/verificacoes/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/processo/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/metricas_de_qualidade/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/conducao/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/despacho/publico.ts";
export * from "../../src/modulos/ciclo_de_vida/coordenacao/publico.ts";
