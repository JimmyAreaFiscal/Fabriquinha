// A API dos Sandboxes (MELHORIAS §8): o conjunto de containers, quem ocupa cada um, a criação e a eliminação deles.
export {
  type AmbienteGravado,
  alocarAmbienteLivreDaImagem,
  eliminarAmbiente,
  inserirAmbienteAlocado,
  liberarAmbiente,
  listarAmbientes,
} from "./armazenamento/ambientes.ts";
export {
  ConjuntoDeSandboxes,
  type OcupanteDoAmbiente,
  type ProjetoDoAmbiente,
  type ServicoDoConjunto,
  tipoConfiguradoTemConjunto,
} from "./aplicacao/conjunto_de_sandboxes.ts";
export {
  DIR_DO_PI_NO_HOME,
  GeradorDeAmbientes,
  PADRAO_DE_TOKEN_DO_GITHUB,
  PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA,
} from "./infra/gerador_de_ambientes.ts";
export { abrigarNoAmbiente } from "./infra/pastas_do_ambiente.ts";
