// A regra única que classifica a saída de um comando de Verificação, sem I/O.
import type { CausaDeInfraestrutura } from "../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";

/**
 * Saída 0 passa; estouro do tempo e saída 126/127 (comando que não roda) são infraestrutura. Sem `codigoDeReprovacao`,
 * qualquer outra saída reprova; com ele (e2e), só esse código reprova e outro é infraestrutura.
 */
export function classificarSaidaDeComando(
  saida: { codigo: number | null; estourou: boolean },
  codigoDeReprovacao?: number,
): "passou" | "reprovacao" | "falha_infraestrutura" {
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

/** Os três resultados possíveis de uma Verificação; a infraestrutura não volta ao agente, a reprovação sim. */
export type ResultadoDaVerificacao =
  | { tipo: "passou"; relatorio?: RelatorioDaVerificacao }
  | { tipo: "reprovacao"; motivo: string; log: string }
  | { tipo: "falha_infraestrutura"; causa: CausaDeInfraestrutura; motivo: string };
