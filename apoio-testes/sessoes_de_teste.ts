// O apoio de teste de Sessões: o harness pi (que os testes montam com o executor falso), o token da execução, o Uso
// declarado e o catálogo de preços gravados direto, com que os testes de fora do módulo montam cenário sem passar pela
// interface `SessoesDeAgente`.
export { HarnessPi } from "../src/modulos/sessoes/harness/infra/pi/harness_pi.ts";
export { gravarTokenDaExecucao } from "../src/modulos/sessoes/execucao/armazenamento/sessoes_e_execucoes.ts";
export { gravarUsoDeclarado } from "../src/modulos/sessoes/metricas_de_execucao/armazenamento/uso_declarado.ts";
export { gravarCatalogoDePrecos } from "../src/modulos/sessoes/modelos/armazenamento/catalogo_de_precos.ts";
export { skillDoTipo } from "../src/modulos/sessoes/harness/infra/pi/pi.ts";
