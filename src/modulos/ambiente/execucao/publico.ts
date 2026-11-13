// A API da Execução (MELHORIAS §8), fronteira interna do Ambiente: a gestão que a fachada expõe e o Ambiente onde os
// comandos rodam (host local ou o container alocado).
export {
  type GestaoDeAmbientes,
  montarGestaoDeAmbientes,
  type MontagemDaGestaoDeAmbientes,
} from "./aplicacao/gestao_de_ambientes.ts";
export type {
  Ambiente,
  ComandoNoAmbiente,
  IdentificadorDoProcesso,
  ProcessoNoAmbiente,
  SaidaDoComando,
} from "./infra/ambiente.ts";
