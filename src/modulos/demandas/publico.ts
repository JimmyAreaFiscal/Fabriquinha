// A fachada do domínio Demandas (MELHORIAS §12): a montagem da GestaoDeDemandas, a única entrada usada por fora do
// domínio, e os tipos da entrada e da saída dela. O Projeto e a configuração SDLC vão com os schemas que os validam.
export { ComandosDePreparacao, type FormularioDoProjeto, Projeto, ProjetoConfigurado } from "./projetos/publico.ts";
export {
  type FiltroDePedidos,
  type GestaoDeDemandas,
  montarGestaoDeDemandas,
  type NovoPedido,
  type Pedido,
} from "./pedidos/publico.ts";
