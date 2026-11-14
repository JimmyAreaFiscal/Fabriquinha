// A marca que a política dos agentes põe nas mensagens da conversa de uma sessão: o prompt que a Fabriquinha montou vira
// linha do sistema no chat, e a resposta de `perguntar` leva o Ator de quem respondeu, o Agente (o Auditor automático,
// que Sessões registra na execução) ou o Auditor.
import { AUDITOR, Ator } from "../../../etapas/publico.ts";
import type { ConversaDaSessao } from "../../../../sessoes/publico.ts";

/** A marca de cada mensagem da conversa da sessão: `fabriquinha` no prompt montado, o `ator` na resposta de `perguntar`. */
export function marcadorDaConversa(
  conversa: Pick<ConversaDaSessao, "marcaDa">,
): (mensagem: unknown) => { fabriquinha: true } | { ator: Ator } | undefined {
  return (mensagem) => {
    const marca = conversa.marcaDa(mensagem);
    if (marca === undefined) return undefined;
    if ("promptDoPedido" in marca) return { fabriquinha: true };
    const { respondidaPor } = marca.respostaDaPergunta;
    return { ator: Ator.safeParse(respondidaPor).success ? (respondidaPor as Ator) : AUDITOR };
  };
}
