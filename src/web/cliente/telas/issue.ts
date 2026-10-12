// Página da issue (F7 §4.4, §4.5) como funções puras que devolvem HTML: cabeçalho, coluna da esquerda (detalhes,
// descrição e tickets), "Ação do Auditor", artefatos e o conteúdo da caixa. O texto que vem do servidor passa sempre
// por `escapar`; a descrição chega já renderizada pelo `markdown-it` sem HTML.
import type { ArquivoEvidencia, Evidencia, ModoExecucao, Ticket, TipoEvidencia } from "../../../dominio/agregado.ts";
import type { Etapa, Fase, Modelo } from "../../../dominio/primitivos.ts";
import type { InfoSessao, MotivoEspera } from "../../../execucao/sessoes.ts";
import type { PaginaDaIssue } from "../../rotas/issue.ts";
import type { ConteudoDaCaixa } from "../dom.ts";
import { type EstadoDoTrilho, escapar, ha, MODO_DA_SESSAO, STATUS_DO_TICKET, trilho } from "../render.ts";

export const caminhoDaIssue = (projeto: string, issue: number): string =>
  `/projects/${encodeURIComponent(projeto)}/issues/I-${String(issue)}`;

const ETAPA: Record<Etapa, string> = {
  registro: "Registro",
  desenho: "Desenho",
  desenvolvimento: "Desenvolvimento",
  revisao: "Revisão",
  encerramento: "Encerramento",
  sessao: "Sessão em aberto",
};
export const etapa = (e: Etapa): string => ETAPA[e].toLowerCase();

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

const MOTIVO: Record<MotivoEspera, string> = {
  conversa: "Conversa",
  dialogo: "Diálogo",
  falha: "Falha",
  gate_registro: "Gate do registro",
  gate_desenho: "Gate do desenho",
  gate_pr: "Gate do PR",
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

const dois = (n: number): string => String(n).padStart(2, "0");

/** `11/10 09:00`, no fuso do navegador. */
export function data(instante: string): string {
  const d = new Date(instante);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}

/** `48 s`, `2 min 10 s`, `34 min`, `1 h 20 min`. */
export function duracao(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${String(s)} s`;
  const [min, resto] = [Math.floor(s / 60), s % 60];
  if (min < 60) return resto ? `${String(min)} min ${String(resto)} s` : `${String(min)} min`;
  const [h, m] = [Math.floor(min / 60), min % 60];
  return m ? `${String(h)} h ${String(m)} min` : `${String(h)} h`;
}

export const custo = (valor: number): string => `US$ ${valor.toFixed(2).replace(".", ",")}`;

/** A cor do marco atual no trilho: a falha antes de quem aguarda, e quem aguarda antes do que roda. */
export function estadoDoTrilho(sessoes: readonly InfoSessao[]): EstadoDoTrilho | undefined {
  if (sessoes.some((s) => s.motivo === "falha")) return "falha";
  if (sessoes.some((s) => s.estado === "aguardando_humano")) return "aguarda";
  return sessoes.some((s) => s.estado === "rodando") ? "rodando" : undefined;
}

// ——— coluna da esquerda ———

function pr(p: PaginaDaIssue): string {
  const aberto = p.evidencias.findLast((e) => e.tipo === "pr_aberto")?.dados as { id: string; url: string } | undefined;
  return aberto
    ? `<dt>PR</dt><dd><a class="pr" href="${escapar(aberto.url)}" target="_blank" rel="noopener">#${escapar(aberto.id)} ↗</a></dd>`
    : "";
}

function dependencias(p: PaginaDaIssue): string {
  const aberta = p.issue.fase !== "concluida";
  const deps = p.dependencias.map(
    (d) =>
      `<span class="dep"><a href="${caminhoDaIssue(d.projeto, d.id)}">I-${String(d.id)}</a><span class="fase">${FASE[d.fase]}</span>${
        aberta
          ? `<button type="button" class="x" data-remover-dep="${String(d.id)}" title="Remover I-${String(d.id)}" aria-label="Remover I-${String(d.id)}">×</button>`
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

function detalhes(p: PaginaDaIssue): string {
  const { issue } = p;
  const tipo = issue.tipo ? `<span class="tag">${issue.tipo}</span>` : '<span class="muted">—</span>';
  return `<section class="cartao-lateral superficie"><h3>Detalhes</h3><dl class="fatos">
    <dt>Projeto</dt><dd>${escapar(issue.projeto)}</dd>
    <dt>Tipo</dt><dd>${tipo}</dd>
    <dt>Criada</dt><dd>${data(issue.criadaEm)}</dd>
    ${pr(p)}
    <dt>Dependências</dt><dd>${dependencias(p)}</dd>
  </dl></section>`;
}

const descricao = (html: string): string =>
  `<section class="cartao-lateral superficie"><h3>Descrição</h3>${
    html
      ? `<div class="md descricao" data-descricao>${html}</div><button type="button" class="link ver-tudo" data-acao="ver-descricao">ver tudo</button>`
      : '<p class="muted vazio">Sem descrição.</p>'
  }</section>`;

function pilulaDaSessao(s: InfoSessao): string {
  if (s.motivo) {
    return `<span class="pill ${s.motivo === "falha" ? "pill-falha" : "pill-aguarda"}">${MOTIVO[s.motivo]}</span>`;
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
        (s) => `<a class="chat" href="/sessions/${s.sessao}">${pilulaDaSessao(s)}<span class="ir">chat →</span></a>`,
      );
    return `<li class="${t.status}">
      <button type="button" class="ticket-btn" data-ticket="${String(t.id)}" title="Ver execuções"><span class="id">T-${String(t.id)}</span><span class="tt">${escapar(t.titulo)}</span></button>
      <div class="sub"><span>${etapa(t.etapa)}</span><span class="pill st-${t.status}">${STATUS_DO_TICKET[t.status]}</span>${sessoes.join("")}</div>
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
    <div class="painel-linha"><span class="rotulo">Executar agora</span><span class="muted"><span class="mono">T-${id}</span> · ${escapar(ticket.titulo)} · ${etapa(ticket.etapa)}</span>
      <button type="button" class="btn btn-primario" data-acao="executar" data-executar="${id}"${ocupada ? ` disabled title="${escapar(ocupada)}"` : ""}>Executar agora</button></div>
    ${ocupada ? `<p class="bloqueio">${escapar(ocupada)}</p>` : ""}
  </section>`;
}

const limpeza = (p: PaginaDaIssue): string =>
  p.limpeza.length === 0
    ? ""
    : `<section class="painel-acao falhou" role="status">
    <div class="painel-linha"><span class="rotulo">A limpeza falhou</span><span class="muted">a issue foi encerrada, mas a worktree ficou no disco; rode:</span></div>
    <pre class="comandos">${p.limpeza.map(escapar).join("\n")}</pre>
  </section>`;

/** O que a página lê fora do `GET /api/issues/:id`: os modelos do pi (seletor do gate do desenho) e a hora atual. */
export interface Extras {
  modelos: readonly Modelo[];
  agora: Date;
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
    return `<option value="${escapar(par(m))}"${selecionado}>${escapar(m.provedor + " / " + m.modelo)}</option>`;
  });
  const rotuloPadrao = padrao ? "padrão · " + escapar(padrao.modelo) : "padrão do pi";
  return `<select class="seletor-modelo${modelo ? " override" : ""}" data-modelo="${String(t.id)}" aria-label="Modelo de T-${String(t.id)}"><option value="">${rotuloPadrao}</option>${options.join("")}</select>`;
}

/** O formulário de C12 (com o ticket) ou de C11 (sem). */
const formularioDeTicket = (t?: Ticket): string =>
  `<form class="form-ticket" data-form-ticket${t ? '="' + String(t.id) + '"' : ""}><input name="titulo" value="${escapar(t?.titulo ?? "")}" placeholder="Título do ticket" aria-label="Título" required maxlength="120" autocomplete="off" /><textarea name="descricao" placeholder="O que o ticket entrega, em Markdown" aria-label="Descrição" rows="3">${escapar(t?.descricao ?? "")}</textarea><div class="botoes"><button type="button" class="btn btn-pequeno" data-acao="cancelar-ticket">Cancelar</button><button class="btn btn-pequeno btn-primario">${t ? "Salvar" : "Criar ticket"}</button></div></form>`;

function propostos(p: PaginaDaIssue, modelos: readonly Modelo[]): string {
  const linhas = p.tickets
    .filter((t) => t.etapa === "desenvolvimento" && t.status === "aberto")
    .map((t) => {
      const id = String(t.id);
      return `<tr data-proposto="${id}"><td class="mono">T-${id}</td><td>${escapar(t.titulo)}<div class="d">${escapar(t.descricao)}</div></td><td class="modelo">${seletorDeModelo(p, t, modelos)}</td><td class="acoes-t"><button type="button" class="btn btn-pequeno" data-acao="editar-ticket" data-id="${id}">Editar</button> <button type="button" class="btn btn-pequeno btn-reprovar" data-acao="remover-ticket" data-id="${id}">Remover</button></td></tr><tr data-edicao="${id}" hidden><td class="mono">T-${id}</td><td colspan="3">${formularioDeTicket(t)}</td></tr>`;
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
        ? `<span class="muted">aguarda você ${ha(espera.desde, agora)}</span><a class="link direita" href="/sessions/${espera.sessao}">abrir o chat da sessão →</a>`
        : ""
    }</div>
    <div class="gate-corpo">
      <div class="numeros">${numero(n?.arquivosPrevistos, "arquivo previsto", "arquivos previstos")}${numero(n?.ticketsPropostos, "ticket proposto", "tickets propostos")}${numero(n?.novosAcoplamentos, "acoplamento novo", "acoplamentos novos")}<div class="numero"><strong>${
        impacto ? `<span class="impacto-${impacto}">${IMPACTO[impacto]}</span>` : "—"
      }</strong><span>impacto na arquitetura</span></div></div>
      <div><div class="titulo-bloco">Critérios de aceite</div>${
        criterios ? tabelaDeCriterios(criterios) : '<p class="muted">Sem critérios de aceite.</p>'
      }</div>
      <div><div class="titulo-bloco">Tickets propostos</div>${propostos(p, modelos)}<button type="button" class="link" data-acao="novo-ticket">+ Novo ticket</button><div class="novo-ticket" data-novo-ticket hidden>${formularioDeTicket()}</div></div>
    </div>
    <div class="decidir"><label>Motivo (obrigatório para reprovar)<textarea data-motivo placeholder="O que precisa mudar no desenho"></textarea></label><div class="botoes"><button type="button" class="btn btn-grande btn-reprovar" data-acao="reprovar-desenho" disabled>Reprovar</button><button type="button" class="btn btn-grande btn-primario" data-acao="aprovar-desenho">Aprovar desenho</button></div></div>
  </section>`;
}

/**
 * Os painéis da "Ação do Auditor", na ordem da coluna: cada um devolve o seu HTML, ou `""` quando não se aplica. Os
 * painéis de gate da fase (desenho e PR, tickets 31 e 32) entram no começo desta lista, e as ações deles na tabela
 * `ACOES` da montagem (issue-montar.ts).
 */
export const PAINEIS: ((p: PaginaDaIssue, extras: Extras) => string)[] = [gateDoDesenho, executarAgora, limpeza];

/** A "Ação do Auditor", só quando algum painel existe (F7 §4.4). */
export function acaoDoAuditor(p: PaginaDaIssue, extras = SEM_EXTRAS): string {
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

/** O card de um artefato, que abre a evidência na caixa pelo `data-evidencia`; aqui e na coluna da direita do chat. */
export function cardDaEvidencia(e: Evidencia): string {
  const ponto =
    e.aprovada === undefined ? "" : `<span class="ponto ${cor(e.aprovada)}" title="${veredito(e.aprovada)}"></span>`;
  return `<button type="button" class="art" data-evidencia="${String(e.id)}"><span class="tipo">${classeDoCard(e)}</span>${NOME[e.tipo]}${ponto}</button>`;
}

/** Os artefatos que aparecem como card: `explicacao_fitness` vai dentro da tabela da `matriz_fitness` do ticket. */
export const comCard = (p: PaginaDaIssue): Evidencia[] => p.evidencias.filter((e) => e.tipo !== "explicacao_fitness");

function artefatos(p: PaginaDaIssue): string {
  const porTicket = Map.groupBy(comCard(p), (e) => e.ticket);
  const linhas = p.tickets.toReversed().flatMap((t) => {
    const evidencias = porTicket.get(t.id);
    if (!evidencias) return [];
    return [
      `<div class="etapa-artefatos"><div class="etapa-nome">${ETAPA[t.etapa]}<span class="id">T-${String(t.id)}</span></div><div class="cards-art">${evidencias.map(cardDaEvidencia).join("")}</div></div>`,
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
    <nav class="migalha" aria-label="Caminho"><a href="/projects">Projetos</a> › <a href="/projects/${encodeURIComponent(issue.projeto)}">${escapar(issue.projeto)}</a> › I-${String(issue.id)}</nav>
    <h1 class="titulo-issue"><span class="id">I-${String(issue.id)}</span>${titulo}</h1>
    ${trilho(issue.fase, estadoDoTrilho(ativas))}
    <div class="mesa">
      <aside class="lateral">${detalhes(p)}${descricao(descricaoHtml)}${tickets(p)}</aside>
      <div class="principal">${acaoDoAuditor(p, extras)}${artefatos(p)}</div>
    </div>
  </div>`;
}

// ——— caixa ———

/** As execuções do ticket na caixa: modo, resultado, início, duração, custo, erro, log e prompt. */
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
    titulo: `T-${String(id)} · ${ticket.titulo}`,
    meta: `${etapa(ticket.etapa)} · ${STATUS_DO_TICKET[ticket.status]}`,
    corpo: linhas.length
      ? `<div class="rola"><table class="tabela"><thead><tr><th>Execução</th><th>Modo</th><th>Resultado</th><th>Início</th><th class="num">Duração</th><th class="num">Custo</th><th>Erro</th><th></th></tr></thead><tbody>${linhas.join("")}</tbody></table></div>`
      : '<p class="muted">Ainda sem execução.</p>',
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

interface Alterado {
  caminho: string;
  status: string;
  adicionadas: number | null;
  removidas: number | null;
  previsto: string | null;
}

/** Uma lista de `dados`, que o F3 já validou com o schema do tipo. */
const lista = <T>(valor: unknown): T[] => valor as T[];

/** Os critérios de aceite, na caixa e no gate do desenho. */
const tabelaDeCriterios = (e: Evidencia): string =>
  tabela(
    "<th>ID</th><th>Dado</th><th>Quando</th><th>Então</th>",
    lista<{ id: string; dado: string; quando: string; entao: string }>(e.dados.criterios).map(
      (c) =>
        `<tr><td class="mono">${escapar(c.id)}</td><td>${escapar(c.dado)}</td><td>${escapar(c.quando)}</td><td>${escapar(c.entao)}</td></tr>`,
    ),
  );

/** As tabelas dos tipos que o Auditor lê para decidir um gate (F7 §4.5); os demais saem como JSON formatado. */
const TABELAS: Partial<Record<TipoEvidencia, Tabela>> = {
  criterios_aceite: tabelaDeCriterios,
  comprovacao_criterios: (e) =>
    tabela(
      "<th>ID</th><th>Atendido</th><th>Como foi verificado</th><th>Anexos</th>",
      lista<{ id: string; atendido: boolean; comoVerificado: string; arquivos: string[] }>(e.dados.criterios).map(
        (c) =>
          `<tr><td class="mono">${escapar(c.id)}</td>${sim(c.atendido, "sim", "não")}<td>${escapar(c.comoVerificado)}</td><td>${c.arquivos.map((nome) => anexo(e, nome)).join(", ")}</td></tr>`,
      ),
    ),
  relatorio_complexidade: (e) => {
    type Big = { tempo: string; espaco: string } | undefined;
    const bigo = (c: Big) =>
      c ? `<td class="bigo">${escapar(c.tempo)} · ${escapar(c.espaco)}</td>` : '<td class="bigo muted">—</td>';
    return tabela(
      "<th>Fluxo</th><th>Situação</th><th>Antes (tempo · espaço)</th><th>Depois (tempo · espaço)</th>",
      lista<{ nome: string; situacao: string; antes?: Big; depois: Big }>(e.dados.fluxos).map(
        (f) => `<tr><td>${escapar(f.nome)}</td><td>${escapar(f.situacao)}</td>${bigo(f.antes)}${bigo(f.depois)}</tr>`,
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
        const porque = motivo ? ": " + escapar(motivo) : "";
        const previsto =
          a.previsto === null
            ? `<td class="nao-previsto">não previsto${porque}</td>`
            : `<td class="mono">${escapar(a.previsto)}</td>`;
        return `<tr><td class="mono">${escapar(a.caminho)}</td><td>${a.status}</td><td class="num">${linhas}</td>${previsto}</tr>`;
      }),
    );
  },
  matriz_fitness: (e, p) => {
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
          `<tr><td class="mono">${escapar(l.nome)}</td>${resultadoDoComando(l)}<td class="num">${duracao(l.duracaoMs)}</td><td>${escapar(explicacoes.get(l.nome) ?? "—")}</td><td>${anexo(e, l.log)}</td></tr>`,
      ),
    );
  },
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
    meta: [e.tipo, etapaDoTicket.get(e.ticket), `T-${String(e.ticket)}`].filter(Boolean).join(" · "),
    corpo: `<div class="evidencia">${corpo.join("")}</div>`,
    ...(unico && { aba: arquivo(unico), baixar: baixar(unico) }),
  };
}
