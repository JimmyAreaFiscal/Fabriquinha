// Configuração (F7 §4.4) como funções puras: o menu lateral, o agendador e o formulário de projeto, com os erros do
// `zod` ao lado de cada campo. O DOM e a rede ficam em configuracao-montar.ts.
import type { Hospedagem, Projeto } from "../../../dominio/projeto.ts";
import type { Etapa, Modelo } from "../../../dominio/primitivos.ts";
import type { Configuracao } from "../../../persistencia/servico.ts";
import type { UsuarioSimulado } from "../../../persistencia/simulacao.ts";
import { escapar, ha, nomeDoModelo, rotuloIssue, rotuloTicket } from "../render.ts";

/** `GET /api/configuracao`. */
export interface EstadoDaConfiguracao extends Configuracao {
  proximaBusca: string | null;
  emAndamento: { execucao: number; ticket: number; issue: number; iniciadaEm: string }[];
}

/** `GET /api/projetos`: o projeto com o número de issues. */
export type ProjetoListado = Projeto & { issues: number };

/** O projeto no formulário: o novo ainda não tem hospedagem (o F5 a deduz do remoto ao salvar). */
export type Rascunho = Omit<Projeto, "hospedagem"> & { hospedagem?: Hospedagem };

/** O item do menu escolhido, pelo endereço: `/config`, `/config?projeto=<nome>` ou `/config?novo`. */
export type Selecao = { tipo: "agendador" } | { tipo: "projeto"; nome: string } | { tipo: "novo" };

export function selecao(busca: string): Selecao {
  const q = new URLSearchParams(busca);
  const nome = q.get("projeto");
  if (nome) return { tipo: "projeto", nome };
  return q.has("novo") ? { tipo: "novo" } : { tipo: "agendador" };
}

export const NOVO: Rascunho = {
  nome: "",
  repo: "",
  branchBase: "main",
  preparacao: [],
  testes: [""],
  sonar: { projectKey: "" },
  fitness: [{ nome: "", comando: "", descricao: "" }],
  modelos: {},
  linkProduto: "",
};

/** As mensagens por caminho (`fitness[0].nome`) do 422, a partir do `z.prettifyError` que o servidor manda. */
export type Erros = Map<string, string[]>;

export function errosDoZod(texto: string): Erros {
  const erros: Erros = new Map();
  for (const [, mensagem = "", caminho = ""] of texto.matchAll(/^✖ (.*)(?:\n {2}→ at (.*))?$/gm)) {
    erros.set(caminho, [...(erros.get(caminho) ?? []), mensagem]);
  }
  return erros;
}

/** As mensagens do campo `caminho`, inclusive as de dentro dele (`modelos.desenho.modelo` no seletor da etapa). */
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

export const ETAPAS: readonly (readonly [Etapa, string])[] = [
  ["registro", "Registro"],
  ["desenho", "Desenho"],
  ["desenvolvimento", "Desenvolvimento"],
  ["revisao", "Revisão"],
  ["encerramento", "Encerramento"],
  ["sessao", "Sessão em aberto"],
];

const atual = (sim: boolean): string => (sim ? ' aria-current="page"' : "");

/** Menu à esquerda: Geral → Agendador, com a marca; Projetos → um por projeto, com a hospedagem, e o novo. */
export function menu(config: Configuracao, projetos: readonly ProjetoListado[], sel: Selecao): string {
  const ligado = config.agendadorAtivo
    ? '<span class="pill pill-ok">ligado</span>'
    : '<span class="pill pill-neutro">desligado</span>';
  const itens = projetos.map(
    (p) =>
      `<a href="/config?projeto=${encodeURIComponent(p.nome)}"${atual(sel.tipo === "projeto" && sel.nome === p.nome)}>${escapar(p.nome)}<span class="muted hospedagem">${HOSPEDAGEM[p.hospedagem]}</span></a>`,
  );
  return `<nav class="menu-config" aria-label="Configuração"><span class="rotulo">Geral</span><a href="/config"${atual(sel.tipo === "agendador")}>Agendador ${ligado}</a><span class="rotulo">Projetos</span>${itens.join("")}<a class="novo" href="/config?novo"${atual(sel.tipo === "novo")}>+ Novo projeto</a></nav>`;
}

const hora = (instante: string): string =>
  new Date(instante).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

const NUMEROS = [
  ["intervaloMin", "Procurar a cada", 1],
  ["timeoutMin", "Tempo limite da execução", 10],
  ["ociosidadeMin", "Parar sessão ociosa após", 5],
] as const;

/** Agendador (F4 §3): interruptor, os três tempos em minutos, a próxima busca e as execuções autônomas em andamento. */
export function agendador(estado: EstadoDaConfiguracao, erros: Erros, agora: Date): string {
  const numeros = NUMEROS.map(([campo, rotulo, minimo]) => {
    const m = marca(erros, campo);
    return `<div class="num-campo${m.classe}"><label for="${idDe(campo)}">${rotulo}</label><span class="com-unidade"><input type="number" id="${idDe(campo)}" name="${campo}" value="${String(estado[campo])}" min="${String(minimo)}" max="1440"${m.aria}> min</span>${m.msg}</div>`;
  });
  const busca = estado.proximaBusca
    ? `Próxima busca às <b>${hora(estado.proximaBusca)}</b>`
    : "Desligado: <b>não procura tickets</b>";
  const execucoes = estado.emAndamento.map(
    (e) =>
      `<span>Executando <b>E-${String(e.execucao)}</b> · ${rotuloIssue(e.issue)} · ${rotuloTicket(e.ticket)} · ${ha(e.iniciadaEm, agora)}</span>`,
  );
  return `<h2>Agendador</h2><form class="agendador superficie" data-agendador novalidate><label class="chave"><input type="checkbox" name="agendadorAtivo"${estado.agendadorAtivo ? " checked" : ""}><span class="trilho-chave"></span><span><strong>Agendador</strong><small>procura tickets abertos e executa um por issue</small></span></label>${numeros.join("")}<div class="status-ag"><span>${busca}</span>${execucoes.join("") || "<span>Nenhuma execução autônoma em andamento</span>"}</div><button type="submit" class="btn btn-primario">Salvar</button></form>`;
}

export interface OpcoesDoProjeto {
  /** `undefined` no novo projeto. */
  issues?: number;
  modelos: readonly Modelo[];
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

/** Lista de comandos com adicionar e remover; os erros de cada item e da lista inteira (pelo menos um). */
function lista(erros: Erros, campo: "preparacao" | "testes", rotulo: string, ajuda: string, itens: string[]): string {
  const m = marca(erros, campo);
  const linhas = itens.map((valor, i) => {
    const mi = marca(erros, `${campo}[${String(i)}]`);
    return `<div class="item-lista${mi.classe}"><input class="mono" value="${escapar(valor)}" placeholder="${campo === "testes" ? "npm test" : "npm ci"}" aria-label="${rotulo}: comando ${String(i + 1)}"${mi.aria}>${remover}${mi.msg}</div>`;
  });
  return `<div class="campo${m.classe}" data-lista="${campo}">${rotulo} <span class="ajuda">${ajuda}</span><div class="lista">${linhas.join("")}${m.msg}<button type="button" class="link" data-adicionar="${campo}">+ comando</button></div></div>`;
}

function fitness(erros: Erros, itens: Projeto["fitness"]): string {
  const linhas = itens.map((f, i) => {
    const celula = (campo: keyof typeof f, rotulo: string, placeholder: string, mono: boolean) => {
      const m = marca(erros, `fitness[${String(i)}].${campo}`);
      return `<div class="celula${m.classe}"><input${mono ? ' class="mono"' : ""} data-campo="${campo}" value="${escapar(f[campo])}" placeholder="${placeholder}" aria-label="Fitness function ${String(i + 1)}: ${rotulo}"${m.aria}>${m.msg}</div>`;
    };
    return `<div class="fitness" data-fitness>${celula("nome", "nome", "cobertura-minima", true)}${celula("comando", "comando", "comando", true)}${celula("descricao", "descrição", "o que ela garante", false)}${remover}</div>`;
  });
  const m = marca(erros, "fitness");
  return `<div class="grupo"><h3>Fitness functions <span class="nota">· pelo menos uma; rodam no desenvolvimento e na revisão</span></h3><div class="lista${m.classe}"><div class="fitness-cab" aria-hidden="true"><span>Nome</span><span>Comando</span><span>Descrição (até 300)</span><span></span></div>${linhas.join("")}${m.msg}<button type="button" class="link" data-adicionar="fitness">+ fitness function</button></div></div>`;
}

function modelos(erros: Erros, escolhidos: Rascunho["modelos"], disponiveis: readonly Modelo[]): string {
  const linhas = ETAPAS.map(([etapa, rotulo]) => {
    const escolhido = escolhidos[etapa];
    // O modelo gravado que o pi deixou de listar continua no seletor: salvar sem mexer não o apaga sem aviso.
    const opcoes =
      escolhido && !disponiveis.some((m) => par(m) === par(escolhido)) ? [...disponiveis, escolhido] : disponiveis;
    const caminho = `modelos.${etapa}`;
    const m = marca(erros, caminho);
    const options = opcoes.map((o) => {
      const selecionado = escolhido && par(o) === par(escolhido) ? " selected" : "";
      const rotuloDoPar = escapar(nomeDoModelo(o));
      return `<option value="${escapar(par(o))}"${selecionado}>${rotuloDoPar}</option>`;
    });
    return `<label for="${idDe(caminho)}">${rotulo}</label><div class="celula${m.classe}"><select id="${idDe(caminho)}" name="${caminho}"${escolhido ? "" : ' class="padrao"'}${m.aria}><option value="">padrão do pi</option>${options.join("")}</select>${m.msg}</div>`;
  });
  return `<div class="grupo"><h3>Modelo por etapa <span class="nota">· vazio usa o padrão do pi; o ticket pode sobrescrever</span></h3><div class="modelos-grade">${linhas.join("")}</div></div>`;
}

const plural = (n: number, um: string, varios: string): string => `${String(n)} ${n === 1 ? um : varios}`;

/** Projeto (F7 §4.4) nos quatro grupos, com o rodapé que diz o que é conferido ao salvar e quantos campos têm erro. */
export function formularioDeProjeto(
  p: Rascunho,
  { issues, modelos: disponiveis, erros, falha }: OpcoesDoProjeto,
): string {
  const novo = issues === undefined;
  const titulo = novo
    ? "Novo projeto"
    : `${escapar(p.nome)} <span class="muted contagem">${plural(issues, "issue", "issues")}</span><button type="button" class="btn btn-perigo remover-projeto" data-remover-projeto aria-label="Remover o projeto ${escapar(p.nome)}">Remover</button>`;
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
    `<span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.</span>${contagem}`;
  return `<h2>${titulo}</h2><form class="form" data-projeto novalidate>
<div class="grupo"><h3>Repositório</h3><div class="grade">${nome}${texto(erros, "branchBase", "Branch base", p.branchBase, { mono: true })}${texto(erros, "repo", "Caminho do repositório", p.repo, { classe: " largo", mono: true, extra: ' placeholder="/home/…/meu-projeto"', ajuda: "caminho absoluto; o repositório precisa ter o remoto <code>origin</code>" })}<div class="campo"><label for="campo-hospedagem">Hospedagem</label><input id="campo-hospedagem" value="${hospedagem}" readonly></div>${texto(erros, "sonar.projectKey", "Projeto no SonarQube", p.sonar.projectKey, { mono: true, extra: ' placeholder="projectKey"', ajuda: "o token fica em <code>&lt;raiz&gt;/ambiente</code>, fora do banco" })}${texto(erros, "linkProduto", "Link do produto", p.linkProduto ?? "", { classe: " largo", mono: true, extra: ' placeholder="https://produto.exemplo.com"', ajuda: "opcional; endereço http(s) do produto no ar, de preferência homologação. Sem ele, a Simulação não executa" })}</div></div>
<div class="grupo"><h3>Preparação e testes</h3><div class="grade">${lista(erros, "preparacao", "Preparação da worktree", "opcional; roda ao criar a worktree", p.preparacao)}${lista(erros, "testes", "Testes", "pelo menos um; todos precisam sair com 0", p.testes)}</div></div>
${fitness(erros, p.fitness)}
${modelos(erros, p.modelos, disponiveis)}
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

/** A confirmação de remover o projeto (C18 do arquivar, mas sem volta): o nome e quantas issues saem junto. */
export const confirmacaoDeRemover = (nome: string, issues: number): string =>
  `<dialog class="dialogo" data-dialogo-remover aria-labelledby="titulo-remover"><h2 id="titulo-remover">Remover o projeto ${escapar(nome)}</h2><p>O projeto <strong>${escapar(nome)}</strong> e ${plural(issues, "issue", "issues")} serão apagados, em qualquer fase, com tickets, execuções, evidências, decisões e custo. Saem do disco as worktrees e as pastas de execução; o repositório original não é tocado. Não dá para desfazer.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar-remover>Remover projeto</button></form></dialog>`;

/** A página: o cabeçalho, o menu e o painel do item escolhido. */
export const pagina = (menuHtml: string, painel: string): string =>
  `<div class="cabeca-pagina"><h1>Configuração</h1></div><div class="config">${menuHtml}<section class="painel-config superficie">${painel}</section></div>`;

/** O projeto do endereço que não está cadastrado. */
export const projetoInexistente = (nome: string): string =>
  `<h2>Projeto não encontrado</h2><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/config?novo">Cadastrar um projeto</a></p>`;
