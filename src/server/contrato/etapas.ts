// O contrato de `GET /api/etapas`: as Etapas do SDLC como a web as lê, para desenhá-las sem citá-las pelo nome. Só tipos
// e schemas.
import { z } from "zod";
import { EtapaTicket, NomeGate } from "../../modulos/etapas/catalogo.ts";
import { ExibicaoDaEtapa } from "../../modulos/etapas/definicao/exibicao_da_etapa.ts";
import { EstadoDemanda, EstadoRodada } from "../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";

/** Uma Etapa do catálogo: o escopo, o papel que ela cumpre nas regras do motor, os textos das telas e o Gate dela. */
const EtapaDoSdlc = z.object({
  nome: EtapaTicket,
  escopo: z.enum(["demanda", "rodada"]),
  papel: z.string().optional(),
  exibicao: ExibicaoDaEtapa,
  gate: z.object({ nome: NomeGate, rotulo: z.string(), esperaEmEstadoProprio: z.boolean() }).optional(),
});
export type EtapaDoSdlc = z.infer<typeof EtapaDoSdlc>;

/** `GET /api/etapas`: as Etapas na ordem do catálogo, a ordem do SDLC e os estados de cada ciclo, na ordem dele. */
export const EtapasDoSdlc = z.object({
  etapas: z.array(EtapaDoSdlc),
  ordem: z.object({ demanda: z.array(EstadoDemanda), rodada: z.array(EtapaTicket) }),
  estados: z.object({ demanda: z.array(EstadoDemanda), rodada: z.array(EstadoRodada) }),
});
export type EtapasDoSdlc = z.infer<typeof EtapasDoSdlc>;
