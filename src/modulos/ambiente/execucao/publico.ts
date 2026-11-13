// A API da Execução (MELHORIAS §8): o Ambiente onde os comandos rodam (host local ou o container alocado), o conjunto
// de Ambientes em container e o Ambiente que o serviço monta.
export {
  type Ambiente,
  ambienteSemCredenciais,
  chavesDeProvedorDoLlm,
  type ComandoNoAmbiente,
  type IdentificadorDoProcesso,
  LIMITE_COMANDO_MS,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "./infra/ambiente.ts";
export { AmbienteHostLocal } from "./infra/host_local/ambiente_host_local.ts";
export { AmbienteContainer } from "./infra/container/ambiente_container.ts";
export { ConjuntoDeAmbientes } from "./aplicacao/conjunto_de_ambientes.ts";
export {
  ambienteDoServico,
  conjuntoDoServico,
  montarAmbienteDoServico,
  montarConjuntoDoServico,
} from "./aplicacao/ambiente_do_servico.ts";
export { conjuntoDoTipoConfigurado } from "./aplicacao/conjunto_do_tipo_configurado.ts";
export { eliminarAmbienteDoConjunto } from "./aplicacao/eliminacao_pela_configuracao.ts";
