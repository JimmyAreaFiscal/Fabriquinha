// Chat no DOM (F7 §4.4): assina o SSE da sessão, desenha o retrato e acrescenta o que chega ao vivo, com a rolagem
// automática que pausa quando o Auditor sobe, e liga à API o envio com os anexos de histórico, os diálogos, o
// registro, o Responder e retomar, a consulta e o contexto da issue ao lado. O HTML vem de chat.ts; os testes de
// ponta a ponta (e2e/chat.spec.ts) o exercitam no navegador.
import type { Dialogo } from "../../../execucao/gerente.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { CabecalhoDoChat, DadosDoChat } from "../../rotas/chat.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, avisar, elemento, irPara, mostrarErro } from "../dom.ts";
import { caminhoDaSessao, escapar, modeloDoSeletor } from "../render.ts";
import {
  barraDeEstado,
  chaveDa,
  contextoDaIssue,
  conversa,
  edicaoDoRegistro,
  emFluxo,
  envio,
  erroDaFalha,
  etiquetasDeAnexo,
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
  seletorDeSessoes,
} from "./chat.ts";
import { evidenciaNaCaixa, seletorDeModelo } from "./issue.ts";
import { carregarTextos, modelos as modelosDoPi } from "./issue-montar.ts";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div class="coluna-conversa">' +
  '<div class="conversa" data-conversa aria-live="polite"></div><div data-envio-area></div></div>' +
  '<aside class="lateral" aria-label="Ao lado da conversa"><div class="lado" data-lateral></div><div class="lado" data-contexto></div></aside></div></div>';

type Evento = Record<string, unknown> & { type?: string };

const postar = (caminho: string, corpo: unknown = {}) =>
  api<undefined>(caminho, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corpo),
  });

/** O Auditor está no fim da página: o que chega rola junto; se ele subiu para ler, a página fica onde está. */
const noFim = () => innerHeight + scrollY >= document.documentElement.scrollHeight - 48;
const rolarAoFim = () => {
  scrollTo(0, document.documentElement.scrollHeight);
};

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
  const lista = parte("[data-conversa]");
  const areaDeEnvio = parte("[data-envio-area]");
  const aoLado = parte("[data-lateral]");
  const contexto = parte("[data-contexto]");

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
  /** As sessões cujo histórico vai com a próxima mensagem (F4 §6.8). */
  let anexos: InfoSessao[] = [];
  /** A página da issue, para o contexto ao lado, os artefatos na caixa e o seletor de modelo da falha. */
  let pagina: PaginaDaIssue | undefined;
  let leituras = 0;

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

  function desenharAnexos(): void {
    const area = areaDeEnvio.querySelector<HTMLElement>("[data-anexos]");
    if (!area) return;
    area.innerHTML = etiquetasDeAnexo(anexos);
    area.hidden = anexos.length === 0;
  }

  /** Na falha, o seletor de modelo do ticket, quando a issue e os modelos do pi chegam; guarda o valor de partida. */
  function desenharSeletor(): void {
    const lugar = areaDeEnvio.querySelector<HTMLElement>("[data-seletor-modelo]");
    if (!lugar || !pagina || !cabecalho) return;
    const p = pagina;
    const { ticket } = cabecalho;
    void modelosDoPi().then((lista) => {
      lugar.innerHTML = seletorDeModelo(p, ticket, lista);
      const select = lugar.querySelector("select");
      if (select) select.dataset.inicial = select.value;
    });
  }

  /** Relê a página da issue para o contexto ao lado; a resposta de uma leitura antiga não sobrescreve a nova. */
  function lerContexto(c: CabecalhoDoChat): void {
    const vez = ++leituras;
    api<PaginaDaIssue>(`/api/issues/${String(c.issue.id)}`, { signal })
      .then((lida) => {
        if (vez !== leituras || !cabecalho) return;
        pagina = lida;
        contexto.innerHTML = contextoDaIssue(lida, cabecalho.sessao);
        if (!areaDeEnvio.querySelector("[data-seletor-modelo] select:not([disabled])")) desenharSeletor();
      })
      .catch(mostrarErro);
  }

  /** Barra, envio e coluna da direita; envio e coluna só mudam quando a forma muda, para não apagar o que se digita. */
  function aplicar(c: CabecalhoDoChat): void {
    cabecalho = c;
    // Uma execução nova com o modelo fixado (C20) troca o da barra já no início, antes da primeira resposta.
    if (c.execucoes.at(-1)?.modelo) modelo = modeloDe(c, []);
    barra.innerHTML = barraDeEstado(c, modelo);
    const { sessao: s } = c;
    const forma = [s.estado, s.motivo, s.etapa, s.dialogos[0]?.id].join("|");
    if (forma !== formaDoEnvio) {
      formaDoEnvio = forma;
      const digitado = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]")?.value ?? "";
      areaDeEnvio.innerHTML = envio(c, modo);
      const texto = areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]");
      if (texto) texto.value = digitado;
      desenharAnexos();
      desenharSeletor();
    }
    const doLado = JSON.stringify([s.motivo, s.etapa, c.issue, c.registro]);
    const sujo = aoLado.querySelector("[data-sujo]") !== null;
    if (doLado !== formaDoLado && !sujo) {
      formaDoLado = doLado;
      aoLado.innerHTML = lateral(c, Date.now());
    }
    if (s.estado !== "rodando") fecharFluxo();
    linhasNovas([
      ...c.execucoes.flatMap((e, i) => linhasDaExecucao(e, i)),
      ...erroDaFalha(c),
      ...s.dialogos.map(linhaDoDialogo),
    ]);
    lerContexto(c);
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
    if (fonte.readyState === EventSource.CLOSED) api(`/api/sessoes/${encodeURIComponent(sessao)}`).catch(mostrarErro);
  };

  const issue = () => String(cabecalho?.issue.id);
  const ticket = () => String(cabecalho?.sessao.ticket);
  const acao = (promessa: Promise<unknown>) => {
    avisar();
    promessa.catch(mostrarErro);
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
    } else if ("verTudo" in botao.dataset) verSaida(botao);
    else aoClicarNaConsulta(botao);
  });

  /** Conversar sobre, os anexos de histórico e os artefatos ao lado. */
  function aoClicarNaConsulta(botao: HTMLButtonElement): void {
    const { removerAnexo, evidencia } = botao.dataset;
    if ("consulta" in botao.dataset) {
      acao(
        api<{ sessao: string }>(`/api/tickets/${ticket()}/consulta`, { method: "POST" }).then(({ sessao: nova }) => {
          irPara(caminhoDaSessao(nova));
        }),
      );
    } else if ("anexar" in botao.dataset) {
      acao(escolherAnexo());
    } else if (removerAnexo) {
      anexos = anexos.filter((a) => a.sessao !== removerAnexo);
      desenharAnexos();
    } else if (evidencia && pagina) {
      const e = pagina.evidencias.find((x) => x.id === Number(evidencia));
      if (e) {
        abrirCaixa(evidenciaNaCaixa(pagina, e));
        acao(carregarTextos());
      }
    }
  }

  raiz.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const form = evento.target as HTMLFormElement;
    const campos = Object.fromEntries(new FormData(form)) as Record<string, string>;
    if (form.dataset.envio !== undefined) {
      const texto = String(campos.texto).trim();
      if (!texto || !cabecalho) return;
      const modoDoEnvio = cabecalho.sessao.estado === "rodando" ? modo : "prompt";
      const corpo = { texto, modo: modoDoEnvio, ...(anexos.length > 0 && { anexos: anexos.map((a) => a.sessao) }) };
      acao(
        postar(`/api/sessoes/${encodeURIComponent(sessao)}/mensagens`, corpo).then(() => {
          form.reset();
          anexos = [];
          desenharAnexos();
        }),
      );
    } else if (form.dataset.retomar !== undefined) {
      acao(responderERetomar(form, String(campos.texto).trim()));
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

  /**
   * Responder e retomar (F4 §6.4): C20 só quando o modelo mudou, depois C9 com a instrução e os anexos de histórico; o
   * SSE traz o estado novo.
   * Se C20 passar e C9 não, o modelo novo fica, e responder de novo só refaz o C9.
   */
  async function responderERetomar(form: HTMLFormElement, instrucao: string): Promise<void> {
    const select = form.querySelector("select");
    if (select && !select.disabled && select.value !== select.dataset.inicial) {
      await postar(`/api/tickets/${ticket()}/modelo`, { modelo: modeloDoSeletor(select.value) });
      select.dataset.inicial = select.value;
    }
    const comAnexos = anexos.length > 0 ? { anexos: anexos.map((a) => a.sessao) } : {};
    await postar(`/api/tickets/${ticket()}/reabrir`, { ...(instrucao && { instrucao }), ...comAnexos });
    anexos = [];
    desenharAnexos();
  }

  /** As sessões que o seletor do **+ Anexar histórico** mostra na caixa. */
  let escolhas: InfoSessao[] = [];

  /** + Anexar histórico: as outras sessões, ativas e do histórico, na caixa; escolher uma a anexa e fecha a caixa. */
  async function escolherAnexo(): Promise<void> {
    escolhas = (
      await Promise.all(
        (["ativas", "historico"] as const).map((escopo) => api<InfoSessao[]>(`/api/sessoes?escopo=${escopo}`)),
      )
    ).flat();
    abrirCaixa({
      titulo: "Anexar histórico",
      meta: "o agente lê o histórico da sessão escolhida antes de responder",
      estreita: true,
      corpo: seletorDeSessoes(
        escolhas,
        sessao,
        anexos.map((a) => a.sessao),
      ),
    });
  }

  const corpoDaCaixa = elemento("[data-caixa-corpo]", HTMLElement);
  const aoEscolher = (evento: Event) => {
    const alvo = evento.target instanceof Element ? evento.target.closest<HTMLElement>("[data-anexar-sessao]") : null;
    const escolhida = escolhas.find((s) => s.sessao === alvo?.dataset.anexarSessao);
    if (!escolhida) return;
    anexos = [...anexos, escolhida];
    desenharAnexos();
    elemento("[data-caixa]", HTMLDialogElement).close();
    areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea[name=texto]")?.focus();
  };
  corpoDaCaixa.addEventListener("click", aoEscolher, { signal });

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
