// Página do projeto (F7 §4.4) no DOM: escolhe o projeto, lê as issues com os filtros, desenha com as funções puras de
// projeto.ts, abre e fecha as gavetas, arquiva as concluídas (C18) e abre o Registrar necessidade com o projeto. O
// app.ts a redesenha a cada 5 s. Os testes de ponta a ponta (e2e/) a exercitam.
import type { Id } from "../../../dominio/primitivos.ts";
import type { MetricasMes } from "../../../metricas/periodo.ts";
import type { IssueDoBoard } from "../../rotas/inicio.ts";
import type { ListaDoProjeto } from "../../rotas/projeto.ts";
import type { Parametros } from "../caminhos.ts";
import { api, elemento, irPara, mostrarErro } from "../dom.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { abrirRegistro } from "./inicio-montar.ts";
import { mesDe } from "./metricas.ts";
import {
  caminhoDoProjeto,
  escolherProjeto,
  type Escolhas,
  paginaDoProjeto,
  projetoNaoEncontrado,
  SEM_PROJETOS,
} from "./projeto.ts";

/** O último projeto visto neste navegador (F7 §4.4). */
const CHAVE = "fabriquinha.projeto";

// Valem entre os redesenhos de 5 s e entre projetos: os IDs das issues são únicos em toda a Fabriquinha.
const mostrar: Escolhas["mostrar"] = { concluidas: false, arquivadas: false, canceladas: false };
const gavetas = new Map<Id, boolean>();

// O armazenamento do navegador pode faltar (bloqueado, modo privado): a página segue sem lembrar.
export function ultimoVisto(): string | undefined {
  try {
    return localStorage.getItem(CHAVE) ?? undefined;
  } catch {
    return undefined;
  }
}
export function lembrar(nome: string): void {
  try {
    localStorage.setItem(CHAVE, nome);
  } catch {
    // sem armazenamento, sem lembrança
  }
}

/** A página `/projects` e `/projects/:projeto`. Redesenhar preserva a rolagem horizontal do trilho. */
export async function montarProjeto(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const projetos = await api<ProjetoListado[]>("/api/projetos", { signal });
  const nome = params.projeto ?? escolherProjeto(projetos, ultimoVisto());
  if (nome === undefined) {
    main.innerHTML = SEM_PROJETOS;
    return;
  }
  if (params.projeto === undefined) history.replaceState(null, "", caminhoDoProjeto(nome));
  if (!projetos.some((p) => p.nome === nome)) {
    main.innerHTML = projetoNaoEncontrado(nome);
    return;
  }
  lembrar(nome);
  const filtro = `concluidas=${String(mostrar.concluidas)}&arquivadas=${String(mostrar.arquivadas)}&canceladas=${String(mostrar.canceladas)}`;
  const atual = mesDe(new Date());
  const [lista, [mes]] = await Promise.all([
    api<ListaDoProjeto>(`/api/projetos/${encodeURIComponent(nome)}/issues?${filtro}`, { signal }),
    api<[MetricasMes]>(`/api/metricas?projeto=${encodeURIComponent(nome)}&de=${atual}&ate=${atual}`, { signal }),
  ]);
  // Com o seletor ou a confirmação abertos, o redesenho os fecharia nas mãos do Auditor: espera ele sair.
  if (document.activeElement?.matches("[data-projeto]") || main.querySelector("dialog[open]")) return;

  const rolagem = main.querySelector(".pista-rola")?.scrollLeft ?? 0;
  main.innerHTML = paginaDoProjeto(projetos, nome, lista, mes, { mostrar, gavetas }, new Date());
  const rola = main.querySelector(".pista-rola");
  const topo = main.querySelector(".pista-topo");
  if (rola && topo) {
    // O cabeçalho, fora do trilho para ficar fixo ao rolar a página, acompanha a rolagem horizontal dele.
    rola.addEventListener("scroll", () => {
      topo.scrollLeft = rola.scrollLeft;
    });
    rola.scrollLeft = rolagem;
    topo.scrollLeft = rolagem;
  }

  const redesenhar = (): void => {
    montarProjeto(main, params, signal).catch(mostrarErro);
  };
  main.querySelector<HTMLSelectElement>("[data-projeto]")?.addEventListener("change", (evento) => {
    const seletor = evento.currentTarget as HTMLSelectElement;
    // Sem o foco, que seguraria o desenho da página do projeto escolhido.
    seletor.blur();
    irPara(caminhoDoProjeto(seletor.value));
  });
  for (const caixa of main.querySelectorAll<HTMLInputElement>("[data-mostrar]")) {
    caixa.addEventListener("change", () => {
      mostrar[caixa.dataset.mostrar as keyof typeof mostrar] = caixa.checked;
      redesenhar();
    });
  }
  main.querySelector("[data-registrar]")?.addEventListener("click", () => {
    api<IssueDoBoard[]>("/api/board", { signal })
      .then((board) => abrirRegistro(board, nome))
      .catch(mostrarErro);
  });
  // A confirmação do C18; ao arquivar, a página se redesenha.
  const dialogo = elemento("[data-dialogo]", HTMLDialogElement);
  main.querySelector("[data-arquivar]")?.addEventListener("click", () => {
    dialogo.showModal();
  });
  dialogo.querySelector("[data-confirmar]")?.addEventListener("click", (evento) => {
    (evento.currentTarget as HTMLButtonElement).disabled = true;
    api(`/api/projetos/${encodeURIComponent(nome)}/arquivar`, { method: "POST" })
      .then(() => {
        dialogo.close();
        redesenhar();
      })
      .catch((error_: unknown) => {
        dialogo.close();
        mostrarErro(error_);
      });
  });
  // Clicar na linha (fora de um link) abre ou fecha a gaveta; o ▼ é o botão para o teclado.
  main.querySelector(".pista")?.addEventListener("click", (evento) => {
    if (!(evento.target instanceof Element) || evento.target.closest("a")) return;
    const item = evento.target.closest("[data-gaveta]")?.parentElement;
    if (!item) return;
    const aberta = !item.classList.toggle("fechada");
    gavetas.set(Number(item.dataset.issue), aberta);
    item.querySelector(".caret")?.setAttribute("aria-expanded", String(aberta));
  });
}
