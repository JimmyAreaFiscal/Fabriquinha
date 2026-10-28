// A seção da sessão de ajustes na página da demanda como função pura que devolve HTML: a conversa (balões do Auditor e
// do Agente), o motivo do servidor quando não há conversa e a caixa de mensagem. O texto do agente passa por `markdown`.
import type { Entrada } from "../../rotas/chat.ts";
import { markdown } from "../markdown.ts";
import { escapar } from "../render.ts";
import { blocoDeAcao } from "./demandas.ts";
import { type MensagemPi, textoDe } from "./chat.ts";

const AUTOR = { user: ["Auditor", "dm-msg-auditor"], assistant: ["Agente", "dm-msg-agente"] } as const;

/** O balão da entrada; o que não é mensagem de usuário ou agente, é prompt montado pela Fabriquinha ou não tem texto sai vazio. */
function balao(entrada: Entrada): string {
  const m = entrada.message as MensagemPi | undefined;
  const autor = m?.role === "user" || m?.role === "assistant" ? AUTOR[m.role] : undefined;
  if (entrada.type !== "message" || entrada.fabriquinha || !m || !autor) return "";
  const texto = textoDe(m).trim();
  if (texto === "") return "";
  return `<div class="dm-msg ${autor[1]}"><span class="dm-msg-autor">${autor[0]}</span>${markdown(texto)}</div>`;
}

/** A sessão de ajustes da rodada: a conversa, ou o motivo que o servidor deu por não ter conversa. */
export function sessaoDeAjustes(ref: string, conversa: readonly Entrada[] | string): string {
  const campo = `ajuste-${escapar(ref)}`;
  const baloes = typeof conversa === "string" ? [] : conversa.map(balao).filter((b) => b !== "");
  const corpoDaConversa =
    typeof conversa === "string"
      ? `<p class="muted vazio">${escapar(conversa)}</p>`
      : baloes.length > 0
        ? `<div class="dm-conversa">${baloes.join("")}</div>`
        : '<p class="muted vazio">A conversa ainda não tem mensagens.</p>';
  return blocoDeAcao(
    `Sessão de ajustes de ${escapar(ref)}`,
    `${corpoDaConversa}
    <label for="${campo}">Mensagem ao agente</label><textarea id="${campo}" rows="3" aria-describedby="${campo}-erro"></textarea><span class="msg-erro" id="${campo}-erro" role="alert" hidden></span>
    <div class="dm-botoes"><button type="button" class="btn btn-grande btn-primario" data-ajuste="enviar" data-ref="${escapar(ref)}">Enviar</button>
    <button type="button" class="btn btn-grande" data-ajuste="concluir" data-ref="${escapar(ref)}" data-caminho="/api/demandas/rodadas/${encodeURIComponent(ref)}/ajustes/concluir">Concluir a sessão</button></div>`,
  );
}
