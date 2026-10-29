// Configuração SDLC do projeto (comparacao-sdlc §7.1) como funções puras: o `Estado` do formulário em texto, a
// conversão de ida e volta com o contrato `Projeto` e o HTML dos grupos. O DOM e a rede ficam em sdlc-montar.ts.
import type { Projeto } from "../../../dominio/configuracao_projeto.ts";
import { escapar } from "../render.ts";
import { type Erros, idDe, marca } from "./configuracao.ts";

/** Uma linha do formulário: todo campo é o texto digitado. */
export type Linha = Record<string, string>;

export interface Estado {
  branch_base: string;
  chave_sonarqube: string;
  /** Só leitura aqui (quem edita é o cadastro do projeto, na Configuração). */
  raiz_git: string;
  hospedagem: string;
  /** `cursor_commit_humano`: a tela o devolve como veio. */
  cursor: string;
  fitness: Linha[];
  linguagens: Linha[];
  e2e: Linha[];
  globs: Linha[];
}

export type GrupoDeLista = "fitness" | "linguagens" | "e2e" | "globs";

/** `GET /api/projetos/:nome/configuracao-sdlc`. */
export interface Resposta {
  configurada: boolean;
  configuracao: Projeto;
}

export const CAMPOS_DO_PROJETO = ["branch_base", "chave_sonarqube", "raiz_git", "hospedagem", "cursor"] as const;

/** Os grupos de linhas: campo, rótulo e se o texto é de código (fonte mono). */
export const GRUPOS: readonly {
  chave: GrupoDeLista;
  titulo: string;
  nota: string;
  campos: readonly (readonly [string, string, boolean])[];
}[] = [
  {
    chave: "fitness",
    titulo: "Fitness",
    nota: "pelo menos uma; rodam no desenvolvimento e na revisão",
    campos: [
      ["nome", "Nome", true],
      ["comando", "Comando", true],
      ["descricao", "Descrição (até 300)", false],
    ],
  },
  {
    chave: "linguagens",
    titulo: "Linguagens",
    nota: "pelo menos uma; o caminho é relativo à raiz git",
    campos: [
      ["caminho", "Caminho", true],
      ["linguagem", "Linguagem", false],
      ["comando_teste", "Comando de teste", true],
    ],
  },
  {
    chave: "e2e",
    titulo: "E2E",
    nota: "opcional por linguagem; exige ao menos um glob",
    campos: [
      ["caminho_linguagem", "Caminho da linguagem", true],
      ["comando_build", "Build", true],
      ["comando_execucao", "Execução", true],
      ["codigo_falha", "Código de falha", true],
    ],
  },
  {
    chave: "globs",
    titulo: "Globs",
    nota: "arquivos que disparam o E2E da linguagem",
    campos: [
      ["caminho_linguagem", "Caminho da linguagem", true],
      ["glob", "Glob", true],
    ],
  },
];

/** A linha com todos os campos do grupo vazios. */
export const linhaEmBranco = (chave: GrupoDeLista): Linha =>
  Object.fromEntries(GRUPOS.filter((g) => g.chave === chave).flatMap((g) => g.campos.map(([campo]) => [campo, ""])));

/** O contrato em texto, sem as etapas e a preparação: o cadastro do projeto, na Configuração, as edita. */
export function doProjeto(p: Projeto): Estado {
  return {
    branch_base: p.branch_base,
    chave_sonarqube: p.chave_sonarqube,
    raiz_git: p.raiz_git,
    hospedagem: p.hospedagem,
    cursor: p.cursor_commit_humano ?? "",
    fitness: p.fitness.map((f) => ({ ...f })),
    linguagens: p.linguagens.map((l) => ({ ...l })),
    e2e: p.e2e.map((e) => ({ ...e, codigo_falha: String(e.codigo_falha) })),
    globs: p.globs.map((g) => ({ ...g })),
  };
}

/** O corpo do POST, sem as etapas e a preparação: a gravação as mantém como o cadastro do projeto as deixou. */
export function paraProjeto(e: Estado, nome: string): Omit<Projeto, "etapas" | "preparacao"> {
  return {
    nome,
    branch_base: e.branch_base,
    chave_sonarqube: e.chave_sonarqube,
    raiz_git: e.raiz_git,
    hospedagem: e.hospedagem as Projeto["hospedagem"],
    ...(e.cursor && { cursor_commit_humano: e.cursor }),
    fitness: e.fitness as Projeto["fitness"],
    linguagens: e.linguagens as Projeto["linguagens"],
    e2e: e.e2e.map((l) => ({ ...l, codigo_falha: Number(l.codigo_falha) })) as Projeto["e2e"],
    globs: e.globs as Projeto["globs"],
  };
}

export const adicionar = (e: Estado, chave: GrupoDeLista): Estado => ({
  ...e,
  [chave]: [...e[chave], linhaEmBranco(chave)],
});

export const remover = (e: Estado, chave: GrupoDeLista, indice: number): Estado => ({
  ...e,
  [chave]: e[chave].filter((_, i) => i !== indice),
});

interface OpcoesDaCelula {
  campo: string;
  mono?: boolean;
  leitura?: boolean;
}

/** Rótulo de 18 px, controle de 34 px e o erro sob ele, em posição absoluta: nada se desloca (estilo.css). */
function celula(erros: Erros, caminho: string, rotulo: string, valor: string, o: OpcoesDaCelula): string {
  const m = marca(erros, caminho);
  const atributos = `${o.mono ? ' class="mono"' : ""} id="${idDe(caminho)}" data-campo="${o.campo}" value="${escapar(valor)}"${o.leitura ? " readonly" : ""}${m.aria}`;
  return `<div class="celula${m.classe}"><label for="${idDe(caminho)}">${rotulo}</label><input${atributos}>${m.msg}</div>`;
}

const cabecalhoDoGrupo = (titulo: string, nota: string, erros: Erros, caminho: string): string =>
  `<h3>${titulo} <span class="nota">· ${nota}</span></h3>${marca(erros, caminho).msg}`;

function projeto(e: Estado, erros: Erros): string {
  const celulas = [
    celula(erros, "branch_base", "Branch base", e.branch_base, { campo: "branch_base", mono: true }),
    celula(erros, "chave_sonarqube", "Projeto no SonarQube", e.chave_sonarqube, {
      campo: "chave_sonarqube",
      mono: true,
    }),
    celula(erros, "raiz_git", "Caminho do repositório", e.raiz_git, { campo: "raiz_git", mono: true, leitura: true }),
    celula(erros, "hospedagem", "Hospedagem", e.hospedagem, { campo: "hospedagem", mono: true, leitura: true }),
  ];
  const nota =
    "A branch base é a do cadastro do projeto, na Configuração: mudar aqui muda lá. O repositório, a hospedagem, a preparação da worktree e o modelo e o effort de cada etapa só se editam no cadastro.";
  return `<section class="grupo" data-grupo="projeto" aria-label="Projeto"><h3>Projeto</h3><div class="sdlc-linha sdlc-projeto">${celulas.join("")}</div><input type="hidden" data-campo="cursor" value="${escapar(e.cursor)}"><p class="ajuda">${nota}</p></section>`;
}

function lista(g: (typeof GRUPOS)[number], e: Estado, erros: Erros): string {
  const linhas = e[g.chave].map((l, i) => {
    const celulas = g.campos.map(([campo, rotulo, mono]) =>
      celula(erros, `${g.chave}[${String(i)}].${campo}`, rotulo, l[campo] ?? "", { campo, mono }),
    );
    return `<div class="sdlc-linha sdlc-${g.chave}" data-linha>${celulas.join("")}<button type="button" class="btn" data-remover>Remover</button></div>`;
  });
  return `<section class="grupo" data-grupo="${g.chave}" aria-label="${g.titulo}">${cabecalhoDoGrupo(g.titulo, g.nota, erros, g.chave)}${linhas.join("")}<button type="button" class="link" data-adicionar="${g.chave}">Adicionar</button></section>`;
}

const cabecalho = (nome: string): string =>
  `<div class="cabeca-pagina"><h1>Configuração SDLC <span class="muted">${escapar(nome)}</span></h1><a class="link" href="/config?projeto=${encodeURIComponent(nome)}">Cadastro do projeto</a></div>`;

/** O projeto sem configuração SDLC gravada: a mensagem e o botão que abre os grupos. */
export const vazio = (nome: string): string =>
  `${cabecalho(nome)}<div class="vazio-sdlc superficie"><p>O projeto ${escapar(nome)} ainda não tem configuração SDLC.</p><button type="button" class="btn btn-primario" data-criar>Criar configuração</button></div>`;

/** A configuração de partida do vazio: uma fitness function e uma linguagem em branco, que o domínio exige. */
export const estadoInicial = (rascunho: Estado): Estado => adicionar(adicionar(rascunho, "fitness"), "linguagens");

export interface OpcoesDoFormulario {
  erros: Erros;
  /** O 409 ou o 502 do servidor, que não é de um campo. */
  falha?: string;
  salvo?: boolean;
}

/** A página com todos os grupos da seção 7.1 e o Salvar. */
export function formulario(nome: string, e: Estado, { erros, falha, salvo }: OpcoesDoFormulario): string {
  const contagem =
    erros.size > 0
      ? `<span class="msg-erro">${String(erros.size)} ${erros.size === 1 ? "campo" : "campos"} com erro</span>`
      : "";
  const rodape =
    (falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : "") +
    (salvo ? '<span class="ajuda" role="status">Configuração salva.</span>' : "") +
    contagem;
  const corpo = [projeto(e, erros), ...GRUPOS.map((g) => lista(g, e, erros))].join("");
  return `${cabecalho(nome)}<form class="form painel-config superficie" data-sdlc novalidate>${corpo}<div class="rodape-form">${rodape}<button type="submit" class="btn btn-primario">Salvar</button></div></form>`;
}
