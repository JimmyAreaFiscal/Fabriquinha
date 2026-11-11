// Quadro e página da demanda no DOM: leem a API e desenham com `quadro` e `pagina`. O app.ts redesenha só o quadro a
// cada 5 s; a página decide os gates da demanda e do planejamento. Os testes de ponta a ponta (e2e/) os exercitam.
import type { Parametros } from "../../compartilhado/caminhos.ts";
import type { BoardDeDemandas, PaginaDaDemanda } from "../../../contrato/demanda.ts";
import type { MotivoDeRecusaEmJson } from "../../../contrato/despacho.ts";
import { abrirCaixa, api, avisar, ErroDaApi, irPara, mostrarErro } from "../../dom.ts";
import { escapar } from "../../apresentacao/render.ts";
import { pagina, quadro } from "./demandas.ts";
import { textoDoMotivoDeRecusa } from "../inicio/inicio.ts";

export async function montarDemandas(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const dados = await api<BoardDeDemandas>("/api/demandas", { signal });
  const demandas =
    params.projeto === undefined ? dados.demandas : dados.demandas.filter((d) => d.projeto === params.projeto);
  main.innerHTML = quadro({ demandas, trabalho: dados.trabalho });
}

const NAO_ENCONTRADA =
  '<div class="cabeca-pagina"><h1>Demanda não encontrada</h1></div><p class="muted">Esta demanda não existe. <a class="link" href="/home">Ir para o Início</a></p>';

/** Desenha a página; o "ler tudo" só fica onde o texto recolhido não cabe. */
function desenharPagina(main: HTMLElement, dados: PaginaDaDemanda): void {
  main.innerHTML = pagina(dados);
  for (const botao of main.querySelectorAll<HTMLButtonElement>("button[data-expandir]")) {
    const texto = botao.previousElementSibling;
    botao.hidden = texto === null || texto.scrollHeight <= texto.clientHeight;
  }
}

/** Lê a demanda e redesenha a página com o que a API devolve; o 404 vira a página de não encontrada. */
async function carregar(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<boolean> {
  let dados: PaginaDaDemanda;
  try {
    dados = await api<PaginaDaDemanda>(`/api/demandas/${encodeURIComponent(params.demanda ?? "")}`, { signal });
  } catch (erro) {
    if (!(erro instanceof ErroDaApi && erro.status === 404)) throw erro;
    main.innerHTML = NAO_ENCONTRADA;
    return false;
  }
  desenharPagina(main, dados);
  return true;
}

export async function montarDemanda(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  if (!(await carregar(main, params, signal))) return;
  // O ouvinte sai com a página. A imagem do anexo, o HTML do desenho e os dados de cada evidência abrem na caixa; os
  // demais anexos seguem o link, em nova aba.
  main.addEventListener(
    "click",
    (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : null;
      const demanda = alvo?.closest<HTMLButtonElement>("button[data-demanda]");
      if (demanda) {
        void agirNaDemanda(demanda, main);
        return;
      }
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
      const expandir = alvo?.closest<HTMLButtonElement>("button[data-expandir]");
      if (expandir) {
        const aberto = expandir.previousElementSibling?.classList.toggle("aberto");
        expandir.textContent = aberto ? "recolher" : "ler tudo";
        return;
      }
      const evidencia = alvo?.closest<HTMLButtonElement>("button[data-evidencia]");
      if (evidencia) {
        const conteudo = evidencia.nextElementSibling;
        abrirCaixa({
          titulo: evidencia.dataset.evidencia ?? "",
          corpo: conteudo instanceof HTMLTemplateElement ? conteudo.innerHTML : "",
        });
        return;
      }
      const html = alvo?.closest<HTMLButtonElement>("button[data-html]");
      if (html) {
        abrirHtmlNaCaixa(html);
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

/** O HTML da evidência (o desenho, os impactos) na caixa, num iframe sandbox, como o Auditor o lê na demanda. */
function abrirHtmlNaCaixa(botao: HTMLButtonElement): void {
  const link = botao.dataset.html ?? "";
  const nome = botao.dataset.nome ?? "";
  abrirCaixa({
    titulo: nome,
    corpo: `<div class="evidencia"><iframe sandbox="allow-scripts" src="${escapar(link)}" title="${escapar(nome)}"></iframe></div>`,
    aba: link,
    baixar: `${link}&baixar`,
  });
}

/**
 * Envia a decisão do gate. Reprovar sem motivo não vai ao servidor: a mensagem fica junto ao campo. Com ou sem erro do
 * servidor, a página se redesenha com o estado atual; o erro fica no aviso, com a orientação que ele devolveu.
 */
async function decidir(
  botao: HTMLButtonElement,
  main: HTMLElement,
  params: Parametros,
  signal: AbortSignal,
): Promise<void> {
  const aprovando = botao.dataset.gate === "aprovado";
  // Cada botão aponta o campo que lê: o motivo (reprovar) ou a nota (aprovar o PR da rodada).
  const doCampo = (id?: string) =>
    id === undefined ? null : main.querySelector<HTMLInputElement>(`#${CSS.escape(id)}`);
  const campo = doCampo(botao.dataset.campo);
  const motivo = campo?.value.trim() ?? "";
  const nota = doCampo(botao.dataset.nota)?.value;
  const pendencia =
    !aprovando && motivo === ""
      ? { onde: campo?.nextElementSibling, texto: "O motivo é obrigatório para reprovar." }
      : aprovando && nota === ""
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
      body: JSON.stringify(
        aprovando ? { resultado: "aprovado", ...(nota && { nota: Number(nota) }) } : { resultado: "reprovado", motivo },
      ),
      signal,
    });
  } catch (falha) {
    mostrarErro(falha);
  }
  if (!signal.aborted) await carregar(main, params, signal);
}

/**
 * Reabrir (com instrução) ou executar agora um ticket, ou concluir a sessão de ajustes. Instrução vazia não vai ao
 * servidor; com ou sem erro dele, a página se redesenha com o status atual. O motivo da recusa do Despacho fica no aviso.
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
  let recusa: MotivoDeRecusaEmJson | undefined;
  try {
    // O "Executar agora" recusado pelo Despacho responde 200 com o motivo; aceito, responde 204.
    recusa = await api<MotivoDeRecusaEmJson | undefined>(botao.dataset.caminho ?? "", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(reabrir ? { instrucao } : {}),
      signal,
    });
  } catch (falha) {
    mostrarErro(falha);
  }
  if (signal.aborted) return;
  await carregar(main, params, signal);
  if (recusa) avisar(textoDoMotivoDeRecusa(recusa));
}

/**
 * Cancelar abre e fecha a confirmação sem pedido algum; confirmar ou arquivar envia e leva ao quadro, onde a demanda
 * (e as dependentes) aparece com o estado devolvido ou some. Com erro do servidor, o aviso traz a orientação dele e a
 * página se redesenha com o estado atual.
 */
async function agirNaDemanda(botao: HTMLButtonElement, main: HTMLElement): Promise<void> {
  const acao = botao.dataset.demanda;
  if (acao === "abrir-cancelar" || acao === "voltar") {
    const confirmacao = main.querySelector<HTMLElement>("[data-confirmar-cancelar]");
    if (confirmacao) confirmacao.hidden = acao === "voltar";
    return;
  }
  avisar();
  for (const b of main.querySelectorAll<HTMLButtonElement>("button[data-demanda]")) b.disabled = true;
  try {
    await api(botao.dataset.caminho ?? "", { method: "POST" });
    irPara("/home");
  } catch (falha) {
    mostrarErro(falha);
    const id = main.querySelector(".dm-cabeca .id")?.textContent ?? "";
    desenharPagina(main, await api<PaginaDaDemanda>(`/api/demandas/${encodeURIComponent(id)}`));
  }
}
