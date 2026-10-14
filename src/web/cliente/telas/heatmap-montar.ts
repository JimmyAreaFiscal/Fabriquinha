// Aba Heatmap da página do projeto (F7 §4.4) no DOM: lê o heatmap, desenha a raiz com as funções puras de heatmap.ts e
// desenha o conteúdo de cada pasta ou arquivo na primeira abertura dele. Não se atualiza sozinha: cada abertura relê o
// git. Os testes de ponta a ponta (e2e/) a exercitam.
import type { Heatmap } from "../../../repositorio/heatmap.ts";
import type { Parametros } from "../caminhos.ts";
import { api, ErroDaApi, irPara } from "../dom.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { caminhoDoHeatmap, conteudo, erroDoHeatmap, paginaDoHeatmap, topoDoHeatmap } from "./heatmap.ts";
import { projetoNaoEncontrado } from "./projeto.ts";

/** A página `/projects/:projeto/heatmap`; os ouvintes saem com `signal`, quando o Auditor sai dela. */
export async function montarHeatmap(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const nome = String(params.projeto);
  const projetos = await api<ProjetoListado[]>("/api/projetos", { signal });
  if (!projetos.some((p) => p.nome === nome)) {
    main.innerHTML = projetoNaoEncontrado(nome);
    return;
  }
  main.innerHTML = `${topoDoHeatmap(projetos, nome)}<p class="muted">Lendo o git…</p>`;
  // O seletor vale também sob o erro e sob a leitura: o Auditor não fica preso num projeto que não abre.
  main.addEventListener(
    "change",
    (evento) => {
      if (evento.target instanceof HTMLSelectElement) irPara(caminhoDoHeatmap(evento.target.value));
    },
    { signal },
  );
  let heatmap: Heatmap;
  try {
    heatmap = await api<Heatmap>(`/api/projetos/${encodeURIComponent(nome)}/heatmap`, { signal });
  } catch (error_) {
    if (!(error_ instanceof ErroDaApi)) throw error_;
    main.innerHTML = erroDoHeatmap(projetos, nome, error_.message);
    return;
  }
  main.innerHTML = paginaDoHeatmap(projetos, nome, heatmap);
  // `toggle` não borbulha: a captura em `main` pega o de qualquer `<details>`, de qualquer nível.
  main.addEventListener(
    "toggle",
    ({ target }) => {
      if (!(target instanceof HTMLDetailsElement) || !target.open || target.querySelector(".hm-filhos, .hm-detalhe"))
        return;
      const html = conteudo(heatmap.raiz, String(target.dataset.caminho), heatmap.raiz.alteracoes, heatmap.commits);
      target.insertAdjacentHTML("beforeend", html);
    },
    { capture: true, signal },
  );
}
