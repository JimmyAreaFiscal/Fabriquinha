// A API da Configuração do Ambiente (MELHORIAS §8): o tipo de sandbox, os recursos de cada um e o tempo ocioso.
export { ConfiguracaoDoAmbiente } from "./nucleo/configuracao_do_ambiente.ts";
export { configuracaoDoAmbiente, salvarConfiguracaoDoAmbiente } from "./armazenamento/configuracao_do_ambiente.ts";
export { validarESalvarConfiguracaoDoAmbiente } from "./aplicacao/configuracao_do_ambiente.ts";
export { MIGRACOES_DO_AMBIENTE } from "./armazenamento/migracao_da_configuracao.ts";
