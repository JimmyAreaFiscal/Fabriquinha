// O modo de trabalhar de cada Etapa: o `.md` que a definição dela aponta, lido ao montar o prompt do ticket.
import { readFileSync } from "node:fs";
import { CATALOGO_DE_ETAPAS, type EtapaTicket } from "../nucleo/catalogo.ts";

/** O texto do modo de trabalhar da etapa, com os placeholders trocados pelos endereços públicos. */
export function lerModoDeTrabalhar(
  etapa: EtapaTicket,
  enderecos: Record<"demanda" | "rodada" | "ticket", string>,
): string {
  const { instrucao } = CATALOGO_DE_ETAPAS[etapa];
  if (instrucao === undefined) throw new Error(`a etapa ${etapa} não tem modo de trabalhar escrito no catálogo`);
  const texto = readFileSync(instrucao, "utf8");
  return texto.replace(/\{(demanda|rodada|ticket)\}/g, (_, nome: keyof typeof enderecos) => enderecos[nome]);
}
