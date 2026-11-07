// Quem pede o comando: as transições da demanda recebem o ator e checam se ele pode agir.
import { z } from "zod";
import { ErroDeEscopo } from "./erros.ts";
import { Id } from "./primitivos.ts";

/** Quem pede o comando; também é a origem de um ticket (quem o criou). `externo` é a IA de fora da Fabriquinha. */
export const TipoAtor = z.enum(["auditor", "agente", "fabriquinha", "externo"]);

export const Ator = z.discriminatedUnion("tipo", [
  z.object({ tipo: z.literal(TipoAtor.enum.auditor) }),
  z.object({ tipo: z.literal(TipoAtor.enum.agente), execucao: Id, ticket: Id }),
  z.object({ tipo: z.literal(TipoAtor.enum.fabriquinha) }),
  z.object({ tipo: z.literal(TipoAtor.enum.externo) }),
]);

export type Ator = z.infer<typeof Ator>;

/** Os atores sem dados: o Auditor e a própria Fabriquinha. */
export const AUDITOR: Ator = { tipo: "auditor" };
export const FABRIQUINHA: Ator = { tipo: "fabriquinha" };

export function exigirAuditor(ator: Ator, acao: string): void {
  if (ator.tipo !== "auditor") throw new ErroDeEscopo(`só o Auditor pode ${acao}`, "peça ao Auditor pelo web");
}

export function exigirFabriquinha(ator: Ator, acao: string): void {
  if (ator.tipo !== "fabriquinha") {
    throw new ErroDeEscopo(`só a Fabriquinha pode ${acao}`, "ela faz isso sozinha ao executar o ticket");
  }
}
