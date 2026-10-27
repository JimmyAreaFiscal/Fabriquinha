// Configuração SDLC do projeto (comparacao-sdlc §7.1) como funções puras: o `Estado` do formulário em texto, a
// conversão de ida e volta com o contrato `Projeto` e o HTML dos grupos. O DOM e a rede ficam em sdlc-montar.ts.
import type { Effort, EtapaTicket } from "../../../dominio/primitivos.ts";
import type { Projeto } from "../../../dominio/configuracao_projeto.ts";
import { escapar } from "../render.ts";
import { EFFORTS, type Erros, idDe, marca } from "./configuracao.ts";

/** Uma linha do formulário: todo campo é o texto digitado. */
export type Linha = Record<string, string>;

export interface Estado {
  branch_base: string;
  chave_sonarqube: string;
  /** Só leitura aqui (quem edita é a tela legada). */
  raiz_git: string;
  hospedagem: string;
  /** `cursor_commit_humano`: a tela o devolve como veio. */
  cursor: string;
  etapas: Linha[];
  preparacao: Linha[];
  fitness: Linha[];
  linguagens: Linha[];
  e2e: Linha[];
  globs: Linha[];
}

export type GrupoDeLista = "preparacao" | "fitness" | "linguagens" | "e2e" | "globs";

/** `GET /api/projetos/:nome/configuracao-sdlc`. */
export interface Resposta {
  configurada: boolean;
  configuracao: Projeto;
}

const ROTULOS_DA_ETAPA: Record<EtapaTicket, string> = {
  demanda: "Demanda",
  planejar: "Planejar",
  implementar: "Implementar",
  revisar_rodada: "Revisar rodada",
  encerrar_rodada: "Encerrar rodada",
  sessao_em_aberto: "Sessão em aberto",
  revisar_demanda: "Revisar demanda",
  encerrar_demanda: "Encerrar demanda",
  resolver_conflito: "Resolver conflito",
};
const ETAPAS = Object.entries(ROTULOS_DA_ETAPA) as [EtapaTicket, string][];

export const CAMPOS_DA_ETAPA = ["etapa", "modelo_provedor", "modelo_nome", "effort"] as const;
export const CAMPOS_DO_PROJETO = ["branch_base", "chave_sonarqube", "raiz_git", "hospedagem", "cursor"] as const;

/** Os grupos de linhas: campo, rótulo e se o texto é de código (fonte mono). */
export const GRUPOS: readonly {
  chave: GrupoDeLista;
  titulo: string;
  nota: string;
  campos: readonly (readonly [string, string, boolean])[];
}[] = [
  {
    chave: "preparacao",
    titulo: "Preparação",
    nota: "comandos que rodam, na ordem, ao criar a worktree",
    campos: [
      ["ordem", "Ordem", true],
      ["comando", "Comando", true],
    ],
  },
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

/** O contrato em texto, com as nove etapas em branco onde a configuração não diz nada. */
export function doProjeto(p: Projeto): Estado {
  return {
    branch_base: p.branch_base,
    chave_sonarqube: p.chave_sonarqube,
    raiz_git: p.raiz_git,
    hospedagem: p.hospedagem,
    cursor: p.cursor_commit_humano ?? "",
    etapas: ETAPAS.map(([etapa]) => {
      const c = p.etapas.find((e) => e.etapa === etapa);
      return {
        etapa,
        modelo_provedor: c?.modelo_provedor ?? "",
        modelo_nome: c?.modelo_nome ?? "",
        effort: c?.effort ?? "",
      };
    }),
    preparacao: p.preparacao.map((c) => ({ ordem: String(c.ordem), comando: c.comando })),
    fitness: p.fitness.map((f) => ({ ...f })),
    linguagens: p.linguagens.map((l) => ({ ...l })),
    e2e: p.e2e.map((e) => ({ ...e, codigo_falha: String(e.codigo_falha) })),
    globs: p.globs.map((g) => ({ ...g })),
  };
}

/** O corpo do POST: etapa em branco não é enviada, o par provedor + nome e o effort só vão se preenchidos. */
export function paraProjeto(e: Estado, nome: string): Projeto {
  const etapas = e.etapas.flatMap((l) => {
    const [provedor, modelo, effort] = [l.modelo_provedor, l.modelo_nome, l.effort].map((v) => (v ?? "").trim());
    if (!provedor && !modelo && !effort) return [];
    return [
      {
        etapa: l.etapa as EtapaTicket,
        ...(provedor && { modelo_provedor: provedor }),
        ...(modelo && { modelo_nome: modelo }),
        ...(effort && { effort: effort as Effort }),
      },
    ];
  });
  return {
    nome,
    branch_base: e.branch_base,
    chave_sonarqube: e.chave_sonarqube,
    raiz_git: e.raiz_git,
    hospedagem: e.hospedagem as Projeto["hospedagem"],
    ...(e.cursor && { cursor_commit_humano: e.cursor }),
    etapas,
    preparacao: e.preparacao.map((l) => ({ ordem: Number(l.ordem), comando: l.comando ?? "" })),
    fitness: e.fitness as Projeto["fitness"],
    linguagens: e.linguagens as Projeto["linguagens"],
    e2e: e.e2e.map((l) => ({ ...l, codigo_falha: Number(l.codigo_falha) })) as Projeto["e2e"],
    globs: e.globs as Projeto["globs"],
  };
}

/** `etapas[0]` do 422 vira `etapas[planejar]`: o índice é o da lista enviada, que não leva as etapas em branco. */
export function erroPorEtapa(erros: Erros, enviadas: readonly string[]): Erros {
  return new Map(
    [...erros].map(([caminho, ms]) => [
      caminho.replace(/^etapas\[(\d+)\]/, (inteiro, i: string) => `etapas[${enviadas[Number(i)] ?? i}]`),
      ms,
    ]),
  );
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
  /** Nome acessível que distingue a linha (o rótulo visível se repete em todas). */
  aria?: string;
}

/** Rótulo de 18 px, controle de 34 px e o erro sob ele, em posição absoluta: nada se desloca (estilo.css). */
function celula(erros: Erros, caminho: string, rotulo: string, valor: string, o: OpcoesDaCelula): string {
  const m = marca(erros, caminho);
  const atributos = `${o.mono ? ' class="mono"' : ""} id="${idDe(caminho)}" data-campo="${o.campo}" value="${escapar(valor)}"${o.leitura ? " readonly" : ""}${o.aria ? ` aria-label="${escapar(o.aria)}"` : ""}${m.aria}`;
  return `<div class="celula${m.classe}"><label for="${idDe(caminho)}">${rotulo}</label><input${atributos}>${m.msg}</div>`;
}

function seletorDeEffort(erros: Erros, caminho: string, valor: string, aria: string): string {
  const m = marca(erros, caminho);
  const opcoes = EFFORTS.map((e) => `<option value="${e}"${e === valor ? " selected" : ""}>${e}</option>`);
  return `<div class="celula${m.classe}"><label for="${idDe(caminho)}">Effort</label><select id="${idDe(caminho)}" data-campo="effort" aria-label="${aria}"${m.aria}><option value="">padrão do pi</option>${opcoes.join("")}</select>${m.msg}</div>`;
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
    "Branch base e SonarQube são do cadastro do projeto, compartilhados com a tela legada: mudar aqui muda lá. O repositório e a hospedagem só se editam no cadastro.";
  return `<section class="grupo" data-grupo="projeto" aria-label="Projeto"><h3>Projeto</h3><div class="sdlc-linha sdlc-projeto">${celulas.join("")}</div><input type="hidden" data-campo="cursor" value="${escapar(e.cursor)}"><p class="ajuda">${nota}</p></section>`;
}

function etapas(e: Estado, erros: Erros): string {
  const linhas = e.etapas.map((l) => {
    const [etapa = "", provedor = "", modelo = "", effort = ""] = CAMPOS_DA_ETAPA.map((c) => l[c]);
    const caminho = (campo: string) => `etapas[${etapa}].${campo}`;
    const aria = (o: string) => `${o} da etapa ${etapa}`;
    return `<div class="sdlc-linha sdlc-etapa" data-linha><input type="hidden" data-campo="etapa" value="${etapa}"><strong class="sdlc-nome">${ROTULOS_DA_ETAPA[etapa as EtapaTicket]}</strong>${celula(erros, caminho("modelo_provedor"), "Provedor do modelo", provedor, { campo: "modelo_provedor", aria: aria("Provedor do modelo") })}${celula(erros, caminho("modelo_nome"), "Nome do modelo", modelo, { campo: "modelo_nome", aria: aria("Nome do modelo") })}${seletorDeEffort(erros, caminho("effort"), effort, aria("Effort"))}</div>`;
  });
  return `<section class="grupo" data-grupo="etapas" aria-label="Etapas">${cabecalhoDoGrupo("Etapas", "modelo e effort são opcionais; em branco usa o padrão do pi", erros, "etapas")}${linhas.join("")}</section>`;
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
  const corpo = [projeto(e, erros), etapas(e, erros), ...GRUPOS.map((g) => lista(g, e, erros))].join("");
  return `${cabecalho(nome)}<form class="form painel-config superficie" data-sdlc novalidate>${corpo}<div class="rodape-form">${rodape}<button type="submit" class="btn btn-primario">Salvar</button></div></form>`;
}
