import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { test } from "node:test";
import { abrirFluxoSse } from "./sse.ts";

/** Um `ServerResponse` que só guarda o cabeçalho e o que foi escrito. */
function respostaFalsa() {
  const resposta = Object.assign(new EventEmitter(), {
    cabecalho: undefined as [number, Record<string, string>] | undefined,
    escrito: [] as string[],
    writeHead(status: number, cabecalhos: Record<string, string>) {
      resposta.cabecalho = [status, cabecalhos];
      return resposta;
    },
    write(texto: string) {
      resposta.escrito.push(texto);
      return true;
    },
  });
  return resposta;
}

test("o fluxo abre o text/event-stream, manda o retrato antes de assinar e repassa cada evento", () => {
  const resposta = respostaFalsa();
  let ouvinte: ((evento: object) => void) | undefined;
  abrirFluxoSse(resposta as unknown as ServerResponse, { type: "chat", sessao: "s1" }, (escrever) => {
    assert.deepEqual(
      resposta.escrito,
      ['data: {"type":"chat","sessao":"s1"}\n\n'],
      "o retrato vai antes da assinatura",
    );
    ouvinte = escrever;
    return () => undefined;
  });
  assert.deepEqual(resposta.cabecalho, [
    200,
    { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" },
  ]);
  ouvinte?.({ type: "estado", estado: "concluida" });
  assert.equal(resposta.escrito[1], 'data: {"type":"estado","estado":"concluida"}\n\n');
});

test("o fluxo cancela a assinatura quando o cliente fecha a conexão", () => {
  const resposta = respostaFalsa();
  let cancelada = 0;
  abrirFluxoSse(resposta as unknown as ServerResponse, {}, () => () => cancelada++);
  assert.equal(cancelada, 0);
  resposta.emit("close");
  assert.equal(cancelada, 1);
});
