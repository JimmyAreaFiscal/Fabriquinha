// A fachada GestaoDeAmbientes (MELHORIAS §8), a única entrada do domínio Ambiente: quem monta entrega a Configuração do
// Ambiente e recebe a gestão, que lista o conjunto com o uso medido, aloca, limpa e elimina os Ambientes; o Ambiente alocado
// executa, lança e sinaliza os comandos. Ambiente não conhece demandas, tickets nem etapas: quem pede informa um ocupante opaco.
export {
  type Ambiente,
  type ComandoNoAmbiente,
  type GestaoDeAmbientes,
  type IdentificadorDoProcesso,
  montarGestaoDeAmbientes,
  type MontagemDaGestaoDeAmbientes,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "./execucao/publico.ts";
export type {
  OcupanteDoAmbiente,
  ProjetoDoAmbiente,
  Recursos,
  ServicoDoConjunto,
  SituacaoDoAmbiente,
} from "./sandboxes/publico.ts";
