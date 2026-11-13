// O apoio de teste de Demandas: o cadastro e a gravação direta do projeto, sem as conferências externas do formulário
// (o repositório e os modelos), o pedido gravado como o cenário o monta e a dependência entre pedidos já registrados,
// com que os testes de fora do módulo montam cenário sem passar pela GestaoDeDemandas.
export { registrarProjeto } from "../src/modulos/demandas/projetos/aplicacao/cadastro.ts";
export { buscarProjeto, gravarProjeto } from "../src/modulos/demandas/projetos/armazenamento/projetos.ts";
export { gravarPedidoNovo } from "../src/modulos/demandas/pedidos/armazenamento/pedidos.ts";
export { registrarDependencia } from "../src/modulos/demandas/pedidos/aplicacao/gestao_de_dependencias.ts";
