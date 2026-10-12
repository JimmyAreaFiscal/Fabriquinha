// Montagem da página da issue (F7 §4.4) no DOM: lê a página, corrige o projeto do caminho, desenha e liga as ações.
// Não se atualiza sozinha, para não apagar o que o Auditor digita num gate; cada ação relê a página quando termina.
// Não roda em Node: os testes de ponta a ponta (e2e/issue.spec.ts) a exercitam no navegador.
import type { Modelo } from "../../../dominio/primitivos.ts";
import type { LeituraDoPR } from "../../../repositorio/pr.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, avisar, elemento, mostrarErro } from "../dom.ts";
import { markdown } from "../markdown.ts";
import { caminhoDaIssue, modeloDoSeletor, paginaVazia, rotuloIssue } from "../render.ts";
import {
  type AbaDoPR,
  bloqueiosDoPR,
  type EstadoLido,
  evidenciaNaCaixa,
  execucoesDoTicket,
  type Extras,
  paginaDaIssue,
  type RascunhoDoPR,
} from "./issue.ts";

/** O que uma ação recebe: o elemento clicado, a página lida, o que veio fora dela e como desenhá-la de novo. */
interface Contexto {
  alvo: HTMLElement;
  pagina: PaginaDaIssue;
  extras: Extras;
  raiz: HTMLElement;
  remontar: () => Promise<void>;
}

/** O que o Auditor já escreveu ou escolheu nos gates, que uma ação que relê a página não apaga. */
interface Rascunho {
  motivo?: string;
  pr?: RascunhoDoPR;
}

const enviarJson = (metodo: "POST" | "DELETE", corpo?: unknown): RequestInit => ({
  method: metodo,
  ...(corpo !== undefined && { headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }),
});

/**
 * Os modelos do pi para os seletores de modelo (gate do desenho e Responder e retomar no chat), lidos uma vez por carga
 * do cliente: cada ação relê a página, e `pi --list-models` não precisa rodar a cada uma. Falhando, o seletor fica só
 * com o padrão e o override, com o aviso.
 * ponytail: um modelo novo no pi só aparece depois de recarregar a página.
 */
let modelosDoPi: Promise<Modelo[]> | undefined;
export function modelos(): Promise<Modelo[]> {
  modelosDoPi ??= api<Modelo[]>("/api/modelos").catch((error_: unknown) => {
    modelosDoPi = undefined;
    avisar(`não foi possível listar os modelos do pi: ${error_ instanceof Error ? error_.message : String(error_)}`);
    return [];
  });
  return modelosDoPi;
}

/** Decide o gate do desenho (C15) e relê a página. */
const decidirDesenho =
  (aprovado: boolean) =>
  async ({ alvo, pagina, raiz, remontar }: Contexto): Promise<void> => {
    const motivo = raiz.querySelector<HTMLTextAreaElement>("[data-motivo]")?.value.trim();
    (alvo as HTMLButtonElement).disabled = true;
    await api(
      `/api/issues/${String(pagina.issue.id)}/desenho`,
      enviarJson("POST", aprovado ? { aprovado } : { aprovado, motivo }),
    );
    await remontar();
  };

/**
 * O estado do PR lido agora na plataforma (F5 §5.2); a falha do `gh` ou do `az` (502) fica no painel, com a saída.
 * ponytail: a página espera o `gh`/`az` antes de se desenhar no gate do PR; se ficar lento, desenhar antes e
 * preencher a aba Decisão depois.
 */
const lerPR = (issue: number, signal: AbortSignal): Promise<EstadoLido> =>
  api<LeituraDoPR>(`/api/issues/${String(issue)}/pr`, { signal }).then(
    (leitura) => ({ leitura }),
    (error_: unknown) => {
      signal.throwIfAborted();
      return { erro: error_ instanceof Error ? error_.message : String(error_) };
    },
  );

/** O rascunho do gate do PR que está na tela: a aba aberta, o motivo e a nota escolhida. */
function rascunhoDoPR(raiz: HTMLElement): RascunhoDoPR | undefined {
  const motivo = raiz.querySelector<HTMLTextAreaElement>("[data-motivo-pr]");
  if (!motivo) return undefined;
  const aba = raiz.querySelector<HTMLElement>('[data-acao="aba-pr"][aria-selected="true"]')?.dataset.aba as AbaDoPR;
  const nota = raiz.querySelector<HTMLElement>('[data-nota][aria-pressed="true"]')?.dataset.nota;
  return { aba, motivo: motivo.value, ...(nota && { nota: Number(nota) }) };
}

/** Aplica na aba Decisão o que o estado lido, o motivo e a nota deixam fazer (a mesma regra do render). */
function aplicarBloqueios(raiz: HTMLElement, pr: EstadoLido): void {
  const rascunho = rascunhoDoPR(raiz);
  if (!rascunho) return;
  const b = bloqueiosDoPR(pr, rascunho.motivo, rascunho.nota);
  for (const [acao, [habilitada, bloqueio]] of [
    ["pedir", b.pedir],
    ["encerrar", b.encerrar],
  ] as const) {
    const botao = raiz.querySelector<HTMLButtonElement>(
      `[data-acao="${acao === "pedir" ? "pedir-mudancas" : "encerrar-issue"}"]`,
    );
    if (botao) botao.disabled = !habilitada;
    const texto = raiz.querySelector(`[data-bloqueio="${acao}"]`);
    if (texto) texto.textContent = bloqueio;
  }
}

/** Decide o gate do PR (C16) e relê a página: depois de encerrar, o aviso da limpeza que falhou aparece nela. */
const decidirPR =
  (aprovado: boolean) =>
  async ({ alvo, pagina, raiz, remontar }: Contexto): Promise<void> => {
    const rascunho = rascunhoDoPR(raiz);
    (alvo as HTMLButtonElement).disabled = true;
    await api(
      `/api/issues/${String(pagina.issue.id)}/pr`,
      enviarJson("POST", aprovado ? { aprovado, nota: rascunho?.nota } : { aprovado, motivo: rascunho?.motivo }),
    );
    await remontar();
  };

/** Troca a linha (ou o "+ Novo ticket") pelo formulário, e o formulário pela linha no Cancelar. */
function alternar(mostrar: HTMLElement | null, esconder: HTMLElement | null): void {
  if (!mostrar || !esconder) return;
  esconder.hidden = true;
  mostrar.hidden = false;
  mostrar.querySelector("input")?.focus();
}

/** Preenche cada `[data-texto]` da caixa com o texto do anexo, como texto (nunca como HTML). */
export async function carregarTextos(): Promise<void> {
  for (const pre of elemento("[data-caixa-corpo]", HTMLElement).querySelectorAll<HTMLElement>("[data-texto]")) {
    const resposta = await fetch(String(pre.dataset.texto));
    pre.textContent = resposta.ok
      ? await resposta.text()
      : `não foi possível ler o arquivo (${String(resposta.status)})`;
  }
}

/**
 * As ações da página, pelo `data-acao` do botão. Os painéis de gate (tickets 31 e 32) acrescentam as suas aqui, ao
 * lado do HTML deles em `PAINEIS` (issue.ts).
 */
const ACOES: Record<string, (c: Contexto) => void | Promise<void>> = {
  "ver-descricao": ({ alvo, raiz }) => {
    const aberta = raiz.querySelector("[data-descricao]")?.classList.toggle("aberta");
    alvo.textContent = aberta ? "ver menos" : "ver tudo";
  },
  "mostrar-dep": ({ alvo, raiz }) => {
    const form = raiz.querySelector<HTMLFormElement>("[data-form-dep]");
    if (!form) return;
    alvo.hidden = true;
    form.hidden = false;
    form.querySelector("input")?.focus();
  },
  executar: async ({ alvo, remontar }) => {
    (alvo as HTMLButtonElement).disabled = true;
    await api(`/api/tickets/${String(alvo.dataset.executar)}/executar`, enviarJson("POST"));
    await remontar();
  },
  // Gate do desenho (ticket 31).
  "editar-ticket": ({ alvo, raiz }) => {
    const id = String(alvo.dataset.id);
    alternar(raiz.querySelector(`[data-edicao="${id}"]`), raiz.querySelector(`[data-proposto="${id}"]`));
  },
  "novo-ticket": ({ alvo, raiz }) => {
    alternar(raiz.querySelector("[data-novo-ticket]"), alvo);
  },
  "cancelar-ticket": ({ alvo, raiz }) => {
    const form = alvo.closest("form");
    form?.reset();
    const id = form?.dataset.formTicket;
    if (id) alternar(raiz.querySelector(`[data-proposto="${id}"]`), raiz.querySelector(`[data-edicao="${id}"]`));
    else alternar(raiz.querySelector('[data-acao="novo-ticket"]'), raiz.querySelector("[data-novo-ticket]"));
  },
  "remover-ticket": async ({ alvo, remontar }) => {
    (alvo as HTMLButtonElement).disabled = true;
    await api(`/api/tickets/${String(alvo.dataset.id)}`, enviarJson("DELETE"));
    await remontar();
  },
  "aprovar-desenho": decidirDesenho(true),
  "reprovar-desenho": decidirDesenho(false),
  // Gate do PR (ticket 32).
  "aba-pr": ({ alvo, raiz }) => {
    for (const aba of raiz.querySelectorAll<HTMLElement>('[data-acao="aba-pr"]')) {
      aba.setAttribute("aria-selected", String(aba === alvo));
    }
    for (const painel of raiz.querySelectorAll<HTMLElement>("[data-painel-pr]")) {
      painel.hidden = painel.dataset.painelPr !== alvo.dataset.aba;
    }
  },
  "nota-pr": ({ alvo, raiz, extras }) => {
    for (const nota of raiz.querySelectorAll<HTMLElement>("[data-nota]")) {
      nota.setAttribute("aria-pressed", String(nota === alvo));
    }
    if (extras.pr) aplicarBloqueios(raiz, extras.pr);
  },
  "atualizar-pr": async ({ alvo, remontar }) => {
    (alvo as HTMLButtonElement).disabled = true;
    await remontar();
  },
  "pedir-mudancas": decidirPR(false),
  "encerrar-issue": decidirPR(true),
};

/**
 * `/projects/:projeto/issues/:issue`: a issue `I-n` (ou `n`), com o projeto do caminho trocado pelo dela. `rascunho` é
 * o que o Auditor já escreveu ou escolheu nos gates, que uma ação que relê a página não apaga.
 */
export async function montarIssue(
  main: HTMLElement,
  params: Parametros,
  signal: AbortSignal,
  rascunho: Rascunho = {},
): Promise<void> {
  const id = String(params.issue).replace(/^I-/, "");
  let pagina: PaginaDaIssue;
  try {
    pagina = await api<PaginaDaIssue>(`/api/issues/${encodeURIComponent(id)}`, { signal });
  } catch (error_) {
    if (!signal.aborted) main.innerHTML = paginaVazia("Issue");
    throw error_;
  }
  const { fase } = pagina.issue;
  const extras: Extras = {
    modelos: fase === "aprovacao_desenho" ? await modelos() : [],
    ...(fase === "aprovacao_pr" && { pr: await lerPR(pagina.issue.id, signal) }),
    agora: new Date(),
    ...(rascunho.pr && { rascunho: rascunho.pr }),
  };
  // Os modelos vêm da leitura guardada, que não se cancela: o Auditor pode ter saído enquanto ela chegava.
  signal.throwIfAborted();
  const certo = caminhoDaIssue(pagina.issue.projeto, pagina.issue.id);
  if (location.pathname !== certo) history.replaceState(null, "", certo);
  document.title = `${rotuloIssue(pagina.issue.id)} · Fabriquinha`;
  main.innerHTML = paginaDaIssue(pagina, pagina.issue.descricao.trim() ? markdown(pagina.issue.descricao) : "", extras);
  const raiz = elemento(".pagina-issue", HTMLElement);
  const p = pagina;

  const campoMotivo = raiz.querySelector<HTMLTextAreaElement>("[data-motivo]");
  const reprovar = raiz.querySelector<HTMLButtonElement>('[data-acao="reprovar-desenho"]');
  const habilitarReprovar = () => {
    if (campoMotivo && reprovar) reprovar.disabled = !campoMotivo.value.trim();
  };
  if (campoMotivo) campoMotivo.value = rascunho.motivo ?? "";
  habilitarReprovar();
  const remontar = () => montarIssue(main, params, signal, { motivo: campoMotivo?.value, pr: rascunhoDoPR(raiz) });

  // Descrição curta não precisa de "ver tudo".
  const descricao = raiz.querySelector<HTMLElement>("[data-descricao]");
  const verTudo = raiz.querySelector<HTMLElement>('[data-acao="ver-descricao"]');
  if (descricao && verTudo) verTudo.hidden = descricao.scrollHeight <= descricao.clientHeight;

  /** Roda a ação; o erro aparece no aviso, como o servidor o mandou, e a página fica como está. */
  const agir = (acao: () => void | Promise<void>, alvo?: HTMLButtonElement) => {
    avisar();
    Promise.resolve(acao()).catch((error_: unknown) => {
      if (alvo) alvo.disabled = false;
      mostrarErro(error_);
    });
  };

  raiz.addEventListener("click", (evento) => {
    const alvo = evento.target instanceof Element ? evento.target.closest<HTMLElement>("button") : null;
    if (!alvo) return;
    const { ticket, evidencia, removerDep, acao } = alvo.dataset;
    if (ticket) {
      const t = p.tickets.find((x) => x.id === Number(ticket));
      if (t) abrirCaixa(execucoesDoTicket(p, t));
    } else if (evidencia) {
      const e = p.evidencias.find((x) => x.id === Number(evidencia));
      if (e) {
        abrirCaixa(evidenciaNaCaixa(p, e));
        agir(carregarTextos);
      }
    } else if (removerDep) {
      agir(async () => {
        await api(`/api/issues/${String(p.issue.id)}/deps/${removerDep}`, enviarJson("DELETE"));
        await remontar();
      });
    } else if (acao && acao in ACOES) {
      agir(() => ACOES[acao]?.({ alvo, pagina: p, extras, raiz, remontar }), alvo as HTMLButtonElement);
    }
  });

  raiz.addEventListener("submit", (evento) => {
    const form = evento.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (form.matches("[data-form-dep]")) {
      evento.preventDefault();
      const dep = Number(form.querySelector("input")?.value.trim().replace(/^I-/i, ""));
      agir(async () => {
        await api(`/api/issues/${String(p.issue.id)}/deps`, enviarJson("POST", { dep }));
        await remontar();
      });
    } else if (form.matches("[data-form-ticket]")) {
      // C12 com o ticket do formulário; C11 sem ele.
      evento.preventDefault();
      const { titulo, descricao } = Object.fromEntries(new FormData(form));
      const id = form.dataset.formTicket;
      const caminho = id ? `/api/tickets/${id}` : `/api/issues/${String(p.issue.id)}/tickets`;
      const salvar = form.querySelector<HTMLButtonElement>(".btn-primario") ?? undefined;
      if (salvar) salvar.disabled = true;
      agir(async () => {
        await api(caminho, enviarJson("POST", { titulo, descricao }));
        await remontar();
      }, salvar);
    }
  });

  raiz.addEventListener("input", (evento) => {
    if (evento.target === campoMotivo) habilitarReprovar();
    if (evento.target instanceof HTMLTextAreaElement && evento.target.matches("[data-motivo-pr]") && extras.pr) {
      aplicarBloqueios(raiz, extras.pr);
    }
  });

  // O corpo completo do PR (o anexo de `pr_aberto`), em Markdown sem HTML.
  const corpoPR = raiz.querySelector<HTMLElement>("[data-corpo-pr]");
  if (corpoPR) {
    agir(async () => {
      const resposta = await fetch(String(corpoPR.dataset.corpoPr));
      if (!resposta.ok) throw new Error(`não foi possível ler o corpo do PR (${String(resposta.status)})`);
      corpoPR.innerHTML = markdown(await resposta.text());
    });
  }

  // C20: o padrão da etapa (vazio) remove o override.
  raiz.addEventListener("change", (evento) => {
    const select = evento.target;
    if (!(select instanceof HTMLSelectElement) || !select.dataset.modelo) return;
    const modelo = modeloDoSeletor(select.value);
    select.disabled = true;
    agir(async () => {
      try {
        await api(`/api/tickets/${String(select.dataset.modelo)}/modelo`, enviarJson("POST", { modelo }));
      } finally {
        await remontar();
      }
    });
  });
}
