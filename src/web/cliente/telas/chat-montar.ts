// Chat no DOM (F7 §4.4): assina o SSE da sessão do ticket da demanda, desenha o retrato e acrescenta o que chega ao
// vivo, com a rolagem automática que pausa quando o Auditor sobe, e liga à API o envio, os diálogos e o aborto. O HTML
// vem de chat.ts; os testes de ponta a ponta (e2e/chat*.spec.ts) o exercitam no navegador.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, avisar, mostrarErro } from "../dom.ts";
import { escapar } from "../render.ts";
import {
  barraDeEstado,
  type Cabecalho,
  chaveDa,
  comResultado,
  conversa,
  type Dados,
  emFluxo,
  envio,
  erroDaFalha,
  doSistema,
  type Item,
  linhaDoDialogo,
  linhasDaExecucao,
  mensagem,
  type MensagemPi,
  type ModoEnvio,
  modeloDe,
  respostaDoDialogo,
  valorDoSelect,
} from "./chat.ts";
import type * as ModuloDaConversa from "./chat-conversa.tsx";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div data-conversa-area></div></div></div>';

type Evento = Record<string, unknown> & { type?: string };

export const postar = (caminho: string, corpo: unknown = {}) =>
  api<undefined>(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

/** O **ver tudo** de uma chamada de ferramenta: a saída inteira na caixa. Também na prévia do Histórico. */
export function verSaida(botao: Element): void {
  const chamada = botao.closest(".ferramenta");
  const saida = chamada?.querySelector("pre")?.textContent ?? "";
  const nome = chamada?.querySelector(".nome-f")?.textContent ?? "";
  abrirCaixa({ titulo: `Saída de ${nome}`, corpo: `<pre>${escapar(saida)}</pre>` });
}

/** Monta o chat da sessão em `main`; ao sair da página (`signal`), fecha o SSE e solta o ouvinte da caixa. */
export function montarChat(main: HTMLElement, params: Parametros, signal: AbortSignal): void {
  const sessao = String(params.sessao);
  main.innerHTML = ESQUELETO;
  // Os ouvintes ficam na raiz do chat, que some quando o Auditor troca de página; `main` fica.
  const raiz = main.querySelector<HTMLElement>(".pagina-chat") ?? main;
  const parte = (seletor: string) => raiz.querySelector<HTMLElement>(seletor) ?? raiz;
  const barra = parte("[data-barra]");
  const areaDeEnvio = parte("[data-conversa-area]");

  let cabecalho: Cabecalho | undefined;
  let modelo = "";
  let modo: ModoEnvio = "steer";
  /** As chaves do retrato e das linhas do sistema, para o que chega ao vivo não repetir o que já está na tela. */
  const vistas = new Set<string>();
  /** A conversa como o assistant-ui a desenha; o que chega ao vivo entra no fim. */
  let mensagens: ThreadMessageLike[] = [];
  /** A mensagem do agente chegando em fluxo. */
  let fluxo: { texto: string; raciocinio: string } | undefined;

  /** O componente React da conversa; só o chat o baixa, e até chegar o estado só se acumula em `mensagens`. */
  let conversaReact: typeof ModuloDaConversa | undefined;

  /** Redesenha a conversa e o envio; o React só troca o que mudou, e o Viewport rola junto se o Auditor está no fim. */
  function desenhar(): void {
    if (!cabecalho || !conversaReact) return;
    conversaReact.desenharConversa(areaDeEnvio, {
      mensagens: fluxo ? [...mensagens, emFluxo(fluxo.texto, fluxo.raciocinio)] : mensagens,
      envio: envio(cabecalho, modo),
      aoEnviar: enviar,
      aoVazio: () => {
        avisar("escreva a mensagem");
      },
    });
  }

  /** As linhas do sistema que ainda não estão na conversa. */
  function linhasNovas(itens: Item[]): void {
    const novas = itens.filter(({ chave }) => !vistas.has(chave));
    for (const { chave } of novas) vistas.add(chave);
    mensagens = [...mensagens, ...novas.map(doSistema)];
  }

  function fecharFluxo(): void {
    fluxo = undefined;
  }

  /** O envio do compositor (F4 §6.8): o modo conforme o estado. */
  async function enviar(texto: string): Promise<void> {
    if (!cabecalho) return;
    avisar();
    const modoDoEnvio = cabecalho.sessao.estado === "rodando" ? modo : "prompt";
    try {
      await postar(`/api/sessoes/${encodeURIComponent(sessao)}/mensagens`, { texto, modo: modoDoEnvio });
    } catch (error_) {
      mostrarErro(error_);
      throw error_;
    }
  }

  /** Barra e conversa com o envio. */
  function aplicar(c: Cabecalho): void {
    cabecalho = c;
    // Uma execução nova com o modelo fixado troca o da barra já no início, antes da primeira resposta.
    if (c.sessao.modelo) modelo = modeloDe(c, []);
    barra.innerHTML = barraDeEstado(c, modelo);
    if (c.sessao.estado !== "rodando") fecharFluxo();
    linhasNovas([
      ...c.execucoes.flatMap(linhasDaExecucao),
      ...erroDaFalha(c),
      ...c.sessao.dialogos.map(linhaDoDialogo),
    ]);
    desenhar();
  }

  function retrato(dados: Dados): void {
    vistas.clear();
    fecharFluxo();
    modelo = modeloDe(dados, dados.conversa);
    mensagens = conversa(dados, dados.conversa);
    for (const { id } of mensagens) vistas.add(String(id));
    for (const e of dados.conversa) if (e.type === "message") vistas.add(chaveDa(e.message as MensagemPi));
    aplicar(dados);
  }

  function aoFimDaMensagem(evento: Evento): void {
    const m = evento.message as MensagemPi;
    if (m.role === "assistant") fecharFluxo();
    if (vistas.has(chaveDa(m))) {
      desenhar();
      return;
    }
    vistas.add(chaveDa(m));
    if (m.role === "toolResult") mensagens = mensagens.map((x) => comResultado(x, m));
    else if (!evento.fabriquinha) mensagens = [...mensagens, ...mensagem(m)];
    if (m.role === "assistant" && cabecalho) {
      modelo = modeloDe(cabecalho, [evento]);
      barra.innerHTML = barraDeEstado(cabecalho, modelo);
    }
    desenhar();
  }

  /** Texto e raciocínio que chegam em `message_update` (F4 §5.4), com o cursor no fim. */
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

  const fonte = new EventSource(`/api/sessoes/${encodeURIComponent(sessao)}/eventos`);
  fonte.onmessage = (mensagemSse) => {
    const evento = JSON.parse(String(mensagemSse.data)) as Evento;
    if (evento.type === "chat") retrato(evento as Evento & Dados);
    else if (evento.type === "estado") aplicar(evento as Evento & Cabecalho);
    else if (evento.type === "message_end") aoFimDaMensagem(evento);
    else if (evento.type === "message_update") aoFluxo(evento);
    else if (evento.type === "message_start" && (evento.message as MensagemPi).role === "assistant") {
      fluxo = { texto: "", raciocinio: "" };
      desenhar();
    } else if (evento.type === "extension_ui_request" && "title" in evento) {
      linhasNovas([linhaDoDialogo(evento as Dialogo)]);
      desenhar();
    }
  };
  // Fechado de vez (404, 401): a mensagem do servidor só vem pela API. Caído, o navegador reconecta sozinho.
  fonte.onerror = () => {
    if (fonte.readyState === EventSource.CLOSED) api(`/api/sessoes/${encodeURIComponent(sessao)}`).catch(mostrarErro);
  };

  const acao = (promessa: Promise<unknown>) => {
    avisar();
    promessa.catch(mostrarErro);
  };

  raiz.addEventListener("click", (evento) => {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const botao = alvo?.closest("button");
    if (!botao) return;
    const dialogoAberto = botao.closest<HTMLElement>("[data-dialogo]")?.dataset.dialogo;
    if (botao.dataset.opcao !== undefined) {
      acao(respondeDialogo(String(dialogoAberto), { valor: botao.dataset.opcao }));
    } else if (botao.dataset.outros !== undefined) {
      mostrarOutros(botao.closest("form"), true);
    } else if (botao.dataset.modo) {
      modo = botao.dataset.modo as ModoEnvio;
      desenhar();
    } else if (botao.dataset.abortar !== undefined) {
      acao(postar(`/api/sessoes/${encodeURIComponent(sessao)}/abortar`));
    } else if (botao.dataset.cancelar !== undefined) {
      acao(respondeDialogo(String(dialogoAberto), { cancelado: true }));
    } else if ("verTudo" in botao.dataset) verSaida(botao);
  });

  const respondeDialogo = (id: string, corpo: object) =>
    postar(`/api/sessoes/${encodeURIComponent(sessao)}/dialogos/${encodeURIComponent(id)}`, corpo);

  /** «Outros» do select: o campo de texto (obrigatório enquanto à mostra) e, na escolha única, o Responder. */
  function mostrarOutros(form: HTMLFormElement | null, mostrar: boolean): void {
    const campo = form?.querySelector<HTMLTextAreaElement>("textarea[name=outro]");
    if (!form || !campo) return;
    campo.hidden = campo.disabled = !mostrar;
    const responder = form.querySelector<HTMLElement>("[data-responder-outros]");
    if (responder) responder.hidden = !mostrar;
    if (mostrar) campo.focus();
  }

  raiz.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    const campos = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (form.dataset.dialogo) {
      const valor =
        form.dataset.metodo === "select"
          ? valorDoSelect(
              form.dataset.multipla !== undefined,
              new FormData(form).getAll("opcao").map(String),
              campos.outro ?? "",
            )
          : String(campos.valor);
      if (valor !== undefined)
        acao(respondeDialogo(form.dataset.dialogo, respostaDoDialogo(String(form.dataset.metodo), valor)));
    }
  });

  // Na múltipla escolha, «Outros» é uma caixa que alterna o campo.
  raiz.addEventListener("change", (evento) => {
    const alvo = evento.target as HTMLInputElement;
    if (alvo.dataset.outros !== undefined) mostrarOutros(alvo.closest("form"), alvo.checked);
  });

  signal.addEventListener("abort", () => {
    fonte.close();
    conversaReact?.desmontarConversa(areaDeEnvio);
  });
}
