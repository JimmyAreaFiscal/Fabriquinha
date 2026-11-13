// provisório: remover no ticket 22 (os ciclos mudaram para src/modulos/ciclo_de_vida/processo/). O contrato do servidor só
// importa o núcleo do código antigo e o CLI do agente o empacota: reexporta do arquivo do Processo, sem a fachada.
export { EstadoDemanda, EstadoRodada } from "../../../ciclo_de_vida/processo/nucleo/ciclos/ciclos.ts";
