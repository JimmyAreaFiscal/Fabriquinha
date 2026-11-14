// Entrada do cliente (F7 §4.4): escolhe a página pelo caminho, troca de página pela History API sem recarregar (os
// links são `<a href>` de verdade, que também abrem em outra aba) e desenha a navegação fixa com quem aguarda. As Etapas do
// SDLC vêm da API antes da primeira página: as telas as desenham sem citá-las pelo nome.
import type { EtapasDoSdlc } from "../system/api/contrato/etapas.ts";
import type { QuantidadeDePendencias } from "../system/api/contrato/inicio.ts";
import type { Parametros } from "./compartilhado/caminhos.ts";
import { type Pagina, rotear } from "./caminhos.ts";
import { definirEtapasDoSdlc } from "./apresentacao/etapas.ts";
import { api, avisar, elemento, mostrarErro, MUDOU } from "./dom.ts";
import { NAO_ENCONTRADA, navegacao, TITULOS } from "./apresentacao/render.ts";
import { montarChat } from "./telas/chat/chat-montar.ts";
import { montarConfiguracao } from "./telas/configuracao/configuracao-montar.ts";
import { montarDemanda, montarDemandas } from "./telas/demandas/demandas-montar.ts";
import { montarHeatmap } from "./telas/heatmap/heatmap-montar.ts";
import { montarHistorico } from "./telas/historico/historico-montar.ts";
import { montarInicio } from "./telas/inicio/inicio-montar.ts";
import { montarMetricas } from "./telas/metricas/metricas-montar.ts";
import { montarProjeto } from "./telas/projeto/projeto-montar.ts";
import { montarSdlc } from "./telas/sdlc/sdlc-montar.ts";

/**
 * Desenha a página em `<main>`. Cada tela troca a sua entrada aqui; a função pura de render fica num módulo à parte.
 * `sinal` é abortado quando o Auditor sai da página: a tela o passa às chamadas da API (a resposta atrasada não desenha
 * por cima da página nova) e aos ouvintes e ao SSE que abre fora do que ela desenha em `main`.
 */
type Montar = (main: HTMLElement, params: Parametros, sinal: AbortSignal) => void | Promise<void>;

const MONTAR: Record<Pagina, Montar> = {
  // O Início já sabe quanto aguarda: o menu reaproveita a resposta que a tela pediu.
  inicio: async (main, params, sinal) => {
    desenharOQueAguarda(await montarInicio(main, params, sinal));
  },
  projeto: montarProjeto,
  heatmap: montarHeatmap,
  metricas: montarMetricas,
  historico: montarHistorico,
  chat: montarChat,
  configuracao: montarConfiguracao,
  sdlc: montarSdlc,
  demandas: montarDemandas,
  demanda: montarDemanda,
};

const cabeca = elemento("[data-navegacao]", HTMLElement);
const main = elemento("main", HTMLElement);
let aguardando = 0;
/** O da página na tela; trocar de página o aborta. */
let pagina = new AbortController();

/** Redesenha a navegação com quanto aguarda o Auditor, no contador do Início. */
function desenharOQueAguarda(quantidade: number): void {
  aguardando = quantidade;
  cabeca.innerHTML = navegacao(rotear(location.pathname)?.pagina, aguardando);
}

/** Pede ao servidor quanto aguarda o Auditor, pela consulta leve do contador. */
async function contar(): Promise<void> {
  desenharOQueAguarda((await api<QuantidadeDePendencias>("/api/pendencias/quantidade")).quantidade);
}

/** Fora do Início, o menu pede o contador; no Início, a tela o entrega junto com o que desenha. */
const contaPeloContador = (pagina: Pagina | undefined): boolean => pagina !== "inicio";

/** Os caminhos que só levam ao Início: a raiz e a lista das demandas, que virou o board do Início. */
const LEVAM_AO_INICIO: ReadonlySet<string> = new Set(["/", "/demandas"]);

function desenhar(): void {
  if (LEVAM_AO_INICIO.has(location.pathname)) history.replaceState(null, "", "/home");
  const rota = rotear(location.pathname);
  document.title = rota ? `${TITULOS[rota.pagina]} · Fabriquinha` : "Fabriquinha";
  cabeca.innerHTML = navegacao(rota?.pagina, aguardando);
  avisar();
  pagina.abort();
  pagina = new AbortController();
  if (rota) Promise.resolve(MONTAR[rota.pagina](main, rota.params, pagina.signal)).catch(mostrarErro);
  else main.innerHTML = NAO_ENCONTRADA;
  if (contaPeloContador(rota?.pagina)) contar().catch(mostrarErro);
}

// Clique comum num link da própria Fabriquinha troca a página sem recarregar; com modificador, nova aba ou download,
// o navegador segue como sempre.
document.addEventListener("click", (evento) => {
  const link = evento.target instanceof Element ? evento.target.closest("a") : null;
  if (
    link?.origin !== location.origin ||
    link.target !== "" ||
    link.hasAttribute("download") ||
    evento.button !== 0 ||
    evento.metaKey ||
    evento.ctrlKey ||
    evento.shiftKey ||
    evento.altKey
  ) {
    return;
  }
  evento.preventDefault();
  // Link para um ponto da própria página: só rola até ele, sem trocar de página nem redesenhá-la.
  if (link.hash !== "" && link.pathname === location.pathname && link.search === location.search) {
    document.getElementById(decodeURIComponent(link.hash.slice(1)))?.scrollIntoView();
    return;
  }
  if (link.href !== location.href) history.pushState(null, "", link.href);
  desenhar();
  scrollTo(0, 0);
});
addEventListener("popstate", desenhar);

// A caixa fecha com Esc (nativo do `<dialog>`), com o ✕ ou clicando fora dela.
const caixa = elemento("[data-caixa]", HTMLDialogElement);
caixa.addEventListener("click", (evento) => {
  if (evento.target === caixa || (evento.target instanceof Element && evento.target.closest("[data-fechar]"))) {
    caixa.close();
  }
});

/** As páginas que se redesenham sozinhas (F7 §4.4). */
const ATUALIZAM: ReadonlySet<Pagina> = new Set(["inicio", "demandas", "projeto"]);

/** A cada 5 s com a aba visível, e ao voltar a ela: o contador da navegação e a página, se ela se atualiza. */
function atualizar(): void {
  if (document.visibilityState !== "visible") return;
  const rota = rotear(location.pathname);
  if (rota && ATUALIZAM.has(rota.pagina)) {
    Promise.resolve(MONTAR[rota.pagina](main, rota.params, pagina.signal)).catch(mostrarErro);
  }
  if (contaPeloContador(rota?.pagina)) contar().catch(mostrarErro);
}
setInterval(atualizar, 5000);
addEventListener(MUDOU, () => {
  contar().catch(mostrarErro);
});
document.addEventListener("visibilitychange", atualizar);

api<EtapasDoSdlc>("/api/etapas").then(definirEtapasDoSdlc).catch(mostrarErro).finally(desenhar);
