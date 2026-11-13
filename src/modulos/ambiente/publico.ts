// A fachada GestaoDeAmbientes (MELHORIAS §8), a única entrada do domínio Ambiente: configura e consulta o conjunto,
// aloca e libera, executa e lança comandos, sinaliza processos e informa o estado dos sandboxes. Ambiente não conhece
// demandas, tickets nem etapas: quem pede informa um ocupante opaco.
export {
  ConfiguracaoDoAmbiente,
  configuracaoDoAmbiente,
  salvarConfiguracaoDoAmbiente,
  validarESalvarConfiguracaoDoAmbiente,
} from "./configuracao/publico.ts";
export {
  type AmbienteGravado,
  GeradorDeAmbientes,
  type OcupanteDoAmbiente,
  PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA,
  type ServicoDoConjunto,
} from "./sandboxes/publico.ts";
// provisório: remover no ticket 22. O SQL do inventário, que só os testes de fora do domínio usam para montar cenário.
export {
  alocarAmbienteLivreDaImagem,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
  listarAmbientes,
} from "./sandboxes/publico.ts";
export {
  type Ambiente,
  AmbienteContainer,
  AmbienteHostLocal,
  ambienteDoServico,
  ambienteSemCredenciais,
  chavesDeProvedorDoLlm,
  type ComandoNoAmbiente,
  ConjuntoDeAmbientes,
  conjuntoDoServico,
  conjuntoDoTipoConfigurado,
  eliminarAmbienteDoConjunto,
  type IdentificadorDoProcesso,
  LIMITE_COMANDO_MS,
  montarAmbienteDoServico,
  montarConjuntoDoServico,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "./execucao/publico.ts";
export { listarAmbientesDoConjunto } from "./monitoramento/publico.ts";
