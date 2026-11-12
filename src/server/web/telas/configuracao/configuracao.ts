// Configuração (F7 §4.4) como funções puras: o menu lateral, o agendador e o formulário de projeto, com os erros do
// `zod` ao lado de cada campo. O DOM e a rede ficam em configuracao-montar.ts.
import type { Hospedagem, Projeto } from "../../../../modulos/projeto/nucleo/projeto.ts";
import type { Effort, Modelo } from "../../../../modulos/compartilhado/nucleo/primitivos.ts";
import type { EtapaTicket } from "../../../../modulos/etapas/catalogo.ts";
import type { EstadoDaConfiguracao, EstadoDoAmbiente, ProjetoCadastrado } from "../../../contrato/configuracao.ts";
import { escapar, hora, nomeDoModelo } from "../../apresentacao/render.ts";
import { etapasDoSdlc } from "../../apresentacao/etapas.ts";
import type { ConfiguracaoDoAmbiente } from "../../../../modulos/sandbox/nucleo/configuracao_do_ambiente.ts";

/** O modelo e o effort de cada etapa do ticket; a etapa ausente usa o padrão do pi. */
type ConfiguracoesPorEtapa = Pick<ProjetoCadastrado, "configuracoes">;

/** `GET /api/projetos`: os projetos cadastrados. */
export type ProjetoListado = Projeto;

/**
 * O projeto no formulário, só com o que o cadastro pede; o novo ainda não tem hospedagem (o F5 a deduz do remoto ao
 * salvar).
 */
export type Rascunho = Pick<Projeto, "nome" | "raiz_git" | "branch_base"> &
  ConfiguracoesPorEtapa & { preparacao: string[]; hospedagem?: Hospedagem };

/** O projeto cadastrado como o formulário o edita: a preparação da worktree solta das Verificações. */
export const rascunhoDe = ({
  nome,
  raiz_git,
  branch_base,
  hospedagem,
  verificacoes,
  configuracoes,
}: ProjetoCadastrado): Rascunho => ({
  nome,
  raiz_git,
  branch_base,
  hospedagem,
  preparacao: verificacoes.preparacao,
  configuracoes,
});

/** O item do menu escolhido, pelo endereço: `/config`, `/config?ambiente`, `/config?projeto=<nome>` ou `/config?novo`. */
type Selecao = { tipo: "agendador" } | { tipo: "ambiente" } | { tipo: "projeto"; nome: string } | { tipo: "novo" };

export function selecao(busca: string): Selecao {
  const q = new URLSearchParams(busca);
  const nome = q.get("projeto");
  if (nome) return { tipo: "projeto", nome };
  if (q.has("ambiente")) return { tipo: "ambiente" };
  return q.has("novo") ? { tipo: "novo" } : { tipo: "agendador" };
}

export const NOVO: Rascunho = {
  nome: "",
  raiz_git: "",
  branch_base: "main",
  preparacao: [],
  configuracoes: {},
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

/** As mensagens do campo `caminho`, inclusive as de dentro dele (`configuracoes.planejar.modelo` no seletor da etapa). */
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

// O cliente não importa valores dos `nucleo/` de src (os .ts vão ao navegador só sem os tipos): os níveis saem das chaves.
const EFFORTS = Object.keys({
  off: 0,
  minimal: 0,
  low: 0,
  medium: 0,
  high: 0,
  xhigh: 0,
  max: 0,
} satisfies Record<Effort, 0>);

/** As etapas do ticket, na ordem do catálogo, com o rótulo do formulário. */
export const etapasDoFormulario = (): [EtapaTicket, string][] =>
  etapasDoSdlc().etapas.map(({ nome, exibicao }) => [nome, escapar(exibicao.acao)]);

const atual = (sim: boolean): string => (sim ? ' aria-current="page"' : "");

/** Menu à esquerda: Geral → Agendador, com a marca, e Ambiente; Projetos → um por projeto, com a hospedagem, e o novo. */
export function menu(
  config: Pick<EstadoDaConfiguracao, "agendadorAtivo">,
  projetos: readonly ProjetoListado[],
  sel: Selecao,
): string {
  const ligado = config.agendadorAtivo
    ? '<span class="pill pill-ok">ligado</span>'
    : '<span class="pill pill-neutro">desligado</span>';
  const itens = projetos.map(
    (p) =>
      `<a href="/config?projeto=${encodeURIComponent(p.nome)}"${atual(sel.tipo === "projeto" && sel.nome === p.nome)}>${escapar(p.nome)}<span class="muted hospedagem">${HOSPEDAGEM[p.hospedagem]}</span></a>`,
  );
  return `<nav class="menu-config" aria-label="Configuração"><span class="rotulo">Geral</span><a href="/config"${atual(sel.tipo === "agendador")}>Agendador ${ligado}</a><a href="/config?ambiente"${atual(sel.tipo === "ambiente")}>Ambiente</a><span class="rotulo">Projetos</span>${itens.join("")}<a class="novo" href="/config?novo"${atual(sel.tipo === "novo")}>+ Novo projeto</a></nav>`;
}

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

const TIPOS_DE_AMBIENTE: Record<ConfiguracaoDoAmbiente["tipo"], string> = {
  host_local: "Host local",
  container: "Container",
};

const LIMITES_DO_AMBIENTE = [
  ["memoria_maxima_mb", "Memória máxima por container", 512, "1", "MB"],
  ["cpus", "CPUs por container", 0.1, "any", "CPUs"],
  ["ociosidade_para_eliminar_min", "Eliminar container livre após", 5, "1", "min"],
] as const;

const FORMATO_DO_INSTANTE = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const instanteLegivel = (instante: string): string => FORMATO_DO_INSTANTE.format(Date.parse(instante));

// shortcut: o alocado mostra a criação do container, porque a tabela não guarda quando foi alocado; gravar o instante da alocação se isso confundir.
function linhaDoAmbiente({
  id,
  imagem,
  estado,
  alocado_para,
  criado_em,
  liberado_em,
}: EstadoDoAmbiente["conjunto"][number]): string {
  const desde = instanteLegivel(estado === "alocado" ? criado_em : (liberado_em ?? criado_em));
  const podeEliminar = estado === "livre" || estado === "sujo";
  return `<tr data-ambiente="${escapar(id)}"><td class="mono">${escapar(id)}</td><td class="mono">${escapar(imagem)}</td><td>${estado}</td><td>${alocado_para ? escapar(alocado_para) : "—"}</td><td>${desde}</td><td><button type="button" class="btn btn-perigo" data-eliminar="${escapar(id)}" aria-label="Eliminar o container ${escapar(id)}"${podeEliminar ? "" : " disabled"}>Eliminar</button></td></tr>`;
}

/** Ambiente: o tipo e os limites de cada container, e o conjunto de containers da Fabriquinha com o Eliminar de cada um. */
export function ambiente({ configuracao, conjunto }: EstadoDoAmbiente, erros: Erros): string {
  const opcoes = Object.entries(TIPOS_DE_AMBIENTE).map(
    ([tipo, rotulo]) => `<option value="${tipo}"${tipo === configuracao.tipo ? " selected" : ""}>${rotulo}</option>`,
  );
  const limites = LIMITES_DO_AMBIENTE.map(([campo, rotulo, minimo, passo, unidade]) => {
    const m = marca(erros, campo);
    return `<div class="num-campo${m.classe}"><label for="${idDe(campo)}">${rotulo}</label><span class="com-unidade"><input type="number" id="${idDe(campo)}" name="${campo}" value="${String(configuracao[campo])}" min="${String(minimo)}" step="${passo}"${m.aria}> ${unidade}</span>${m.msg}</div>`;
  });
  const tipo = marca(erros, "tipo");
  const linhas = conjunto.map(linhaDoAmbiente);
  const tabela =
    linhas.length > 0
      ? `<div class="rola"><table class="tabela"><thead><tr><th>Id</th><th>Imagem</th><th>Estado</th><th>Alocado para</th><th>Desde</th><th></th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
      : '<p class="muted">Nenhum container no conjunto.</p>';
  return `<h2>Ambiente</h2><form class="form" data-ambiente novalidate><div class="grupo"><h3>Onde o trabalho roda <span class="nota">· com Host local, o docker nunca é chamado</span></h3><div class="campo${tipo.classe}"><label for="${idDe("tipo")}">Tipo de Ambiente</label><select id="${idDe("tipo")}" name="tipo"${tipo.aria}>${opcoes.join("")}</select>${tipo.msg}</div><div class="limites-ambiente">${limites.join("")}</div></div><div class="rodape-form"><button type="submit" class="btn btn-primario">Salvar</button></div></form><div class="grupo conjunto-ambiente"><h3>Conjunto de containers <span class="nota">· só os que a Fabriquinha criou; o Eliminar vale para o livre ou sujo</span></h3>${tabela}</div>`;
}

/** A confirmação de eliminar um container do conjunto. */
export const confirmacaoDeEliminar = (id: string): string =>
  `<dialog class="dialogo" data-dialogo-eliminar aria-labelledby="titulo-eliminar"><h2 id="titulo-eliminar">Eliminar o container ${escapar(id)}</h2><p>O container <strong>${escapar(id)}</strong> será removido do docker e sai do conjunto. O próximo Espaço que precisar de um Ambiente cria outro.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar-eliminar>Eliminar container</button></form></dialog>`;

interface OpcoesDoProjeto {
  novo: boolean;
  /** Os modelos que o pi lista (`GET /api/modelos`), para o seletor de cada etapa. */
  modelosDoPi: readonly Modelo[];
  erros: Erros;
  /** A mensagem do servidor que não é de um campo (502 do F5, 409), no rodapé. */
  falha?: string;
}

const par = (m: Modelo): string => `${m.provedor}/${m.nome}`;

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

/** Uma linha por etapa: o rótulo, o seletor de modelo e o de effort; vazio usa o padrão do pi. */
function modelosEEffortsPorEtapa(erros: Erros, p: ConfiguracoesPorEtapa, modelosDoPi: readonly Modelo[]): string {
  const linhas = etapasDoFormulario().map(([etapa, rotulo]) => {
    const effortEscolhido = p.configuracoes[etapa]?.effort;
    const caminhoDoModelo = `configuracoes.${etapa}.modelo`;
    const caminhoDoEffort = `configuracoes.${etapa}.effort`;
    const m = marca(erros, caminhoDoEffort);
    const options = EFFORTS.map((e) => `<option value="${e}"${e === effortEscolhido ? " selected" : ""}>${e}</option>`);
    const effort = `<div class="celula celula-effort${m.classe}"><select id="${idDe(caminhoDoEffort)}" name="${caminhoDoEffort}" aria-label="Effort de ${rotulo}"${effortEscolhido ? "" : ' class="padrao"'}${m.aria}><option value="">padrão do pi</option>${options.join("")}</select>${m.msg}</div>`;
    return `<label for="${idDe(caminhoDoModelo)}">${rotulo}</label>${seletorDeModelo(erros, caminhoDoModelo, p.configuracoes[etapa]?.modelo, modelosDoPi)}${effort}`;
  });
  return `<div class="grupo"><h3>Modelo e effort por etapa <span class="nota">· o effort é o raciocínio da IA (pi --thinking); vazio usa o padrão do pi; o ticket pode sobrescrever</span></h3><div class="modelos-grade"><span class="modelos-cab" aria-hidden="true">Etapa</span><span class="modelos-cab" aria-hidden="true">Modelo</span><span class="modelos-cab" aria-hidden="true">Effort</span>${linhas.join("")}</div></div>`;
}

const plural = (n: number, um: string, varios: string): string => `${String(n)} ${n === 1 ? um : varios}`;

/** Projeto (F7 §4.4) nos três grupos, com o rodapé que diz o que é conferido ao salvar e quantos campos têm erro. */
export function formularioDeProjeto(p: Rascunho, { novo, modelosDoPi, erros, falha }: OpcoesDoProjeto): string {
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
    `<span class="ajuda">Ao salvar, a Fabriquinha confere o repositório, a branch, o remoto e os modelos.</span>${contagem}`;
  // Fora do h2: o título acessível do formulário continua o nome do projeto.
  const sdlc = novo
    ? ""
    : `<p class="link-sdlc"><a class="link" href="/projects/${encodeURIComponent(p.nome)}/sdlc">Configuração SDLC do projeto</a></p>`;
  return `<h2>${titulo}</h2>${sdlc}<form class="form" data-projeto novalidate>
<div class="grupo"><h3>Repositório</h3><div class="grade">${nome}${texto(erros, "branch_base", "Branch base", p.branch_base, { mono: true })}${texto(erros, "raiz_git", "Caminho do repositório", p.raiz_git, { classe: " largo", mono: true, extra: ' placeholder="/home/…/meu-projeto"', ajuda: "caminho absoluto; o repositório precisa ter o remoto <code>origin</code>" })}<div class="campo"><label for="campo-hospedagem">Hospedagem</label><input id="campo-hospedagem" value="${hospedagem}" readonly></div></div></div>
<div class="grupo"><h3>Preparação</h3><div class="grade">${lista(erros, "preparacao", "Preparação da worktree", "opcional; roda ao criar a worktree", p.preparacao)}</div></div>
${modelosEEffortsPorEtapa(erros, p, modelosDoPi)}
<div class="rodape-form">${rodape}<button type="button" class="btn" data-cancelar>Cancelar</button><button type="submit" class="btn btn-primario">${novo ? "Cadastrar projeto" : "Salvar projeto"}</button></div></form>`;
}

/** A confirmação de remover o projeto, que não tem volta: o nome e o que sai junto. */
export const confirmacaoDeRemover = (nome: string): string =>
  `<dialog class="dialogo" data-dialogo-remover aria-labelledby="titulo-remover"><h2 id="titulo-remover">Remover o projeto ${escapar(nome)}</h2><p>O projeto <strong>${escapar(nome)}</strong> será apagado com as demandas, em qualquer estado, e os tickets, as sessões, as evidências, as decisões e o custo delas. Saem do disco as worktrees e as pastas de execução; o repositório original não é tocado. Não dá para desfazer.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar-remover>Remover projeto</button></form></dialog>`;

/** A página: o cabeçalho, o menu e o painel do item escolhido. */
export const pagina = (menuHtml: string, painel: string): string =>
  `<div class="cabeca-pagina"><h1>Configuração</h1></div><div class="config">${menuHtml}<section class="painel-config superficie">${painel}</section></div>`;

/** O projeto do endereço que não está cadastrado. */
export const projetoInexistente = (nome: string): string =>
  `<h2>Projeto não encontrado</h2><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/config?novo">Cadastrar um projeto</a></p>`;
