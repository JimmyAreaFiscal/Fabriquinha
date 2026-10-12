// Métricas (F7 §4.4) no DOM: lê os projetos e o período, desenha com as funções puras de metricas.ts, mede a área do
// gráfico de evolução, mostra a dica ao passar o mouse e troca o foco, a métrica, a ordem e a tabela sem reler a API.
// Não se atualiza sozinha. Os testes de ponta a ponta (e2e/) a exercitam.
import type { MetricasIssuePeriodo, MetricasMes } from "../../../metricas/periodo.ts";
import type { Parametros } from "../caminhos.ts";
import { api, mostrarErro } from "../dom.ts";
import type { ProjetoListado } from "./configuracao.ts";
import {
  type Coluna,
  type DadosDasMetricas,
  dica,
  type EstadoDasMetricas,
  evolucao,
  type Metrica,
  mesDe,
  paginaDeMetricas,
  periodoPadrao,
  proximaOrdem,
} from "./metricas.ts";

/** Os controles que voltam a ter o foco do teclado depois de um redesenho. */
const FOCAVEIS = ["data-mes", "data-metrica", "data-ordem", "data-tabela", "data-filtro", "data-padrao"];

/** A página `/metrics`; os ouvintes saem com `signal`, quando o Auditor sai dela. */
export function montarMetricas(main: HTMLElement, _params: Parametros, signal: AbortSignal): void {
  const atual = mesDe(new Date());
  const estado: EstadoDasMetricas = {
    projeto: "",
    ...periodoPadrao(atual),
    metrica: "custo",
    ordem: ["custo", -1],
    tabela: false,
  };
  let dados: DadosDasMetricas | undefined;
  let projetos: Promise<ProjetoListado[]> | undefined;
  let pedido = 0;

  function grafico(): void {
    const area = main.querySelector<HTMLElement>("[data-evolucao]");
    if (dados && area && !estado.tabela) area.innerHTML = evolucao(dados.meses, estado, area.clientWidth);
  }

  function desenhar(): void {
    if (!dados) return;
    const ativo = document.activeElement;
    const chave = ativo && main.contains(ativo) ? FOCAVEIS.find((a) => ativo.hasAttribute(a)) : undefined;
    const seletor = chave && `[${chave}="${ativo?.getAttribute(chave) ?? ""}"]`;
    main.innerHTML = paginaDeMetricas(dados, estado);
    grafico();
    if (seletor) main.querySelector<HTMLElement>(seletor)?.focus();
  }

  /** Relê o período; a resposta de um filtro já trocado de novo é descartada. */
  async function carregar(): Promise<void> {
    const meu = ++pedido;
    const q = new URLSearchParams({ de: estado.de, ate: estado.ate });
    if (estado.projeto) q.set("projeto", estado.projeto);
    projetos ??= api<ProjetoListado[]>("/api/projetos", { signal });
    const [lista, meses, issues] = await Promise.all([
      projetos,
      api<MetricasMes[]>(`/api/metricas?${q.toString()}`, { signal }),
      api<MetricasIssuePeriodo[]>(`/api/metricas/issues?${q.toString()}`, { signal }),
    ]);
    if (meu !== pedido) return;
    dados = { projetos: lista.map((p) => p.nome), meses, issues, atual };
    desenhar();
  }
  const recarregar = (): void => {
    carregar().catch(mostrarErro);
  };

  function aoClicar(evento: Event): void {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const mes = alvo?.closest<HTMLElement | SVGElement>("[data-mes]")?.dataset.mes;
    const metrica = alvo?.closest<HTMLElement>("[data-metrica]")?.dataset.metrica as Metrica | undefined;
    const ordem = alvo?.closest<HTMLElement>("[data-ordem]")?.dataset.ordem as Coluna | undefined;
    if (mes) estado.foco = mes;
    else if (metrica) estado.metrica = metrica;
    else if (ordem) estado.ordem = proximaOrdem(estado.ordem, ordem);
    else if (alvo?.closest("[data-tabela]")) estado.tabela = !estado.tabela;
    else if (alvo?.closest("[data-padrao]")) {
      Object.assign(estado, periodoPadrao(atual));
      recarregar();
      return;
    } else return;
    desenhar();
  }

  function aoMudar(evento: Event): void {
    const seletor = evento.target;
    if (!(seletor instanceof HTMLSelectElement) || !seletor.dataset.filtro) return;
    const campo = seletor.dataset.filtro as "projeto" | "de" | "ate";
    estado[campo] = seletor.value;
    estado.foco = estado.ate;
    recarregar();
  }

  /** A dica do mês sob o ponteiro, montada com `textContent`. */
  function aoMover(evento: PointerEvent): void {
    const caixa = main.querySelector<HTMLElement>("[data-dica]");
    const hit = evento.target instanceof Element ? evento.target.closest<SVGElement>(".hit") : null;
    if (!caixa) return;
    if (!dados || !hit?.dataset.mes) {
      caixa.hidden = true;
      return;
    }
    const { titulo, linhas } = dica(dados.meses, estado, hit.dataset.mes);
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = titulo;
    caixa.replaceChildren(
      t,
      ...linhas.map(([cor, valor, nome]) => {
        const l = document.createElement("div");
        l.className = "l";
        const i = document.createElement("i");
        i.style.background = cor;
        const b = document.createElement("b");
        b.textContent = valor;
        const s = document.createElement("span");
        s.textContent = nome;
        l.append(i, b, s);
        return l;
      }),
    );
    caixa.hidden = false;
    caixa.style.left = `${String(Math.min(evento.pageX + 14, scrollX + innerWidth - caixa.offsetWidth - 8))}px`;
    caixa.style.top = `${String(evento.pageY + 14)}px`;
  }

  let espera: ReturnType<typeof setTimeout> | undefined;
  const aoRedimensionar = (): void => {
    clearTimeout(espera);
    espera = setTimeout(grafico, 120);
  };

  main.addEventListener("click", aoClicar, { signal });
  main.addEventListener("change", aoMudar, { signal });
  main.addEventListener("pointermove", aoMover, { signal });
  addEventListener("resize", aoRedimensionar, { signal });
  signal.addEventListener("abort", () => {
    clearTimeout(espera);
  });
  recarregar();
}
