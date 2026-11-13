// A regra única que classifica a saída de um comando de Verificação, sem I/O.
import type { CausaDeInfraestrutura } from "../../etapas/publico.ts";

/**
 * Saída 0 passa; estouro do tempo e saída 126/127 (comando que não roda) são infraestrutura. Sem `codigoDeReprovacao`,
 * qualquer outra saída reprova; com ele (e2e), só esse código reprova e outro é infraestrutura.
 */
export function classificarSaidaDeComando(
  saida: { codigo: number | null; estourou: boolean },
  codigoDeReprovacao?: number,
): ResultadoDaVerificacao["tipo"] {
  if (saida.estourou || saida.codigo === 126 || saida.codigo === 127) return "falha_infraestrutura";
  if (saida.codigo === 0) return "passou";
  if (codigoDeReprovacao === undefined || saida.codigo === codigoDeReprovacao) return "reprovacao";
  return "falha_infraestrutura";
}

/** O que a Verificação deixa para a Evidência: os dados e os logs dos comandos que ela rodou. */
interface RelatorioDaVerificacao {
  dados: Record<string, unknown>;
  logs: { nome: string; texto: string }[];
}

/**
 * As três classes do resultado de uma Verificação (MELHORIAS §11, regra 10): sucesso (`passou`), reprovação técnica
 * (`reprovacao`, que volta ao agente) e falha de infraestrutura (`falha_infraestrutura`, que não volta).
 */
export type ResultadoDaVerificacao =
  | { tipo: "passou"; relatorio?: RelatorioDaVerificacao }
  | { tipo: "reprovacao"; motivo: string; log: string }
  | { tipo: "falha_infraestrutura"; causa: CausaDeInfraestrutura; motivo: string };
