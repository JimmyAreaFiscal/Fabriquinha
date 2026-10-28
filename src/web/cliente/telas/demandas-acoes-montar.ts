// A sessão de ajustes no DOM: lê a conversa da rodada e envia a mensagem do Auditor. Os testes de ponta a ponta (e2e/)
// o exercitam.
import type { Entrada } from "../../rotas/chat.ts";
import { api, avisar, ErroDaApi, mostrarErro } from "../dom.ts";
import { sessaoDeAjustes } from "./demandas-acoes.ts";

const caminho = (ref: string): string => `/api/demandas/rodadas/${encodeURIComponent(ref)}/ajustes`;
/** Espera `ms`, ou até o `signal` abortar. */
const esperar = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolver) => {
    const fim = () => {
      clearTimeout(tempo);
      resolver();
    };
    const tempo = setTimeout(fim, ms);
    signal.addEventListener("abort", fim, { once: true });
  });

/** Lê a conversa e redesenha a seção, mantendo o rascunho; o 4xx do servidor vira o motivo na seção. Devolve o id da sessão. */
export async function carregarAjustes(secao: HTMLElement, signal: AbortSignal): Promise<string | undefined> {
  const ref = secao.dataset.ajustes ?? "";
  const rascunho = secao.querySelector<HTMLTextAreaElement>("textarea")?.value ?? "";
  let conversa: Entrada[] | string;
  let sessao: string | undefined;
  try {
    ({ conversa, sessao } = await api<{ conversa: Entrada[]; sessao: string }>(caminho(ref), { signal }));
  } catch (falha) {
    if (!(falha instanceof ErroDaApi && falha.status < 500)) throw falha;
    conversa = falha.message;
  }
  if (signal.aborted) return undefined;
  secao.innerHTML = sessaoDeAjustes(ref, conversa);
  const campo = secao.querySelector<HTMLTextAreaElement>("textarea");
  if (campo) campo.value = rascunho;
  return sessao;
}

/**
 * Enquanto a seção está na página, mostra a conversa: relê o GET a cada 2 s até a conversa nascer (qualquer 4xx conta
 * como "ainda não tem conversa", porque a seção só aparece na rodada em sessão) e então segue o EventSource da sessão,
 * que só serve de gatilho para reler. Para quando o `signal` aborta.
 */
// shortcut: qualquer 4xx é "ainda sem conversa", o servidor distinguir a conversa que ainda não nasceu.
export async function acompanharAjustes(secao: HTMLElement, signal: AbortSignal): Promise<void> {
  const parou = () => signal.aborted; // função, para o TypeScript não fixar o valor depois de um await
  let sessao: string | undefined;
  while (!(sessao = await carregarAjustes(secao, signal))) {
    if (parou()) return;
    await esperar(2000, signal);
    if (parou()) return;
  }
  const fonte = new EventSource(`/api/sessoes/${encodeURIComponent(sessao)}/eventos`);
  signal.addEventListener(
    "abort",
    () => {
      fonte.close();
    },
    { once: true },
  );
  fonte.onmessage = (mensagem) => {
    const { type } = JSON.parse(String(mensagem.data)) as { type: string };
    if (type === "message_end" || type === "estado") void carregarAjustes(secao, signal).catch(mostrarErro);
  };
}

/**
 * Enviar vazio não vai ao servidor; enviar faz o POST, limpa o campo e relê a conversa uma vez (o resto chega pelo
 * EventSource de `acompanharAjustes`). Concluir faz o POST sem corpo e recarrega a página inteira, que
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
    await carregarAjustes(secao, signal);
  } catch (falha) {
    mostrarErro(falha);
    botao.disabled = false;
  }
}
