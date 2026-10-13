// Início (F7 §4.4) no DOM: lê as sessões ativas e o board, desenha com as funções puras de inicio.ts e abre o
// Registrar necessidade na caixa. O app.ts o redesenha a cada 5 s. Os testes de ponta a ponta (e2e/) o exercitam.
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { MetricasMes } from "../../../metricas/periodo.ts";
import type { IssueDoBoard } from "../../rotas/inicio.ts";
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, elemento, irPara, mostrarErro } from "../dom.ts";
import { caminhoDaSessao } from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { formularioDeRegistro, inicio } from "./inicio.ts";
import { mesDe } from "./metricas.ts";

/**
 * Registrar necessidade (F4 §6.6) na caixa: projeto, descrição e dependências; o servidor faz o C1 e abre a sessão, e o
 * navegador vai para o chat dela. A recusa aparece no rodapé, com o que já foi escolhido.
 */
export async function abrirRegistro(issues: readonly IssueDoBoard[], escolhido?: string): Promise<void> {
  const projetos = await api<ProjetoListado[]>("/api/projetos");
  const desenhar = (projeto?: string, deps: readonly string[] = [], descricao = "", falha?: string): void => {
    abrirCaixa({
      titulo: "Registrar necessidade",
      corpo: formularioDeRegistro(projetos, issues, projeto, falha, descricao),
      estreita: true,
    });
    const form = document.querySelector<HTMLFormElement>("[data-registro]");
    if (!form) return;
    for (const caixa of form.querySelectorAll<HTMLInputElement>('[name="deps"]'))
      caixa.checked = deps.includes(caixa.value);
    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const nome = form.querySelector<HTMLSelectElement>('[name="projeto"]')?.value ?? "";
      const marcadas = [...form.querySelectorAll<HTMLInputElement>('[name="deps"]:checked')].map((c) => c.value);
      const descricao = form.querySelector<HTMLTextAreaElement>('[name="descricao"]')?.value ?? "";
      if (descricao.trim() === "") {
        desenhar(nome, marcadas, descricao, "a descrição é obrigatória (descreva a necessidade)");
        return;
      }
      const botao = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (botao) {
        botao.disabled = true;
        botao.textContent = "Registrando…";
      }
      api<{ sessao: string }>("/api/registros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projeto: nome, deps: marcadas.map(Number), descricao }),
      })
        .then(({ sessao }) => {
          elemento("[data-caixa]", HTMLDialogElement).close();
          irPara(caminhoDaSessao(sessao));
        })
        .catch((error_: unknown) => {
          desenhar(nome, marcadas, descricao, error_ instanceof Error ? error_.message : String(error_));
        });
    });
  };
  desenhar(escolhido);
}

/** A página `/home`. Redesenhar preserva a rolagem horizontal do board. */
export async function montarInicio(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const atual = mesDe(new Date());
  const [sessoes, board, [mes]] = await Promise.all([
    api<InfoSessao[]>("/api/sessoes?escopo=ativas", { signal }),
    api<IssueDoBoard[]>("/api/board", { signal }),
    api<[MetricasMes]>(`/api/metricas?de=${atual}&ate=${atual}`, { signal }),
  ]);
  const rolagem = main.querySelector(".board-etapas")?.scrollLeft ?? 0;
  main.innerHTML = inicio({ sessoes, board, mes }, new Date());
  const etapas = main.querySelector(".board-etapas");
  if (etapas) etapas.scrollLeft = rolagem;
  main.querySelector("[data-registrar]")?.addEventListener("click", () => {
    abrirRegistro(board).catch(mostrarErro);
  });
}
