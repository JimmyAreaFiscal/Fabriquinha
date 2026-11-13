// provisório: remover no ticket 22 (a sessão e as execuções mudaram para src/modulos/sessoes/execucao/ e o Uso da
// execução para src/modulos/sessoes/metricas_de_execucao/, pela fachada de Sessões, com os nomes de lá)
export {
  acumularUso,
  criarSessao as criarTrabalho,
  encerrarExecucao as encerrarProcesso,
  Execucao as ProcessoDoTrabalho,
  iniciarExecucao as iniciarProcesso,
  registrarUso,
  retomarSessao as retomarTrabalho,
  Sessao as TrabalhoGerenciado,
  UsoDaExecucao as UsoModeloExecucao,
} from "../../sessoes/publico.ts";
