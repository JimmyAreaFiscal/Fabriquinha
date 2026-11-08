// Os cinco pontos em que o SDLC só avança depois de uma Decisão, e a própria Decisão, que sabe de qual gate é.
import { z } from "zod";
import { Ator } from "./ator.ts";
import { DemandaId } from "./demanda.ts";
import { Id, Instante, Motivo } from "./primitivos.ts";

const NomeGate = z.enum([
  "gate_demanda",
  "gate_planejamento",
  "gate_pr",
  "gate_revisao_rodada",
  "gate_revisao_demanda",
]);
type NomeGate = z.infer<typeof NomeGate>;

export const Decisao = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  decisao_id: Id,
  gate: NomeGate,
  resultado: z.enum(["aprovado", "reprovado"]),
  nota: z.number().int().min(1).max(5).optional(),
  motivo: Motivo.optional(),
  por: Ator,
  em: Instante,
});
export type Decisao = z.infer<typeof Decisao>;
