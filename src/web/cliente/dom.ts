// O que o cliente faz no DOM e na rede, fora das funções puras: chamar a API, avisar e abrir a caixa. Não roda em
// Node; os testes de ponta a ponta (e2e/) o exercitam no navegador.

/** O elemento do `index.html`, do tipo pedido; faltar é defeito do próprio cliente. */
export function elemento<T extends Element>(seletor: string, tipo: new () => T): T {
  const achado = document.querySelector(seletor);
  if (!(achado instanceof tipo)) throw new Error(`o index.html não tem ${seletor}`);
  return achado;
}

/** Mostra a mensagem no aviso abaixo da navegação, como o servidor a mandou; sem mensagem, esconde o aviso. */
export function avisar(mensagem?: string): void {
  const aviso = elemento("[data-aviso]", HTMLElement);
  aviso.textContent = mensagem ?? "";
  aviso.hidden = mensagem === undefined;
}

/** Erro de uma chamada à API, com o status e a mensagem do corpo `{ erro }` (F7 §4.2). */
export class ErroDaApi extends Error {
  override name = "ErroDaApi";
  readonly status: number;
  constructor(status: number, mensagem: string) {
    super(mensagem);
    this.status = status;
  }
}

/**
 * Chama a API e devolve o JSON (`undefined` no 204). Erro sai como `ErroDaApi`; o 401 também vira o aviso que manda
 * rodar `fabriquinha abrir`, porque nenhuma página funciona sem entrar.
 */
export async function api<T>(caminho: string, init?: RequestInit): Promise<T> {
  const resposta = await fetch(caminho, init);
  if (resposta.status === 204) return undefined as T;
  const corpo = (await resposta.json()) as unknown;
  if (resposta.ok) return corpo as T;
  const mensagem = (corpo as { erro?: string }).erro ?? resposta.statusText;
  if (resposta.status === 401) avisar(mensagem);
  throw new ErroDaApi(resposta.status, mensagem);
}

export interface ConteudoDaCaixa {
  titulo: string;
  /** Linha discreta ao lado do título (tipo, etapa, ticket). */
  meta?: string;
  /** HTML já escapado por quem chama. */
  corpo: string;
  /** Endereço para **abrir em nova aba**, quando o conteúdo é um arquivo. */
  aba?: string;
  /** Endereço para **baixar**. */
  baixar?: string;
  /** Caixa estreita e da altura do conteúdo, para um formulário curto. */
  estreita?: boolean;
}

/** Abre a caixa (F7 §4.4) sobre a página; fecha com Esc, com o ✕ ou clicando fora. */
export function abrirCaixa({ titulo, meta, corpo, aba, baixar, estreita = false }: ConteudoDaCaixa): void {
  elemento("[data-caixa-titulo]", HTMLElement).textContent = titulo;
  elemento("[data-caixa-meta]", HTMLElement).textContent = meta ?? "";
  for (const [seletor, href] of [
    ["[data-caixa-aba]", aba],
    ["[data-caixa-baixar]", baixar],
  ] as const) {
    const link = elemento(seletor, HTMLAnchorElement);
    link.hidden = href === undefined;
    link.href = href ?? "";
  }
  elemento("[data-caixa-corpo]", HTMLElement).innerHTML = corpo;
  const caixa = elemento("[data-caixa]", HTMLDialogElement);
  caixa.classList.toggle("estreita", estreita);
  caixa.showModal();
}

/** Vai para outra página da Fabriquinha sem recarregar, como um clique num link: o app.ts redesenha no `popstate`. */
export function irPara(caminho: string): void {
  history.pushState(null, "", caminho);
  dispatchEvent(new PopStateEvent("popstate"));
  scrollTo(0, 0);
}
