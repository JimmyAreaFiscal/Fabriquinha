// A fronteira de Pedidos para a fachada de Demandas: a montagem da GestaoDeDemandas, que junta os projetos, os pedidos e
// as dependências entre eles, e os tipos da entrada e da saída dela.
export type { Pedido } from "./nucleo/pedido.ts";
export type { FiltroDePedidos } from "./armazenamento/pedidos.ts";
export { type GestaoDeDemandas, montarGestaoDeDemandas, type NovoPedido } from "./aplicacao/gestao_de_demandas.ts";
