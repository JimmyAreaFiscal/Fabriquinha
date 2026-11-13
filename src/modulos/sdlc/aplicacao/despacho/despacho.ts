// provisório: remover no ticket 22 (mudou para src/modulos/ciclo_de_vida/despacho/, pela API do Despacho; os contratos
// entre o despacho e as conduções são da Condução, em src/modulos/ciclo_de_vida/conducao/aplicacao/conducoes.ts)
export { cicloDoDespacho, executarAgora, ultimasRecusas } from "../../../ciclo_de_vida/despacho/publico.ts";
export type { ConducaoDoTicket, DepsDaConducao, DepsDespacho } from "../../../ciclo_de_vida/conducao/publico.ts";
