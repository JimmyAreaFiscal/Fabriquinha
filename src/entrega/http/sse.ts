// O fluxo SSE único da API (F4 §5.4, D12): o chat da demanda e a avaliação o usam. Primeiro vai o retrato lido logo
// antes de assinar, sem nada no meio; depois, cada evento que a assinatura entrega. Quem reconecta recebe o retrato de novo.
import type { ServerResponse } from "node:http";

/** Quem assina os eventos ao vivo recebe `escrever` e devolve a função que cancela a assinatura. */
type Assinar = (escrever: (evento: object) => void) => () => void;

/** Abre o fluxo `text/event-stream` em `resposta`: escreve `retrato`, assina os eventos e cancela quando o cliente fecha. */
export function abrirFluxoSse(resposta: ServerResponse, retrato: object, assinar: Assinar): void {
  const escrever = (evento: object) => resposta.write(`data: ${JSON.stringify(evento)}\n\n`);
  resposta.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
  escrever(retrato);
  resposta.on("close", assinar(escrever));
}
