// Configuração (F7 §4.4) como funções puras: o menu lateral, o agendador e o formulário de projeto, com os erros do
// `zod` ao lado de cada campo. O DOM e a rede ficam em configuracao-montar.ts.
import type { Hospedagem, Projeto } from "../../../dominio/projeto.ts";
import type { Effort, Modelo } from "../../../dominio/primitivos.ts";
import type { Configuracao } from "../../../persistencia/servico.ts";
import type { UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import { escapar, nomeDoModelo } from "../render.ts";

/** `GET /api/configuracao`. */
export interface EstadoDaConfiguracao extends Configuracao {
  proximaBusca: string | null;
}

/** `GET /api/projetos`: os projetos cadastrados. */
export type ProjetoListado = Projeto;

/**
 * O projeto no formulário, sem os campos do fluxo legado, que o cadastro não pede; o novo ainda não tem hospedagem (o
 * F5 a deduz do remoto ao salvar).
 */
export type Rascunho = Pick<Projeto, "nome" | "repo" | "branchBase" | "preparacao" | "linkProduto"> & {
  hospedagem?: Hospedagem;
};

/** O item do menu escolhido, pelo endereço: `/config`, `/config?avaliacoes`, `/config?projeto=<nome>` ou `/config?novo`. */
export type Selecao =
  { tipo: "agendador" } | { tipo: "avaliacoes" } | { tipo: "projeto"; nome: string } | { tipo: "novo" };

export function selecao(busca: string): Selecao {
  const q = new URLSearchParams(busca);
  const nome = q.get("projeto");
  if (nome) return { tipo: "projeto", nome };
  if (q.has("avaliacoes")) return { tipo: "avaliacoes" };
  return q.has("novo") ? { tipo: "novo" } : { tipo: "agendador" };
}

export const NOVO: Rascunho = { nome: "", repo: "", branchBase: "main", preparacao: [], linkProduto: "" };

/** As mensagens por caminho (`fitness[0].nome`) do 422, a partir do `z.prettifyError` que o servidor manda. */
export type Erros = Map<string, string[]>;

export function errosDoZod(texto: string): Erros {
  const erros: Erros = new Map();
  for (const [, mensagem = "", caminho = ""] of texto.matchAll(/^✖ (.*)(?:\n {2}→ at (.*))?$/gm)) {
    erros.set(caminho, [...(erros.get(caminho) ?? []), mensagem]);
  }
  return erros;
}

/** As mensagens do campo `caminho`, inclusive as de dentro dele (`modeloAuditoria.modelo` no seletor). */
const mensagensDe = (erros: Erros, caminho: string): string[] =>
  [...erros].flatMap(([c, ms]) => (c === caminho || c.startsWith(`${caminho}.`) ? ms : []));

/** O `id` do controle do campo `caminho` (`campo-fitness[0].nome`), para o `<label for>` e a mensagem de erro. */
export const idDe = (caminho: string, prefixo = "campo"): string => `${prefixo}-${caminho}`;

/** A marca de erro do campo: a classe, o `aria-invalid` ligado à mensagem e a mensagem logo abaixo do controle. */
export function marca(erros: Erros, caminho: string, prefixo?: string): { classe: string; aria: string; msg: string } {
  const ms = mensagensDe(erros, caminho);
  if (ms.length === 0) return { classe: "", aria: "", msg: "" };
  const id = `${idDe(caminho, prefixo)}-erro`;
  return {
    classe: " erro",
    aria: ` aria-invalid="true" aria-describedby="${id}"`,
    msg: `<span class="msg-erro" id="${id}">${ms.map(escapar).join("; ")}</span>`,
  };
}

const HOSPEDAGEM: Record<Hospedagem, string> = { github: "GitHub", "azure-devops": "Azure DevOps" };

// O cliente não importa valores de src/dominio (os .ts vão ao navegador só sem os tipos): os níveis saem das chaves.
export const EFFORTS = Object.keys({
  off: 0,
  minimal: 0,
  low: 0,
  medium: 0,
  high: 0,
  xhigh: 0,
  max: 0,
} satisfies Record<Effort, 0>);

const atual = (sim: boolean): string => (sim ? ' aria-current="page"' : "");

/** Menu à esquerda: Geral → Agendador, com a marca, e Avaliações; Projetos → um por projeto, com a hospedagem, e o novo. */
export function menu(config: Configuracao, projetos: readonly ProjetoListado[], sel: Selecao): string {
  const ligado = config.agendadorAtivo
    ? '<span class="pill pill-ok">ligado</span>'
    : '<span class="pill pill-neutro">desligado</span>';
  const itens = projetos.map(
    (p) =>
      `<a href="/config?projeto=${encodeURIComponent(p.nome)}"${atual(sel.tipo === "projeto" && sel.nome === p.nome)}>${escapar(p.nome)}<span class="muted hospedagem">${HOSPEDAGEM[p.hospedagem]}</span></a>`,
  );
  return `<nav class="menu-config" aria-label="Configuração"><span class="rotulo">Geral</span><a href="/config"${atual(sel.tipo === "agendador")}>Agendador ${ligado}</a><a href="/config?avaliacoes"${atual(sel.tipo === "avaliacoes")}>Avaliações</a><span class="rotulo">Projetos</span>${itens.join("")}<a class="novo" href="/config?novo"${atual(sel.tipo === "novo")}>+ Novo projeto</a></nav>`;
}

const hora = (instante: string): string =>
  new Date(instante).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const NUMEROS = [
  ["intervaloMin", "Procurar a cada", 1],
  ["timeoutMin", "Tempo limite da execução", 10],
  ["ociosidadeMin", "Parar sessão ociosa após", 5],
] as const;

/** Agendador (F4 §3): interruptor, os três tempos em minutos e a próxima busca. */
export function agendador(estado: EstadoDaConfiguracao, erros: Erros): string {
  const numeros = NUMEROS.map(([campo, rotulo, minimo]) => {
    const m = marca(erros, campo);
    return `<div class="num-campo${m.classe}"><label for="${idDe(campo)}">${rotulo}</label><span class="com-unidade"><input type="number" id="${idDe(campo)}" name="${campo}" value="${String(estado[campo])}" min="${String(minimo)}" max="1440"${m.aria}> min</span>${m.msg}</div>`;
  });
  const busca = estado.proximaBusca
    ? `Próxima busca às <b>${hora(estado.proximaBusca)}</b>`
    : "Desligado: <b>não procura tickets</b>";
  return `<h2>Agendador</h2><form class="agendador superficie" data-agendador novalidate><label class="chave"><input type="checkbox" name="agendadorAtivo"${estado.agendadorAtivo ? " checked" : ""}><span class="trilho-chave"></span><span><strong>Agendador</strong><small>procura tickets abertos das demandas e os executa</small></span></label>${numeros.join("")}<div class="status-ag"><span>${busca}</span></div><button type="submit" class="btn btn-primario">Salvar</button></form>`;
}

export interface OpcoesDoProjeto {
  novo: boolean;
  erros: Erros;
  /** A mensagem do servidor que não é de um campo (502 do F5, 409), no rodapé. */
  falha?: string;
}

const par = (m: Modelo): string => `${m.provedor}/${m.modelo}`;

/** Um campo de texto com rótulo, ajuda e o erro do caminho. */
function texto(
  erros: Erros,
  caminho: string,
  rotulo: string,
  valor: string,
  { classe = "", mono = false, extra = "", ajuda = "" } = {},
): string {
  const m = marca(erros, caminho);
  const ajudaHtml = ajuda && `<span class="ajuda">${ajuda}</span>`;
  return `<div class="campo${classe}${m.classe}"><label for="${idDe(caminho)}">${rotulo}</label><input${mono ? ' class="mono"' : ""} id="${idDe(caminho)}" name="${caminho}" value="${escapar(valor)}"${extra}${m.aria}>${m.msg}${ajudaHtml}</div>`;
}

const remover = '<button type="button" class="x" data-remover title="Remover" aria-label="Remover">×</button>';

/** Lista de comandos com adicionar e remover; os erros de cada item e da lista inteira. */
function lista(erros: Erros, campo: "preparacao", rotulo: string, ajuda: string, itens: string[]): string {
  const m = marca(erros, campo);
  const linhas = itens.map((valor, i) => {
    const mi = marca(erros, `${campo}[${String(i)}]`);
    return `<div class="item-lista${mi.classe}"><input class="mono" value="${escapar(valor)}" placeholder="npm ci" aria-label="${rotulo}: comando ${String(i + 1)}"${mi.aria}>${remover}${mi.msg}</div>`;
  });
  return `<div class="campo${m.classe}" data-lista="${campo}">${rotulo} <span class="ajuda">${ajuda}</span><div class="lista">${linhas.join("")}${m.msg}<button type="button" class="link" data-adicionar="${campo}">+ comando</button></div></div>`;
}

/** O seletor de modelo do `caminho`: "padrão do pi" primeiro e, se o pi deixou de listar o gravado, ele continua nas opções. */
function seletorDeModelo(
  erros: Erros,
  caminho: string,
  escolhido: Modelo | null | undefined,
  disponiveis: readonly Modelo[],
): string {
  // O modelo gravado que o pi deixou de listar continua no seletor: salvar sem mexer não o apaga sem aviso.
  const opcoes =
    escolhido && !disponiveis.some((m) => par(m) === par(escolhido)) ? [...disponiveis, escolhido] : disponiveis;
  const m = marca(erros, caminho);
  const options = opcoes.map((o) => {
    const selecionado = escolhido && par(o) === par(escolhido) ? " selected" : "";
    return `<option value="${escapar(par(o))}"${selecionado}>${escapar(nomeDoModelo(o))}</option>`;
  });
  return `<div class="celula${m.classe}"><select id="${idDe(caminho)}" name="${caminho}"${escolhido ? "" : ' class="padrao"'}${m.aria}><option value="">padrão do pi</option>${options.join("")}</select>${m.msg}</div>`;
}

/** Avaliações (I-240): o modelo que o pi das avaliações do SDLC usa, e Salvar. */
export function modeloDasAvaliacoes(estado: EstadoDaConfiguracao, modelos: readonly Modelo[], erros: Erros): string {
  const caminho = "modeloAuditoria";
  return `<h2>Avaliações</h2><form class="form" data-avaliacoes novalidate><div class="campo"><label for="${idDe(caminho)}">Modelo das avaliações</label>${seletorDeModelo(erros, caminho, estado.modeloAuditoria, modelos)}<span class="ajuda">vazio usa o padrão do pi; vale para as avaliações iniciadas em Avaliações</span></div><div class="rodape-form"><button type="submit" class="btn btn-primario">Salvar</button></div></form>`;
}

const plural = (n: number, um: string, varios: string): string => `${String(n)} ${n === 1 ? um : varios}`;

/** Projeto (F7 §4.4) nos dois grupos, com o rodapé que diz o que é conferido ao salvar e quantos campos têm erro. */
export function formularioDeProjeto(p: Rascunho, { novo, erros, falha }: OpcoesDoProjeto): string {
  const titulo = novo
    ? "Novo projeto"
    : `${escapar(p.nome)}<button type="button" class="btn btn-perigo remover-projeto" data-remover-projeto aria-label="Remover o projeto ${escapar(p.nome)}">Remover</button>`;
  const nome = novo
    ? texto(erros, "nome", "Nome", p.nome, {
        extra: ' placeholder="loja-api"',
        ajuda: "letras minúsculas, números e hífen; não muda depois",
      })
    : texto(erros, "nome", "Nome", p.nome, { extra: " readonly" });
  const hospedagem = p.hospedagem ? HOSPEDAGEM[p.hospedagem] : "deduzida do remoto ao salvar";
  const contagem =
    erros.size > 0
      ? '<span class="msg-erro">' + plural(erros.size, "campo com erro", "campos com erro") + "</span>"
      : "";
  // A falha do F5 (502) ou a recusa do C19 (409) entra numa linha própria; a nota e a contagem ficam (F7 §4.4).
  const rodape =
    (falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : "") +
    `<span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch e o remoto.</span>${contagem}`;
  // Fora do h2: o título acessível do formulário continua o nome do projeto.
  const sdlc = novo
    ? ""
    : `<p class="link-sdlc"><a class="link" href="/projects/${encodeURIComponent(p.nome)}/sdlc">Configuração SDLC do projeto</a></p>`;
  return `<h2>${titulo}</h2>${sdlc}<form class="form" data-projeto novalidate>
<div class="grupo"><h3>Repositório</h3><div class="grade">${nome}${texto(erros, "branchBase", "Branch base", p.branchBase, { mono: true })}${texto(erros, "repo", "Caminho do repositório", p.repo, { classe: " largo", mono: true, extra: ' placeholder="/home/…/meu-projeto"', ajuda: "caminho absoluto; o repositório precisa ter o remoto <code>origin</code>" })}<div class="campo"><label for="campo-hospedagem">Hospedagem</label><input id="campo-hospedagem" value="${hospedagem}" readonly></div>${texto(erros, "linkProduto", "Link do produto", p.linkProduto ?? "", { mono: true, extra: ' placeholder="https://produto.exemplo.com"', ajuda: "opcional; endereço http(s) do produto no ar, de preferência homologação. Sem ele, a Simulação não executa" })}</div></div>
<div class="grupo"><h3>Preparação</h3><div class="grade">${lista(erros, "preparacao", "Preparação da worktree", "opcional; roda ao criar a worktree", p.preparacao)}</div></div>
<div class="rodape-form">${rodape}<button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn-primario">${novo ? "Cadastrar projeto" : "Salvar projeto"}</button></div></form>${novo ? "" : '<section class="usuarios-simulados" data-usuarios-simulados aria-label="Usuários simulados"></section>'}`;
}

export interface OpcoesDosUsuarios {
  /** O que está nos campos do formulário de novo usuário. */
  rascunho: { nome: string; descricao: string };
  /** Os erros do 422 do formulário, por campo (`nome`, `descricao`). */
  erros: Erros;
  /** A recusa que não é de um campo (nome repetido, 409), logo abaixo do formulário. */
  falha?: string;
  /** A recusa do último anexo de cada usuário, pelo ID dele. */
  falhasDeAnexo: ReadonlyMap<number, string>;
}

const FORMATOS_DO_ANEXO = ".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp,.gif";
const tamanho = (bytes: number): string => `${bytes.toLocaleString("pt-BR")} ${bytes === 1 ? "byte" : "bytes"}`;

function cartaoDoUsuario(u: UsuarioSimulado, falha: string | undefined): string {
  const anexos = u.anexos.map(
    (a) =>
      `<li class="anexo-usuario">${escapar(a.nome)} <span class="muted">${tamanho(a.bytes)}</span><button type="button" class="x" data-remover-anexo="${escapar(a.nome)}" title="Remover o anexo" aria-label="Remover o anexo ${escapar(a.nome)}">×</button></li>`,
  );
  const aviso = falha ? `<span class="msg-erro" role="alert">${escapar(falha)}</span>` : "";
  const listaDeAnexos = anexos.length > 0 ? `<ul class="anexos-usuario">${anexos.join("")}</ul>` : "";
  return `<article class="cartao-usuario" data-usuario="${String(u.id)}"><h4>${escapar(u.nome)}</h4><p class="descricao-usuario">${escapar(u.descricao)}</p>${listaDeAnexos}<div class="anexar"><button type="button" class="link" data-anexar-botao>+ anexar arquivo</button><input type="file" accept="${FORMATOS_DO_ANEXO}" data-anexar hidden aria-label="Anexar arquivo a ${escapar(u.nome)}"></div>${aviso}</article>`;
}

/** Um campo do formulário de novo usuário: `campo-usuario-nome`, para não colidir com o `campo-nome` do projeto. */
function campoDoUsuario(erros: Erros, campo: "nome" | "descricao", rotulo: string, valor: string): string {
  const m = marca(erros, campo, "campo-usuario");
  const id = idDe(campo, "campo-usuario");
  const controle =
    campo === "nome"
      ? `<input id="${id}" name="nome" value="${escapar(valor)}" placeholder="Dona Maria"${m.aria}>`
      : `<textarea id="${id}" name="descricao" rows="3" placeholder="Contadora de 60 anos, pouca familiaridade com sistemas web"${m.aria}>${escapar(valor)}</textarea>`;
  return `<div class="campo${campo === "descricao" ? " largo" : ""}${m.classe}"><label for="${id}">${rotulo}</label>${controle}${m.msg}</div>`;
}

/**
 * Usuários simulados (F8 §2), abaixo do formulário do projeto salvo: um cartão por usuário, com os anexos e o
 * "+ anexar arquivo", e o formulário de novo usuário.
 */
export function usuariosSimulados(
  usuarios: readonly UsuarioSimulado[],
  { rascunho, erros, falha, falhasDeAnexo }: OpcoesDosUsuarios,
): string {
  const cartoes = usuarios.map((u) => cartaoDoUsuario(u, falhasDeAnexo.get(u.id)));
  const lista =
    cartoes.length > 0
      ? `<div class="cartoes-usuario">${cartoes.join("")}</div>`
      : '<p class="muted">Nenhum usuário simulado neste projeto ainda.</p>';
  const aviso = falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : "";
  return `<h3>Usuários simulados <span class="nota">· pessoas fictícias que usam o produto na Simulação</span></h3>${lista}<form class="form novo-usuario" data-usuario-simulado novalidate><div class="grade">${campoDoUsuario(erros, "nome", "Nome do usuário", rascunho.nome)}${campoDoUsuario(erros, "descricao", "Descrição do usuário", rascunho.descricao)}</div><span class="ajuda">A descrição e os anexos (manuais em PDF, texto ou imagem, até 20 MiB) vão para a IA.</span>${aviso}<div class="rodape-form"><button type="submit" class="btn btn-primario">Criar usuário simulado</button></div></form>`;
}

/** A confirmação de remover o projeto, que não tem volta: o nome e o que sai junto. */
export const confirmacaoDeRemover = (nome: string): string =>
  `<dialog class="dialogo" data-dialogo-remover aria-labelledby="titulo-remover"><h2 id="titulo-remover">Remover o projeto ${escapar(nome)}</h2><p>O projeto <strong>${escapar(nome)}</strong> será apagado com as demandas, em qualquer fase, e os tickets, as sessões, as evidências, as decisões e o custo delas. Saem do disco as worktrees e as pastas de execução; o repositório original não é tocado. Não dá para desfazer.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar-remover>Remover projeto</button></form></dialog>`;

/** A página: o cabeçalho, o menu e o painel do item escolhido. */
export const pagina = (menuHtml: string, painel: string): string =>
  `<div class="cabeca-pagina"><h1>Configuração</h1></div><div class="config">${menuHtml}<section class="painel-config superficie">${painel}</section></div>`;

/** O projeto do endereço que não está cadastrado. */
export const projetoInexistente = (nome: string): string =>
  `<h2>Projeto não encontrado</h2><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/config?novo">Cadastrar um projeto</a></p>`;
