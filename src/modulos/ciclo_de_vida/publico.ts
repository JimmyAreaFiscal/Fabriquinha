// A fachada do Ciclo de Vida (PROPOSTA §4.2): a montagem, a interface `CicloDeVida` (as ações do Auditor e as leituras
// das telas), a `CicloDeVidaDoAgente` (os casos de uso do agente, no escopo do token) e os tipos de entrada e saída delas.
// Os schemas do vocabulário (`EtapaTicket`, `EstadoDemanda`...) saem como tipos de saída, porque os contratos da API os
// conferem em tempo de execução. Despacho, condução, verificações, recuperação e retomada ficam internos.
export {
  type Andamento,
  type CascataDoCancelamento,
  type CatalogoDoCicloDeVida,
  type CicloDeVida,
  type CicloDeVidaDoAgente,
  type DemandasDoCicloDeVida,
  type MontagemDoCicloDeVida,
  montarCicloDeVida,
  type SessaoNoCicloDeVida,
} from "./coordenacao/publico.ts";
export {
  ConfiguracaoAgente,
  Endereco,
  EtapaTicket,
  ExibicaoDaEtapa,
  NomeGate,
  type PapelDaEtapa,
  TipoEvidencia,
  type TipoMetrica,
} from "./etapas/publico.ts";
export {
  type AcaoEsperada,
  Decisao,
  Demanda,
  EstadoDemanda,
  EstadoRodada,
  EstadoTicket,
  type Pendencia,
  type ResumoDaDemanda,
  RodadaDemanda,
  TicketDemanda,
  TipoDemanda,
  type TipoPendencia,
  type TrabalhoVivo,
} from "./processo/publico.ts";
export type { RefRodada } from "./conducao/publico.ts";
export type { MotivoDeRecusa } from "./despacho/publico.ts";
export {
  type MetricasDoProcesso,
  type OrigemDosFatos,
  type ParteDoFato,
  type PedidoDasMetricas,
  Periodo,
  type Recorte,
  type ValorDaMetrica,
  type ValoresPorParte,
} from "./metricas_de_qualidade/publico.ts";
