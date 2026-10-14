// Página da issue (F7 §4.4, §4.5) como funções puras que devolvem HTML: cabeçalho, coluna da esquerda (detalhes,
// descrição e tickets), "Ação do Auditor", artefatos e o conteúdo da caixa. O texto que vem do servidor passa sempre
// por `escapar`; a descrição chega já renderizada pelo `markdown-it` sem HTML.
import type {
  ArquivoEvidencia,
  Evidencia,
  Issue,
  ModoExecucao,
  Ticket,
  TipoEvidencia,
} from "../../../dominio/agregado.ts";
import type { Fase, Modelo } from "../../../dominio/primitivos.ts";
import type { Hospedagem } from "../../../dominio/projeto.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { Consumo, MetricasIssue } from "../../../metricas/issue.ts";
import type { LeituraDoPR } from "../../../repositorio/pr.ts";
import type { PainelRegistro, PaginaDaIssue } from "../../rotas/issue.ts";
import type { ConteudoDaCaixa } from "../dom.ts";
import { markdown, markdownEmLinha } from "../markdown.ts";
import {
  caminhoDaIssue,
  caminhoDaSessao,
  compacto,
  custo,
  data,
  duracao,
  escapar,
  estadoDoTrilho,
  etapa,
  ha,
  MODO_DA_SESSAO,
  MOTIVOS,
  NOME_DA_ETAPA,
  PILULA_DO_STATUS,
  nomeDoModelo,
  plural,
  rotuloIssue,
  rotuloTicket,
  STATUS_DO_TICKET,
  trilho,
} from "../render.ts";

const FASE: Record<Fase, string> = {
  registro: "registro",
  desenho: "desenho",
  aprovacao_desenho: "aprovação do desenho",
  desenvolvimento: "desenvolvimento",
  revisao: "revisão",
  encerramento: "encerramento",
  aprovacao_pr: "aprovação do PR",
  ajuste_pr: "ajuste do PR",
  concluida: "concluída",
};

const MODO: Record<ModoExecucao, string> = { autonomo: "autônomo", interativo: "interativo", consulta: "consulta" };

/** O nome de cada tipo de evidência no card e na caixa. */
const NOME: Record<TipoEvidencia, string> = {
  comportamento: "Comportamento",
  criterios_aceite: "Critérios de aceite",
  desenho_solucao: "Desenho da solução",
  prototipo: "Protótipo",
  relatorio_complexidade: "Complexidade",
  relatorio_impactos_arquitetura: "Impactos na arquitetura",
  execucao_testes: "Testes",
  matriz_fitness: "Fitness",
  relatorio_sonar: "SonarQube",
  arquivos_alterados: "Arquivos alterados × desenho",
  explicacao_fitness: "Explicação das fitness",
  comprovacao_criterios: "Comprovação dos critérios",
  mensagem_pr: "Mensagem do PR",
  video_explicativo: "Vídeo explicativo",
  relatorio_produtividade: "Relatório de produtividade",
  pr_aberto: "PR aberto",
};

// ——— coluna da esquerda ———

/** O PR da issue: o da última evidência `pr_aberto` (F5 §5.2). */
const prAberto = (p: PaginaDaIssue) =>
  p.evidencias.findLast((e) => e.tipo === "pr_aberto")?.dados as { id: string; url: string } | undefined;

function pr(p: PaginaDaIssue): string {
  const aberto = prAberto(p);
  return aberto
    ? `<dt>PR</dt><dd><a class="pr" href="${escapar(aberto.url)}" target="_blank" rel="noopener">#${escapar(aberto.id)} ↗</a></dd>`
    : "";
}

function dependencias(p: PaginaDaIssue): string {
  const aberta = p.issue.fase !== "concluida" && p.issue.canceladaEm === undefined;
  const deps = p.dependencias.map(
    (d) =>
      `<span class="dep"><a href="${caminhoDaIssue(d.projeto, d.id)}">${rotuloIssue(d.id)}</a><span class="fase">${FASE[d.fase]}</span>${
        aberta
          ? `<button type="button" class="x" data-remover-dep="${String(d.id)}" title="Remover ${rotuloIssue(d.id)}" aria-label="Remover ${rotuloIssue(d.id)}">×</button>`
          : ""
      }</span>`,
  );
  if (aberta) {
    deps.push(
      '<button type="button" class="link" data-acao="mostrar-dep">+ adicionar</button>',
      '<form class="nova-dep" data-form-dep hidden><input name="dep" placeholder="I-12" aria-label="Nova dependência" required pattern="(I-)?[0-9]+" autocomplete="off" /><button class="btn btn-pequeno">Adicionar</button></form>',
    );
  }
  return deps.join("") || '<span class="muted">—</span>';
}

/** O que o C22 faz além de cancelar a issue, para o Auditor ler antes de confirmar. */
function efeitosDoCancelamento(p: PaginaDaIssue): string {
  const fechados = p.tickets.filter((t) => t.status === "aberto" || t.status === "falhou");
  const rodando = p.tickets.find((t) => t.status === "em_execucao");
  const itens = [
    fechados.length > 0 &&
      `<li>${fechados.length === 1 ? "Ticket que será fechado" : "Tickets que serão fechados"}: ${fechados.map((t) => rotuloTicket(t.id)).join(", ")}</li>`,
    rodando && `<li>A execução em andamento de ${rotuloTicket(rodando.id)} será parada e o ticket, cancelado</li>`,
    p.dependentes.length > 0 &&
      `<li>${p.dependentes.length === 1 ? "Dependente que será cancelada" : "Dependentes que serão canceladas"}:<ul>${p.dependentes
        .map(
          (d) =>
            `<li><a href="${caminhoDaIssue(d.projeto, d.id)}">${rotuloIssue(d.id)}</a> <span class="muted">${escapar(d.projeto)} · ${FASE[d.fase]}</span></li>`,
        )
        .join("")}</ul></li>`,
  ].filter(Boolean);
  return itens.length > 0 ? `<ul class="efeitos">${itens.join("")}</ul>` : "";
}

/** O pé do card Detalhes: o botão com a confirmação (C22), ou o motivo de não haver o que cancelar. */
function cancelar(p: PaginaDaIssue): string {
  const { issue } = p;
  if (issue.canceladaEm !== undefined) return "";
  if (issue.fase === "concluida") {
    return `<div class="cancelar"><button type="button" class="btn btn-perigo" disabled>Cancelar issue</button><p class="muted">A ${rotuloIssue(issue.id)} está concluída e não pode ser cancelada.</p></div>`;
  }
  return `<div class="cancelar"><button type="button" class="btn btn-perigo" data-acao="cancelar-issue">Cancelar issue</button>
    <dialog class="dialogo" data-dialogo-cancelar aria-labelledby="titulo-cancelar"><h2 id="titulo-cancelar">Cancelar ${rotuloIssue(issue.id)}</h2><p>A issue sai do andamento e não volta mais. Nada é apagado: tickets, execuções, decisões e evidências continuam na página, e os custos continuam nas métricas.</p>${efeitosDoCancelamento(p)}<form method="dialog" class="dialogo-botoes"><button class="btn">Voltar</button><button type="button" class="btn btn-perigo-cheio" data-acao="confirmar-cancelar" data-confirmar-cancelar>Cancelar issue</button></form></dialog></div>`;
}

function detalhes(p: PaginaDaIssue): string {
  const { issue } = p;
  const tipo = issue.tipo ? `<span class="tag">${issue.tipo}</span>` : '<span class="muted">—</span>';
  const cancelada = issue.canceladaEm === undefined ? "" : `<dt>Cancelada</dt><dd>${data(issue.canceladaEm)}</dd>`;
  return `<section class="cartao-lateral superficie"><h3>Detalhes</h3><dl class="fatos">
    <dt>Projeto</dt><dd>${escapar(issue.projeto)}</dd>
    <dt>Tipo</dt><dd>${tipo}</dd>
    <dt>Criada</dt><dd>${data(issue.criadaEm)}</dd>
    ${cancelada}
    ${pr(p)}
    <dt>Dependências</dt><dd>${dependencias(p)}</dd>
  </dl>${cancelar(p)}</section>`;
}

const descricao = (html: string): string =>
  `<section class="cartao-lateral superficie"><h3>Descrição</h3>${
    html
      ? `<div class="md descricao" data-descricao>${html}</div><button type="button" class="link ver-tudo" data-acao="ver-descricao">ver tudo</button>`
      : '<p class="muted vazio">Sem descrição.</p>'
  }</section>`;

function pilulaDaSessao(s: InfoSessao): string {
  if (s.motivo) {
    return `<span class="pill ${s.motivo === "falha" ? "pill-falha" : "pill-aguarda"}">${MOTIVOS[s.motivo].titulo}</span>`;
  }
  return s.estado === "rodando"
    ? '<span class="pill pill-rodando">rodando</span>'
    : `<span class="pill pill-neutro">${MODO_DA_SESSAO[s.modo]}</span>`;
}

function tickets(p: PaginaDaIssue): string {
  const itens = p.tickets.map((t) => {
    // A sessão principal antes das consultas.
    const sessoes = p.sessoes
      .filter((s) => s.ticket === t.id)
      .toSorted((a, b) => Number(a.modo === "consulta") - Number(b.modo === "consulta"))
      .map(
        (s) =>
          `<a class="chat" href="${caminhoDaSessao(s.sessao)}">${pilulaDaSessao(s)}<span class="ir">chat →</span></a>`,
      );
    return `<li class="${t.status}">
      <button type="button" class="ticket-btn" data-ticket="${String(t.id)}" title="Ver execuções"><span class="id">${rotuloTicket(t.id)}</span><span class="tt">${escapar(t.titulo)}</span></button>
      <div class="sub"><span>${etapa(t.etapa)}</span><span class="pill ${PILULA_DO_STATUS[t.status]}">${STATUS_DO_TICKET[t.status]}</span>${sessoes.join("")}</div>
    </li>`;
  });
  return `<section class="cartao-lateral superficie"><h3>Tickets e sessões</h3><ol class="linha-tempo">${itens.join("")}</ol></section>`;
}

// ——— coluna da direita ———

function executarAgora(p: PaginaDaIssue): string {
  if (!p.executar) return "";
  const { ticket, ocupada } = p.executar;
  const id = String(ticket.id);
  return `<section class="painel-acao">
    <div class="painel-linha"><span class="rotulo">Executar agora</span><span class="muted"><span class="mono">${rotuloTicket(ticket.id)}</span> · ${escapar(ticket.titulo)} · ${etapa(ticket.etapa)}</span>
      <button type="button" class="btn btn-primario" data-acao="executar" data-executar="${id}"${ocupada ? ` disabled title="${escapar(ocupada)}"` : ""}>Executar agora</button></div>
    ${ocupada ? `<p class="bloqueio">${escapar(ocupada)}</p>` : ""}
  </section>`;
}

/**
 * O aviso da limpeza que falhou (F5 §5.3): logo depois de encerrar, os comandos que falharam com a saída do git
 * (`avisos`, da resposta do encerramento); depois, o comando a rodar, lido do disco.
 */
function limpeza(p: PaginaDaIssue, { avisos }: Extras): string {
  const [linhas, texto] = avisos?.length
    ? [avisos, "a issue foi encerrada, mas a limpeza da worktree falhou:"]
    : [p.limpeza, "a issue foi encerrada, mas a worktree ficou no disco; rode:"];
  return linhas.length === 0
    ? ""
    : `<section class="painel-acao falhou" role="status">
    <div class="painel-linha"><span class="rotulo">A limpeza falhou</span><span class="muted">${texto}</span></div>
    <pre class="comandos">${linhas.map(escapar).join("\n")}</pre>
  </section>`;
}

/** O estado do PR como a página o leu (`GET /api/issues/:id/pr`), ou a mensagem da falha do `gh` ou do `az` (502). */
export type EstadoLido = { leitura: LeituraDoPR } | { erro: string };

export type AbaDoPR = "revisao" | "decisao";

/** O que o Auditor já fez no gate do PR, que a releitura da página (o **Atualizar**, por exemplo) mantém. */
export interface RascunhoDoPR {
  aba: AbaDoPR;
  motivo: string;
  nota?: number;
}

/**
 * O que a página lê fora do `GET /api/issues/:id`: os modelos do pi (seletor do gate do desenho), a hora atual e, no
 * gate do PR, o estado lido na plataforma e o rascunho do Auditor.
 */
export interface Extras {
  modelos: readonly Modelo[];
  agora: Date;
  pr?: EstadoLido;
  rascunho?: RascunhoDoPR;
  /** O que falhou na limpeza, da resposta do encerramento (C16), até a página ser recarregada. */
  avisos?: readonly string[];
}

const SEM_EXTRAS: Extras = { modelos: [], agora: new Date(0) };

const par = (m: Modelo): string => `${m.provedor}/${m.modelo}`;

type Impacto = "baixo" | "medio" | "alto";
const IMPACTO: Record<Impacto, string> = { baixo: "baixo", medio: "médio", alto: "alto" };

/** Um card de número, com o rótulo no singular ou no plural; sem o número, "—". */
function numero(valor: number | undefined, um: string, varios: string): string {
  const rotulo = valor === 1 ? um : varios;
  return `<div class="numero"><strong>${valor === undefined ? "—" : String(valor)}</strong><span>${rotulo}</span></div>`;
}

/**
 * O seletor do modelo do ticket: o padrão da etapa dele ou um override (C20); o override que o pi não lista continua.
 * Serve ao gate do desenho e ao Responder e retomar do chat.
 */
export function seletorDeModelo(p: PaginaDaIssue, t: Ticket, modelos: readonly Modelo[]): string {
  const padrao = p.projeto.modelos[t.etapa];
  const { modelo } = t;
  const opcoes = modelo && !modelos.some((m) => par(m) === par(modelo)) ? [...modelos, modelo] : modelos;
  const options = opcoes.map((m) => {
    const selecionado = modelo && par(m) === par(modelo) ? " selected" : "";
    return `<option value="${escapar(par(m))}"${selecionado}>${escapar(nomeDoModelo(m))}</option>`;
  });
  const rotuloPadrao = padrao ? "padrão · " + escapar(padrao.modelo) : "padrão do pi";
  return `<select class="seletor-modelo${modelo ? " override" : ""}" data-modelo="${String(t.id)}" aria-label="Modelo de ${rotuloTicket(t.id)}"><option value="">${rotuloPadrao}</option>${options.join("")}</select>`;
}

/** O formulário de C12 (com o ticket) ou de C11 (sem). */
const formularioDeTicket = (t?: Ticket): string =>
  `<form class="form-ticket" data-form-ticket${t ? '="' + String(t.id) + '"' : ""}><input name="titulo" value="${escapar(t?.titulo ?? "")}" placeholder="Título do ticket" aria-label="Título" required maxlength="120" autocomplete="off" /><textarea name="descricao" placeholder="O que o ticket entrega, em Markdown" aria-label="Descrição" rows="3">${escapar(t?.descricao ?? "")}</textarea><div class="botoes"><button type="button" class="btn btn-pequeno" data-acao="cancelar-ticket">Cancelar</button><button class="btn btn-pequeno btn-primario">${t ? "Salvar" : "Criar ticket"}</button></div></form>`;

function propostos(p: PaginaDaIssue, modelos: readonly Modelo[]): string {
  const linhas = p.tickets
    .filter((t) => t.etapa === "desenvolvimento" && t.status === "aberto")
    .map((t) => {
      const id = String(t.id);
      return `<tr data-proposto="${id}"><td class="mono">${rotuloTicket(t.id)}</td><td>${escapar(t.titulo)}<div class="d md">${markdown(t.descricao)}</div></td><td class="modelo-cel">${seletorDeModelo(p, t, modelos)}</td><td class="acoes-t"><button type="button" class="btn btn-pequeno" data-acao="editar-ticket" data-id="${id}">Editar</button> <button type="button" class="btn btn-pequeno btn-reprovar" data-acao="remover-ticket" data-id="${id}">Remover</button></td></tr><tr data-edicao="${id}" hidden><td class="mono">${rotuloTicket(t.id)}</td><td colspan="3">${formularioDeTicket(t)}</td></tr>`;
    });
  return linhas.length
    ? `<div class="rola"><table class="tabela propostos"><tbody>${linhas.join("")}</tbody></table></div>`
    : '<p class="muted">Nenhum ticket proposto.</p>';
}

/**
 * O gate do desenho (F7 §4.4): a espera, os números do desenho (F6 §5.5) com o impacto, os critérios de aceite, os
 * tickets propostos com o modelo, editar, remover e criar (C11 a C13, C20), e a decisão (C15).
 */
export function gateDoDesenho(p: PaginaDaIssue, { modelos, agora }: Extras): string {
  if (p.issue.fase !== "aprovacao_desenho") return "";
  const espera = p.sessoes.find((s) => s.motivo === "gate_desenho");
  const desenho = p.tickets.findLast((t) => t.etapa === "desenho" && t.status === "concluido");
  const impacto = p.evidencias.find((e) => e.ticket === desenho?.id && e.tipo === "relatorio_impactos_arquitetura")
    ?.dados.impacto as Impacto | undefined;
  const criterios = p.evidencias.findLast((e) => e.tipo === "criterios_aceite");
  const n = p.desenho ?? undefined;
  return `<section class="gate-painel" aria-label="Gate do desenho">
    <div class="gate-cabeca"><span class="rotulo">Gate do desenho</span>${
      espera
        ? `<span class="muted">aguarda você ${ha(espera.desde, agora)}</span><a class="link direita" href="${caminhoDaSessao(espera.sessao)}">abrir o chat da sessão →</a>`
        : ""
    }</div>
    <div class="gate-corpo">
      <div class="numeros">${numero(n?.arquivosPrevistos, "arquivo previsto", "arquivos previstos")}${numero(n?.ticketsPropostos, "ticket proposto", "tickets propostos")}${numero(n?.novosAcoplamentos, "acoplamento novo", "acoplamentos novos")}<div class="numero"><strong>${
        impacto ? `<span class="impacto-${impacto}">${IMPACTO[impacto]}</span>` : "—"
      }</strong><span>impacto na arquitetura</span></div></div>
      <div><div class="titulo-bloco">Critérios de aceite</div>${
        criterios ? tabelaDeCriterios(criterios.dados.criterios) : '<p class="muted">Sem critérios de aceite.</p>'
      }</div>
      <div><div class="titulo-bloco">Tickets propostos</div>${propostos(p, modelos)}<button type="button" class="link" data-acao="novo-ticket">+ Novo ticket</button><div class="novo-ticket" data-novo-ticket hidden>${formularioDeTicket()}</div></div>
    </div>
    <div class="decidir"><label>Motivo (obrigatório para reprovar)<textarea data-motivo placeholder="O que precisa mudar no desenho"></textarea></label><div class="botoes"><button type="button" class="btn btn-grande btn-reprovar" data-acao="reprovar-desenho" disabled>Reprovar</button><button type="button" class="btn btn-grande btn-primario" data-acao="aprovar-desenho">Aprovar desenho</button></div></div>
  </section>`;
}

// ——— gate do registro ———

/** Texto que o agente registrou, em Markdown sem HTML (F7 §4.4); vazio, "—". */
const textoDoAgente = (texto: string): string => (texto.trim() ? `<div class="md">${markdown(texto)}</div>` : "—");

/**
 * O que o painel do gate do registro mostra (F7 §4.4), no chat e na página da issue: título, tipo, descrição,
 * comportamento, a tabela de critérios de aceite e as evidências que faltam.
 */
export function corpoDoRegistro(issue: Pick<Issue, "titulo" | "tipo" | "descricao">, r: PainelRegistro): string {
  const faltando = r.faltando.length ? `Faltam evidências: ${r.faltando.join(", ")}.` : "Nenhuma evidência faltando.";
  return (
    '<dl class="fatos">' +
    `<dt>Título</dt><dd>${escapar(issue.titulo)}</dd>` +
    `<dt>Tipo</dt><dd><span class="tag">${escapar(issue.tipo)}</span></dd>` +
    `<dt>Descrição</dt><dd>${textoDoAgente(issue.descricao)}</dd>` +
    `<dt>Comportamento</dt><dd>${textoDoAgente(r.comportamento)}</dd></dl>` +
    `<div><div class="titulo-bloco">Critérios de aceite</div>${tabelaDeCriterios(r.criterios)}</div>` +
    `<span class="muted">${faltando}</span>`
  );
}

/**
 * O gate do registro na página da issue (F7 §4.4), quando a sessão do registro aguarda a decisão: o mesmo conteúdo do
 * painel do chat, **Aprovar registro** (C10) e **Devolver** com o motivo, que vai ao agente.
 */
export function gateDoRegistro(p: PaginaDaIssue, { agora }: Extras): string {
  const espera = p.sessoes.find((s) => s.motivo === "gate_registro");
  if (!p.registro || !espera) return "";
  return `<section class="gate-painel" aria-label="Gate do registro">
    <div class="gate-cabeca"><span class="rotulo">Gate do registro</span><span class="muted">aguarda você ${ha(espera.desde, agora)}</span><a class="link direita" href="${caminhoDaSessao(espera.sessao)}">abrir o chat da sessão →</a></div>
    <div class="gate-corpo">${corpoDoRegistro(p.issue, p.registro)}</div>
    <div class="decidir"><label>Motivo (obrigatório para devolver)<textarea data-motivo-registro placeholder="O que o agente precisa rever no registro"></textarea></label><div class="botoes"><button type="button" class="btn btn-grande btn-reprovar" data-acao="devolver-registro" disabled>Devolver</button><button type="button" class="btn btn-grande btn-primario" data-acao="aprovar-registro">Aprovar registro</button></div></div>
  </section>`;
}

// ——— gate do PR ———

const NAO_LIDO = "o estado do PR não foi lido";

/** Uma ação da decisão: habilitada, ou desabilitada com o motivo ao lado (que pode ser vazio). */
type Liberacao = [habilitada: boolean, bloqueio: string];

/** O que a aba Decisão deixa fazer com o estado lido, o motivo escrito e a nota escolhida (F1 C16, F7 §4.4). */
export interface BloqueiosDoPR {
  motivo: boolean;
  pedir: Liberacao;
  notas: boolean;
  encerrar: Liberacao;
}

/**
 * Pedir mudanças só com o PR não mergeado e o motivo escrito; encerrar só com o PR mergeado e a nota; sem o estado
 * lido, nenhum dos dois. O servidor confere de novo com o estado relido (F5 §5.2).
 */
export function bloqueiosDoPR(pr: EstadoLido, motivo: string, nota: number | undefined): BloqueiosDoPR {
  if ("erro" in pr) return { motivo: true, pedir: [false, NAO_LIDO], notas: false, encerrar: [false, NAO_LIDO] };
  const { estado } = pr.leitura;
  if (estado === "mergeado") {
    return {
      motivo: false,
      pedir: [false, "o PR já foi mergeado"],
      notas: true,
      encerrar: nota === undefined ? [false, "escolha a nota"] : [true, ""],
    };
  }
  return {
    motivo: true,
    pedir: [motivo.trim() !== "", ""],
    notas: false,
    encerrar: [false, estado === "fechado" ? "o PR foi fechado sem merge" : "o PR ainda não foi mergeado"],
  };
}

const HOSPEDAGEM: Record<Hospedagem, [nome: string, comando: string]> = {
  github: ["GitHub", "gh pr view"],
  "azure-devops": ["Azure DevOps", "az repos pr show"],
};

/** `lido agora`, `lido há 12 s` ou `lido há 3 min`. */
function lido(lidoEm: string, agora: Date): string {
  const s = Math.round((agora.getTime() - Date.parse(lidoEm)) / 1000);
  if (s < 5) return "lido agora";
  return s < 60 ? `lido há ${String(s)} s` : `lido ${ha(lidoEm, agora)}`;
}

function estadoDoPR(l: LeituraDoPR, agora: Date): string {
  const pilula = {
    aberto: '<span class="pill pill-neutro">aberto · aguardando merge</span>',
    mergeado: `<span class="pill pill-ok">mergeado${l.mergeadoEm ? " em " + data(l.mergeadoEm) : ""}</span>`,
    fechado: '<span class="pill pill-falha">fechado sem merge</span>',
  }[l.estado];
  return `${pilula}<span class="muted">${lido(l.lidoEm, agora)}</span>`;
}

const habilitar = (sim: boolean): string => (sim ? "" : " disabled");

/** A aba Decisão: o estado do PR na plataforma, **Pedir mudanças** com o motivo e **Encerrar issue** com a nota. */
function decisaoDoPR(p: PaginaDaIssue, pr: EstadoLido, rascunho: RascunhoDoPR, agora: Date): string {
  const [hospedagem, comando] = HOSPEDAGEM[p.projeto.hospedagem];
  const aberto = prAberto(p);
  const b = bloqueiosDoPR(pr, rascunho.motivo, rascunho.nota);
  const estado =
    "erro" in pr
      ? `<span class="pill pill-falha">não lido</span><span class="erro-pr">${escapar(pr.erro)}</span>`
      : estadoDoPR(pr.leitura, agora);
  const abrir = aberto
    ? `<a class="btn btn-pequeno" href="${escapar(aberto.url)}" target="_blank" rel="noopener">Abrir PR #${escapar(aberto.id)} ↗</a>`
    : "";
  const notas = [1, 2, 3, 4, 5].map(
    (n) =>
      `<button type="button" data-acao="nota-pr" data-nota="${String(n)}" aria-pressed="${String(n === rascunho.nota)}"${habilitar(b.notas)}>${String(n)}</button>`,
  );
  return `<div class="estado-pr"><span>Estado no ${hospedagem}</span>${estado}<div class="direita"><button type="button" class="btn btn-pequeno" data-acao="atualizar-pr" title="Lê de novo com ${comando}">Atualizar</button>${abrir}</div></div>
      <p class="muted plataforma">A revisão e o merge acontecem na plataforma. Aqui você registra o resultado.</p>
      <div class="decisoes-pr">
        <section class="decisao-pr"><h3>Pedir mudanças</h3><p>Volta para o agente numa sessão em aberto, com este motivo.</p>
          <textarea data-motivo-pr rows="3" placeholder="O que precisa mudar" aria-label="O que precisa mudar no PR"${habilitar(b.motivo)}>${escapar(rascunho.motivo)}</textarea>
          <div class="rodape"><span class="bloqueio" data-bloqueio="pedir">${b.pedir[1]}</span><button type="button" class="btn btn-reprovar" data-acao="pedir-mudancas"${habilitar(b.pedir[0])}>Pedir mudanças</button></div></section>
        <section class="decisao-pr"><h3>Encerrar issue</h3><p>Só depois do merge. A Fabriquinha remove a worktree; as branches ficam para você limpar na plataforma.</p>
          <div class="nota-campo"><span class="muted">Nota da qualidade (obrigatória)</span><div class="notas" role="group" aria-label="Nota de 1 a 5">${notas.join("")}</div></div>
          <div class="rodape"><span class="bloqueio" data-bloqueio="encerrar">${b.encerrar[1]}</span><button type="button" class="btn btn-primario" data-acao="encerrar-issue"${habilitar(b.encerrar[0])}>Encerrar issue</button></div></section>
      </div>`;
}

const card = (valor: string, rotulo: string): string =>
  `<div class="numero"><strong>${valor}</strong><span>${rotulo}</span></div>`;

/** Os 4 cards de produtividade, do relatório do encerramento (F6 §6): custo e tokens somam as consultas. */
function produtividade(m: MetricasIssue | undefined): string {
  if (!m) return ["custo", "tokens", "execuções", "reprovações"].map((r) => card("—", r)).join("");
  const consumos: Consumo[] = [...m.etapas, m.consultas];
  const total = (f: (c: Consumo) => number) => consumos.reduce((n, c) => n + f(c), 0);
  const nas = (campo: "execucoes" | "falhas" | "reprovacoes") => m.etapas.reduce((n, e) => n + e[campo], 0);
  const [execucoes, reprovacoes] = [nas("execucoes"), nas("reprovacoes")];
  return [
    card(custo(total((c) => c.custo)), "custo"),
    card(compacto(total((c) => c.tokens.input + c.tokens.output + c.tokens.cacheRead + c.tokens.cacheWrite)), "tokens"),
    card(
      String(execucoes),
      `${execucoes === 1 ? "execução" : "execuções"} · ${plural(nas("falhas"), "falha", "falhas")}`,
    ),
    card(String(reprovacoes), reprovacoes === 1 ? "reprovação" : "reprovações"),
  ].join("");
}

/** Um bloco da aba Revisão com o título, ou o aviso de que falta a evidência. */
function bloco(titulo: string, conteudo: string | undefined, falta: string): string {
  const corpo = conteudo ?? '<p class="muted">' + falta + "</p>";
  return `<div><div class="titulo-bloco">${titulo}</div>${corpo}</div>`;
}

/** A aba Revisão: vídeo, produtividade, o corpo completo do PR (preenchido pela montagem), comprovação e fitness. */
function revisaoDoPR(p: PaginaDaIssue): string {
  const ultima = (tipo: TipoEvidencia) => p.evidencias.findLast((e) => e.tipo === tipo);
  const [video] = ultima("video_explicativo")?.arquivos ?? [];
  const [corpo] = ultima("pr_aberto")?.arquivos ?? [];
  const comprovacao = ultima("comprovacao_criterios");
  const fitness = ultima("matriz_fitness");
  return `<div class="duas">${
    video
      ? `<video controls preload="metadata" src="${arquivo(video)}" aria-label="Vídeo explicativo"></video>`
      : '<div class="sem-video">sem vídeo explicativo</div>'
  }<div class="numeros">${produtividade(ultima("relatorio_produtividade")?.dados as MetricasIssue | undefined)}</div></div>
      ${bloco("Corpo do PR", corpo && `<div class="corpo-pr md" data-corpo-pr="${arquivo(corpo)}">carregando…</div>`, "Sem o corpo do PR.")}
      ${bloco("Comprovação dos critérios", comprovacao && tabelaDeComprovacao(comprovacao), "Sem a comprovação dos critérios.")}
      ${bloco("Fitness functions", fitness && tabelaDeFitness(fitness, p), "Sem a matriz de fitness.")}`;
}

/**
 * O gate do PR (F7 §4.4), em duas abas: **Revisão** (vídeo, produtividade, corpo do PR, comprovação e fitness) e
 * **Decisão** (o estado lido na plataforma, pedir mudanças e encerrar a issue, C16).
 */
export function gateDoPR(
  p: PaginaDaIssue,
  { agora, pr = { erro: NAO_LIDO }, rascunho = { aba: "revisao", motivo: "" } }: Extras,
): string {
  if (p.issue.fase !== "aprovacao_pr") return "";
  const espera = p.sessoes.find((s) => s.motivo === "gate_pr");
  const aberto = prAberto(p);
  const aba = (id: AbaDoPR, rotulo: string) =>
    `<button type="button" role="tab" id="aba-pr-${id}" aria-controls="painel-pr-${id}" aria-selected="${String(id === rascunho.aba)}" data-acao="aba-pr" data-aba="${id}">${rotulo}</button>`;
  const painel = (id: AbaDoPR, conteudo: string) =>
    `<div class="gate-corpo" role="tabpanel" id="painel-pr-${id}" aria-labelledby="aba-pr-${id}" data-painel-pr="${id}"${id === rascunho.aba ? "" : " hidden"}>${conteudo}</div>`;
  return `<section class="gate-painel" aria-label="Gate do PR">
    <div class="gate-cabeca"><span class="rotulo">Gate do PR</span>${
      aberto
        ? `<a class="pr" href="${escapar(aberto.url)}" target="_blank" rel="noopener">PR #${escapar(aberto.id)} ↗</a>`
        : ""
    }${
      espera
        ? `<span class="muted">aguarda você ${ha(espera.desde, agora)}</span><a class="link direita" href="${caminhoDaSessao(espera.sessao)}">abrir o chat da sessão →</a>`
        : ""
    }</div>
    <div class="abas-gate" role="tablist">${aba("revisao", "Revisão")}${aba("decisao", "Decisão")}</div>
    ${painel("revisao", revisaoDoPR(p))}
    ${painel("decisao", decisaoDoPR(p, pr, rascunho, agora))}
  </section>`;
}

/**
 * Os painéis da "Ação do Auditor", na ordem da coluna: cada um devolve o seu HTML, ou `""` quando não se aplica. Os
 * painéis de gate da fase (desenho e PR, tickets 31 e 32) entram no começo desta lista, e as ações deles na tabela
 * `ACOES` da montagem (issue-montar.ts).
 */
export const PAINEIS: ((p: PaginaDaIssue, extras: Extras) => string)[] = [
  gateDoRegistro,
  gateDoDesenho,
  gateDoPR,
  executarAgora,
  limpeza,
];

/** A "Ação do Auditor", só quando algum painel existe (F7 §4.4). */
export function acaoDoAuditor(p: PaginaDaIssue, extras = SEM_EXTRAS): string {
  // A cancelada fica na fase em que parou, mas não tem mais o que decidir (C22).
  if (p.issue.canceladaEm !== undefined) return "";
  const paineis = PAINEIS.map((painel) => painel(p, extras)).join("");
  return paineis && `<div class="acao-auditor" aria-label="Ação do Auditor" role="region">${paineis}</div>`;
}

/** A classe de cor de um resultado: verde ou vermelho. */
const cor = (ok: boolean): string => (ok ? "ok" : "nok");
const veredito = (aprovada: boolean): string => (aprovada ? "aprovada" : "reprovada");

const marcaAprovada = (aprovada: boolean): string =>
  `<p class="marca-aprovada"><span class="pill ${aprovada ? "pill-ok" : "pill-falha"}">${veredito(aprovada)}</span></p>`;

type Classe = "html" | "video" | "imagem" | "texto";

/** A classe de um anexo pelo mime que o F3 gravou a partir dos bytes. */
function classe(a: ArquivoEvidencia): Classe {
  if (a.mime.startsWith("video/")) return "video";
  if (a.mime.startsWith("image/")) return "imagem";
  return a.mime.startsWith("text/html") ? "html" : "texto";
}

const ROTULO_DA_CLASSE: Record<Classe, string> = { html: "HTML", video: "VÍDEO", imagem: "IMG", texto: "TEXTO" };

/** A classe do card: TABELA nos tipos de gate (F7 §4.5), senão a do primeiro anexo, e JSON sem anexo. */
function classeDoCard(e: Evidencia): string {
  if (TABELAS[e.tipo]) return "TABELA";
  const [primeiro] = e.arquivos;
  return primeiro ? ROTULO_DA_CLASSE[classe(primeiro)] : "JSON";
}

/**
 * O card de um artefato, que abre a evidência na caixa pelo `data-evidencia`; aqui e na coluna da direita do chat. Aqui
 * os cards vêm agrupados por etapa e ticket; no chat, sem o grupo, `comTicket` põe o `T-n` em cada um.
 */
export function cardDaEvidencia(e: Evidencia, comTicket = false): string {
  const ponto =
    e.aprovada === undefined ? "" : `<span class="ponto ${cor(e.aprovada)}" title="${veredito(e.aprovada)}"></span>`;
  const ticket = comTicket ? `<span class="id">${rotuloTicket(e.ticket)}</span>` : "";
  return `<button type="button" class="art" data-evidencia="${String(e.id)}"><span class="tipo">${classeDoCard(e)}</span>${NOME[e.tipo]}${ticket}${ponto}</button>`;
}

/** Os artefatos que aparecem como card: `explicacao_fitness` vai dentro da tabela da `matriz_fitness` do ticket. */
export const comCard = (p: PaginaDaIssue): Evidencia[] => p.evidencias.filter((e) => e.tipo !== "explicacao_fitness");

function artefatos(p: PaginaDaIssue): string {
  const porTicket = Map.groupBy(comCard(p), (e) => e.ticket);
  const linhas = p.tickets.toReversed().flatMap((t) => {
    const evidencias = porTicket.get(t.id);
    if (!evidencias) return [];
    return [
      `<div class="etapa-artefatos"><div class="etapa-nome">${NOME_DA_ETAPA[t.etapa]}<span class="id">${rotuloTicket(t.id)}</span></div><div class="cards-art">${evidencias.map((e) => cardDaEvidencia(e)).join("")}</div></div>`,
    ];
  });
  return `<section class="secao"><h2>Artefatos <span class="muted">${linhas.length ? "clique para abrir" : ""}</span></h2>${
    linhas.join("") || '<p class="muted">Nenhum artefato ainda.</p>'
  }</section>`;
}

/** A página inteira. `descricaoHtml` é a descrição já renderizada pelo `markdown-it` com `html: false`. */
export function paginaDaIssue(p: PaginaDaIssue, descricaoHtml: string, extras = SEM_EXTRAS): string {
  const { issue } = p;
  const ativas = p.sessoes.filter((s) => s.estado !== "terminada");
  const titulo = issue.titulo === null ? '<span class="muted">sem título</span>' : escapar(issue.titulo);
  return `<div class="pagina-issue">
    <nav class="migalha" aria-label="Caminho"><a href="/projects">Projetos</a> › <a href="/projects/${encodeURIComponent(issue.projeto)}">${escapar(issue.projeto)}</a> › ${rotuloIssue(issue.id)}</nav>
    <h1 class="titulo-issue"><span class="id">${rotuloIssue(issue.id)}</span>${titulo}${issue.canceladaEm === undefined ? "" : ' <span class="pill pill-cancelada">Cancelada</span>'}</h1>
    ${trilho(issue.fase, p.percorridas, issue.canceladaEm === undefined ? estadoDoTrilho(ativas) : "cancelada")}
    <div class="mesa">
      <aside class="lateral">${detalhes(p)}${descricao(descricaoHtml)}${tickets(p)}</aside>
      <div class="principal">${acaoDoAuditor(p, extras)}${artefatos(p)}</div>
    </div>
  </div>`;
}

// ——— caixa ———

/** A descrição e as execuções do ticket na caixa: modo, resultado, início, duração, custo, erro, log e prompt. */
export function execucoesDoTicket(p: PaginaDaIssue, ticket: Ticket): ConteudoDaCaixa {
  const id = ticket.id;
  const linhas = p.execucoes
    .filter((e) => e.ticket === id)
    .map((e) => {
      const tempo = e.terminadaEm ? duracao(Date.parse(e.terminadaEm) - Date.parse(e.iniciadaEm)) : "—";
      const gasto = p.custos[String(e.id)];
      const resultado = { em_andamento: "em andamento", sucesso: "sucesso", falha: "falha" }[e.resultado];
      return `<tr><td class="mono">E-${String(e.id)}</td><td>${MODO[e.modo]}</td><td class="${e.resultado === "falha" ? "nok" : ""}">${resultado}</td><td>${data(e.iniciadaEm)}</td><td class="num">${tempo}</td><td class="num">${gasto === undefined ? "—" : custo(gasto)}</td><td>${escapar(e.erro ?? "")}</td><td class="acoes-t"><a class="link" href="/api/execucoes/${String(e.id)}/log" target="_blank" rel="noopener">log</a> · <a class="link" href="/api/execucoes/${String(e.id)}/prompt" target="_blank" rel="noopener">prompt</a></td></tr>`;
    });
  return {
    titulo: `${rotuloTicket(id)} · ${ticket.titulo}`,
    meta: `${etapa(ticket.etapa)} · ${STATUS_DO_TICKET[ticket.status]}`,
    corpo:
      (ticket.descricao ? `<div class="md descricao-ticket">${markdown(ticket.descricao)}</div>` : "") +
      (linhas.length
        ? `<div class="rola"><table class="tabela"><thead><tr><th>Execução</th><th>Modo</th><th>Resultado</th><th>Início</th><th class="num">Duração</th><th class="num">Custo</th><th>Erro</th><th></th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
        : '<p class="muted">Ainda sem execução.</p>'),
  };
}

const arquivo = (a: ArquivoEvidencia): string => `/arquivos/${a.sha256}`;
const baixar = (a: ArquivoEvidencia): string => `${arquivo(a)}?baixar`;

/** O link para o anexo `nome` da evidência, aberto em nova aba. */
function anexo(e: Evidencia, nome: string): string {
  const a = e.arquivos.find((x) => x.nome === nome);
  return a ? `<a class="link" href="${arquivo(a)}" target="_blank" rel="noopener">${escapar(nome)}</a>` : escapar(nome);
}

const tabela = (cabecalho: string, linhas: string[]): string =>
  `<div class="rola"><table class="tabela"><thead><tr>${cabecalho}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;

function sim(ok: boolean, sim: string, nao: string): string {
  const texto = ok ? sim : nao;
  return `<td class="${cor(ok)}">${ok ? "✓" : "✗"} ${texto}</td>`;
}

interface ComandoRodado {
  comando: string;
  codigoSaida: number | null;
  estourou: boolean;
  duracaoMs: number;
  log: string;
}

function resultadoDoComando(c: ComandoRodado): string {
  if (c.estourou) return '<td class="nok">✗ estourou o tempo</td>';
  return sim(c.codigoSaida === 0, "passou", `reprovou (código ${String(c.codigoSaida)})`);
}

type Tabela = (e: Evidencia, p: PaginaDaIssue) => string;

/** O status do arquivo no git (F3, `arquivos_alterados`), por extenso. */
const STATUS_DO_ARQUIVO = { A: "adicionado", M: "modificado", D: "removido", R: "renomeado" } as const;

interface Alterado {
  caminho: string;
  status: keyof typeof STATUS_DO_ARQUIVO;
  adicionadas: number | null;
  removidas: number | null;
  previsto: string | null;
}

/** Uma lista de `dados`, que o F3 já validou com o schema do tipo. */
const lista = <T>(valor: unknown): T[] => valor as T[];

/** Uma célula com o texto curto do agente, em Markdown de linha. */
const celulaDoAgente = (texto: string): string => `<td class="md">${markdownEmLinha(texto)}</td>`;

/** Os critérios de aceite (F7 §4.5), na caixa, no gate do desenho e no gate do registro. */
export const tabelaDeCriterios = (criterios: unknown): string =>
  tabela(
    "<th>ID</th><th>Dado</th><th>Quando</th><th>Então</th>",
    lista<{ id: string; dado: string; quando: string; entao: string }>(criterios).map(
      (c) =>
        `<tr><td class="mono">${escapar(c.id)}</td>${[c.dado, c.quando, c.entao].map(celulaDoAgente).join("")}</tr>`,
    ),
  );

/** A comprovação dos critérios, na caixa e no gate do PR. */
const tabelaDeComprovacao = (e: Evidencia): string =>
  tabela(
    '<th>ID</th><th>Atendido</th><th>Como foi verificado</th><th class="num">Anexos</th>',
    lista<{ id: string; atendido: boolean; comoVerificado: string; arquivos: string[] }>(e.dados.criterios).map(
      (c) =>
        `<tr><td class="mono">${escapar(c.id)}</td>${sim(c.atendido, "sim", "não")}${celulaDoAgente(c.comoVerificado)}<td class="num">${c.arquivos.map((nome) => anexo(e, nome)).join(", ")}</td></tr>`,
    ),
  );

/** A matriz de fitness com a explicação do agente do mesmo ticket, na caixa e no gate do PR. */
function tabelaDeFitness(e: Evidencia, p: PaginaDaIssue): string {
  const explicacoes = new Map(
    p.evidencias
      .filter((x) => x.tipo === "explicacao_fitness" && x.ticket === e.ticket)
      .flatMap((x) =>
        lista<{ nome: string; explicacao: string }>(x.dados.explicacoes).map((n) => [n.nome, n.explicacao]),
      ),
  );
  return tabela(
    '<th>Fitness function</th><th>Resultado</th><th class="num">Duração</th><th>Explicação do agente</th><th>Log</th>',
    lista<ComandoRodado & { nome: string }>(e.dados.linhas).map(
      (l) =>
        `<tr><td class="mono">${escapar(l.nome)}</td>${resultadoDoComando(l)}<td class="num">${duracao(l.duracaoMs)}</td>${celulaDoAgente(explicacoes.get(l.nome) ?? "—")}<td>${anexo(e, l.log)}</td></tr>`,
    ),
  );
}

/**
 * O corpo do PR em Markdown sem HTML, sem a marca `<!-- fabriquinha I-n/T-n -->` da primeira linha: é para o GitHub e
 * o Azure DevOps, que a escondem; aqui o `markdown-it` sem HTML a mostraria como texto.
 */
export const corpoDoPR = (texto: string): string => markdown(texto.replace(/^<!-- fabriquinha [^\n]*-->\n*/, ""));

/** As tabelas dos tipos que o Auditor lê para decidir um gate (F7 §4.5); os demais saem como JSON formatado. */
const TABELAS: Partial<Record<TipoEvidencia, Tabela>> = {
  criterios_aceite: (e) => tabelaDeCriterios(e.dados.criterios),
  comprovacao_criterios: (e) => tabelaDeComprovacao(e),
  relatorio_complexidade: (e) => {
    type Big = { tempo: string; espaco: string } | undefined;
    const bigo = (c: Big) =>
      c ? `<td class="bigo">${escapar(c.tempo)} · ${escapar(c.espaco)}</td>` : '<td class="bigo muted">—</td>';
    return tabela(
      "<th>Fluxo</th><th>Situação</th><th>Antes (tempo · espaço)</th><th>Depois (tempo · espaço)</th>",
      lista<{ nome: string; situacao: string; antes?: Big; depois: Big }>(e.dados.fluxos).map(
        (f) => `<tr>${celulaDoAgente(f.nome)}<td>${escapar(f.situacao)}</td>${bigo(f.antes)}${bigo(f.depois)}</tr>`,
      ),
    );
  },
  arquivos_alterados: (e, p) => {
    // O motivo de cada não previsto vem da mensagem do PR, quando o encerramento já a submeteu.
    const motivos = new Map(
      p.evidencias
        .filter((x) => x.tipo === "mensagem_pr")
        .flatMap((x) =>
          lista<{ caminho: string; motivo: string }>(x.dados.naoPrevistos).map((n) => [n.caminho, n.motivo]),
        ),
    );
    return tabela(
      '<th>Arquivo</th><th>Status</th><th class="num">+/−</th><th>Previsto no desenho</th>',
      lista<Alterado>(e.dados.arquivos).map((a) => {
        const linhas =
          a.adicionadas === null
            ? "binário"
            : `<span class="ok">+${String(a.adicionadas)}</span> <span class="nok">−${String(a.removidas)}</span>`;
        const motivo = motivos.get(a.caminho);
        const porque = motivo ? ": " + markdownEmLinha(motivo) : "";
        const previsto =
          a.previsto === null
            ? `<td class="nao-previsto md">não previsto${porque}</td>`
            : `<td class="mono">${escapar(a.previsto)}</td>`;
        return `<tr><td class="mono">${escapar(a.caminho)}</td><td>${STATUS_DO_ARQUIVO[a.status]}</td><td class="num">${linhas}</td>${previsto}</tr>`;
      }),
    );
  },
  matriz_fitness: (e, p) => tabelaDeFitness(e, p),
  execucao_testes: (e) =>
    tabela(
      '<th>Comando</th><th>Resultado</th><th class="num">Duração</th><th>Log</th>',
      lista<ComandoRodado>(e.dados.comandos).map(
        (c) =>
          `<tr><td class="mono">${escapar(c.comando)}</td>${resultadoDoComando(c)}<td class="num">${duracao(c.duracaoMs)}</td><td>${anexo(e, c.log)}</td></tr>`,
      ),
    ),
  relatorio_sonar: (e) => {
    const issues = lista<{ arquivo: string; linha?: number; regra: string; severidade: string; mensagem: string }>(
      e.dados.issues,
    );
    const resumo = tabela('<th class="num">Arquivos analisados</th><th class="num">Issues abertas</th>', [
      `<tr><td class="num">${String(lista<string>(e.dados.arquivosAnalisados).length)}</td><td class="num ${issues.length ? "nok" : "ok"}">${String(issues.length)}</td></tr>`,
    ]);
    return issues.length
      ? resumo +
          tabela(
            "<th>Arquivo</th><th>Regra</th><th>Severidade</th><th>Mensagem</th>",
            issues.map(
              (i) =>
                `<tr><td class="mono">${escapar(i.arquivo)}${i.linha === undefined ? "" : ":" + String(i.linha)}</td><td class="mono">${escapar(i.regra)}</td><td>${escapar(i.severidade)}</td><td>${escapar(i.mensagem)}</td></tr>`,
            ),
          )
      : resumo;
  },
};

/** Um anexo como a caixa o mostra (F7 §4.5); o texto chega depois, pela montagem, em `[data-texto]`. */
function exibir(a: ArquivoEvidencia): string {
  const src = arquivo(a);
  const nome = escapar(a.nome);
  switch (classe(a)) {
    case "html":
      return `<iframe sandbox="allow-scripts" src="${src}" title="${nome}"></iframe>`;
    case "video":
      return `<video controls preload="metadata" src="${src}" aria-label="${nome}"></video>`;
    case "imagem":
      return `<img src="${src}" alt="${nome}" />`;
    case "texto":
      return `<pre data-texto="${src}">carregando…</pre>`;
  }
}

/**
 * A evidência na caixa (F7 §4.5): a tabela própria nos tipos de gate, com o HTML abaixo; nos demais, os anexos e os
 * `dados` em JSON formatado. Com um anexo só, **abrir em nova aba** e **baixar** ficam no cabeçalho da caixa; com
 * mais, cada anexo traz os seus.
 */
export function evidenciaNaCaixa(p: PaginaDaIssue, e: Evidencia): ConteudoDaCaixa {
  const etapaDoTicket = new Map(p.tickets.map((t) => [t.id, etapa(t.etapa)]));
  const montarTabela = TABELAS[e.tipo];
  // Na tabela, os anexos citados nela viram links; só o HTML aparece abaixo.
  const exibidos = montarTabela ? e.arquivos.filter((a) => classe(a) === "html") : e.arquivos;
  const [unico] = exibidos.length === 1 ? exibidos : [];
  const anexos = exibidos.map((a) =>
    unico
      ? exibir(a)
      : `<figure class="anexo"><figcaption><span class="mono">${escapar(a.nome)}</span><a class="link" href="${arquivo(a)}" target="_blank" rel="noopener">abrir em nova aba ↗</a><a class="link" href="${baixar(a)}" download>baixar</a></figcaption>${exibir(a)}</figure>`,
  );
  const marca = e.aprovada === undefined ? "" : marcaAprovada(e.aprovada);
  const dados =
    montarTabela?.(e, p) ??
    (Object.keys(e.dados).length ? `<pre class="json">${escapar(JSON.stringify(e.dados, null, 2))}</pre>` : "");
  const corpo = montarTabela ? [marca, dados, ...anexos] : [marca, ...anexos, dados];
  return {
    titulo: NOME[e.tipo],
    meta: [e.tipo, etapaDoTicket.get(e.ticket), rotuloTicket(e.ticket)].filter(Boolean).join(" · "),
    corpo: `<div class="evidencia">${corpo.join("")}</div>`,
    ...(unico && { aba: arquivo(unico), baixar: baixar(unico) }),
  };
}
