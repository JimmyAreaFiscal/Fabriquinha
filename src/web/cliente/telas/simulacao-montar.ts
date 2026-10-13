// Simulação (F7 §4.4, F8) no DOM: lê a API, desenha com as funções puras de simulacao.ts e cria a Tarefa, com os erros
// do 422 ao lado dos campos. Os testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Tarefa, UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import type { Parametros } from "../caminhos.ts";
import { api, ErroDaApi, mostrarErro } from "../dom.ts";
import { type Erros, errosDoZod, type ProjetoListado } from "./configuracao.ts";
import { lembrar, ultimoVisto } from "./projeto-montar.ts";
import { escolherProjeto, projetoNaoEncontrado } from "./projeto.ts";
import {
  caminhoDaSimulacao,
  paginaDaSimulacao,
  RASCUNHO_VAZIO,
  type Rascunho,
  SEM_PROJETOS_DA_SIMULACAO,
} from "./simulacao.ts";

/** O que o formulário de nova Tarefa tem agora. */
const lerRascunho = (form: HTMLFormElement): Rascunho => ({
  texto: form.querySelector<HTMLTextAreaElement>('[name="texto"]')?.value ?? "",
  n: form.querySelector<HTMLInputElement>('[name="n"]')?.value ?? "",
  usuarios: [...form.querySelectorAll<HTMLInputElement>('[name="usuarios"]:checked')].map((c) => Number(c.value)),
});

/** A página `/simulation` e `/simulation/:projeto`. */
export async function montarSimulacao(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const projetos = await api<ProjetoListado[]>("/api/projetos", { signal });
  const nome = params.projeto ?? escolherProjeto(projetos, ultimoVisto());
  if (nome === undefined) {
    main.innerHTML = SEM_PROJETOS_DA_SIMULACAO;
    return;
  }
  const projeto = projetos.find((p) => p.nome === nome);
  if (!projeto) {
    main.innerHTML = projetoNaoEncontrado(nome);
    return;
  }
  if (params.projeto === undefined) history.replaceState(null, "", caminhoDaSimulacao(nome));
  lembrar(nome);
  const rota = `/api/projetos/${encodeURIComponent(nome)}`;
  const [usuarios, tarefas] = await Promise.all([
    api<UsuarioSimulado[]>(`${rota}/usuarios-simulados`, { signal }),
    api<Tarefa[]>(`${rota}/tarefas`, { signal }),
  ]);

  const desenhar = (rascunho: Rascunho, erros: Erros, falha?: string): void => {
    main.innerHTML = paginaDaSimulacao({ projetos, projeto, usuarios, tarefas, rascunho, erros, falha });
    const form = main.querySelector<HTMLFormElement>("[data-nova-tarefa]");
    form?.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const dados = lerRascunho(form);
      const botao = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (botao) botao.disabled = true;
      api(`${rota}/tarefas`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: dados.texto, n: Number(dados.n), usuarios: dados.usuarios }),
      })
        .then(() => montarSimulacao(main, params, signal))
        .catch((error_: unknown) => {
          if (signal.aborted) return;
          if (error_ instanceof ErroDaApi && error_.status === 422) desenhar(dados, errosDoZod(error_.message));
          else if (error_ instanceof ErroDaApi && error_.status !== 401) desenhar(dados, new Map(), error_.message);
          else {
            desenhar(dados, new Map());
            mostrarErro(error_);
          }
        });
    });
  };
  desenhar(RASCUNHO_VAZIO, new Map());
}
