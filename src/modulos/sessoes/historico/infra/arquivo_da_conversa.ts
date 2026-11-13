// A conversa guardada de uma sessão: o JSONL que o harness grava. Quem diz onde ele fica é o harness.
import { readFileSync } from "node:fs";

/** As entradas do JSONL, divididas só em `\n` (F4 §6.1.2); linha incompleta do fim fica de fora; sem arquivo, nenhuma. */
export function lerConversaDoArquivo(arquivo: string | undefined): unknown[] {
  if (!arquivo) return [];
  return readFileSync(arquivo, "utf8")
    .split("\n")
    .flatMap((linha) => {
      try {
        return [JSON.parse(linha) as unknown];
      } catch {
        return [];
      }
    });
}
