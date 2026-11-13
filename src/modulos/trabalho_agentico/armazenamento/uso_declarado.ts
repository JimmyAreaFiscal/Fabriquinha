// provisório: remover no ticket 22. O Uso declarado (D10) mudou para src/modulos/sessoes/metricas_de_execucao/, pela
// fachada; a leitura por período, que juntava o Uso às tabelas das Demandas e da Evidência, deu lugar à leitura em lote
// (`lerUsoDeclaradoEmLote`) que as Métricas de Qualidade recortam pelo registro da demanda.
export { gravarUsoDeclarado, lerUsoDeclarado, type UsoDeclarado } from "../../sessoes/publico.ts";
