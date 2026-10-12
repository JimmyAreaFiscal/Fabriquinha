// Página do projeto (F7 §4.4) como funções puras: o seletor, a barra com a contagem e os filtros, o trilho de fases
// de cada issue com a sessão ativa e a gaveta de tickets. O DOM e a rede ficam em projeto-montar.ts.
import type { Ticket } from "../../../dominio/agregado.ts";
import type { Id, Modelo } from "../../../dominio/primitivos.ts";
import type { InfoSessao } from "../../../execucao/sessoes.ts";
import type { IssueDoProjeto, ListaDoProjeto } from "../../rotas/projeto.ts";
import { escapar, FASES, GATES, ha, STATUS_DO_TICKET, trilho } from "../render.ts";
import type { ProjetoListado } from "./configuracao.ts";
import { ETAPAS_DO_PROCESSO, MOTIVOS } from "./inicio.ts";
import { caminhoDaIssue, estadoDoTrilho, etapa } from "./issue.ts";

export const caminhoDoProjeto = (nome: string): string => `/projects/${encodeURIComponent(nome)}`;

/** O que o Auditor escolheu na página e vale entre os redesenhos de 5 s. */
export interface Escolhas {
  mostrar: { concluidas: boolean; arquivadas: boolean };
  /** A gaveta que o Auditor abriu ou fechou; as demais seguem o padrão (aberta quando aguarda ou falhou). */
  gavetas: ReadonlyMap<Id, boolean>;
}

/** O projeto de `/projects`: o último visto neste navegador, se ainda existe, ou o primeiro em ordem alfabética. */
export const escolherProjeto = (projetos: readonly ProjetoListado[], ultimo?: string): string | undefined =>
  projetos.find((p) => p.nome === ultimo)?.nome ?? projetos[0]?.nome;

export const SEM_PROJETOS =
  '<div class="cabeca-pagina"><h1>Projetos</h1></div><p class="muted">Nenhum projeto cadastrado ainda. <a class="link" href="/config?novo">Cadastrar um projeto na Configuração</a></p>';

export const projetoNaoEncontrado = (nome: string): string =>
  `<div class="cabeca-pagina"><h1>Projeto não encontrado</h1></div><p class="muted">O projeto ${escapar(nome)} não está cadastrado. <a class="link" href="/projects">Ver os projetos</a></p>`;

const plural = (n: number, um: string, varios: string): string => `${String(n)} ${n === 1 ? um : varios}`;

/** A confirmação do **Arquivar concluídas** (C18): quantas e que nada é apagado. */
export const confirmacaoDeArquivar = (n: number, projeto: string): string =>
  `<dialog class="dialogo" data-dialogo aria-labelledby="titulo-arquivar"><h2 id="titulo-arquivar">Arquivar concluídas</h2><p>${
    n === 1
      ? `1 issue concluída de ${escapar(projeto)} será arquivada. Ela sai desta lista e continua acessível`
      : `${String(n)} issues concluídas de ${escapar(projeto)} serão arquivadas. Elas saem desta lista e continuam acessíveis`
  } em "Mostrar arquivadas". Nada é apagado.</p><form method="dialog" class="dialogo-botoes"><button class="btn">Cancelar</button><button type="button" class="btn btn-perigo-cheio" data-confirmar>Arquivar</button></form></dialog>`;

const dia = (instante: string): string =>
  new Date(instante).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Quando a issue saiu do andamento: arquivada ou concluída. */
function quando(i: IssueDoProjeto): string {
  if (i.arquivadaEm) return `<span>arquivada em ${dia(i.arquivadaEm)}</span>`;
  return i.concluidaEm ? `<span>concluída em ${dia(i.concluidaEm)}</span>` : "";
}

/** A sessão com o estado, há quanto tempo e o link para o chat. */
function sessao(s: InfoSessao, agora: Date): string {
  const [pill, rotulo] =
    s.estado === "rodando"
      ? ["pill-rodando", s.modo === "consulta" ? "Consulta" : "Rodando"]
      : [s.motivo === "falha" ? "pill-falha" : "pill-aguarda", MOTIVOS[s.motivo ?? "conversa"].titulo];
  return `<a class="chat" href="/sessions/${encodeURIComponent(s.sessao)}"><span class="pill ${pill}">${rotulo}</span><span class="muted quando">${ha(s.desde, agora)}</span><span class="ir">chat →</span></a>`;
}

/** A sessão que dá a cor da linha: a que falhou, depois a que aguarda, depois a que roda. */
const prioridade = (s: InfoSessao): number => {
  if (s.motivo === "falha") return 0;
  return s.estado === "aguardando_humano" ? 1 : 2;
};

/** O modelo do ticket: o override (C20) com ★, ou o da etapa no projeto, ou o padrão do pi. */
function modelo(t: Ticket, projeto: ProjetoListado | undefined): string {
  const nome = (m: Modelo): string => escapar(m.provedor + " / " + m.modelo);
  if (t.modelo) {
    return `<span class="modelo override" title="modelo do ticket (override)">${nome(t.modelo)} ★</span>`;
  }
  const m = projeto?.modelos[t.etapa];
  return `<span class="modelo" title="modelo da etapa no projeto">${m ? nome(m) : "padrão do pi"}</span>`;
}

function gaveta(i: IssueDoProjeto, sessoes: readonly InfoSessao[], projeto: ProjetoListado | undefined, agora: Date) {
  const linhas = i.tickets.map((t) => {
    const s = sessoes.find((x) => x.ticket === t.id);
    return `<tr${t.status === "concluido" && !s ? ' class="apagada"' : ""}>
      <td class="etapa-cel">${etapa(t.etapa)}</td>
      <td class="id-cel"><span class="id">T-${String(t.id)}</span></td>
      <td class="titulo-cel">${escapar(t.titulo)}</td>
      <td class="status-cel"><span class="pill st-${t.status}">${STATUS_DO_TICKET[t.status]}</span></td>
      <td class="modelo-cel">${modelo(t, projeto)}</td>
      <td class="sessao-cel">${s ? sessao(s, agora) : ""}</td>
    </tr>`;
  });
  return `<div class="gaveta"><table>${linhas.join("")}</table></div>`;
}

const rotulo = (id: Id): string => "I-" + String(id);

/** O que fica sob o título: `I-n`, tipo, a dependência que bloqueia, o PR, o progresso e quando saiu do andamento. */
function marcas(i: IssueDoProjeto): string {
  const feitos = i.tickets.filter((t) => t.status === "concluido").length;
  const largura = String((100 * feitos) / i.tickets.length);
  const partes = [`<span class="id">${rotulo(i.id)}</span>`];
  if (i.tipo) partes.push(`<span class="tag">${i.tipo}</span>`);
  if (i.bloqueadaPor.length > 0) {
    partes.push(`<span class="bloqueia">bloqueada por ${i.bloqueadaPor.map(rotulo).join(", ")}</span>`);
  }
  if (i.pr) {
    partes.push(`<a class="pr" href="${escapar(i.pr.url)}" target="_blank" rel="noopener">PR #${escapar(i.pr.id)}</a>`);
  }
  partes.push(
    `<span class="progresso" title="tickets concluídos">${String(feitos)}/${String(i.tickets.length)}<span class="trilho-p"><i style="width:${largura}%"></i></span></span>`,
    quando(i),
  );
  return partes.join("");
}

/** Uma linha por issue: título e marcas, o trilho com a cor do estado, a sessão ativa e a gaveta dos tickets. */
function linha(
  i: IssueDoProjeto,
  todas: readonly InfoSessao[],
  projeto: ProjetoListado | undefined,
  { gavetas }: Escolhas,
  agora: Date,
): string {
  const sessoes = todas.filter((s) => s.issue === i.id);
  const estado = estadoDoTrilho(sessoes);
  const aberta = gavetas.get(i.id) ?? (estado === "aguarda" || estado === "falha");
  const [destaque] = sessoes.toSorted((a, b) => prioridade(a) - prioridade(b));
  const id = rotulo(i.id);
  const classes = ["pista-item", estado, !aberta && "fechada", i.fase === "concluida" && "apagada"];
  return `<div class="${classes.filter(Boolean).join(" ")}" data-issue="${String(i.id)}">
    <div class="pista-linha" data-gaveta>
      <div class="pista-issue"><button type="button" class="caret" aria-expanded="${String(aberta)}" aria-label="Tickets de ${id}">▼</button><div class="texto">
        <a class="titulo${i.titulo === null ? " sem" : ""}" href="${caminhoDaIssue(i.projeto, i.id)}">${escapar(i.titulo ?? "sem título")}</a>
        <span class="sub">${marcas(i)}</span>
      </div></div>
      ${trilho(i.fase, estado)}
      <div class="pista-estado">${destaque ? sessao(destaque, agora) : ""}</div>
    </div>
    ${gaveta(i, sessoes, projeto, agora)}
  </div>`;
}

/** O cabeçalho das colunas do trilho: as 5 etapas sobre as 8 fases, as de gate em âmbar. */
function cabeca(): string {
  const etapas = ETAPAS_DO_PROCESSO.map(
    ([nome, fases]) => `<div class="pista-etapa" style="grid-column: span ${String(fases)}">${nome}</div>`,
  );
  const fases = FASES.map(([f, nome]) => {
    const classe = GATES.has(f) ? "pista-fase gate" : "pista-fase";
    return `<div class="${classe}">${nome}</div>`;
  });
  return `<div class="pista-cabeca" aria-hidden="true"><div></div>${etapas.join("")}<div></div><div></div>${fases.join("")}<div></div></div>`;
}

/** A página `/projects/:projeto`. */
export function paginaDoProjeto(
  projetos: readonly ProjetoListado[],
  nome: string,
  { issues, sessoes, contagem }: ListaDoProjeto,
  escolhas: Escolhas,
  agora: Date,
): string {
  const projeto = projetos.find((p) => p.nome === nome);
  const opcoes = projetos
    .map((p) => `<option${p.nome === nome ? " selected" : ""}>${escapar(p.nome)}</option>`)
    .join("");
  const alternar = (chave: keyof Escolhas["mostrar"], rotulo: string) =>
    `<label class="alternar"><input type="checkbox" data-mostrar="${chave}"${escolhas.mostrar[chave] ? " checked" : ""}> ${rotulo}</label>`;
  return `<div class="seletor-linha">
    <h1>Projeto</h1>
    <select class="seletor" aria-label="Projeto" data-projeto>${opcoes}</select>
    <a class="editar" href="/config?projeto=${encodeURIComponent(nome)}">Editar na Configuração</a>
    <div class="acoes"><button type="button" class="btn btn-primario" data-registrar>+ Registrar necessidade</button></div>
  </div>
  <div class="ferramentas">
    <span class="contagem">${String(contagem.andamento)} em andamento · ${plural(contagem.concluidas, "concluída", "concluídas")} · ${plural(contagem.arquivadas, "arquivada", "arquivadas")}</span>
    ${alternar("concluidas", "Mostrar concluídas")}
    ${alternar("arquivadas", "Mostrar arquivadas")}
    <button type="button" class="btn btn-perigo direita" data-arquivar${contagem.concluidas === 0 ? " disabled" : ""}>Arquivar concluídas</button>
  </div>
  ${confirmacaoDeArquivar(contagem.concluidas, nome)}
  ${
    issues.length > 0
      ? `<div class="pista-rola"><div class="pista">${cabeca()}${issues.map((i) => linha(i, sessoes, projeto, escolhas, agora)).join("")}</div></div>`
      : '<p class="vazio">Nenhuma issue.</p>'
  }`;
}
