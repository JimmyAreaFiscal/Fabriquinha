// A API dos Pedidos (MELHORIAS §12): registra, edita, envia e consulta os pedidos e registra o cancelamento e a conclusão.
// A situação administrativa é só rascunho, enviado, cancelado ou concluído; o andamento é do Ciclo de Vida.
export { type Pedido, pedidoTerminou, SituacaoDoPedido } from "./nucleo/pedido.ts";
export {
  editarPedido,
  enviarPedido,
  registrarCancelamentoDosPedidos,
  registrarConclusaoDoPedido,
  registrarPedido,
} from "./aplicacao/gestao_de_pedidos.ts";
export { lerPedido, situacoesDosPedidos } from "./armazenamento/pedidos.ts";
export { MIGRACOES_DE_DEMANDAS } from "./armazenamento/migracao_da_situacao.ts";
