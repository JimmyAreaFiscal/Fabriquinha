// Configuração (F7 §4.4) no DOM: lê a API, desenha com as funções puras de configuracao.ts, lê os formulários e
// mostra os erros do 422 ao lado dos campos. Os testes de ponta a ponta (e2e/) o exercitam no navegador.
import type { Effort, Modelo } from "../../../../modulos/compartilhado/nucleo/primitivos.ts";
import type { Parametros } from "../../compartilhado/caminhos.ts";
import type { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../../../contrato/configuracao.ts";
import type { UsuarioSimulado } from "../../../contrato/avaliacao/simulacao.ts";
import { api, avisar, ErroDaApi, mostrarErro } from "../../dom.ts";
import { modeloDoSeletor } from "../../apresentacao/render.ts";
import {
  agendador,
  ambiente,
  confirmacaoDeEliminar,
  confirmacaoDeRemover,
  type Erros,
  errosDoZod,
  etapasDoFormulario,
  formularioDeProjeto,
  menu,
  modeloDasAvaliacoes,
  NOVO,
  type OpcoesDosUsuarios,
  pagina,
  type ProjetoListado,
  projetoInexistente,
  rascunhoDe,
  type Rascunho,
  selecao,
  usuariosSimulados,
} from "./configuracao.ts";

const postar = (corpo: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corpo),
});

/** Os erros de campo do 422; qualquer outro erro vai para o aviso, e o formulário volta sem erro de campo. */
function errosDe(erro: unknown): Erros {
  if (erro instanceof ErroDaApi && erro.status === 422) return errosDoZod(erro.message);
  mostrarErro(erro);
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

/**
 * O que o formulário do projeto tem agora, no formato do F1 §3.3 sem a hospedagem nem os campos do fluxo legado, com o
 * modelo e o effort de cada etapa; a etapa em "padrão do pi" fica de fora.
 */
function lerProjeto(form: HTMLFormElement, hospedagem: Rascunho["hospedagem"]): Rascunho {
  const configuracoes: Rascunho["configuracoes"] = {};
  for (const [etapa] of etapasDoFormulario()) {
    const modelo = modeloDoSeletor(valor(form, `[name="configuracoes.${etapa}.modelo"]`));
    const effort = valor(form, `[name="configuracoes.${etapa}.effort"]`);
    if (modelo || effort) {
      configuracoes[etapa] = { ...(modelo && { modelo }), ...(effort && { effort: effort as Effort }) };
    }
  }
  return {
    nome: valor(form, '[name="nome"]'),
    raiz_git: valor(form, '[name="raiz_git"]'),
    branch_base: valor(form, '[name="branch_base"]'),
    ...(hospedagem && { hospedagem }),
    preparacao: [...form.querySelectorAll<HTMLInputElement>('[data-lista="preparacao"] input')].map((i) => i.value),
    link_produto: valor(form, '[name="link_produto"]'),
    configuracoes,
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

function montarAgendador(
  main: HTMLElement,
  signal: AbortSignal,
  menuHtml: string,
  estado: EstadoDaConfiguracao,
  erros: Erros,
): void {
  main.innerHTML = pagina(menuHtml, agendador(estado, erros));
  const form = main.querySelector<HTMLFormElement>("[data-agendador]");
  form?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const dados = { ...lerAgendador(form), modeloAuditoria: estado.modeloAuditoria }; // o formulário posta a configuração inteira
    ocupar(form, "Salvando…");
    api("/api/configuracao", postar(dados))
      .then(() => montarConfiguracao(main, {}, signal))
      .catch((error_: unknown) => {
        if (!signal.aborted) montarAgendador(main, signal, menuHtml, { ...estado, ...dados }, errosDe(error_));
      });
  });
}

/** O modelo das avaliações: posta a configuração gravada inteira com o modelo escolhido; o 422 aparece no campo. */
function montarModeloDasAvaliacoes(
  main: HTMLElement,
  signal: AbortSignal,
  menuHtml: string,
  estado: EstadoDaConfiguracao,
  modelos: readonly Modelo[],
  erros: Erros,
): void {
  main.innerHTML = pagina(menuHtml, modeloDasAvaliacoes(estado, modelos, erros));
  const form = main.querySelector<HTMLFormElement>("[data-avaliacoes]");
  form?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const { agendadorAtivo, intervaloMin, timeoutMin, ociosidadeMin } = estado;
    const modeloAuditoria = modeloDoSeletor(valor(form, '[name="modeloAuditoria"]'));
    ocupar(form, "Salvando…");
    api("/api/configuracao", postar({ agendadorAtivo, intervaloMin, timeoutMin, ociosidadeMin, modeloAuditoria }))
      .then(() => montarConfiguracao(main, {}, signal))
      .catch((error_: unknown) => {
        if (!signal.aborted)
          montarModeloDasAvaliacoes(main, signal, menuHtml, { ...estado, modeloAuditoria }, modelos, errosDe(error_));
      });
  });
}

/** O que o formulário do Ambiente tem agora, no formato de `ConfiguracaoDoAmbiente`. */
const lerAmbiente = (form: HTMLFormElement): EstadoDoAmbiente["configuracao"] => ({
  tipo: valor(form, '[name="tipo"]') as EstadoDoAmbiente["configuracao"]["tipo"],
  memoria_maxima_mb: Number(valor(form, '[name="memoria_maxima_mb"]')),
  cpus: Number(valor(form, '[name="cpus"]')),
  ociosidade_para_eliminar_min: Number(valor(form, '[name="ociosidade_para_eliminar_min"]')),
});

/** O Ambiente: salvar grava o tipo e os limites; Eliminar pede confirmação e o 409 do alocado vai para o aviso. */
function montarAmbiente(
  main: HTMLElement,
  signal: AbortSignal,
  menuHtml: string,
  estado: EstadoDoAmbiente,
  erros: Erros,
): void {
  main.innerHTML = pagina(menuHtml, ambiente(estado, erros));
  const form = main.querySelector<HTMLFormElement>("[data-ambiente]");
  form?.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const dados = lerAmbiente(form);
    ocupar(form, "Salvando…");
    api("/api/ambiente", postar(dados))
      .then(() => montarConfiguracao(main, {}, signal))
      .catch((error_: unknown) => {
        if (!signal.aborted)
          montarAmbiente(main, signal, menuHtml, { ...estado, configuracao: dados }, errosDe(error_));
      });
  });
  main.querySelector(".conjunto-ambiente")?.addEventListener("click", (evento) => {
    const id =
      evento.target instanceof Element
        ? evento.target.closest<HTMLElement>("[data-eliminar]")?.dataset.eliminar
        : undefined;
    if (id === undefined) return;
    main.querySelector("[data-dialogo-eliminar]")?.remove();
    main.querySelector(".painel-config")?.insertAdjacentHTML("beforeend", confirmacaoDeEliminar(id));
    const dialogo = main.querySelector<HTMLDialogElement>("[data-dialogo-eliminar]");
    dialogo?.showModal();
    dialogo?.querySelector("[data-confirmar-eliminar]")?.addEventListener("click", (clique) => {
      (clique.currentTarget as HTMLButtonElement).disabled = true;
      api(`/api/ambiente/${encodeURIComponent(id)}`, { method: "DELETE" })
        .then(() => {
          dialogo.close();
          return montarConfiguracao(main, {}, signal);
        })
        .catch((error_: unknown) => {
          dialogo.close();
          mostrarErro(error_);
        });
    });
  });
}

/** O diálogo de remover o projeto salvo: só o DELETE apaga; ao concluir, volta a `/config` com os avisos do disco. */
function montarRemocao(main: HTMLElement, signal: AbortSignal, salvo: ProjetoListado): void {
  main.querySelector(".painel-config")?.insertAdjacentHTML("beforeend", confirmacaoDeRemover(salvo.nome));
  const dialogo = main.querySelector<HTMLDialogElement>("[data-dialogo-remover]");
  main.querySelector("[data-remover-projeto]")?.addEventListener("click", () => dialogo?.showModal());
  dialogo?.querySelector("[data-confirmar-remover]")?.addEventListener("click", (evento) => {
    (evento.currentTarget as HTMLButtonElement).disabled = true;
    api<{ avisos: string[] }>(`/api/projetos/${encodeURIComponent(salvo.nome)}`, { method: "DELETE" })
      .then(async ({ avisos }) => {
        dialogo.close();
        history.replaceState(null, "", "/config");
        await montarConfiguracao(main, {}, signal);
        if (avisos.length > 0) avisar(avisos.join("; "));
      })
      .catch((error_: unknown) => {
        dialogo.close();
        mostrarErro(error_);
      });
  });
}

/**
 * Os usuários simulados do projeto salvo (F8 §2), na seção abaixo do formulário: ela se redesenha sozinha, então
 * criar usuário ou anexar arquivo não toca no que o Auditor digitou no formulário do projeto.
 */
function montarUsuarios(main: HTMLElement, signal: AbortSignal, projeto: string): void {
  const secao = main.querySelector<HTMLElement>("[data-usuarios-simulados]");
  if (!secao) return;
  const rota = `/api/projetos/${encodeURIComponent(projeto)}/usuarios-simulados`;
  let usuarios: UsuarioSimulado[] = [];
  const rascunho = () => ({ nome: valor(secao, '[name="nome"]'), descricao: valor(secao, '[name="descricao"]') });
  const desenhar = (extra: Partial<OpcoesDosUsuarios> = {}): void => {
    secao.innerHTML = usuariosSimulados(usuarios, {
      rascunho: rascunho(),
      erros: new Map(),
      falhasDeAnexo: new Map(),
      ...extra,
    });
  };
  /** Relê a lista e redesenha; o que o Auditor digitou no formulário fica. */
  const recarregar = (extra?: Partial<OpcoesDosUsuarios>): Promise<void> =>
    api<UsuarioSimulado[]>(rota, { signal }).then((lista) => {
      const atual = rascunho();
      usuarios = lista;
      desenhar({ rascunho: atual, ...extra });
    });
  const falhou = (erro: unknown): void => {
    if (!signal.aborted) mostrarErro(erro);
  };
  /** A recusa do anexo: o 422 do nome leva o caminho `nome`; o resto (tamanho, 404) vai como o servidor mandou. */
  const recusaDoAnexo = (erro: unknown): string | undefined => {
    if (!(erro instanceof ErroDaApi) || erro.status === 401) return undefined;
    return erro.status === 422 ? (errosDoZod(erro.message).get("nome") ?? [erro.message]).join("; ") : erro.message;
  };
  const idDoCartao = (alvo: Element | null): number =>
    Number(alvo?.closest<HTMLElement>("[data-usuario]")?.dataset.usuario);

  secao.addEventListener("click", (evento) => {
    const alvo = evento.target instanceof Element ? evento.target : null;
    const cartao = alvo?.closest("[data-usuario]");
    if (alvo?.closest("[data-anexar-botao]")) {
      cartao?.querySelector<HTMLInputElement>("[data-anexar]")?.click();
      return;
    }
    const nome = alvo?.closest<HTMLElement>("[data-remover-anexo]")?.dataset.removerAnexo;
    if (nome === undefined) return;
    const id = idDoCartao(alvo);
    api(`/api/usuarios-simulados/${String(id)}/anexos/${encodeURIComponent(nome)}`, { method: "DELETE" })
      .then(() => recarregar())
      .catch(falhou);
  });
  secao.addEventListener("change", (evento) => {
    const entrada = evento.target;
    if (!(entrada instanceof HTMLInputElement) || entrada.type !== "file") return;
    const arquivo = entrada.files?.[0];
    if (!arquivo) return;
    const id = idDoCartao(entrada);
    api(`/api/usuarios-simulados/${String(id)}/anexos?nome=${encodeURIComponent(arquivo.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: arquivo,
    })
      .then(() => recarregar())
      .catch((error_: unknown) => {
        const recusa = recusaDoAnexo(error_);
        if (recusa === undefined) falhou(error_);
        else if (!signal.aborted) desenhar({ falhasDeAnexo: new Map([[id, recusa]]) });
      });
  });
  secao.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const dados = rascunho();
    if (evento.target instanceof HTMLFormElement) ocupar(evento.target, "Criando…");
    api(rota, postar(dados))
      .then(() => recarregar({ rascunho: { nome: "", descricao: "" } }))
      .catch((error_: unknown) => {
        if (signal.aborted) return;
        if (error_ instanceof ErroDaApi && error_.status === 422)
          desenhar({ rascunho: dados, erros: errosDoZod(error_.message) });
        else if (error_ instanceof ErroDaApi && error_.status !== 401)
          desenhar({ rascunho: dados, falha: error_.message });
        else falhou(error_);
      });
  });
  recarregar().catch(falhou);
}

function montarProjeto(
  main: HTMLElement,
  signal: AbortSignal,
  menuHtml: string,
  salvo: ProjetoCadastrado | undefined,
  modelosDoPi: readonly Modelo[],
): void {
  const inicial: Rascunho = salvo ? rascunhoDe(salvo) : NOVO;
  const desenhar = (p: Rascunho, erros: Erros, falha?: string): void => {
    main.innerHTML = pagina(menuHtml, formularioDeProjeto(p, { novo: !salvo, modelosDoPi, erros, falha }));
    const form = main.querySelector<HTMLFormElement>("[data-projeto]");
    if (!form) return;
    if (salvo) {
      montarRemocao(main, signal, salvo);
      montarUsuarios(main, signal, salvo.nome);
    }
    // O "padrão do pi" fica apagado; escolher um modelo ou effort o acende.
    form.addEventListener("change", (evento) => {
      if (evento.target instanceof HTMLSelectElement) evento.target.classList.toggle("padrao", !evento.target.value);
    });
    form.addEventListener("click", (evento) => {
      const alvo = evento.target instanceof Element ? evento.target : null;
      const adicionar = alvo?.closest<HTMLElement>("[data-adicionar]")?.dataset.adicionar;
      const remover = alvo?.closest("[data-remover]")?.closest(".item-lista");
      if (alvo?.closest("[data-cancelar]")) {
        desenhar(inicial, new Map());
      } else if (adicionar === "preparacao") {
        const p = lerProjeto(form, inicial.hospedagem);
        desenhar({ ...p, preparacao: [...p.preparacao, ""] }, erros);
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
          await montarConfiguracao(main, {}, signal);
        })
        .catch((error_: unknown) => {
          if (signal.aborted) return;
          // A falha do F5 (502) e a recusa do C19 (409) não são de um campo: vão para o rodapé, onde se clicou.
          if (error_ instanceof ErroDaApi && error_.status !== 422 && error_.status !== 401)
            desenhar(p, new Map(), error_.message);
          else desenhar(p, errosDe(error_));
        });
    });
  };
  desenhar(inicial, new Map());
}

/** A página `/config`: o item do menu vem do endereço (`?projeto=<nome>`, `?novo`), e cada link troca o item. */
export async function montarConfiguracao(main: HTMLElement, _params: Parametros, signal: AbortSignal): Promise<void> {
  const sel = selecao(location.search);
  const [estado, projetos] = await Promise.all([
    api<EstadoDaConfiguracao>("/api/configuracao", { signal }),
    api<ProjetoCadastrado[]>("/api/projetos", { signal }),
  ]);
  const menuHtml = menu(estado, projetos, sel);
  if (sel.tipo === "agendador") {
    montarAgendador(main, signal, menuHtml, estado, new Map());
    return;
  }
  if (sel.tipo === "avaliacoes") {
    montarModeloDasAvaliacoes(
      main,
      signal,
      menuHtml,
      estado,
      await api<Modelo[]>("/api/modelos", { signal }),
      new Map(),
    );
    return;
  }
  if (sel.tipo === "ambiente") {
    montarAmbiente(main, signal, menuHtml, await api<EstadoDoAmbiente>("/api/ambiente", { signal }), new Map());
    return;
  }
  const salvo = sel.tipo === "projeto" ? projetos.find((p) => p.nome === sel.nome) : undefined;
  if (sel.tipo === "projeto" && !salvo) {
    main.innerHTML = pagina(menuHtml, projetoInexistente(sel.nome));
    return;
  }
  montarProjeto(main, signal, menuHtml, salvo, await api<Modelo[]>("/api/modelos", { signal }));
}
