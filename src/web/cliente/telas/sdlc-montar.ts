// Configuração SDLC do projeto no DOM: lê a API, desenha com as funções puras de sdlc.ts, Adicionar e Remover sem
// rede, Salvar com os erros do 422 ao lado dos campos. Os testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Parametros } from "../caminhos.ts";
import { api, ErroDaApi, mostrarErro } from "../dom.ts";
import { errosDoZod } from "./configuracao.ts";
import {
  adicionar,
  CAMPOS_DA_ETAPA,
  CAMPOS_DO_PROJETO,
  doProjeto,
  erroPorEtapa,
  type Estado,
  estadoInicial,
  formulario,
  GRUPOS,
  type GrupoDeLista,
  type Linha,
  paraProjeto,
  remover,
  type Resposta,
  vazio,
} from "./sdlc.ts";

const valor = (raiz: ParentNode, campo: string): string =>
  raiz.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-campo="${campo}"]`)?.value ?? "";

/** O que o formulário tem agora, em texto. */
function ler(form: HTMLFormElement): Estado {
  const linhas = (grupo: string, campos: readonly string[]): Linha[] =>
    [...form.querySelectorAll(`[data-grupo="${grupo}"] [data-linha]`)].map((linha) =>
      Object.fromEntries(campos.map((c) => [c, valor(linha, c)])),
    );
  const projeto = Object.fromEntries(CAMPOS_DO_PROJETO.map((c) => [c, valor(form, c)])) as Pick<
    Estado,
    (typeof CAMPOS_DO_PROJETO)[number]
  >;
  const listas = Object.fromEntries(
    GRUPOS.map((g) => [
      g.chave,
      linhas(
        g.chave,
        g.campos.map(([c]) => c),
      ),
    ]),
  ) as Record<GrupoDeLista, Linha[]>;
  return { ...projeto, ...listas, etapas: linhas("etapas", CAMPOS_DA_ETAPA) };
}

export async function montarSdlc(main: HTMLElement, params: Parametros, signal: AbortSignal): Promise<void> {
  const nome = params.projeto ?? "";
  const { configurada, configuracao } = await api<Resposta>(
    `/api/projetos/${encodeURIComponent(nome)}/configuracao-sdlc`,
    { signal },
  );
  const rascunho = doProjeto(configuracao);

  const desenhar = (
    estado: Estado,
    erros = new Map<string, string[]>(),
    extra: { falha?: string; salvo?: boolean } = {},
  ) => {
    main.innerHTML = formulario(nome, estado, { erros, ...extra });
    const form = main.querySelector<HTMLFormElement>("[data-sdlc]");
    if (!form) return;
    form.addEventListener("click", (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : null;
      const chave = alvo?.closest<HTMLElement>("[data-adicionar]")?.dataset.adicionar as GrupoDeLista | undefined;
      const linha = alvo?.closest("[data-remover]")?.closest("[data-linha]");
      if (chave) {
        desenhar(adicionar(ler(form), chave), erros);
      } else if (linha) {
        const secao = linha.closest<HTMLElement>("[data-grupo]");
        const indice = [...(secao?.querySelectorAll("[data-linha]") ?? [])].indexOf(linha);
        // Os índices dos erros mudam com a linha removida: eles somem até o próximo envio.
        desenhar(remover(ler(form), secao?.dataset.grupo as GrupoDeLista, indice));
      }
    });
    form.addEventListener("submit", (evento) => {
      evento.preventDefault();
      const lido = ler(form);
      const corpo = paraProjeto(lido, nome);
      const botao = form.querySelector<HTMLButtonElement>('[type="submit"]');
      if (botao) botao.disabled = true;
      api<Resposta>(`/api/projetos/${encodeURIComponent(nome)}/configuracao-sdlc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      })
        .then((r) => {
          if (!signal.aborted) desenhar(doProjeto(r.configuracao), undefined, { salvo: true });
        })
        .catch((error_: unknown) => {
          if (signal.aborted) return;
          if (error_ instanceof ErroDaApi && error_.status === 422)
            desenhar(
              lido,
              erroPorEtapa(
                errosDoZod(error_.message),
                corpo.etapas.map((e) => e.etapa),
              ),
            );
          else if (error_ instanceof ErroDaApi && error_.status !== 401)
            desenhar(lido, undefined, { falha: error_.message });
          else {
            mostrarErro(error_);
            desenhar(lido);
          }
        });
    });
  };

  if (configurada) {
    desenhar(rascunho);
    return;
  }
  main.innerHTML = vazio(nome);
  main.querySelector("[data-criar]")?.addEventListener("click", () => {
    desenhar(estadoInicial(rascunho));
  });
}
