// Avaliações (D12; I-240) no DOM: carrega os projetos e a lista, recarrega as demandas do período ao mudar projeto ou
// datas, dispara a avaliação (a recusa vai ao aviso) e abre a escolhida. Os testes de ponta a ponta (e2e/) o exercitam.
import type { Parametros } from "../caminhos.ts";
import { api, avisar, elemento, irPara, mostrarErro } from "../dom.ts";
import { caminhoDaAvaliacao } from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { type AvaliacaoListada, caixinhasDeDemandas, listaDasAvaliacoes, paginaDasAvaliacoes } from "./avaliacoes.ts";

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
