// A fachada de Sessões de IA (MELHORIAS §9): a única entrada de fora do domínio. Por enquanto, o harness com os contratos de
// eventos e de Uso, os modelos e o Uso somado; o ticket 09 acrescenta `SessoesDeAgente`.
export {
  colunasDoModelo,
  dirDoPiDoAuditor,
  type EventoDoAgente,
  type Harness,
  HarnessPi,
  type LancamentoDoTicket,
  type LinhaDeUso,
  type MensagemDoAgente,
  ModoTrabalho,
  PACOTE,
  type PedidoDeExtensao,
  type ProcessoDoAgente,
  type RespostaDaConsulta,
  skillDoTipo,
} from "./harness/publico.ts";
export { Effort, Modelo } from "./modelos/publico.ts";
export { textoDoCusto, textoDoCustoDe, Uso } from "./metricas_de_execucao/publico.ts";
