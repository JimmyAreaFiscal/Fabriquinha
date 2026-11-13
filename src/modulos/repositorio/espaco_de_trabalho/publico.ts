// API do subdomínio Espaço de Trabalho (MELHORIAS §10): cria, atualiza e limpa as worktrees.
export { ambienteDoEspaco, ocupanteDoAmbiente } from "./aplicacao/ambiente_do_espaco.ts";
export {
  espacoDaDemanda,
  espacoDaRodada,
  EspacoDeTrabalho,
  espacoDoTicket,
  prDoEscopo,
  prDoEspaco,
  PullRequest,
} from "./nucleo/espaco_de_trabalho.ts";
export { limparDemanda, pendenciasDeLimpeza, pendenciasDoEspaco, sobrasDaDemanda } from "./infra/limpeza_demanda.ts";
export { descartarAlteracoes, removerWorktrees } from "./infra/worktree.ts";
export {
  atualizarWorktreeRodada,
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeDemanda,
  garantirWorktreeDemandaDizendoSeBuscouBase,
  garantirWorktreeRodada,
  type ResultadoAtualizacao,
} from "./infra/worktree-demanda.ts";
