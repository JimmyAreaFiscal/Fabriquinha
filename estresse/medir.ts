// Medição do estresse: roda uma ação n vezes com concorrência fixa e resume os tempos (p50, p95, max), os erros e o orçamento.

export interface Medicao {
  n: number;
  p50: number;
  p95: number;
  max: number;
  erros: number;
  orcamento: number;
  acimaDoOrcamento: boolean;
}

/** Percentil por posto mais próximo (nearest-rank) sobre tempos já ordenados. */
export function percentil(ordenados: number[], p: number): number {
  if (ordenados.length === 0) return 0;
  return ordenados[Math.max(0, Math.ceil((p / 100) * ordenados.length) - 1)] ?? 0;
}

/**
 * Roda `acao` n vezes, no máximo `concorrencia` ao mesmo tempo. `acao` devolve o tempo em ms, ou lança quando o resultado
 * é inesperado (conta como erro; o tempo de uma chamada com erro não entra nos percentis).
 */
export async function medir(
  acao: () => Promise<number>,
  opcoes: { n: number; concorrencia: number; orcamento: number },
): Promise<Medicao> {
  const { n, concorrencia, orcamento } = opcoes;
  const tempos: number[] = [];
  let erros = 0;
  let iniciadas = 0;
  const trabalhador = async () => {
    while (iniciadas < n) {
      iniciadas++;
      try {
        tempos.push(await acao());
      } catch {
        erros++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concorrencia, n) }, trabalhador));
  tempos.sort((a, b) => a - b);
  const p95 = percentil(tempos, 95);
  return {
    n,
    p50: percentil(tempos, 50),
    p95,
    max: tempos.at(-1) ?? 0,
    erros,
    orcamento,
    acimaDoOrcamento: p95 > orcamento,
  };
}
