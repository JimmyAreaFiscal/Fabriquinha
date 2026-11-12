// Contagem das execuções SQL do ensaio de desempenho: cada `run`, `get`, `all` e `iterate` de um statement do node:sqlite,
// no processo inteiro, sem tocar no código de produção. Preparar um statement não conta (o `prepare` não executa), nem o
// `exec` (só os PRAGMAs da abertura, as migrações e o BEGIN/COMMIT das transações passam por ele).
import { StatementSync } from "node:sqlite";

const METODOS_QUE_EXECUTAM_O_STATEMENT = ["run", "get", "all", "iterate"] as const;

let execucoesSqlDoProcesso = 0;
let contadorInstalado = false;

function instalarContadorNosStatements(): void {
  const prototipo = StatementSync.prototype as unknown as Record<string, (...argumentos: unknown[]) => unknown>;
  for (const metodo of METODOS_QUE_EXECUTAM_O_STATEMENT) {
    const executarOriginal = prototipo[metodo] as (...argumentos: unknown[]) => unknown;
    prototipo[metodo] = function (this: StatementSync, ...argumentos: unknown[]) {
      execucoesSqlDoProcesso++;
      return executarOriginal.apply(this, argumentos);
    };
  }
  contadorInstalado = true;
}

/**
 * Quantas execuções SQL o processo fez enquanto `acaoMedida` rodava. A contagem é do processo, não da ação: só vale com
 * nada mais tocando no banco ao mesmo tempo (o ensaio chama uma rota por vez).
 */
export async function contarExecucoesSql(acaoMedida: () => Promise<unknown>): Promise<number> {
  if (!contadorInstalado) instalarContadorNosStatements();
  const execucoesAntes = execucoesSqlDoProcesso;
  await acaoMedida();
  return execucoesSqlDoProcesso - execucoesAntes;
}
