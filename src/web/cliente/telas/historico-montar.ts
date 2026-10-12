// Histórico (F7 §4.4) no DOM: lê as sessões terminadas com os filtros, desenha a lista com as funções puras de
// historico.ts, mostra a prévia da escolhida e abre a consulta (C21) dela. Não se atualiza sozinho: o que terminou fica
// terminado. Os testes de ponta a ponta (e2e/historico.spec.ts) o exercitam.
import type { DadosDoChat } from "../../rotas/chat.ts";
import type { SessaoDoHistorico } from "../../rotas/historico.ts";
import type { Parametros } from "../caminhos.ts";
import { api, avisar, elemento, irPara, mostrarErro } from "../dom.ts";
import { caminhoDaSessao } from "../render.ts";
import { verSaida } from "./chat-montar.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { consulta, contagem, type Filtros, listaDoHistorico, paginaDoHistorico, previa } from "./historico.ts";

// Valem entre as visitas à página, como os filtros do projeto.
const filtros: Filtros = { projeto: "", issue: "", etapa: "" };
let selecionada = "";

export async function montarHistorico(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const projetos = await api<ProjetoListado[]>("/api/projetos", { signal });
  main.innerHTML = paginaDoHistorico(
    projetos.map((p) => p.nome),
    filtros,
  );
  const raiz = elemento(".pagina-historico", HTMLElement);
  const lista = elemento("[data-lista]", HTMLElement);
  const total = elemento("[data-contagem]", HTMLElement);
  let sessoes: SessaoDoHistorico[] = [];
  /** O último pedido de sessões: a resposta de um filtro já trocado não desenha por cima da do atual. */
  let pedido = 0;

  /** Lê a prévia da selecionada pela rota do chat e a põe ao lado, se ela ainda é a selecionada. */
  async function carregarPrevia(s: SessaoDoHistorico): Promise<void> {
    const dados = await api<DadosDoChat>(`/api/sessoes/${encodeURIComponent(s.sessao)}`, { signal });
    const lugar = lista.querySelector("[data-previa]");
    if (s.sessao === selecionada && lugar) lugar.innerHTML = previa(s, dados, new Date());
  }

  /** A lista com a selecionada (ou a mais recente) marcada, e a prévia dela. */
  function desenhar(): void {
    const sel = sessoes.find((s) => s.sessao === selecionada) ?? sessoes[0];
    selecionada = sel?.sessao ?? "";
    total.textContent = contagem(sessoes.length);
    lista.innerHTML = listaDoHistorico(sessoes, selecionada, new Date());
    if (sel) carregarPrevia(sel).catch(mostrarErro);
  }

  async function carregar(): Promise<void> {
    const n = ++pedido;
    const query = consulta(filtros);
    const lidas = query === undefined ? [] : await api<SessaoDoHistorico[]>(`/api/sessoes?${query}`, { signal });
    if (n !== pedido) return;
    // A API devolve da mais antiga para a mais recente (F4 §5.3).
    sessoes = lidas.toReversed();
    desenhar();
  }

  raiz.addEventListener("input", (evento) => {
    const campo = evento.target;
    if (!(campo instanceof HTMLInputElement || campo instanceof HTMLSelectElement) || !campo.dataset.f) return;
    filtros[campo.dataset.f as keyof Filtros] = campo.value.trim();
    avisar();
    carregar().catch(mostrarErro);
  });

  raiz.addEventListener("click", (evento) => {
    const alvo =
      evento.target instanceof Element
        ? evento.target.closest<HTMLElement>("[data-sel], [data-consulta], [data-ver-tudo]")
        : null;
    if (alvo?.dataset.verTudo !== undefined) verSaida(alvo);
    else if (alvo?.dataset.sel !== undefined) {
      selecionada = alvo.dataset.sel;
      desenhar();
      lista.querySelector<HTMLElement>(`[data-sel="${CSS.escape(selecionada)}"]`)?.focus();
    } else if (alvo?.dataset.consulta) {
      (alvo as HTMLButtonElement).disabled = true;
      avisar();
      api<{ sessao: string }>(`/api/tickets/${alvo.dataset.consulta}/consulta`, { method: "POST" })
        .then(({ sessao }) => {
          irPara(caminhoDaSessao(sessao));
        })
        .catch((error_: unknown) => {
          (alvo as HTMLButtonElement).disabled = false;
          mostrarErro(error_);
        });
    }
  });

  await carregar();
}
