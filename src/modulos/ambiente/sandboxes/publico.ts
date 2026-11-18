// A API dos Sandboxes (MELHORIAS §8), fronteira interna do Ambiente: o conjunto de containers, quem ocupa cada um, o uso
// medido, a criação e a eliminação deles.
export type { AmbienteGravado } from "./armazenamento/ambientes.ts";
export {
  ConjuntoDeSandboxes,
  type OcupanteDoAmbiente,
  type ProjetoDoAmbiente,
  type ServicoDoConjunto,
  type SituacaoDoAmbiente,
} from "./aplicacao/conjunto_de_sandboxes.ts";
export {
  DIR_DO_PI_NO_HOME,
  GeradorDeAmbientes,
  PADRAO_DE_TOKEN_DO_GITHUB,
  PASTA_DA_CREDENCIAL_DO_CLAUDE_NO_CONTAINER,
  type Recursos,
  VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE,
} from "./infra/gerador_de_ambientes.ts";
export { abrigarNoAmbiente } from "./infra/pastas_do_ambiente.ts";
