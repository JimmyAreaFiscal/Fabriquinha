// A API do subdomínio Métricas de Execução: o Uso medido de cada execução e o declarado das sessões externas, o Uso
// somado por modelo e o custo como as telas o mostram.
export { textoDoCusto, textoDoCustoDe, Uso } from "./nucleo/uso.ts";
export { acumularUso, registrarUso, UsoDaExecucao, usoDaExecucaoDaLinha } from "./nucleo/uso_da_execucao.ts";
export { gravarUsoDasExecucoes, lerUsoDasExecucoes } from "./armazenamento/uso_das_execucoes.ts";
export {
  gravarUsoDeclarado,
  lerUsoDeclarado,
  lerUsoDeclaradoEmLote,
  type UsoDeclarado,
} from "./armazenamento/uso_declarado.ts";
