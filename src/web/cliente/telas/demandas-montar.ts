// Quadro e página da demanda no DOM: leem a API e desenham com `quadro` e `pagina`. O app.ts redesenha só o quadro a
// cada 5 s; a página decide os gates da demanda e do planejamento. Os testes de ponta a ponta (e2e/) os exercitam.
import type { Parametros } from "../caminhos.ts";
import { abrirCaixa, api, avisar, ErroDaApi, mostrarErro } from "../dom.ts";
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

/** Lê a demanda e redesenha a página com o que a API devolve; o 404 vira a página de não encontrada. */
async function carregar(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<boolean> {
  let dados: DadosDaPagina;
  try {
    dados = await api<DadosDaPagina>(`/api/demandas/${encodeURIComponent(params.demanda ?? "")}`, { signal });
  } catch (erro) {
    if (!(erro instanceof ErroDaApi && erro.status === 404)) throw erro;
    main.innerHTML = NAO_ENCONTRADA;
    return false;
  }
  main.innerHTML = pagina(dados);
  return true;
}

export async function montarDemanda(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  if (!(await carregar(main, params, signal))) return;
  // O ouvinte sai com a página. A imagem do anexo abre na caixa; os demais anexos seguem o link, em nova aba.
  main.addEventListener(
    "click",
    (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : null;
      const botao = alvo?.closest<HTMLButtonElement>("button[data-gate]");
      if (botao) {
        void decidir(botao, main, params, signal);
        return;
      }
      const acao = alvo?.closest<HTMLButtonElement>("button[data-acao]");
      if (acao) {
        void agirNoTicket(acao, main, params, signal);
        return;
      }
      const link = alvo?.closest<HTMLAnchorElement>("a[data-imagem]");
      if (!link || evento.button !== 0 || evento.ctrlKey || evento.metaKey || evento.shiftKey) return;
      evento.preventDefault();
      const nome = link.dataset.imagem ?? "";
      abrirCaixa({ titulo: nome, corpo: `<img src="${escapar(link.href)}" alt="${escapar(nome)}" />`, aba: link.href });
    },
    { signal },
  );
}

/**
 * Envia a decisão do gate. Recusar sem motivo não vai ao servidor: a mensagem fica junto ao campo. Com ou sem erro do
 * servidor, a página se redesenha com a fase atual; o erro fica no aviso, com a orientação que ele devolveu.
 */
async function decidir(
  botao: HTMLButtonElement,
  main: HTMLElement,
  params: Parametros,
  signal: AbortSignal,
): Promise<void> {
  const aprovado = botao.dataset.gate === "true";
  // Cada botão aponta o campo que lê: o motivo (recusar) ou a nota (aprovar o PR da rodada).
  const doCampo = (id?: string) =>
    id === undefined ? null : main.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
  const campo = doCampo(botao.dataset.campo);
  const motivo = campo?.value.trim() ?? "";
  const nota = doCampo(botao.dataset.nota)?.value;
  const pendencia =
    !aprovado && motivo === ""
      ? { onde: campo?.nextElementSibling, texto: "O motivo é obrigatório para recusar." }
      : aprovado && nota === ""
        ? { onde: doCampo(`${botao.dataset.nota ?? ""}-erro`), texto: "Escolha a nota de 1 a 5." }
        : undefined;
  if (pendencia) {
    if (pendencia.onde) {
      pendencia.onde.textContent = pendencia.texto;
      (pendencia.onde as HTMLElement).hidden = false;
    }
    return;
  }
  avisar();
  for (const b of main.querySelectorAll<HTMLButtonElement>("button[data-gate]")) b.disabled = true;
  try {
    await api(botao.dataset.caminho ?? "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aprovado ? { aprovado, ...(nota && { nota: Number(nota) }) } : { aprovado, motivo }),
      signal,
    });
  } catch (falha) {
    mostrarErro(falha);
  }
  if (!signal.aborted) await carregar(main, params, signal);
}

/**
 * Reabrir (com instrução) ou executar agora um ticket. Instrução vazia não vai ao servidor; com ou sem erro dele, a
 * página se redesenha com o status atual.
 */
async function agirNoTicket(
  botao: HTMLButtonElement,
  main: HTMLElement,
  params: Parametros,
  signal: AbortSignal,
): Promise<void> {
  const reabrir = botao.dataset.acao === "reabrir";
  const campo = reabrir ? main.querySelector<HTMLTextAreaElement>(`#${CSS.escape(botao.dataset.campo ?? "")}`) : null;
  const instrucao = campo?.value.trim() ?? "";
  if (reabrir && instrucao === "") {
    const erro = campo?.nextElementSibling as HTMLElement | null;
    if (erro) {
      erro.textContent = "A instrução é obrigatória para reabrir.";
      erro.hidden = false;
    }
    return;
  }
  avisar();
  for (const b of main.querySelectorAll<HTMLButtonElement>("button[data-acao]")) b.disabled = true;
  try {
    await api(botao.dataset.caminho ?? "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reabrir ? { instrucao } : {}),
      signal,
    });
  } catch (falha) {
    mostrarErro(falha);
  }
  if (!signal.aborted) await carregar(main, params, signal);
}
