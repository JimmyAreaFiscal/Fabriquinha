// A fachada do Ciclo de Vida (MELHORIAS §11): a única entrada usada por fora do domínio. Por ora, o catálogo de Etapas,
// o vocabulário do SDLC, a configuração do agente e os tipos que validam a configuração do projeto (`EtapaTicket`,
// `ConfiguracaoAgente`); os demais subdomínios entram aqui quando migrarem.
export * from "./etapas/publico.ts";
export * from "./planejamento/publico.ts";
export * from "./evidencias/publico.ts";
export * from "./verificacoes/publico.ts";
export * from "./processo/publico.ts";
export * from "./metricas_de_qualidade/publico.ts";
// provisório: remover no ticket 22, que traz o agregado da demanda e o repositório dele do sdlc para o Processo. O agregado
// e as leituras dele, em lote, para as consultas das telas; a linha `demanda` ainda mistura as colunas do pedido e as do
// processo. Ficam no fim da fachada, e não na API do Processo: o agregado importa a fachada, e os subdomínios que importam
// a API do Processo ainda estariam pela metade quando ele a lesse (TDZ).
export { type AgregadoDemanda, prDaDemanda, type TicketDemanda } from "../sdlc/nucleo/demanda/agregado_demanda.ts";
export {
  andamentoDasDemandasEmLote,
  carregarDemanda,
  carregarDemandas,
  listarDemandas,
  situacaoDasDemandas,
} from "../sdlc/armazenamento/demandas.ts";
