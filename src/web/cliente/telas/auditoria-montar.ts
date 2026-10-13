// Auditoria no DOM (F4; F7 §4.4): assina o SSE da auditoria, desenha o retrato e acrescenta o que chega ao vivo, como o
// chat, mas sem o que é de ticket; liga ao servidor o envio da pergunta e o Abortar. O HTML vem de auditoria.ts; os
// testes de ponta a ponta (e2e/auditoria.spec.ts) o exercitam no navegador.
import type { Parametros } from "../caminhos.ts";
import { api, avisar, mostrarErro } from "../dom.ts";
import {
  barraDaAuditoria,
  conversaDaAuditoria,
  type DadosDaAuditoria,
  envioDaAuditoria,
  inicioDaAuditoria,
  ladoDaAuditoria,
  modeloDaAuditoria,
} from "./auditoria.ts";
import { chaveDa, emFluxo, ferramenta, mensagem, type MensagemPi } from "./chat.ts";
import { noFim, postar, rolarAoFim, verSaida } from "./chat-montar.ts";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div class="coluna-conversa">' +
  '<div class="conversa" data-conversa aria-live="polite"></div><div data-envio-area></div></div>' +
  '<aside class="lateral" aria-label="Ao lado da conversa"><div class="lado" data-lateral></div></aside></div></div>';

type Evento = Record<string, unknown> & { type?: string };

/** Monta o chat da auditoria em `main`; ao sair da página (`signal`), fecha o SSE. */
export function montarAuditoria(main: HTMLElement, params: Parametros, signal: AbortSignal): void {
  const sessao = String(params.sessao);
  const base = `/api/auditorias/${encodeURIComponent(sessao)}`;
  main.innerHTML = ESQUELETO;
  const raiz = main.querySelector<HTMLElement>(".pagina-chat") ?? main;
  const parte = (seletor: string) => raiz.querySelector<HTMLElement>(seletor) ?? raiz;
  const barra = parte("[data-barra]");
  const lista = parte("[data-conversa]");
  const areaDeEnvio = parte("[data-envio-area]");
  const aoLado = parte("[data-lateral]");

  let dados: DadosDaAuditoria | undefined;
  let modelo = "";
  let formaDoEnvio = "";
  /** As chaves da conversa, para o que chega ao vivo não repetir o que já está na tela. */
  const vistas = new Set<string>();
  /** As chamadas de ferramenta por id, para completá-las quando o resultado chegar. */
  const chamadas = new Map<string, Record<string, unknown>>();
  /** A mensagem do agente chegando em fluxo. */
  let fluxo: { el: HTMLElement; texto: string; raciocinio: string } | undefined;

  /** Acrescenta ao fim da conversa, antes do que chega em fluxo, rolando junto se o Auditor está no fim. */
  function acrescentar(html: string): void {
    const rolar = noFim();
    lista.insertAdjacentHTML("beforeend", html);
    if (fluxo) lista.append(fluxo.el);
    if (rolar) rolarAoFim();
  }

  function guardarChamadas(m: MensagemPi): void {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    for (const b of m.content ?? []) if (b.type === "toolCall") chamadas.set(String(b.id), { ...b });
  }

  function fecharFluxo(): void {
    fluxo?.el.remove();
    fluxo = undefined;
  }

  /** Barra e envio; o envio só muda quando o estado muda, para não apagar o que se digita. */
  function aplicar(d: DadosDaAuditoria): void {
    dados = d;
    barra.innerHTML = barraDaAuditoria(d, modelo);
    if (d.estado !== formaDoEnvio) {
      formaDoEnvio = d.estado;
      const digitado = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]")?.value ?? "";
      areaDeEnvio.innerHTML = envioDaAuditoria(d.estado);
      const texto = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]");
      if (texto) texto.value = digitado;
    }
    if (d.estado !== "rodando") fecharFluxo();
  }

  function retrato(lido: DadosDaAuditoria): void {
    vistas.clear();
    chamadas.clear();
    fecharFluxo();
    formaDoEnvio = "";
    for (const e of lido.conversa as { message?: MensagemPi }[]) if (e.message) guardarChamadas(e.message);
    modelo = modeloDaAuditoria(lido.conversa);
    const itens = conversaDaAuditoria(lido);
    for (const { chave } of itens) vistas.add(chave);
    lista.innerHTML = itens.map(({ html }) => html).join("");
    aoLado.innerHTML = ladoDaAuditoria(lido);
    aplicar(lido);
    rolarAoFim();
  }

  function aoFimDaMensagem(evento: Evento): void {
    const m = evento.message as MensagemPi;
    if (m.role === "assistant") fecharFluxo();
    if (vistas.has(chaveDa(m))) return;
    if (m.role === "toolResult") {
      const el = lista.querySelector<HTMLDetailsElement>(`[data-chamada="${CSS.escape(String(m.toolCallId))}"]`);
      const chamada = chamadas.get(String(m.toolCallId));
      if (el && chamada) el.outerHTML = ferramenta(chamada, m, el.open);
      return;
    }
    guardarChamadas(m);
    if (m.role === "assistant" && dados) {
      modelo = modeloDaAuditoria([evento]);
      barra.innerHTML = barraDaAuditoria(dados, modelo);
    }
    if (evento.fabriquinha && dados) acrescentar(inicioDaAuditoria(dados));
    else acrescentar(mensagem(m));
  }

  /** Texto e raciocínio que chegam em `message_update`, com o cursor no fim. */
  function aoFluxo(evento: Evento): void {
    const delta = evento.assistantMessageEvent as { type?: string; delta?: string } | undefined;
    if (!fluxo || !delta?.delta) return;
    if (delta.type === "text_delta") fluxo.texto += delta.delta;
    else if (delta.type === "thinking_delta") fluxo.raciocinio += delta.delta;
    else return;
    const rolar = noFim();
    fluxo.el.innerHTML = emFluxo(fluxo.texto, fluxo.raciocinio);
    if (rolar) rolarAoFim();
  }

  const fonte = new EventSource(`${base}/eventos`);
  fonte.onmessage = (mensagemSse) => {
    const evento = JSON.parse(String(mensagemSse.data)) as Evento;
    if (evento.type === "auditoria") retrato({ ...(evento as Evento & DadosDaAuditoria), sessao });
    else if (evento.type === "estado" && dados)
      aplicar({ ...dados, estado: evento.estado as DadosDaAuditoria["estado"] });
    else if (evento.type === "message_end") aoFimDaMensagem(evento);
    else if (evento.type === "message_update") aoFluxo(evento);
    else if (evento.type === "message_start" && (evento.message as MensagemPi).role === "assistant") {
      fecharFluxo();
      fluxo = { el: document.createElement("div"), texto: "", raciocinio: "" };
      fluxo.el.className = "fluxo";
      fluxo.el.innerHTML = emFluxo("", "");
      acrescentar("");
    }
  };
  // Fechado de vez (404, 422): a mensagem do servidor só vem pela API. Caído, o navegador reconecta sozinho.
  fonte.onerror = () => {
    if (fonte.readyState === EventSource.CLOSED) api(base).catch(mostrarErro);
  };

  const acao = (promessa: Promise<unknown>) => {
    avisar();
    promessa.catch(mostrarErro);
  };

  raiz.addEventListener("click", (evento) => {
    const botao = evento.target instanceof Element ? evento.target.closest("button") : null;
    if (botao?.dataset.abortar !== undefined) acao(postar(`${base}/abortar`));
    else if (botao && "verTudo" in botao.dataset) verSaida(botao);
  });

  raiz.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    const { texto = "" } = Object.fromEntries(new FormData(form)) as { texto?: string };
    if (!texto.trim()) return;
    acao(
      postar(`${base}/mensagens`, { texto: texto.trim() }).then(() => {
        form.reset();
      }),
    );
  });

  // Enter envia; Shift+Enter quebra a linha.
  raiz.addEventListener("keydown", (evento) => {
    const alvo = evento.target as HTMLElement;
    if (evento.key !== "Enter" || evento.shiftKey || evento.isComposing || !alvo.matches("textarea[name=texto]"))
      return;
    evento.preventDefault();
    alvo.closest("form")?.requestSubmit();
  });

  signal.addEventListener("abort", () => {
    fonte.close();
  });
}
