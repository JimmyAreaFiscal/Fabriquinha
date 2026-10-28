// Arquivos de uma execução fora do agregado (F2 §2, F4 §6.1.2, §7): a pasta da execução simulada, o log, a linha no log
// do serviço e o arquivo da sessão do pi.
import { appendFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";

/** `<raiz>/simulacoes/<n>`: anexos, sessão, log e `saida/` da execução simulada `n` (F8 §4). */
export const dirDaExecucaoSimulada = (raiz: string, execucao: Id): string => join(raiz, "simulacoes", String(execucao));

/** Uma linha com horário no log da execução (o `log` da pasta dela). */
export const anotar = (log: string, texto: string): void => {
  appendFileSync(log, `${new Date().toISOString()} ${texto}\n`);
};

/** O log do serviço é o stderr, que o systemd guarda (F4 §2). */
export const noLog = (erro: unknown): void => {
  console.error(`${new Date().toISOString()} fabriquinha:`, erro);
};

/**
 * O arquivo JSONL que o pi grava em `<raiz>/sessoes/<instante>_<sessaoPi>.jsonl`, ou `undefined` se ainda não existe.
 * Mais de um arquivo para o mesmo ID é erro (F6 §3.1): não há como saber qual é a sessão.
 */
export function arquivoDaSessao(raiz: string, sessao: string): string | undefined {
  const dir = join(raiz, "sessoes");
  const achados = existsSync(dir) ? readdirSync(dir).filter((nome) => nome.endsWith(`_${sessao}.jsonl`)) : [];
  if (achados.length > 1) {
    throw new ErroDeRegra(
      `a sessão ${sessao} tem ${String(achados.length)} arquivos em ${dir}: ${achados.join(", ")}`,
      "deixe só o arquivo da sessão e apague as cópias",
    );
  }
  return achados[0] && join(dir, achados[0]);
}
