// O apoio de teste de Sessões: o harness pi (que os testes montam com o executor falso), o motor de cada banco, as sessões
// e as execuções gravadas e lidas direto, o token da execução, o Uso declarado e o catálogo de preços, com que os testes
// de fora do módulo montam e conferem cenário sem passar pela interface `SessoesDeAgente`.
export { HarnessPi } from "../src/modulos/sessoes/harness/infra/pi/harness_pi.ts";
export {
  execucoesAbertas,
  gravarTokenDaExecucao,
} from "../src/modulos/sessoes/execucao/armazenamento/sessoes_e_execucoes.ts";
export { criarSessao, iniciarExecucao, retomarSessao } from "../src/modulos/sessoes/execucao/nucleo/sessao.ts";
export { pastasDoProcesso } from "../src/modulos/sessoes/execucao/nucleo/pastas_da_execucao.ts";
export {
  carregarSessoesDoContexto,
  comSessoesDoContexto,
} from "../src/modulos/sessoes/execucao/aplicacao/sessoes_do_contexto.ts";
export { MotorDasSessoes, type PedidoDeProcesso } from "../src/modulos/sessoes/execucao/aplicacao/motor_das_sessoes.ts";
export { motorDoBanco } from "../src/modulos/sessoes/execucao/aplicacao/montagem_das_sessoes.ts";
export { atividadeDo, PREFIXO_DA_RESPOSTA_AUTOMATICA } from "../src/modulos/sessoes/chat/publico.ts";
export { gravarUsoDeclarado } from "../src/modulos/sessoes/metricas_de_execucao/armazenamento/uso_declarado.ts";
export { registrarUso } from "../src/modulos/sessoes/metricas_de_execucao/nucleo/uso_da_execucao.ts";
export { gravarCatalogoDePrecos } from "../src/modulos/sessoes/modelos/armazenamento/catalogo_de_precos.ts";
export { skillDoTipo } from "../src/modulos/sessoes/harness/infra/pi/pi.ts";
