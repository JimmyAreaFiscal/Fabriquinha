// provisório: remover no ticket 22 (a Pendência mudou para src/modulos/ciclo_de_vida/processo/, e o despacho parado, para o
// Despacho). O contrato do servidor só importa o núcleo do código antigo: reexporta do arquivo do Processo, sem a fachada.
export type { AcaoEsperada, TipoPendencia } from "../../../ciclo_de_vida/processo/nucleo/agregado/pendencia.ts";
