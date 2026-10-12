// Chat no DOM (F7 §4.4): assina o SSE da sessão, desenha o retrato e acrescenta o que chega ao vivo, com a rolagem
// automática que pausa quando o Auditor sobe, e liga o envio, os diálogos e o registro à API. O HTML vem de chat.ts;
// os testes de ponta a ponta (e2e/chat.spec.ts) o exercitam no navegador.
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { CabecalhoDoChat, DadosDoChat } from "../../rotas/chat.ts";
import { abrirCaixa, api, avisar } from "../dom.ts";
import { escapar } from "../render.ts";
import {
  barraDeEstado,
  chaveDa,
  conversa,
  edicaoDoRegistro,
  emFluxo,
  envio,
  ferramenta,
  type Item,
  lateral,
  linhaDoDialogo,
  linhasDaExecucao,
  mensagem,
  type MensagemPi,
  type ModoEnvio,
  modeloDe,
  respostaDoDialogo,
} from "./chat.ts";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div class="coluna-conversa">' +
  '<div class="conversa" data-conversa aria-live="polite"></div><div data-envio-area></div></div>' +
  '<aside class="lateral" data-lateral aria-label="Ao lado da conversa"></aside></div></div>';

type Evento = Record<string, unknown> & { type?: string };

const postar = (caminho: string, corpo: unknown = {}) =>
  api<undefined>(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

const mostrar = (erro: unknown) => {
  avisar(erro instanceof Error ? erro.message : String(erro));
};

/** O Auditor está no fim da página: o que chega rola junto; se ele subiu para ler, a página fica onde está. */
const noFim = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 48;
const rolarAoFim = () => {
  scrollTo(0, document.documentElement.scrollHeight);
};

/** Monta o chat da sessão em `main`; devolve o que o desfaz ao sair da página (fecha o SSE). */
export function montarChat(main: HTMLElement, params: Record<string, string>): () => void {
  const sessao = String(params.sessao);
  main.innerHTML = ESQUELETO;
  // Os ouvintes ficam na raiz do chat, que some quando o Auditor troca de página; `main` fica.
  const raiz = main.querySelector<HTMLElement>(".pagina-chat") ?? main;
  const parte = (seletor: string) => raiz.querySelector<HTMLElement>(seletor) ?? raiz;
  const barra = parte("[data-barra]");
  const lista = parte("[data-conversa]");
  const areaDeEnvio = parte("[data-envio-area]");
  const aoLado = parte("[data-lateral]");

  let cabecalho: CabecalhoDoChat | undefined;
  let modelo = "";
  let modo: ModoEnvio = "steer";
  let formaDoEnvio = "";
  let formaDoLado = "";
  /** As chaves do retrato e das linhas do sistema, para o que chega ao vivo não repetir o que já está na tela. */
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

  /** As linhas do sistema que ainda não estão na conversa. */
  function linhasNovas(itens: Item[]): void {
    const novas = itens.filter(({ chave }) => !vistas.has(chave));
    for (const { chave } of novas) vistas.add(chave);
    acrescentar(novas.map(({ html }) => html).join(""));
  }

  function guardarChamadas(m: MensagemPi): void {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    for (const b of m.content ?? []) if (b.type === "toolCall") chamadas.set(String(b.id), { ...b });
  }

  function fecharFluxo(): void {
    fluxo?.el.remove();
    fluxo = undefined;
  }

  /** Barra, envio e coluna da direita; envio e coluna só mudam quando a forma muda, para não apagar o que se digita. */
  function aplicar(c: CabecalhoDoChat): void {
    cabecalho = c;
    barra.innerHTML = barraDeEstado(c, modelo);
    const { sessao: s } = c;
    const forma = [s.estado, s.motivo, s.etapa, s.dialogos[0]?.id].join("|");
    if (forma !== formaDoEnvio) {
      formaDoEnvio = forma;
      const digitado = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]")?.value ?? "";
      areaDeEnvio.innerHTML = envio(c, modo);
      const texto = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]");
      if (texto) texto.value = digitado;
    }
    const doLado = JSON.stringify([s.motivo, s.etapa, c.issue, c.registro]);
    const sujo = aoLado.querySelector("[data-sujo]") !== null;
    if (doLado !== formaDoLado && !sujo) {
      formaDoLado = doLado;
      aoLado.innerHTML = lateral(c, Date.now());
    }
    if (s.estado !== "rodando") fecharFluxo();
    linhasNovas([...c.execucoes.flatMap((e, i) => linhasDaExecucao(e, i)), ...s.dialogos.map(linhaDoDialogo)]);
  }

  function retrato(dados: DadosDoChat): void {
    lista.innerHTML = "";
    vistas.clear();
    chamadas.clear();
    fecharFluxo();
    formaDoEnvio = "";
    formaDoLado = "";
    for (const e of dados.conversa) if (e.type === "message") guardarChamadas(e.message as MensagemPi);
    modelo = modeloDe(dados, dados.conversa);
    const itens = conversa(dados, dados.conversa);
    for (const { chave } of itens) vistas.add(chave);
    lista.innerHTML = itens.map(({ html }) => html).join("");
    aplicar(dados);
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
    if (m.role === "assistant" && cabecalho) {
      modelo = modeloDe(cabecalho, [evento]);
      barra.innerHTML = barraDeEstado(cabecalho, modelo);
    }
    if (!evento.fabriquinha) acrescentar(mensagem(m));
  }

  /** Texto e raciocínio que chegam em `message_update` (F4 §5.4), com o cursor no fim. */
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

  const fonte = new EventSource(`/api/sessoes/${encodeURIComponent(sessao)}/eventos`);
  fonte.onmessage = (mensagemSse) => {
    const evento = JSON.parse(String(mensagemSse.data)) as Evento;
    if (evento.type === "chat") retrato(evento as Evento & DadosDoChat);
    else if (evento.type === "estado") aplicar(evento as Evento & CabecalhoDoChat);
    else if (evento.type === "message_end") aoFimDaMensagem(evento);
    else if (evento.type === "message_update") aoFluxo(evento);
    else if (evento.type === "message_start" && (evento.message as MensagemPi).role === "assistant") {
      fecharFluxo();
      fluxo = { el: document.createElement("div"), texto: "", raciocinio: "" };
      fluxo.el.className = "fluxo";
      fluxo.el.innerHTML = emFluxo("", "");
      acrescentar("");
    } else if (evento.type === "extension_ui_request" && "title" in evento) {
      linhasNovas([linhaDoDialogo(evento as Dialogo)]);
    }
  };
  // Fechado de vez (404, 401): a mensagem do servidor só vem pela API. Caído, o navegador reconecta sozinho.
  fonte.onerror = () => {
    if (fonte.readyState === EventSource.CLOSED) api(`/api/sessoes/${encodeURIComponent(sessao)}`).catch(mostrar);
  };

  const issue = () => String(cabecalho?.issue.id);
  const acao = (promessa: Promise<unknown>) => {
    avisar();
    promessa.catch(mostrar);
  };

  raiz.addEventListener("click", (evento) => {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const botao = alvo?.closest("button");
    if (!botao) return;
    if (botao.dataset.modo) {
      modo = botao.dataset.modo as ModoEnvio;
      for (const b of areaDeEnvio.querySelectorAll<HTMLElement>("[data-modo]")) {
        b.setAttribute("aria-pressed", String(b === botao));
      }
    } else if (botao.dataset.abortar !== undefined) {
      acao(postar(`/api/sessoes/${encodeURIComponent(sessao)}/abortar`));
    } else if (botao.dataset.concluir !== undefined) {
      acao(postar(`/api/tickets/${String(cabecalho?.sessao.ticket)}/concluir-sessao`));
    } else if (botao.dataset.cancelar !== undefined) {
      const id = botao.closest<HTMLElement>("[data-dialogo]")?.dataset.dialogo;
      acao(
        postar(`/api/sessoes/${encodeURIComponent(sessao)}/dialogos/${encodeURIComponent(String(id))}`, {
          cancelado: true,
        }),
      );
    } else if (botao.dataset.devolver !== undefined) {
      const motivo = botao.form?.querySelector("textarea")?.value ?? "";
      acao(postar(`/api/issues/${issue()}/registro`, { aprovado: false, motivo }));
    } else if (botao.dataset.verTudo !== undefined) {
      const saida = botao.closest(".ferramenta")?.querySelector("pre")?.textContent ?? "";
      const nome = botao.closest(".ferramenta")?.querySelector(".nome-f")?.textContent ?? "";
      abrirCaixa({ titulo: `Saída de ${nome}`, corpo: `<pre>${escapar(saida)}</pre>` });
    }
  });

  raiz.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    const campos = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (form.dataset.envio !== undefined) {
      const texto = String(campos.texto).trim();
      if (!texto || !cabecalho) return;
      const modoDoEnvio = cabecalho.sessao.estado === "rodando" ? modo : "prompt";
      acao(
        postar(`/api/sessoes/${encodeURIComponent(sessao)}/mensagens`, { texto, modo: modoDoEnvio }).then(() => {
          form.reset();
        }),
      );
    } else if (form.dataset.dialogo) {
      const corpo = respostaDoDialogo(String(form.dataset.metodo), String(campos.valor));
      acao(
        postar(
          `/api/sessoes/${encodeURIComponent(sessao)}/dialogos/${encodeURIComponent(form.dataset.dialogo)}`,
          corpo,
        ),
      );
    } else if (form.dataset.gateRegistro !== undefined) {
      acao(postar(`/api/issues/${issue()}/registro`, { aprovado: true }));
    } else if (form.dataset.registro !== undefined) {
      const salvo = api<CabecalhoDoChat["issue"]>(`/api/issues/${issue()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(edicaoDoRegistro({ titulo: "", tipo: "", descricao: "", ...campos })),
      }).then((salva) => {
        delete form.dataset.sujo;
        if (cabecalho) aplicar({ ...cabecalho, issue: salva });
      });
      acao(salvo);
    }
  });

  raiz.addEventListener("input", (evento) => {
    const alvo = evento.target as HTMLElement;
    const registro = alvo.closest<HTMLElement>("[data-registro]");
    if (registro) registro.dataset.sujo = "";
    const gate = alvo.closest<HTMLFormElement>("[data-gate-registro]");
    const devolver = gate?.querySelector<HTMLButtonElement>("[data-devolver]");
    if (devolver) devolver.disabled = !gate?.querySelector("textarea")?.value.trim();
  });

  // Enter envia; Shift+Enter quebra a linha.
  raiz.addEventListener("keydown", (evento) => {
    const alvo = evento.target as HTMLElement;
    if (evento.key !== "Enter" || evento.shiftKey || evento.isComposing || !alvo.matches("textarea[name=texto]"))
      return;
    evento.preventDefault();
    alvo.closest("form")?.requestSubmit();
  });

  return () => {
    fonte.close();
  };
}
