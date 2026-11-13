// A API de Projetos (MELHORIAS §12): cadastra, configura e consulta os projetos. O repositório é conferido pela fachada
// do Repositório; a configuração é validada com os tipos públicos do Ciclo de Vida.
export { Projeto, ProjetoConfigurado } from "./nucleo/projeto.ts";
export {
  cadastrarProjetoDoFormulario,
  editarProjetoDoFormulario,
  gravarConfiguracaoSdlc,
  registrarProjeto,
  removerProjeto,
} from "./aplicacao/cadastro.ts";
export { projetoComConfiguracoesDasEtapas } from "./aplicacao/configuracao_do_agente.ts";
export {
  buscarProjeto,
  carregarProjeto,
  gravarProjeto,
  listarProjetos,
  projetoDaDemanda,
  projetoExistente,
} from "./armazenamento/projetos.ts";
