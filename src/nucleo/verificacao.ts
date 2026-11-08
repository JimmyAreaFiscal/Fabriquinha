// A regra única que classifica a saída de um comando de Verificação, sem I/O.

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
