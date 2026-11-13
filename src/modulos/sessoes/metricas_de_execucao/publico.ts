// A API do subdomínio Métricas de Execução: o Uso medido de cada execução e o declarado das sessões externas, o Uso
// somado por modelo, o custo estimado pelo catálogo de preços e o custo como as telas o mostram.
export { type CustoDoUso, Uso } from "./nucleo/uso.ts";
export {
  acumularUso,
  estimarCustoPeloCatalogo,
  linhaDeUsoDaExecucao,
  registrarUso,
  UsoDaExecucao,
  usoDaExecucaoDaLinha,
} from "./nucleo/uso_da_execucao.ts";
export { apagarUsoDasExecucoes, gravarUsoDasExecucoes, lerUsoDasExecucoes } from "./armazenamento/uso_das_execucoes.ts";
export {
  apagarUsoDeclaradoDasDemandas,
  gravarUsoDeclarado,
  lerUsoDeclarado,
  lerUsoDeclaradoEmLote,
  type UsoDeclarado,
} from "./armazenamento/uso_declarado.ts";
