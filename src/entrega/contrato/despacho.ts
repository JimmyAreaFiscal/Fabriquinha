// O contrato do Despacho na API: por que cada item parado não foi despachado. Os Endereços saem pelo texto público (`I-1.T2`).
import { z } from "zod";
import { NomeGate } from "../../nucleo/agregado_demanda.ts";
import { Motivo } from "../../nucleo/primitivos.ts";

/** O `MotivoDeRecusa` como `GET /api/despacho` e `POST .../executar` o devolvem. */
export const MotivoDeRecusaEmJson = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal("limite_de_paralelismo"), em_uso: z.number().int(), limite: z.number() }),
  z.object({ tipo: z.literal("dependencia_pendente"), aguarda: z.array(z.string()) }),
  z.object({ tipo: z.literal("gate_aguardando"), gate: NomeGate }),
  z.object({ tipo: z.literal("ocupado"), por: z.string() }),
  z.object({ tipo: z.literal("bloqueado"), motivo: Motivo }),
  z.object({ tipo: z.literal("aguarda_acao_externa") }),
]);
export type MotivoDeRecusaEmJson = z.infer<typeof MotivoDeRecusaEmJson>;

/** Um item parado do último ciclo do Despacho. */
const RecusaDoDespacho = z.object({ item: z.string(), motivo: MotivoDeRecusaEmJson });
export type RecusaDoDespacho = z.infer<typeof RecusaDoDespacho>;

/** `GET /api/despacho`. */
export const RecusasDoDespacho = z.object({ recusas: z.array(RecusaDoDespacho) });
export type RecusasDoDespacho = z.infer<typeof RecusasDoDespacho>;
