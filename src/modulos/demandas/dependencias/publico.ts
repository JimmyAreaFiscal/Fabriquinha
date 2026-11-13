// A API das Dependências (MELHORIAS §12): valida e grava as relações entre pedidos e informa os dependentes que ainda
// não terminaram e os pedidos liberados, pela situação administrativa de cada pedido, e as predecessoras de cada um.
export {
  cancelarComDependentes,
  dependentesNaoConcluidosDoPedido,
  predecessorasPendentesDosPedidos,
  registrarDependencia,
} from "./aplicacao/gestao_de_dependencias.ts";
export { apagarDependenciasDosPedidos, predecessorasDosPedidosEmLote } from "./armazenamento/dependencias.ts";
