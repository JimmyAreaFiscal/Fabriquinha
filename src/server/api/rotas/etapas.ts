// A rota das Etapas do SDLC: o catálogo como a web o lê, com a ordem do SDLC e os estados de cada ciclo.
import { descreverEtapasDoSdlc } from "../../consultas/etapas.ts";
import { EtapasDoSdlc } from "../../contrato/etapas.ts";
import type { Rota } from "../rotas.ts";

export const ROTAS_DAS_ETAPAS: Rota[] = [
  { metodo: "GET", caminho: "/api/etapas", tratar: descreverEtapasDoSdlc, resposta: EtapasDoSdlc },
];
