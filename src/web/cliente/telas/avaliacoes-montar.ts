// Avaliações (D12; I-240) no DOM: carrega os projetos e a lista, recarrega as demandas do período ao mudar projeto ou
// datas, dispara a avaliação (a recusa vai ao aviso) e abre a escolhida; no detalhe, assina o SSE, desenha escopo,
// achados e a conversa (o componente React do chat, carregado com import()) e liga Encaminhar e Abortar. Os testes de
// ponta a ponta (e2e/avaliacoes.spec.ts) o exercitam no navegador.
import type { ThreadMessageLike } from "@assistant-ui/react";
import type { Parametros } from "../caminhos.ts";
import { api, avisar, elemento, irPara, mostrarErro } from "../dom.ts";
import { caminhoDaAvaliacao } from "../render.ts";
import {
  achadosDaAvaliacao,
  type AvaliacaoListada,
  barraDaAvaliacao,
  caixinhasDeDemandas,
  conversaDaAvaliacao,
  type DadosDaAvaliacao,
  envioDaAvaliacao,
  escopoDaAvaliacao,
  linhaDoInicioDaAvaliacao,
  listaDasAvaliacoes,
  paginaDasAvaliacoes,
} from "./avaliacoes.ts";
import { chaveDa, comResultado, emFluxo, mensagem, type MensagemPi, modeloDaConversa } from "./chat.ts";
import type * as ModuloDaConversa from "./chat-conversa.tsx";
import { postar } from "./chat-montar.ts";
import type { ProjetoListado } from "./configuracao.ts";

const JSON_ = { "Content-Type": "application/json" };

export async function montarAvaliacoes(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const [projetos, lidas] = await Promise.all([
    api<ProjetoListado[]>("/api/projetos", { signal }),
    api<AvaliacaoListada[]>("/api/avaliacoes", { signal }),
  ]);
  main.innerHTML = paginaDasAvaliacoes(projetos.map((p) => p.nome));
  elemento("[data-lista]", HTMLElement).innerHTML = listaDasAvaliacoes(lidas);
  const [projeto, de, ate] = [
    elemento("[data-projeto]", HTMLSelectElement),
    elemento("[data-de]", HTMLInputElement),
    elemento("[data-ate]", HTMLInputElement),
  ];
  const demandas = elemento("[data-demandas]", HTMLElement);
  const marcadas = (): string[] =>
    [...demandas.querySelectorAll<HTMLInputElement>("[data-demanda]:checked")].map((c) => c.value);
  /** O último pedido: a resposta de um período já trocado não desenha por cima da do atual. */
  let pedido = 0;

  async function recarregarDemandas(): Promise<void> {
    const n = ++pedido;
    const completo = projeto.value !== "" && de.value !== "" && ate.value !== "";
    const query = new URLSearchParams({ projeto: projeto.value, de: de.value, ate: ate.value });
    const achadas = completo
      ? await api<{ id: string; titulo: string }[]>(`/api/avaliacoes/demandas?${query.toString()}`, { signal })
      : undefined;
    if (n === pedido) demandas.innerHTML = caixinhasDeDemandas(achadas);
  }

  for (const campo of [projeto, de, ate]) {
    campo.addEventListener("change", () => {
      recarregarDemandas().catch(mostrarErro);
    });
  }
  demandas.innerHTML = caixinhasDeDemandas(undefined);

  elemento("[data-form]", HTMLFormElement).addEventListener("submit", (evento) => {
    evento.preventDefault();
    const botao = elemento("[data-avaliar]", HTMLButtonElement);
    botao.disabled = true;
    avisar();
    const escolhidas = marcadas();
    api<{ id: string }>("/api/avaliacoes", {
      method: "POST",
      headers: JSON_,
      body: JSON.stringify({
        projeto: projeto.value,
        de: de.value,
        ate: ate.value,
        ...(escolhidas.length > 0 && { demandas: escolhidas }),
        pedido: elemento("[data-pedido]", HTMLTextAreaElement).value,
      }),
    })
      .then(({ id }) => {
        irPara(caminhoDaAvaliacao(id));
      })
      .catch((erro: unknown) => {
        botao.disabled = false;
        mostrarErro(erro);
      });
  });
}

const ESQUELETO =
  '<div class="pagina-avaliacao"><div data-barra></div><div class="avaliacao-layout"><div class="coluna-achados">' +
  "<div data-escopo></div><div data-achados></div></div><div data-conversa-area></div></div></div>";

type Evento = Record<string, unknown> & { type?: string };

/** Monta a avaliação em `main`; ao sair da página (`signal`), fecha o SSE e desmonta a conversa. */
export function montarAvaliacao(main: HTMLElement, params: Parametros, signal: AbortSignal): void {
  const id = String(params.avaliacao);
  const base = `/api/avaliacoes/${encodeURIComponent(id)}`;
  main.innerHTML = ESQUELETO;
  const raiz = elemento(".pagina-avaliacao", HTMLElement);
  const parte = (seletor: string) => elemento(seletor, HTMLElement);
  const [barra, escopo, achados, areaDaConversa] = [
    parte("[data-barra]"),
    parte("[data-escopo]"),
    parte("[data-achados]"),
    parte("[data-conversa-area]"),
  ];

  let dados: DadosDaAvaliacao | undefined;
  let modelo = "";
  /** As chaves da conversa, para o que chega ao vivo não repetir o que já está na tela. */
  const vistas = new Set<string>();
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

  function desenhar(): void {
    if (!dados || !conversaReact) return;
    conversaReact.desenharConversa(areaDaConversa, {
      mensagens: fluxo ? [...mensagens, emFluxo(fluxo.texto, fluxo.raciocinio)] : mensagens,
      envio: envioDaAvaliacao(dados.estado),
      aoEnviar: enviar,
    });
  }

  function aplicar(d: DadosDaAvaliacao): void {
    dados = d;
    barra.innerHTML = barraDaAvaliacao(d, modelo);
    escopo.innerHTML = escopoDaAvaliacao(d);
    achados.innerHTML = achadosDaAvaliacao(d);
    if (d.estado !== "rodando") fluxo = undefined;
    desenhar();
  }

  function retrato(lido: DadosDaAvaliacao): void {
    vistas.clear();
    fluxo = undefined;
    modelo = modeloDaConversa(lido.conversa);
    mensagens = conversaDaAvaliacao(lido);
    for (const { id: chave } of mensagens) vistas.add(String(chave));
    for (const e of lido.conversa as { message?: MensagemPi }[]) if (e.message) vistas.add(chaveDa(e.message));
    aplicar(lido);
  }

  /** Relê o detalhe: o estado e os achados mudam fora da conversa (o agente registra; o Auditor encaminha). */
  async function reler(): Promise<void> {
    const lido = await api<DadosDaAvaliacao>(base, { signal });
    if (dados) aplicar({ ...dados, estado: lido.estado, achados: lido.achados });
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
    else if (evento.fabriquinha && dados) mensagens = [...mensagens, ...linhaDoInicioDaAvaliacao(m, dados)];
    else mensagens = [...mensagens, ...mensagem(m)];
    if (m.role === "assistant" && dados) {
      modelo = modeloDaConversa([evento]);
      barra.innerHTML = barraDaAvaliacao(dados, modelo);
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
    if (evento.type === "avaliacao") retrato(evento as Evento & DadosDaAvaliacao);
    else if (evento.type === "estado") reler().catch(mostrarErro);
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
    } else if (botao?.dataset.encaminhar !== undefined) {
      avisar();
      botao.disabled = true;
      postar(`${base}/achados/${botao.dataset.encaminhar}/encaminhar`)
        .then(reler)
        .catch((erro: unknown) => {
          botao.disabled = false;
          mostrarErro(erro);
        });
    }
  });

  signal.addEventListener("abort", () => {
    fonte.close();
    conversaReact?.desmontarConversa(areaDaConversa);
  });
}
