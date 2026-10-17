// Chat no DOM (F7 §4.4): assina o SSE da sessão, desenha o retrato e acrescenta o que chega ao vivo, com a rolagem
// automática que pausa quando o Auditor sobe, e liga à API o envio com os anexos de histórico, os diálogos, o
// registro, o Responder e retomar, a consulta e o contexto da issue ao lado. O HTML vem de chat.ts; os testes de
// ponta a ponta (e2e/chat.spec.ts) o exercitam no navegador.
import type { ThreadMessageLike } from "@assistant-ui/react";
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
  comResultado,
  contextoDaIssue,
  conversa,
  edicaoDoRegistro,
  emFluxo,
  envio,
  erroDaFalha,
  etiquetasDeAnexo,
  doSistema,
  type Item,
  lateral,
  linhaDoDialogo,
  linhasDaExecucao,
  mensagem,
  type MensagemPi,
  type ModoEnvio,
  modeloDe,
  propostasDoChat,
  respostaDoDialogo,
  valorDoSelect,
  seletorDeSessoes,
} from "./chat.ts";
import type * as ModuloDaConversa from "./chat-conversa.tsx";
import { evidenciaNaCaixa, seletorDeModelo } from "./issue.ts";
import { carregarTextos, modelos as modelosDoPi } from "./issue-montar.ts";

const ESQUELETO =
  '<div class="pagina-chat"><div data-barra></div><div class="chat-layout"><div data-conversa-area>' +
  "</div>" +
  '<aside class="lateral" aria-label="Ao lado da conversa"><div class="lado" data-lateral></div><div class="lado" data-contexto></div></aside></div></div>';

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
  const aoLado = parte("[data-lateral]");
  const contexto = parte("[data-contexto]");

  let cabecalho: CabecalhoDoChat | undefined;
  let modelo = "";
  let modo: ModoEnvio = "steer";
  let formaDoLado = "";
  /** As chaves do retrato e das linhas do sistema, para o que chega ao vivo não repetir o que já está na tela. */
  const vistas = new Set<string>();
  /** A conversa como o assistant-ui a desenha; o que chega ao vivo entra no fim. */
  let mensagens: ThreadMessageLike[] = [];
  /** A mensagem do agente chegando em fluxo. */
  let fluxo: { texto: string; raciocinio: string } | undefined;
  /** As sessões cujo histórico vai com a próxima mensagem (F4 §6.8). */
  let anexos: InfoSessao[] = [];
  /** A página da issue, para o contexto ao lado, os artefatos na caixa e o seletor de modelo da falha. */
  let pagina: PaginaDaIssue | undefined;
  let leituras = 0;

  /** O componente React da conversa; só o chat o baixa, e até chegar o estado só se acumula em `mensagens`. */
  let conversaReact: typeof ModuloDaConversa | undefined;

  /** Redesenha a conversa e o envio; o React só troca o que mudou, e o Viewport rola junto se o Auditor está no fim. */
  function desenhar(): void {
    if (!cabecalho || !conversaReact) return;
    conversaReact.desenharConversa(areaDeEnvio, {
      mensagens: fluxo ? [...mensagens, emFluxo(fluxo.texto, fluxo.raciocinio)] : mensagens,
      envio: envio(cabecalho, modo),
      anexos: etiquetasDeAnexo(anexos),
      propostas: propostasDoChat(cabecalho),
      aoEnviar: enviar,
    });
    // As etiquetas do formulário de retomada (HTML pronto de chat.ts) ficam por nossa conta; as do compositor, do React.
    const daRetomada = areaDeEnvio.querySelector<HTMLElement>("[data-retomar] [data-anexos]");
    if (daRetomada) {
      daRetomada.innerHTML = etiquetasDeAnexo(anexos);
      daRetomada.hidden = anexos.length === 0;
    }
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

  /** O envio do compositor (F4 §6.8): o modo conforme o estado e os anexos de histórico. */
  async function enviar(texto: string): Promise<void> {
    if (!cabecalho) return;
    avisar();
    const modoDoEnvio = cabecalho.sessao.estado === "rodando" ? modo : "prompt";
    const corpo = { texto, modo: modoDoEnvio, ...(anexos.length > 0 && { anexos: anexos.map((a) => a.sessao) }) };
    try {
      await postar(`/api/sessoes/${encodeURIComponent(sessao)}/mensagens`, corpo);
    } catch (error_) {
      mostrarErro(error_);
      throw error_;
    }
    anexos = [];
    desenhar();
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

  /** Barra, conversa com o envio e coluna da direita; a coluna só muda quando a forma muda, para não apagar o que se digita. */
  function aplicar(c: CabecalhoDoChat): void {
    cabecalho = c;
    // Uma execução nova com o modelo fixado (C20) troca o da barra já no início, antes da primeira resposta.
    if (c.execucoes.at(-1)?.modelo) modelo = modeloDe(c, []);
    barra.innerHTML = barraDeEstado(c, modelo);
    const { sessao: s } = c;
    const doLado = JSON.stringify([s.motivo, s.etapa, c.issue]);
    const sujo = aoLado.querySelector("[data-sujo]") !== null;
    if (doLado !== formaDoLado && !sujo) {
      formaDoLado = doLado;
      aoLado.innerHTML = lateral(c);
    }
    if (s.estado !== "rodando") fecharFluxo();
    linhasNovas([
      ...c.execucoes.flatMap((e, i) => linhasDaExecucao(e, i)),
      ...erroDaFalha(c),
      ...s.dialogos.map(linhaDoDialogo),
    ]);
    desenhar();
    // O select que o Auditor já mexeu não é refeito a cada estado.
    if (!areaDeEnvio.querySelector("[data-seletor-modelo] select:not([disabled])")) desenharSeletor();
    lerContexto(c);
  }

  function retrato(dados: DadosDoChat): void {
    vistas.clear();
    fecharFluxo();
    formaDoLado = "";
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
    else if (!evento.fabriquinha) mensagens = [...mensagens, ...mensagem(m, undefined, evento.aviso === true)];
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
      if (!areaDeEnvio.querySelector("[data-seletor-modelo] select:not([disabled])")) desenharSeletor();
    })
    .catch(mostrarErro);

  const fonte = new EventSource(`/api/sessoes/${encodeURIComponent(sessao)}/eventos`);
  fonte.onmessage = (mensagemSse) => {
    const evento = JSON.parse(String(mensagemSse.data)) as Evento;
    if (evento.type === "chat") retrato(evento as Evento & DadosDoChat);
    else if (evento.type === "estado") aplicar(evento as Evento & CabecalhoDoChat);
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
    } else if (botao.dataset.concluir !== undefined) {
      acao(postar(`/api/tickets/${String(cabecalho?.sessao.ticket)}/concluir-sessao`));
    } else if (botao.dataset.cancelar !== undefined) {
      acao(respondeDialogo(String(dialogoAberto), { cancelado: true }));
    } else if (botao.dataset.acao === "aceitar-proposta" || botao.dataset.acao === "recusar-proposta") {
      botao.disabled = true;
      const decisao = postar(`/api/propostas/${String(botao.dataset.id)}`, {
        aceita: botao.dataset.acao === "aceitar-proposta",
      });
      acao(
        decisao.catch((error_: unknown) => {
          botao.disabled = false;
          throw error_;
        }),
      );
    } else if ("verTudo" in botao.dataset) verSaida(botao);
    else aoClicarNaConsulta(botao);
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
      desenhar();
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
    if (form.dataset.retomar !== undefined) {
      acao(responderERetomar(form, String(campos.texto).trim()));
    } else if (form.dataset.dialogo) {
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

  // Na múltipla escolha, «Outros» é uma caixa que alterna o campo.
  raiz.addEventListener("change", (evento) => {
    const alvo = evento.target as HTMLInputElement;
    if (alvo.dataset.outros !== undefined) mostrarOutros(alvo.closest("form"), alvo.checked);
  });

  raiz.addEventListener("input", (evento) => {
    const alvo = evento.target as HTMLElement;
    const registro = alvo.closest<HTMLElement>("[data-registro]");
    if (registro) registro.dataset.sujo = "";
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
    desenhar();
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
    desenhar();
    elemento("[data-caixa]", HTMLDialogElement).close();
    areaDeEnvio.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  };
  corpoDaCaixa.addEventListener("click", aoEscolher, { signal });

  // Enter envia; Shift+Enter quebra a linha.
  raiz.addEventListener("keydown", (evento) => {
    const alvo = evento.target as HTMLElement;
    if (evento.key !== "Enter" || evento.shiftKey || evento.isComposing || !alvo.matches("[data-retomar] textarea"))
      return;
    evento.preventDefault();
    alvo.closest("form")?.requestSubmit();
  });

  signal.addEventListener("abort", () => {
    fonte.close();
    conversaReact?.desmontarConversa(areaDeEnvio);
  });
}
