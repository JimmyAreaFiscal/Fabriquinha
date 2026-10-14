// Simulação (F7 §4.4, F8) no DOM: lê a API, desenha com as funções puras de simulacao.ts, cria a Tarefa, com os erros
// do 422 ao lado dos campos, executa e abre o relatório. Enquanto há execução pendente, relê as Tarefas a cada 3 s. Os
// testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Tarefa, UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, ErroDaApi, mostrarErro } from "../dom.ts";
import { type Erros, errosDoZod, type ProjetoListado } from "./configuracao.ts";
import { lembrar, ultimoVisto } from "./projeto-montar.ts";
import { escolherProjeto, projetoNaoEncontrado } from "./projeto.ts";
import {
  caminhoDaSimulacao,
  listaDeTarefas,
  paginaDaSimulacao,
  RASCUNHO_VAZIO,
  type Rascunho,
  relatorioNaCaixa,
  SEM_PROJETOS_DA_SIMULACAO,
  temPendente,
} from "./simulacao.ts";

/** De quanto em quanto tempo as Tarefas são relidas enquanto há execução pendente. */
const RELEITURA_MS = 3000;

/** A releitura agendada: uma só, mesmo que a página seja montada de novo (depois de criar uma Tarefa). */
let releitura: ReturnType<typeof setTimeout> | undefined;

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
  const [usuarios, lidas] = await Promise.all([
    api<UsuarioSimulado[]>(`${rota}/usuarios-simulados`, { signal }),
    api<Tarefa[]>(`${rota}/tarefas`, { signal }),
  ]);
  let tarefas = lidas;
  /** A recusa do Executar de cada Tarefa, mostrada no cartão dela até o próximo Executar. */
  const falhasDeExecutar: Record<number, string> = {};

  const agendar = (): void => {
    clearTimeout(releitura);
    if (temPendente(tarefas)) releitura = setTimeout(reler, RELEITURA_MS);
  };
  /** Redesenha só os cartões, para o polling não apagar o que o Auditor digita no formulário. */
  const desenharTarefas = (): void => {
    const lista = main.querySelector("[data-tarefas]");
    if (lista) lista.innerHTML = listaDeTarefas(tarefas, falhasDeExecutar);
    agendar();
  };
  const reler = (): void => {
    if (signal.aborted) return;
    api<Tarefa[]>(`${rota}/tarefas`, { signal })
      .then((novas) => {
        tarefas = novas;
        desenharTarefas();
      })
      .catch(mostrarErro);
  };
  signal.addEventListener("abort", () => {
    clearTimeout(releitura);
  });

  const executar = (id: number): void => {
    api(`/api/tarefas/${String(id)}/executar`, { method: "POST" })
      .then(() => {
        falhasDeExecutar[id] = ""; // vazio: o cartão não mostra alerta
        reler();
      })
      .catch((error_: unknown) => {
        if (error_ instanceof ErroDaApi && error_.status === 409) {
          falhasDeExecutar[id] = error_.message;
          desenharTarefas();
          reler();
        } else mostrarErro(error_);
      });
  };

  const desenhar = (rascunho: Rascunho, erros: Erros, falha?: string): void => {
    main.innerHTML = paginaDaSimulacao({
      projetos,
      projeto,
      usuarios,
      tarefas,
      rascunho,
      erros,
      falha,
      falhasDeExecutar,
    });
    agendar();
    main.querySelector("[data-tarefas]")?.addEventListener("click", (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : undefined;
      const executando = alvo?.closest<HTMLElement>("[data-executar]");
      if (executando instanceof HTMLButtonElement) {
        executando.disabled = true;
        executar(Number(executando.dataset.executar));
      }
      const relatorio = alvo?.closest<HTMLElement>("[data-relatorio]")?.dataset.relatorio;
      if (relatorio === undefined) return;
      const [idDaTarefa, idDaExecucao] = relatorio.split(":").map(Number);
      const t = tarefas.find((x) => x.id === idDaTarefa);
      const e = t?.execucoes.find((x) => x.id === idDaExecucao);
      if (t && e?.relatorio) abrirCaixa({ ...relatorioNaCaixa(t, { ...e, relatorio: e.relatorio }), estreita: true });
    });
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
