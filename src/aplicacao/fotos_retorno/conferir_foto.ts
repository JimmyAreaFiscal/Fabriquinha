// As fotos do texto de retorno ao agente: o prompt completo de cada caso, gerado no commit-base da I-270, que a
// mudança de montador não pode alterar. Só o que muda a cada execução (raiz temporária, ID da execução, SHAs) é trocado.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function normalizarPrompt(prompt: string, raizTemporaria: string): string {
  return prompt
    .replaceAll(raizTemporaria, "<raiz>")
    .replaceAll(/E-[0-9a-f]{8}-[0-9a-f-]{27}/g, "E-<execucao>")
    .replaceAll(/\b[0-9a-f]{40}\b/g, "<sha>");
}

/** @testes Confere, byte a byte, o prompt do caso com a foto `fotos_retorno/<nomeDaFoto>.txt`. */
export function conferirPromptComFoto(prompt: string, raizTemporaria: string, nomeDaFoto: string): void {
  const foto = readFileSync(new URL(`${nomeDaFoto}.txt`, import.meta.url), "utf8");
  assert.equal(normalizarPrompt(prompt, raizTemporaria), foto);
}
