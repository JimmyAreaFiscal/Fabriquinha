// A fronteira interna de Projetos (MELHORIAS §12), usada pela gestão de Demandas: cadastra, configura, consulta e remove
// os projetos. O repositório é conferido pela fachada do Repositório; a configuração é validada com os tipos públicos do
// Ciclo de Vida.
export { ComandosDePreparacao, Projeto, ProjetoConfigurado } from "./nucleo/projeto.ts";
export {
  cadastrarProjetoDoFormulario,
  editarProjetoDoFormulario,
  type FormularioDoProjeto,
  gravarConfiguracaoSdlc,
  removerProjeto,
  type SobrasNoDisco,
} from "./aplicacao/cadastro.ts";
export type { ConferirModeloNoHarness } from "./aplicacao/configuracao_do_agente.ts";
export { listarProjetos, projetoExistente } from "./armazenamento/projetos.ts";
