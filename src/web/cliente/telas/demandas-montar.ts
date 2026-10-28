// Quadro e página da demanda no DOM: leem a API e desenham com `quadro` e `pagina`. O app.ts redesenha só o quadro a
// cada 5 s; a página não tem formulário nem ação (os gates são da I-238). Os testes de ponta a ponta (e2e/) os exercitam.
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, ErroDaApi } from "../dom.ts";
import { escapar } from "../render.ts";
import { type DadosDaPagina, type DadosDoQuadro, pagina, quadro } from "./demandas.ts";

export async function montarDemandas(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const dados = await api<DadosDoQuadro>("/api/demandas", { signal });
  const demandas =
    params.projeto === undefined ? dados.demandas : dados.demandas.filter((d) => d.projeto === params.projeto);
  main.innerHTML = quadro({ demandas, trabalho: dados.trabalho });
}

const NAO_ENCONTRADA =
  '<div class="cabeca-pagina"><h1>Demanda não encontrada</h1></div><p class="muted">Esta demanda não existe. <a class="link" href="/demandas">Ir para as demandas</a></p>';

export async function montarDemanda(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  let dados: DadosDaPagina;
  try {
    dados = await api<DadosDaPagina>(`/api/demandas/${encodeURIComponent(params.demanda ?? "")}`, { signal });
  } catch (erro) {
    if (!(erro instanceof ErroDaApi && erro.status === 404)) throw erro;
    main.innerHTML = NAO_ENCONTRADA;
    return;
  }
  main.innerHTML = pagina(dados);
  // A imagem do anexo abre na caixa; os demais anexos seguem o link, em nova aba. O ouvinte sai com a página.
  main.addEventListener(
    "click",
    (evento) => {
      const link = evento.target instanceof Element ? evento.target.closest<HTMLAnchorElement>("a[data-imagem]") : null;
      if (!link || evento.button !== 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
      evento.preventDefault();
      const nome = link.dataset.imagem ?? "";
      abrirCaixa({ titulo: nome, corpo: `<img src="${escapar(link.href)}" alt="${escapar(nome)}" />`, aba: link.href });
    },
    { signal },
  );
}
