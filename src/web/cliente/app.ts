// Entrada do cliente (F7 §4.4): escolhe a página pelo caminho, troca de página pela History API sem recarregar (os
// links são `<a href>` de verdade, que também abrem em outra aba) e desenha a navegação fixa com quem aguarda.
import { type Pagina, type Parametros, rotear } from "./caminhos.ts";
import { api, avisar, elemento, mostrarErro, MUDOU } from "./dom.ts";
import { NAO_ENCONTRADA, navegacao, TITULOS } from "./render.ts";
import { montarChat } from "./telas/chat-montar.ts";
import { montarConfiguracao } from "./telas/configuracao-montar.ts";
import { montarHistorico } from "./telas/historico-montar.ts";
import { montarInicio } from "./telas/inicio-montar.ts";
import { montarIssue } from "./telas/issue-montar.ts";
import { montarMetricas } from "./telas/metricas-montar.ts";
import { montarProjeto } from "./telas/projeto-montar.ts";

/**
 * Desenha a página em `<main>`. Cada tela troca a sua entrada aqui; a função pura de render fica num módulo à parte.
 * `sinal` é abortado quando o Auditor sai da página: a tela o passa às chamadas da API (a resposta atrasada não desenha
 * por cima da página nova) e aos ouvintes e ao SSE que abre fora do que ela desenha em `main`.
 */
type Montar = (main: HTMLElement, params: Parametros, sinal: AbortSignal) => void | Promise<void>;

const MONTAR: Record<Pagina, Montar> = {
  inicio: montarInicio,
  projeto: montarProjeto,
  issue: montarIssue,
  metricas: montarMetricas,
  historico: montarHistorico,
  chat: montarChat,
  configuracao: montarConfiguracao,
};

const cabeca = elemento("[data-navegacao]", HTMLElement);
const main = elemento("main", HTMLElement);
let aguardando = 0;
/** O da página na tela; trocar de página o aborta. */
let pagina = new AbortController();

/** Quantas sessões aguardam o Auditor, para o contador do Início. */
async function contar(): Promise<void> {
  const ativas = await api<{ estado: string }[]>("/api/sessoes?escopo=ativas");
  aguardando = ativas.filter((s) => s.estado === "aguardando_humano").length;
  cabeca.innerHTML = navegacao(rotear(location.pathname)?.pagina, aguardando);
}

function desenhar(): void {
  if (location.pathname === "/") history.replaceState(null, "", "/home");
  const rota = rotear(location.pathname);
  document.title = rota ? `${TITULOS[rota.pagina]} · Fabriquinha` : "Fabriquinha";
  cabeca.innerHTML = navegacao(rota?.pagina, aguardando);
  avisar();
  pagina.abort();
  pagina = new AbortController();
  if (rota) Promise.resolve(MONTAR[rota.pagina](main, rota.params, pagina.signal)).catch(mostrarErro);
  else main.innerHTML = NAO_ENCONTRADA;
  contar().catch(mostrarErro);
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
const ATUALIZAM: ReadonlySet<Pagina> = new Set(["inicio", "projeto"]);

/** A cada 5 s com a aba visível, e ao voltar a ela: o contador da navegação e a página, se ela se atualiza. */
function atualizar(): void {
  if (document.visibilityState !== "visible") return;
  const rota = rotear(location.pathname);
  if (rota && ATUALIZAM.has(rota.pagina)) {
    Promise.resolve(MONTAR[rota.pagina](main, rota.params, pagina.signal)).catch(mostrarErro);
  }
  contar().catch(mostrarErro);
}
setInterval(atualizar, 5000);
addEventListener(MUDOU, () => {
  contar().catch(mostrarErro);
});
document.addEventListener("visibilitychange", atualizar);

desenhar();
