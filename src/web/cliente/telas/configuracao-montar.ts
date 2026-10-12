// Configuração (F7 §4.4) no DOM: lê a API, desenha com as funções puras de configuracao.ts, lê os formulários e
// mostra os erros do 422 ao lado dos campos. Os testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Modelo } from "../../../dominio/primitivos.ts";
import { api, avisar, ErroDaApi } from "../dom.ts";
import {
  agendador,
  type Erros,
  errosDoZod,
  type EstadoDaConfiguracao,
  formularioDeProjeto,
  menu,
  NOVO,
  pagina,
  type ProjetoListado,
  projetoInexistente,
  type Rascunho,
  selecao,
} from "./configuracao.ts";

const postar = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

/** Os erros de campo do 422; qualquer outro erro vai para o aviso, e o formulário volta sem erro de campo. */
function errosDe(erro: unknown): Erros {
  if (erro instanceof ErroDaApi && erro.status === 422) return errosDoZod(erro.message);
  mostrar(erro);
  return new Map();
}

const valor = (raiz: ParentNode, seletor: string): string =>
  raiz.querySelector<HTMLInputElement | HTMLSelectElement>(seletor)?.value ?? "";

/** O que o formulário do agendador tem agora, no formato do F4 §3. */
const lerAgendador = (form: HTMLFormElement) => ({
  agendadorAtivo: form.querySelector<HTMLInputElement>('[name="agendadorAtivo"]')?.checked ?? false,
  intervaloMin: Number(valor(form, '[name="intervaloMin"]')),
  timeoutMin: Number(valor(form, '[name="timeoutMin"]')),
  ociosidadeMin: Number(valor(form, '[name="ociosidadeMin"]')),
});

/** O que o formulário do projeto tem agora, no formato do F1 §3.3 sem a hospedagem. */
function lerProjeto(form: HTMLFormElement, hospedagem: Rascunho["hospedagem"]): Rascunho {
  const itens = (campo: string) =>
    [...form.querySelectorAll<HTMLInputElement>(`[data-lista="${campo}"] input`)].map((i) => i.value);
  const modelos: Rascunho["modelos"] = {};
  for (const s of form.querySelectorAll<HTMLSelectElement>('select[name^="modelos."]')) {
    const corte = s.value.indexOf("/");
    if (corte > 0) {
      modelos[s.name.slice("modelos.".length) as keyof Rascunho["modelos"]] = {
        provedor: s.value.slice(0, corte),
        modelo: s.value.slice(corte + 1),
      };
    }
  }
  return {
    nome: valor(form, '[name="nome"]'),
    repo: valor(form, '[name="repo"]'),
    branchBase: valor(form, '[name="branchBase"]'),
    ...(hospedagem && { hospedagem }),
    preparacao: itens("preparacao"),
    testes: itens("testes"),
    sonar: { projectKey: valor(form, '[name="sonar.projectKey"]') },
    fitness: [...form.querySelectorAll("[data-fitness]")].map((linha) => ({
      nome: valor(linha, '[data-campo="nome"]'),
      comando: valor(linha, '[data-campo="comando"]'),
      descricao: valor(linha, '[data-campo="descricao"]'),
    })),
    modelos,
  };
}

/** O botão de enviar ocupado enquanto o servidor confere (o `git ls-remote` e o `gh` levam segundos). */
function ocupar(form: HTMLFormElement, texto: string): void {
  const botao = form.querySelector<HTMLButtonElement>('[type="submit"]');
  if (botao) {
    botao.disabled = true;
    botao.textContent = texto;
  }
}

function montarAgendador(main: HTMLElement, menuHtml: string, estado: EstadoDaConfiguracao, erros: Erros): void {
  main.innerHTML = pagina(menuHtml, agendador(estado, erros, new Date()));
  const form = main.querySelector<HTMLFormElement>("[data-agendador]");
  form?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const dados = lerAgendador(form);
    ocupar(form, "Salvando…");
    api("/api/configuracao", postar(dados))
      .then(() => montarConfiguracao(main))
      .catch((error_: unknown) => {
        montarAgendador(main, menuHtml, { ...estado, ...dados }, errosDe(error_));
      });
  });
}

function montarProjeto(
  main: HTMLElement,
  menuHtml: string,
  salvo: ProjetoListado | undefined,
  modelos: readonly Modelo[],
): void {
  const inicial: Rascunho = salvo ?? NOVO;
  const desenhar = (p: Rascunho, erros: Erros, falha?: string): void => {
    main.innerHTML = pagina(menuHtml, formularioDeProjeto(p, { issues: salvo?.issues, modelos, erros, falha }));
    const form = main.querySelector<HTMLFormElement>("[data-projeto]");
    if (!form) return;
    form.addEventListener("change", (evento) => {
      if (evento.target instanceof HTMLSelectElement) evento.target.classList.toggle("padrao", !evento.target.value);
    });
    form.addEventListener("click", (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : null;
      const adicionar = alvo?.closest<HTMLElement>("[data-adicionar]")?.dataset.adicionar;
      const remover = alvo?.closest("[data-remover]")?.closest(".item-lista, [data-fitness]");
      if (alvo?.closest("[data-cancelar]")) {
        desenhar(inicial, new Map());
      } else if (adicionar === "fitness") {
        const p = lerProjeto(form, inicial.hospedagem);
        desenhar({ ...p, fitness: [...p.fitness, { nome: "", comando: "", descricao: "" }] }, erros);
      } else if (adicionar === "preparacao" || adicionar === "testes") {
        const p = lerProjeto(form, inicial.hospedagem);
        desenhar({ ...p, [adicionar]: [...p[adicionar], ""] }, erros);
      } else if (remover) {
        // Remove a linha do DOM e redesenha: os índices dos erros mudariam, então eles somem até o próximo envio.
        remover.remove();
        desenhar(lerProjeto(form, inicial.hospedagem), new Map());
      }
    });
    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const p = lerProjeto(form, inicial.hospedagem);
      ocupar(form, "Conferindo…");
      const caminho = salvo ? `/api/projetos/${encodeURIComponent(salvo.nome)}` : "/api/projetos";
      api<ProjetoListado>(caminho, postar(p))
        .then(async (gravado) => {
          if (!salvo) history.pushState(null, "", `/config?projeto=${encodeURIComponent(gravado.nome)}`);
          await montarConfiguracao(main);
        })
        .catch((error_: unknown) => {
          // A falha do F5 (502) e a recusa do C19 (409) não são de um campo: vão para o rodapé, onde se clicou.
          if (error_ instanceof ErroDaApi && error_.status !== 422 && error_.status !== 401)
            desenhar(p, new Map(), error_.message);
          else desenhar(p, errosDe(error_));
        });
    });
  };
  desenhar(inicial, new Map());
}

/** O erro que não é de campo vai para o aviso; o 401 a `api` já avisou. */
function mostrar(erro: unknown): void {
  if (!(erro instanceof ErroDaApi && erro.status === 401)) avisar(erro instanceof Error ? erro.message : String(erro));
}

/** A página `/config`: o item do menu vem do endereço (`?projeto=<nome>`, `?novo`), e cada link troca o item. */
export async function montarConfiguracao(main: HTMLElement): Promise<void> {
  const sel = selecao(location.search);
  const [estado, projetos] = await Promise.all([
    api<EstadoDaConfiguracao>("/api/configuracao"),
    api<ProjetoListado[]>("/api/projetos"),
  ]);
  const menuHtml = menu(estado, projetos, sel);
  if (sel.tipo === "agendador") {
    montarAgendador(main, menuHtml, estado, new Map());
    return;
  }
  const salvo = sel.tipo === "projeto" ? projetos.find((p) => p.nome === sel.nome) : undefined;
  if (sel.tipo === "projeto" && !salvo) {
    main.innerHTML = pagina(menuHtml, projetoInexistente(sel.nome));
    return;
  }
  montarProjeto(main, menuHtml, salvo, await api<Modelo[]>("/api/modelos"));
}
