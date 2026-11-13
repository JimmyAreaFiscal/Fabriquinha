// A API das Dependências (MELHORIAS §12): valida e grava as relações entre pedidos e informa os dependentes que ainda
// não terminaram, pela situação administrativa de cada pedido.
export {
  cancelarComDependentes,
  dependentesNaoConcluidosDoPedido,
  registrarDependencia,
} from "./aplicacao/gestao_de_dependencias.ts";
