// Início (F7 §4.4) como funções puras: o que aguarda o Auditor, o que roda, o board das issues em andamento e o
// formulário do Registrar necessidade. O DOM e a rede ficam em inicio-montar.ts.
import type { Fase, Id, Modelo } from "../../../dominio/primitivos.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { MetricasMes } from "../../../metricas/periodo.ts";
import type { IssueDoBoard } from "../../rotas/inicio.ts";
import {
  caminhoDaIssue,
  caminhoDaSessao,
  escapar,
  ETAPAS_DO_PROCESSO,
  etapa,
  FASES,
  GATES,
  ha,
  MODO_DA_SESSAO,
  MOTIVOS,
  nomeDoModelo,
  plural,
  rotuloDoModelo,
  rotuloIssue,
  rotuloTicket,
  STATUS_DO_TICKET,
} from "../render.ts";
import { fraseDoMes } from "./metricas.ts";
import type { ProjetoListado } from "./configuracao.ts";

/** O que o Início lê: `GET /api/sessoes?escopo=ativas`, `GET /api/board` e o mês corrente de `GET /api/metricas`. */
export interface DadosDoInicio {
  sessoes: readonly InfoSessao[];
  board: readonly IssueDoBoard[];
  mes: MetricasMes;
}

const tituloDa = (issue: IssueDoBoard | undefined): string => issue?.titulo ?? "sem título";
const modelo = (m: Modelo | undefined): string => (m ? nomeDoModelo(m) : "padrão do pi");

/** A frase do que falta para a sessão sair da espera. */
function falta(s: InfoSessao, issue: IssueDoBoard | undefined): string {
  const tickets = issue?.tickets ?? [];
  switch (s.motivo) {
    case "falha":
      return tickets.find((t) => t.id === s.ticket)?.erro ?? "o agente falhou";
    case "gate_registro":
      return "Registro pronto; falta aprovar";
    case "gate_desenho": {
      const n = tickets.filter((t) => t.etapa === "desenvolvimento" && t.status !== "concluido").length;
      return plural(n, "ticket de desenvolvimento proposto", "tickets de desenvolvimento propostos");
    }
    case "gate_pr": {
      const numero = issue?.pr ? "#" + issue.pr.id + " " : "";
      return `PR ${numero}aberto; aguarda a sua revisão no PR`;
    }
    case "dialogo": {
      const titulo = s.dialogos[0]?.title;
      return typeof titulo === "string" ? `O agente pergunta: ${titulo}` : "O agente abriu uma pergunta";
    }
    default:
      return "O agente respondeu e espera você";
  }
}

/** Card de uma sessão que aguarda o Auditor; o card inteiro abre o chat. */
function decisao(s: InfoSessao, issue: IssueDoBoard | undefined, agora: Date): string {
  const m = MOTIVOS[s.motivo ?? "conversa"];
  const falhou = s.motivo === "falha";
  return `<a class="decisao superficie${falhou ? " falha" : ""}" href="${caminhoDaSessao(s.sessao)}">
    <span class="decisao-motivo">${m.titulo}</span><span class="btn${falhou ? "" : " btn-primario"} btn-pequeno">${m.acao} →</span>
    <span class="decisao-titulo"><span class="id">${rotuloIssue(s.issue)}</span> ${escapar(tituloDa(issue))}</span>
    <p class="decisao-texto">${escapar(falta(s, issue))}</p>
    <div class="decisao-pe"><span class="tag">${escapar(s.projeto)}</span><span><span class="mono">${rotuloTicket(s.ticket)}</span> · ${etapa(s.etapa)} · ${MODO_DA_SESSAO[s.modo]} · ${ha(s.desde, agora)}</span></div>
  </a>`;
}

/**
 * Linha de uma sessão rodando: o que o agente faz, como o processo vivo diz; sem ele, o título do ticket e, na
 * consulta, responder ao Auditor.
 */
function rodando(s: InfoSessao, issue: IssueDoBoard | undefined, agora: Date): string {
  const doTicket =
    s.modo === "consulta"
      ? "Respondendo à sua pergunta"
      : (issue?.tickets.find((t) => t.id === s.ticket)?.titulo ?? "Trabalhando");
  const fazendo = s.atividade ?? doTicket;
  return `<a class="rodando-linha" href="${caminhoDaSessao(s.sessao)}">
    <span class="pill pill-rodando">${MODO_DA_SESSAO[s.modo]}</span>
    <span class="id">${rotuloIssue(s.issue)}</span>
    <span class="titulo">${escapar(tituloDa(issue))} <span class="muted">— ${escapar(fazendo)}</span></span>
    <span class="muted esconde"><span class="mono">${rotuloTicket(s.ticket)}</span> · ${etapa(s.etapa)}</span>
    ${rotuloDoModelo(modelo(s.modelo))}
    <span class="tempo muted">${ha(s.desde, agora)}</span>
  </a>`;
}

/** As marcas do cartão (F7 §4.4), sem repetir: aguarda você, em execução e bloqueada por I-x. */
function marcas(issue: IssueDoBoard, sessoes: readonly InfoSessao[], emAndamento: ReadonlySet<Id>, agora: Date) {
  const lista = new Map<string, [classe: string, pill: string]>();
  for (const s of sessoes.filter((x) => x.issue === issue.id)) {
    // A marca pode quebrar no cartão estreito, mas só antes da duração: "1 min" não se separa.
    if (s.estado === "rodando")
      lista.set(`em execução · ${ha(s.desde, agora).replace("há ", "").replaceAll(" ", "\u00a0")}`, [
        "rodando",
        "pill-rodando",
      ]);
    else {
      const motivo = s.motivo ?? "conversa";
      lista.set(`aguarda você · ${MOTIVOS[motivo].marca}`, [
        "aguarda",
        motivo === "falha" ? "pill-falha" : "pill-aguarda",
      ]);
    }
  }
  const bloqueio = issue.deps.filter((d) => emAndamento.has(d));
  if (bloqueio.length > 0)
    lista.set(`bloqueada por ${bloqueio.map(rotuloIssue).join(", ")}`, ["bloqueada", "pill-neutro"]);
  return [...lista];
}

function cartao(issue: IssueDoBoard, sessoes: readonly InfoSessao[], emAndamento: ReadonlySet<Id>, agora: Date) {
  const abertos = issue.tickets.filter((t) => t.status !== "concluido");
  const [ticket] = abertos;
  const lista = marcas(issue, sessoes, emAndamento, agora);
  const classes = ["cartao", ...new Set(lista.map(([, [c]]) => c))].join(" ");
  const mais = abertos.length > 1 ? ` (+${String(abertos.length - 1)})` : "";
  const pills = lista.map(([texto, [, pill]]) => `<span class="pill ${pill}">${escapar(texto)}</span>`).join("");
  return `<a class="${classes}" href="${caminhoDaIssue(issue.projeto, issue.id)}">
    <div class="cartao-topo"><span class="id">${rotuloIssue(issue.id)}</span><span class="tag">${escapar(issue.projeto)}</span></div>
    <div class="cartao-titulo${issue.titulo === null ? " sem" : ""}">${escapar(tituloDa(issue))}</div>
    ${ticket ? `<div class="cartao-ticket"><span class="mono">${rotuloTicket(ticket.id)}</span> ${etapa(ticket.etapa)} · ${STATUS_DO_TICKET[ticket.status]}${mais}</div>` : ""}
    ${lista.length > 0 ? `<div class="cartao-marcas">${pills}</div>` : ""}
  </a>`;
}

/** Board: uma coluna por fase, agrupadas sob as 5 etapas; as de gate hachuradas e marcadas "gate". */
function board({ sessoes, board: issues }: DadosDoInicio, agora: Date): string {
  const emAndamento = new Set(issues.map((i) => i.id));
  const coluna = ([fase, nome]: readonly [Fase, string]) => {
    const lista = issues.filter((i) => i.fase === fase);
    const gate = GATES.has(fase);
    return `<div class="coluna${gate ? " coluna-gate" : ""}">
      <div class="coluna-cabeca">${nome}<span class="n">${String(lista.length)}</span>${gate ? '<span class="tag tag-gate">gate</span>' : ""}</div>
      <div class="coluna-corpo">${lista.map((i) => cartao(i, sessoes, emAndamento, agora)).join("") || '<span class="coluna-vazia">vazia</span>'}</div>
    </div>`;
  };
  return (
    ETAPAS_DO_PROCESSO.map(
      ([nome, fases]) => `<div class="etapa" style="grid-column: span ${String(fases)}">${nome}</div>`,
    ).join("") + FASES.map(coluna).join("")
  );
}

/** A página `/home`: o cabeçalho com Registrar necessidade, a frase do mês, Aguarda você, Rodando e o board. */
export function inicio(dados: DadosDoInicio, agora: Date): string {
  const issue = (id: Id) => dados.board.find((i) => i.id === id);
  const aguardam = dados.sessoes.filter((s) => s.estado === "aguardando_humano");
  const rodam = dados.sessoes.filter((s) => s.estado === "rodando");
  const n = dados.board.length;
  return `<div class="cabeca-pagina">
    <h1>Início</h1>
    <div class="acoes"><button type="button" class="btn btn-primario" data-registrar>+ Registrar necessidade</button></div>
  </div>
  ${fraseDoMes(dados.mes)}
  <section class="bloco bloco-aguarda" aria-labelledby="titulo-aguarda">
    <div class="secao-titulo"><h2 id="titulo-aguarda">Aguarda você</h2>${aguardam.length > 0 ? `<span class="contador">${String(aguardam.length)}</span><span class="muted">da mais antiga para a mais nova</span>` : ""}</div>
    ${aguardam.length > 0 ? `<div class="decisoes">${aguardam.map((s) => decisao(s, issue(s.issue), agora)).join("")}</div>` : '<p class="muted vazio">Nada aguarda você agora.</p>'}
  </section>
  <section class="bloco bloco-rodando" aria-labelledby="titulo-rodando">
    <div class="secao-titulo"><h2 id="titulo-rodando">Rodando</h2><span class="muted">${String(rodam.length)}</span></div>
    ${rodam.length > 0 ? `<div class="rodando-linhas superficie">${rodam.map((s) => rodando(s, issue(s.issue), agora)).join("")}</div>` : '<p class="muted vazio">Nenhuma sessão rodando.</p>'}
  </section>
  <section class="bloco" aria-labelledby="titulo-board">
    <div class="secao-titulo"><h2 id="titulo-board">Board</h2><span class="muted">${plural(n, "issue", "issues")} em andamento</span></div>
    <div class="board-etapas">${board(dados, agora)}</div>
  </section>`;
}

/**
 * O formulário do Registrar necessidade (F4 §6.6), na caixa: o projeto (`escolhido`, ou o primeiro) e as
 * dependências entre as issues em andamento, as únicas que ainda bloqueiam. `falha` é a recusa do servidor.
 */
export function formularioDeRegistro(
  projetos: readonly ProjetoListado[],
  issues: readonly IssueDoBoard[],
  escolhido?: string,
  falha?: string,
): string {
  if (projetos.length === 0) {
    return '<p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo" data-fechar>Cadastrar um projeto na Configuração</a></p>';
  }
  const opcoes = projetos
    .map(
      (p) => `<option value="${escapar(p.nome)}"${p.nome === escolhido ? " selected" : ""}>${escapar(p.nome)}</option>`,
    )
    .join("");
  const deps =
    issues
      .map(
        (i) =>
          `<label class="dep-opcao"><input type="checkbox" name="deps" value="${String(i.id)}"><span class="id">${rotuloIssue(i.id)}</span><span class="dep-titulo${i.titulo === null ? " sem" : ""}">${escapar(tituloDa(i))}</span><span class="tag">${escapar(i.projeto)}</span></label>`,
      )
      .join("") || '<span class="ajuda">Nenhuma issue em andamento.</span>';
  return `<form class="form registro" data-registro>
    <p class="muted">O agente conversa com você no chat do registro até a issue ficar pronta para o gate.</p>
    <label class="campo">Projeto<select name="projeto">${opcoes}</select></label>
    <fieldset class="campo">
      <legend>Dependências <span class="ajuda">opcional · a issue espera estas concluírem</span></legend>
      <div class="deps-lista">${deps}</div>
    </fieldset>
    <div class="rodape-form">
      ${falha ? `<span class="msg-erro falha" role="alert">${escapar(falha)}</span>` : ""}
      <button type="button" class="btn" data-fechar>Cancelar</button>
      <button type="submit" class="btn btn-primario">Registrar e abrir o chat</button>
    </div>
  </form>`;
}
