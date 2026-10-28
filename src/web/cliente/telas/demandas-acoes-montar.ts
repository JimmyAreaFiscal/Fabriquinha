// A sessão de ajustes no DOM: lê a conversa da rodada e envia a mensagem do Auditor. Os testes de ponta a ponta (e2e/)
// o exercitam.
import type { Entrada } from "../../rotas/chat.ts";
import { api, avisar, ErroDaApi, mostrarErro } from "../dom.ts";
import { sessaoDeAjustes } from "./demandas-acoes.ts";

const caminho = (ref: string): string => `/api/demandas/rodadas/${encodeURIComponent(ref)}/ajustes`;
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Lê a conversa e redesenha a seção, mantendo o rascunho; o 4xx do servidor vira o motivo na seção. */
export async function carregarAjustes(secao: HTMLElement, signal: AbortSignal): Promise<Entrada[] | undefined> {
  const ref = secao.dataset.ajustes ?? "";
  const rascunho = secao.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
  let conversa: Entrada[] | string;
  try {
    conversa = (await api<{ conversa: Entrada[] }>(caminho(ref), { signal })).conversa;
  } catch (falha) {
    if (!(falha instanceof ErroDaApi && falha.status < 500)) throw falha;
    conversa = falha.message;
  }
  if (signal.aborted) return undefined;
  secao.innerHTML = sessaoDeAjustes(ref, conversa);
  const campo = secao.querySelector<HTMLTextAreaElement>("textarea");
  if (campo) campo.value = rascunho;
  return typeof conversa === "string" ? undefined : conversa;
}

const temTexto = (conversa: Entrada[] | undefined, texto: string): boolean =>
  JSON.stringify(conversa ?? []).includes(JSON.stringify(texto).slice(1, -1));

/**
 * Atualizar relê a conversa. Enviar vazio não vai ao servidor; enviar faz o POST e relê até a mensagem aparecer (até
 * 10 × 500 ms, porque o pi grava depois de responder). Concluir faz o POST sem corpo e recarrega a página inteira, que
 * mostra a fase devolvida. O erro do servidor vai ao aviso e a sessão continua.
 */
export async function agirNaSessao(
  botao: HTMLButtonElement,
  signal: AbortSignal,
  recarregar: () => Promise<unknown>,
): Promise<void> {
  const secao = botao.closest<HTMLElement>("[data-ajustes]");
  if (!secao) return;
  const ref = secao.dataset.ajustes ?? "";
  avisar();
  if (botao.dataset.ajuste === "atualizar") {
    await carregarAjustes(secao, signal).catch(mostrarErro);
    return;
  }
  if (botao.dataset.ajuste === "concluir") {
    botao.disabled = true;
    try {
      await api(botao.dataset.caminho ?? "", { method: "POST", signal });
      if (!signal.aborted) await recarregar();
    } catch (falha) {
      mostrarErro(falha);
      botao.disabled = false;
    }
    return;
  }
  const campo = secao.querySelector<HTMLTextAreaElement>("textarea");
  const texto = campo?.value.trim() ?? "";
  if (texto === "") {
    const erro = campo?.nextElementSibling as HTMLElement | null;
    if (erro) {
      erro.textContent = "Escreva o texto da mensagem.";
      erro.hidden = false;
    }
    return;
  }
  botao.disabled = true;
  try {
    await api(`${caminho(ref)}/mensagens`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto }),
      signal,
    });
    if (campo) campo.value = "";
    for (let i = 0; i < 10 && !signal.aborted; i++) {
      if (temTexto(await carregarAjustes(secao, signal), texto)) break;
      await dormir(500);
    }
  } catch (falha) {
    mostrarErro(falha);
    botao.disabled = false;
  }
}
