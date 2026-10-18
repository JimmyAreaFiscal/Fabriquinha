// Auditoria no DOM (F4; F7 §4.4): assina o SSE da auditoria, desenha o retrato e acrescenta o que chega ao vivo, como o
// chat, mas sem o que é de ticket; a conversa é o componente React do chat (chat-conversa.tsx), carregado com import().
// Liga ao servidor o envio da pergunta e o Abortar. O HTML vem de auditoria.ts; os testes de ponta a ponta
// (e2e/auditoria.spec.ts) o exercitam no navegador.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Parametros } from "../caminhos.ts";
import { api, avisar, mostrarErro } from "../dom.ts";
import {
  barraDaAuditoria,
  conversaDaAuditoria,
  type DadosDaAuditoria,
  envioDaAuditoria,
  ladoDaAuditoria,
  linhaDoInicio,
  modeloDaAuditoria,
} from "./auditoria.ts";
import { chaveDa, comResultado, emFluxo, mensagem, type MensagemPi } from "./chat.ts";
import type * as ModuloDaConversa from "./chat-conversa.tsx";
import { postar, verSaida } from "./chat-montar.ts";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div data-conversa-area></div>' +
  '<aside class="lateral" aria-label="Ao lado da conversa"><div class="lado" data-lateral></div></aside></div></div>';

type Evento = Record<string, unknown> & { type?: string };

/** Monta o chat da auditoria em `main`; ao sair da página (`signal`), fecha o SSE e desmonta a conversa. */
export function montarAuditoria(main: HTMLElement, params: Parametros, signal: AbortSignal): void {
  const sessao = String(params.sessao);
  const base = `/api/auditorias/${encodeURIComponent(sessao)}`;
  main.innerHTML = ESQUELETO;
  const raiz = main.querySelector<HTMLElement>(".pagina-chat") ?? main;
  const parte = (seletor: string) => raiz.querySelector<HTMLElement>(seletor) ?? raiz;
  const barra = parte("[data-barra]");
  const areaDaConversa = parte("[data-conversa-area]");
  const aoLado = parte("[data-lateral]");

  let dados: DadosDaAuditoria | undefined;
  let modelo = "";
  /** As chaves da conversa, para o que chega ao vivo não repetir o que já está na tela. */
  const vistas = new Set<string>();
  /** A conversa como o assistant-ui a desenha; o que chega ao vivo entra no fim. */
  let mensagens: ThreadMessageLike[] = [];
  /** A mensagem do agente chegando em fluxo. */
  let fluxo: { texto: string; raciocinio: string } | undefined;
  /** O componente React da conversa; até chegar, só se acumula em `mensagens`. */
  let conversaReact: typeof ModuloDaConversa | undefined;

  /** O envio do compositor: a pergunta vai ao agente; se falhar, o texto volta ao campo. */
  async function enviar(texto: string): Promise<void> {
    avisar();
    try {
      await postar(`${base}/mensagens`, { texto });
    } catch (error_) {
      mostrarErro(error_);
      throw error_;
    }
  }

  /** Redesenha a conversa e o envio; o React só troca o que mudou, e o Viewport rola junto se o Auditor está no fim. */
  function desenhar(): void {
    if (!dados || !conversaReact) return;
    conversaReact.desenharConversa(areaDaConversa, {
      mensagens: fluxo ? [...mensagens, emFluxo(fluxo.texto, fluxo.raciocinio)] : mensagens,
      envio: envioDaAuditoria(dados.estado),
      anexos: "",
      aoEnviar: enviar,
    });
  }

  function aplicar(d: DadosDaAuditoria): void {
    dados = d;
    barra.innerHTML = barraDaAuditoria(d, modelo);
    if (d.estado !== "rodando") fluxo = undefined;
    desenhar();
  }

  function retrato(lido: DadosDaAuditoria): void {
    vistas.clear();
    fluxo = undefined;
    modelo = modeloDaAuditoria(lido.conversa);
    mensagens = conversaDaAuditoria(lido);
    for (const { id } of mensagens) vistas.add(String(id));
    for (const e of lido.conversa as { message?: MensagemPi }[]) if (e.message) vistas.add(chaveDa(e.message));
    aoLado.innerHTML = ladoDaAuditoria(lido);
    aplicar(lido);
  }

  function aoFimDaMensagem(evento: Evento): void {
    const m = evento.message as MensagemPi;
    if (m.role === "assistant") fluxo = undefined;
    if (vistas.has(chaveDa(m))) {
      desenhar();
      return;
    }
    vistas.add(chaveDa(m));
    if (m.role === "toolResult") mensagens = mensagens.map((x) => comResultado(x, m));
    else if (evento.fabriquinha && dados) mensagens = [...mensagens, ...linhaDoInicio(m, dados)];
    else mensagens = [...mensagens, ...mensagem(m)];
    if (m.role === "assistant" && dados) {
      modelo = modeloDaAuditoria([evento]);
      barra.innerHTML = barraDaAuditoria(dados, modelo);
    }
    desenhar();
  }

  /** Texto e raciocínio que chegam em `message_update`, com o cursor no fim. */
  function aoFluxo(evento: Evento): void {
    const delta = evento.assistantMessageEvent as { type?: string; delta?: string } | undefined;
    if (!fluxo || !delta?.delta) return;
    if (delta.type === "text_delta") fluxo.texto += delta.delta;
    else if (delta.type === "thinking_delta") fluxo.raciocinio += delta.delta;
    else return;
    desenhar();
  }

  import("./chat-conversa.tsx")
    .then((modulo) => {
      if (signal.aborted) return;
      conversaReact = modulo;
      desenhar();
    })
    .catch(mostrarErro);

  const fonte = new EventSource(`${base}/eventos`);
  fonte.onmessage = (mensagemSse) => {
    const evento = JSON.parse(String(mensagemSse.data)) as Evento;
    if (evento.type === "auditoria") retrato({ ...(evento as Evento & DadosDaAuditoria), sessao });
    else if (evento.type === "estado" && dados)
      aplicar({ ...dados, estado: evento.estado as DadosDaAuditoria["estado"] });
    else if (evento.type === "message_end") aoFimDaMensagem(evento);
    else if (evento.type === "message_update") aoFluxo(evento);
    else if (evento.type === "message_start" && (evento.message as MensagemPi).role === "assistant") {
      fluxo = { texto: "", raciocinio: "" };
      desenhar();
    }
  };
  // Fechado de vez (404, 422): a mensagem do servidor só vem pela API. Caído, o navegador reconecta sozinho.
  fonte.onerror = () => {
    if (fonte.readyState === EventSource.CLOSED) api(base).catch(mostrarErro);
  };

  raiz.addEventListener("click", (evento) => {
    const botao = evento.target instanceof Element ? evento.target.closest("button") : null;
    if (botao?.dataset.abortar !== undefined) {
      avisar();
      postar(`${base}/abortar`).catch(mostrarErro);
    } else if (botao && "verTudo" in botao.dataset) verSaida(botao);
  });

  signal.addEventListener("abort", () => {
    fonte.close();
    conversaReact?.desmontarConversa(areaDaConversa);
  });
}
