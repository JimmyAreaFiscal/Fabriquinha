// Métricas (F7 §4.4) como funções puras: o período em meses, a página `/metrics` (mês em foco contra a média dos
// meses anteriores do período, com uma seção por Etapa e as Métricas de Sucesso dela), a frase do mês do Início e os
// cards do mês do Projeto. O DOM e a rede ficam em metricas-montar.ts. A comparação com a média é feita aqui, sobre a
// lista de meses lida das tabelas da demanda.
import type { EstadoDemanda } from "../../../sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import type { EtapaTicket } from "../../../etapas/catalogo.ts";
import type { TipoMetrica } from "../../../etapas/definicao/tipos_declaraveis.ts";
import type { LinhaDeUso } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/uso.ts";
import type { MetricasDasDemandas, MetricasDoMes, ValorDaMetricaDoTipo } from "../../contrato/metricas.ts";
import {
  caminhoDaDemanda,
  compacto,
  custo,
  duracao,
  escapar,
  APARENCIA_DO_ESTADO_DA_DEMANDA,
  plural as pluralDe,
} from "../render.ts";
import { pilula } from "./demandas.ts";

type MetricasMes = MetricasDoMes;
type MetricasDaEtapa = MetricasMes["etapas"][number];
type Nivel = MetricasMes["niveis"][number]["nivel"];
type MetricasDaDemandaNoPeriodo = MetricasDasDemandas["demandas"][number];

// ——— meses (`AAAA-MM`) ———

const indice = (mes: string): number => {
  const [ano = 0, m = 0] = mes.split("-").map(Number);
  return ano * 12 + m - 1;
};

const FORMATO_DO_MES = new Intl.DateTimeFormat("pt-BR", { year: "numeric", month: "2-digit" });

/** O mês de um instante (milissegundos), no fuso do navegador. */
export const mesDe = (instante: number): string => {
  const partes = Object.fromEntries(FORMATO_DO_MES.formatToParts(instante).map((p) => [p.type, p.value]));
  return `${String(partes.year)}-${String(partes.month)}`;
};

/** O mês `n` meses depois (ou antes, com `n` negativo). */
/** @testes função pura da tela, testada sem montar o DOM */
export function somarMeses(mes: string, n: number): string {
  const i = indice(mes) + n;
  return `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Quantos meses há de `de` a `ate`, inclusive. */
/** @testes função pura da tela, testada sem montar o DOM */
export const contarMeses = (de: string, ate: string): number => indice(ate) - indice(de) + 1;

/** Os meses de `de` a `ate`, inclusive. */
const mesesDe = (de: string, ate: string): string[] =>
  Array.from({ length: contarMeses(de, ate) }, (_, i) => somarMeses(de, i));

/** `outubro`. */
const FORMATO_DO_MES_POR_EXTENSO = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" });
const extenso = (mes: string): string => FORMATO_DO_MES_POR_EXTENSO.format(Date.UTC(0, indice(mes) % 12, 1));

/** `out/26`. */
/** @testes função pura da tela, testada sem montar o DOM */
export const rotuloMes = (mes: string): string => `${extenso(mes).slice(0, 3)}/${mes.slice(2, 4)}`;

// ——— números ———

const numero = (v: number, casas = 0): string =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Uma contagem, ou a média de contagens com uma casa. */
const qtd = (v: number): string => numero(v, Number.isInteger(v) ? 0 : 1);

/** A média simples, sem os `null` (mês sem nota fica fora); `null` quando não sobra nada. */
/** @testes função pura da tela, testada sem montar o DOM */
export function media(valores: readonly (number | null)[]): number | null {
  const v = valores.filter((x) => x !== null);
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** A variação do valor contra a média, em %; vazia quando um dos dois falta ou a média é zero. */
/** @testes função pura da tela, testada sem montar o DOM */
export function variacao(atual: number | null, med: number | null): string {
  if (atual === null || med === null || med === 0) return "";
  const p = Math.round(((atual - med) / med) * 100);
  let seta = "=";
  if (p > 0) seta = "▲";
  else if (p < 0) seta = "▼";
  return `<span class="delta" title="contra a média">${seta} ${String(Math.abs(p))}%</span>`;
}

// ——— o que a página mostra ———

export type Metrica = "custo" | "tokens" | "demandas" | "tickets" | "prs" | "nota" | "alteracoes";
export type Coluna =
  | "demanda"
  | "titulo"
  | "projeto"
  | "estado"
  | "custo"
  | "tokens"
  | "execucoes"
  | "falhas"
  | "reprovacoes"
  | "duracao"
  | "conformidade"
  | "nota";

/** O que o Auditor escolheu na página. `projeto` vazio é "todos". */
export interface EstadoDasMetricas {
  projeto: string;
  de: string;
  ate: string;
  foco: string;
  metrica: Metrica;
  ordem: readonly [Coluna, 1 | -1];
  tabela: boolean;
}

export interface DadosDasMetricas {
  projetos: readonly string[];
  /** Um por mês de `de` a `ate` (`GET /api/metricas`). */
  meses: readonly MetricasMes[];
  demandas: readonly MetricasDaDemandaNoPeriodo[];
  /** O Uso somado das `demandas`, com a conformidade e a nota do período, que o servidor entrega para o rodapé da tabela. */
  totalDasDemandas: MetricasDasDemandas["total"];
  /** O mês corrente: o último que os filtros oferecem. */
  atual: string;
}

/** O mês em foco depois de trocar um filtro: o mesmo, se o período ainda o contém; senão, o último mês dele. */
export const focoNoPeriodo = ({ de, ate, foco }: Pick<EstadoDasMetricas, "de" | "ate" | "foco">): string =>
  foco >= de && foco <= ate ? foco : ate;

/** O período padrão (F7 §4.2): os 11 meses anteriores mais o corrente, com o foco no corrente. */
export function periodoPadrao(atual: string): Pick<EstadoDasMetricas, "de" | "ate" | "foco"> {
  return { de: somarMeses(atual, -11), ate: atual, foco: atual };
}

interface DefMetrica {
  nome: string;
  valor(m: MetricasMes): number | null;
  formato(v: number): string;
  eixo(v: number): string;
  /** O número que acompanha o valor (as registradas das concluídas), com o nome dele. */
  par?: { valor(m: MetricasMes): number; nome: string };
  /** O complemento do valor no card. */
  extra(m: MetricasMes): string;
  /** O teto do eixo, quando a escala é fixa (a nota, de 1 a 5). */
  teto?: number;
  /** Contagem: o eixo anda de inteiro em inteiro. */
  inteiro?: boolean;
}

const plural = (n: number, um: string, varios: string): string => pluralDe(n, um, varios, qtd);

/** O valor da Métrica de `tipo` no mês: a nota humana e as alterações posteriores são de uma só Etapa cada. */
const valorNoMes = <Tipo extends TipoMetrica>(m: MetricasMes, tipo: Tipo): ValorDaMetricaDoTipo<Tipo> =>
  m.etapas.flatMap((e) => e.metricas).find((x) => x.definicao.tipo === tipo)?.valor as ValorDaMetricaDoTipo<Tipo>;
const notaDoMes = (m: MetricasMes) => valorNoMes(m, "nota_humana");
const alteracoesDoMes = (m: MetricasMes) => valorNoMes(m, "alteracoes_posteriores");

const METRICAS: Record<Metrica, DefMetrica> = {
  custo: {
    nome: "Custo",
    valor: (m) => m.total.custo.conhecido,
    formato: custo,
    eixo: (v) => `$${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`,
    extra: () => "",
  },
  tokens: {
    nome: "Tokens",
    valor: (m) => m.total.tokens.total,
    formato: compacto,
    eixo: compacto,
    extra: () => "",
    inteiro: true,
  },
  demandas: {
    nome: "Demandas concluídas",
    valor: (m) => m.demandas.concluidas,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.demandas.registradas, nome: "registradas" },
    extra: (m) => ` <small>de ${qtd(m.demandas.registradas)} registradas</small>`,
    inteiro: true,
  },
  tickets: {
    nome: "Tickets concluídos",
    valor: (m) => m.tickets.concluidos,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.tickets.criados, nome: "criados" },
    extra: (m) => ` <small>de ${qtd(m.tickets.criados)} criados</small>`,
    inteiro: true,
  },
  prs: {
    nome: "PRs mergeados",
    valor: (m) => m.prs.mergeados,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.prs.abertos, nome: "abertos" },
    extra: (m) => ` <small>de ${qtd(m.prs.abertos)} abertos</small>`,
    inteiro: true,
  },
  nota: {
    nome: "Nota humana média",
    valor: (m) => notaDoMes(m).media,
    formato: (v) => numero(v, 1),
    eixo: qtd,
    par: { valor: (m) => notaDoMes(m).quantidade, nome: "notas dadas" },
    extra: (m) => ` <small>de 5 · ${plural(notaDoMes(m).quantidade, "nota", "notas")}</small>`,
    teto: 5,
    inteiro: true,
  },
  alteracoes: {
    nome: "Alterações posteriores (linhas)",
    valor: (m) => alteracoesDoMes(m).alteradasPorHumanos,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => alteracoesDoMes(m).adicionadas, nome: "linhas adicionadas" },
    extra: (m) => ` <small>de ${qtd(alteracoesDoMes(m).adicionadas)} adicionadas</small>`,
    inteiro: true,
  },
};

/** O mês do período; fora dele é defeito de quem chama. */
function doPeriodo(meses: readonly MetricasMes[], mes: string): MetricasMes {
  const achado = meses.find((m) => m.mes === mes);
  if (!achado) throw new Error(`${mes} está fora do período`);
  return achado;
}

/** O mês em foco, a posição dele e os meses do período anteriores a ele, que formam a média. */
function recorte(meses: readonly MetricasMes[], foco: string) {
  const anteriores = meses.filter((m) => m.mes < foco);
  return { k: anteriores.length, atual: doPeriodo(meses, foco), anteriores };
}

// ——— filtros e régua ———

function opcoesDeMes(atual: string, escolhido: string, desabilitado: (mes: string) => boolean): string {
  // ponytail: oferece os últimos 36 meses; ampliar quando houver histórico mais antigo que valha comparar.
  return mesesDe(somarMeses(atual, -35), atual)
    .map(
      (m) =>
        `<option value="${m}"${m === escolhido ? " selected" : ""}${desabilitado(m) ? " disabled" : ""}>${rotuloMes(m)}</option>`,
    )
    .join("");
}

/** A frase da comparação (F7 §4.4). */
/** @testes função pura da tela, testada sem montar o DOM */
export function resumo({ de, foco }: Pick<EstadoDasMetricas, "de" | "foco">): string {
  const n = contarMeses(de, foco) - 1;
  if (n === 0) return `<b>${rotuloMes(foco)}</b> é o primeiro mês do período: sem média para comparar`;
  const faixa = n > 1 ? `${rotuloMes(de)} a ${rotuloMes(somarMeses(foco, -1))}` : rotuloMes(de);
  return `comparando <b>${rotuloMes(foco)}</b> com a média de <b>${plural(n, "mês", "meses")}</b> (${faixa})`;
}

function filtros(dados: DadosDasMetricas, e: EstadoDasMetricas): string {
  const projetos = dados.projetos
    .map((p) => `<option value="${escapar(p)}"${p === e.projeto ? " selected" : ""}>${escapar(p)}</option>`)
    .join("");
  const de = opcoesDeMes(dados.atual, e.de, (m) => m > e.ate || contarMeses(m, e.ate) > 24);
  const ate = opcoesDeMes(dados.atual, e.ate, (m) => m < e.de || contarMeses(e.de, m) > 24);
  return `<div class="filtros">
    <label>Projeto <select aria-label="Projeto" data-filtro="projeto"><option value="">Todos os projetos</option>${projetos}</select></label>
    <label>De <select aria-label="De" data-filtro="de">${de}</select></label>
    <label>Até <select aria-label="Até" data-filtro="ate">${ate}</select></label>
    <button type="button" class="limpar" data-padrao>últimos 12 meses</button>
    <span class="resumo">${resumo(e)}</span>
  </div>`;
}

function regua(meses: readonly MetricasMes[], foco: string): string {
  const maximo = Math.max(...meses.map((m) => m.total.custo.conhecido));
  const botoes = meses.map((m) => {
    const altura = Math.max(3, maximo > 0 ? (m.total.custo.conhecido / maximo) * 42 : 0);
    return `<button type="button" class="mes-btn${m.mes < foco ? " base" : ""}" data-mes="${m.mes}" aria-pressed="${String(m.mes === foco)}" title="${m.total.textoDoCusto}"><i style="height:${altura.toFixed(1)}px"></i><span>${rotuloMes(m.mes)}</span></button>`;
  });
  return `<div class="regua" role="group" aria-label="Mês em foco">${botoes.join("")}</div>`;
}

// ——— cards ———

/** O custo do jeito que o servidor o escreve, com o aviso de sessões sem custo (`≥ US$ 4,20 (1 sessão sem custo)`) em destaque. */
function custoEmDestaque(texto: string): string {
  const corte = texto.indexOf(" (");
  return corte < 0 ? texto : `${texto.slice(0, corte)} <small class="sem-custo">${texto.slice(corte + 1)}</small>`;
}

function cards(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const { atual, anteriores } = recorte(meses, e.foco);
  const card = (chave: Metrica) => {
    const def = METRICAS[chave];
    const valor = def.valor(atual);
    const med = media(anteriores.map((m) => def.valor(m)));
    const fmt = (v: number | null) => (v === null ? "—" : def.formato(v));
    const comparacao = anteriores.length === 0 ? "sem meses anteriores" : `média ${fmt(med)}`;
    return `<button type="button" class="kpi" data-metrica="${chave}" aria-pressed="${String(e.metrica === chave)}">
      <span class="rotulo">${def.nome}</span><span class="kpi-valor">${chave === "custo" ? custoEmDestaque(atual.total.textoDoCusto) : fmt(valor)}${def.extra(atual)}</span>
      <span class="kpi-media">${comparacao}${variacao(valor, med)}</span></button>`;
  };
  return `<div class="kpis">${(Object.keys(METRICAS) as Metrica[]).map(card).join("")}</div>`;
}

// ——— evolução ———

/** O passo "redondo" (1, 2 ou 5 × 10ⁿ) para cerca de 4 linhas de grade até `topo`. */
function passo(topo: number): number {
  const bruto = (topo || 1) / 4;
  const p = 10 ** Math.floor(Math.log10(bruto));
  const n = bruto / p;
  if (n <= 2) return 2 * p;
  if (n <= 5) return 5 * p;
  return 10 * p;
}

/** Coluna com o topo arredondado, ancorada na base. */
function coluna(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const f = (v: number) => v.toFixed(1);
  return `M${f(x)},${f(y + h)}V${f(y + r)}Q${f(x)},${f(y)} ${f(x + r)},${f(y)}H${f(x + w - r)}Q${f(x + w)},${f(y)} ${f(x + w)},${f(y + r)}V${f(y + h)}Z`;
}

/** O mês em foco destacado, os da média num tom e os posteriores apagados. */
function corDaColuna(i: number, foco: number): string {
  if (i === foco) return "var(--foco)";
  return i < foco ? "var(--base)" : "var(--resto)";
}

/**
 * Evolução por mês do card escolhido (F7 §4.4): uma coluna por mês, o mês em foco destacado, os meses da média num
 * tom, os posteriores apagados e a linha da média até o mês em foco. Cada mês tem uma área de toque (`.hit`) da
 * altura do gráfico, para a dica e o clique que muda o foco. `largura` é a da área na página, em px.
 */
export function evolucao(meses: readonly MetricasMes[], e: EstadoDasMetricas, largura: number): string {
  const def = METRICAS[e.metrica];
  const { k: kFoco, anteriores } = recorte(meses, e.foco);
  const valores = meses.map((m) => def.valor(m));
  const med = media(anteriores.map((m) => def.valor(m)));
  const W = Math.max(300, Math.round(largura));
  const H = 210;
  const m = { t: 22, r: 8, b: 24, l: 46 };
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const banda = iw / meses.length;
  const topo = def.teto ?? Math.max(...valores.map(Number), med ?? 0);
  const minimo = def.inteiro ? 1 : 0; // contagem anda de inteiro em inteiro
  const p = def.teto ? 1 : Math.max(minimo, passo(topo));
  const linhas = Math.max(1, Math.ceil(topo / p));
  const maximo = p * linhas;
  const y = (v: number) => m.t + ih - (v / maximo) * ih;
  const bw = Math.min(24, banda * 0.62);
  const f = (v: number) => v.toFixed(1);

  let s = `<svg class="barras" viewBox="0 0 ${String(W)} ${String(H)}" role="img" aria-label="Evolução de ${def.nome} por mês">`;
  for (let i = 0; i <= linhas; i++) {
    const yy = f(y(p * i));
    s += `<line x1="${String(m.l)}" x2="${String(W - m.r)}" y1="${yy}" y2="${yy}" stroke="var(--grade)"/><text x="${String(m.l - 8)}" y="${f(y(p * i) + 4)}" text-anchor="end">${def.eixo(p * i)}</text>`;
  }
  meses.forEach((mes, i) => {
    const x = m.l + banda * i;
    const v = valores[i] ?? 0;
    const h = y(0) - y(v);
    const barra =
      h > 0 ? `<path d="${coluna(x + (banda - bw) / 2, y(v), bw, h)}" fill="${corDaColuna(i, kFoco)}"/>` : "";
    s += `<rect class="hit" data-mes="${mes.mes}" x="${f(x)}" y="${String(m.t)}" width="${f(banda)}" height="${String(ih)}"/><g>${barra}</g>`;
    const rotulo = W < 560 && i % 2 === 1 && i !== kFoco ? "" : rotuloMes(mes.mes);
    s += `<text x="${f(x + banda / 2)}" y="${String(H - 6)}" text-anchor="middle"${i === kFoco ? ' class="valor"' : ""}>${rotulo}</text>`;
  });
  if (med !== null) {
    const yy = f(y(med));
    s += `<line x1="${String(m.l)}" x2="${f(m.l + banda * kFoco)}" y1="${yy}" y2="${yy}" stroke="var(--ink)" stroke-width="2" stroke-linecap="round"/>`;
    s += `<text class="rot-media" x="${String(m.l + 4)}" y="${f(y(med) - 6)}">média ${def.formato(med)}</text>`;
  }
  const vFoco = valores[kFoco];
  if (vFoco !== null && vFoco !== undefined) {
    s += `<text class="valor" x="${f(m.l + banda * kFoco + banda / 2)}" y="${f(y(vFoco) - 6)}" text-anchor="middle">${def.formato(vFoco)}</text>`;
  }
  return `${s}<line x1="${String(m.l)}" x2="${String(W - m.r)}" y1="${f(y(0))}" y2="${f(y(0))}" stroke="var(--line)"/></svg>`;
}

/** Uma linha da dica: a cor da marca, o valor e o nome. */
type LinhaDaDica = readonly [cor: string, valor: string, nome: string];

/** A dica de um mês do gráfico: o valor, o par e, no mês em foco, a média dos anteriores. */
export function dica(
  meses: readonly MetricasMes[],
  e: EstadoDasMetricas,
  mes: string,
): { titulo: string; linhas: LinhaDaDica[] } {
  const def = METRICAS[e.metrica];
  const { anteriores } = recorte(meses, e.foco);
  const m = doPeriodo(meses, mes);
  const v = def.valor(m);
  const linhas: LinhaDaDica[] = [["var(--foco)", v === null ? "—" : def.formato(v), def.nome.toLowerCase()]];
  if (def.par) linhas.push(["var(--muted)", qtd(def.par.valor(m)), def.par.nome]);
  const med = media(anteriores.map((x) => def.valor(x)));
  if (m.mes === e.foco && med !== null) linhas.push(["var(--ink)", def.formato(med), "média dos anteriores"]);
  return { titulo: `${rotuloMes(m.mes)} · ${m.mes === e.foco ? "em foco" : "clique para focar"}`, linhas };
}

/** O **ver tabela** do gráfico: os mesmos números, mês a mês. */
/** @testes função pura da tela, testada sem montar o DOM */
export function tabelaDaEvolucao(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const def = METRICAS[e.metrica];
  const linhas = meses.map((m) => {
    const v = def.valor(m);
    const foco = m.mes === e.foco ? ' <span class="muted">· em foco</span>' : "";
    const par = def.par ? `<td class="num">${qtd(def.par.valor(m))}</td>` : "";
    return `<tr><td>${rotuloMes(m.mes)}${foco}</td><td class="num">${v === null ? "—" : def.formato(v)}</td>${par}</tr>`;
  });
  const par = def.par ? `<th class="num">${def.par.nome}</th>` : "";
  return `<div class="rola"><table class="tabela"><thead><tr><th>Mês</th><th class="num">${def.nome}</th>${par}</tr></thead><tbody>${linhas.join("")}</tbody></table></div>`;
}

function blocoDaEvolucao(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const def = METRICAS[e.metrica];
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>${def.nome}</h3><span class="sub">${rotuloMes(e.de)} a ${rotuloMes(e.ate)}</span>
    <div class="legenda"><span><i style="background:var(--foco)"></i>mês em foco</span><span><i style="background:var(--base)"></i>meses da média</span><span><i class="linha" style="background:var(--ink)"></i>média</span></div>
    <button type="button" class="ver" data-tabela>${e.tabela ? "ver gráfico" : "ver tabela"}</button></div>
    <div class="area" data-evolucao>${e.tabela ? tabelaDaEvolucao(meses, e) : ""}</div></section>`;
}

// ——— por etapa ———

/** O título da seção de cada Etapa e como ela trabalha, na ordem do fluxo da demanda. */
const SECOES_DAS_ETAPAS: Record<EtapaTicket, { titulo: string; modo: string; escopo: "Demanda" | "Rodada" }> = {
  entender_e_desenhar: { titulo: "Entender e desenhar", modo: "Não Gerenciado", escopo: "Demanda" },
  planejar: { titulo: "Planejar", modo: "Gerenciado", escopo: "Demanda" },
  implementar: { titulo: "Implementar", modo: "Gerenciado", escopo: "Rodada" },
  revisar_rodada: { titulo: "Revisar rodada", modo: "Gerenciado", escopo: "Rodada" },
  encerrar_rodada: { titulo: "Encerrar rodada", modo: "Gerenciado", escopo: "Rodada" },
  revisar_demanda: { titulo: "Revisar demanda", modo: "Gerenciado", escopo: "Demanda" },
  encerrar_demanda: { titulo: "Encerrar demanda", modo: "Fabriquinha", escopo: "Demanda" },
  resolver_conflito: { titulo: "Resolver conflito", modo: "Gerenciado", escopo: "Demanda" },
  ajustar_resultado: { titulo: "Ajustar Resultado", modo: "Gerenciado (interativo)", escopo: "Rodada" },
};

/** O que a seção mostra de cada Métrica de Sucesso: o número que se compara com a média e o complemento dele. */
interface ApresentacaoDaMetrica<Valor> {
  numero(valor: Valor): number | null;
  formato(numero: number): string;
  detalhe(valor: Valor): string;
}

const APRESENTACAO_DAS_METRICAS: {
  aprovacoes_e_reprovacoes: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"aprovacoes_e_reprovacoes">>;
  conformidade_com_o_plano: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"conformidade_com_o_plano">>;
  alteracoes_posteriores: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"alteracoes_posteriores">>;
  exigencias_de_alteracao: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"exigencias_de_alteracao">>;
  bugs_nos_arquivos_revisados: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"bugs_nos_arquivos_revisados">>;
  nota_humana: ApresentacaoDaMetrica<ValorDaMetricaDoTipo<"nota_humana">>;
} = {
  aprovacoes_e_reprovacoes: {
    numero: (v) => v.reprovacoes,
    formato: qtd,
    detalhe: (v) =>
      `de ${plural(v.aprovacoes + v.reprovacoes, "Gate", "Gates")} · ${plural(v.aprovacoes, "aprovação", "aprovações")}`,
  },
  conformidade_com_o_plano: {
    numero: (v) => (v.percentual === null ? null : v.percentual / 100),
    formato: (v) => numero(v, 2),
    detalhe: (v) => `Jaccard médio · ${plural(v.rodadas.length, "PR", "PRs")}`,
  },
  alteracoes_posteriores: {
    numero: (v) => v.alteradasPorHumanos,
    formato: qtd,
    detalhe: (v) => `de ${qtd(v.adicionadas)} linhas adicionadas`,
  },
  exigencias_de_alteracao: {
    numero: (v) => v.reprovacoes,
    formato: qtd,
    detalhe: (v) => (v.reprovacoes === 1 ? "reprovação" : "reprovações"),
  },
  bugs_nos_arquivos_revisados: {
    numero: (v) => v.alteradasPorHumanos,
    formato: qtd,
    detalhe: () => "linhas alteradas por humanos",
  },
  nota_humana: {
    numero: (v) => v.media,
    formato: (v) => numero(v, 1),
    detalhe: (v) => `de 5 · ${plural(v.quantidade, "nota", "notas")}`,
  },
};

/** O valor da Métrica de `tipo` na Etapa do mês: toda Etapa do catálogo vem em todo mês. */
const valorDaEtapa = (m: MetricasMes, etapa: EtapaTicket, tipo: TipoMetrica): unknown =>
  m.etapas
    .filter((x) => x.etapa === etapa)
    .flatMap((x) => x.metricas)
    .find((x) => x.definicao.tipo === tipo)?.valor;

/** O Uso é a Métrica de todas as Etapas. */
const usoDaEtapa = (etapa: MetricasDaEtapa) =>
  etapa.metricas.find((m) => m.definicao.tipo === "uso") as {
    definicao: MetricasDaEtapa["metricas"][number]["definicao"];
    valor: ValorDaMetricaDoTipo<"uso">;
  };

const tokensDoModelo = (x: LinhaDeUso): number =>
  x.tokens_entrada + x.tokens_saida + x.tokens_cache_leitura + x.tokens_cache_escrita;

/** A comparação do card com a média dos meses anteriores: o texto da média e a variação. */
function comparacaoComAMedia(
  valor: number | null,
  anteriores: readonly (number | null)[],
  formato: (v: number) => string,
): string {
  if (anteriores.length === 0) return "sem meses anteriores";
  const med = media(anteriores);
  return `média ${med === null ? "—" : formato(med)}${variacao(valor, med)}`;
}

function metricaDeSucesso(
  { definicao, valor }: MetricasDaEtapa["metricas"][number],
  etapa: EtapaTicket,
  { anteriores }: ReturnType<typeof recorte>,
): string {
  const apresentacao = APRESENTACAO_DAS_METRICAS[
    definicao.tipo as keyof typeof APRESENTACAO_DAS_METRICAS
  ] as ApresentacaoDaMetrica<unknown>;
  const atual = apresentacao.numero(valor);
  const dosAnteriores = anteriores.map((m) => apresentacao.numero(valorDaEtapa(m, etapa, definicao.tipo)));
  return `<div class="metrica-sucesso"><span class="rotulo">${escapar(definicao.rotulo)}</span>
        <span class="kpi-valor">${atual === null ? "—" : apresentacao.formato(atual)} <small>${apresentacao.detalhe(valor)}</small></span>
        <span class="kpi-media">${comparacaoComAMedia(atual, dosAnteriores, (n) => apresentacao.formato(n))}</span>
        <span class="fonte">${escapar(definicao.fonte)}</span></div>`;
}

/** Uma linha de modelo do Uso: o nome, o provedor, o custo, os tokens e a trilha por tipo, na largura relativa ao maior. */
function linhaDoModelo(x: LinhaDeUso, maximo: number): string {
  const [provedor = "", ...nome] = x.modelo.split("/");
  const rotulo = nome.length > 0 ? `${escapar(nome.join("/"))}<small>${escapar(provedor)}</small>` : escapar(provedor);
  const partes = [
    ["cache", x.tokens_cache_leitura + x.tokens_cache_escrita, "var(--serie-3)"],
    ["entrada", x.tokens_entrada, "var(--serie-1)"],
    ["saída", x.tokens_saida, "var(--serie-2)"],
  ] as const;
  const trilha = partes
    .filter(([, v]) => v > 0)
    .map(
      ([nomeDoTipo, v, cor]) =>
        `<i style="flex:${String(v)};background:${cor}" title="${nomeDoTipo} ${compacto(v)}"></i>`,
    )
    .join("");
  return `<div class="uso-modelo"><span class="nome">${rotulo}</span><span class="vals"><b>${x.custo === null ? "sem custo" : custo(x.custo)}</b><small>${compacto(tokensDoModelo(x))}</small></span>
      <div class="trilha" style="width:${((tokensDoModelo(x) / maximo) * 100).toFixed(1)}%">${trilha}</div></div>`;
}

/** Os modelos do mais caro ao mais barato; o custo desconhecido fica depois dos conhecidos. */
const modelosPorCusto = (modelos: readonly LinhaDeUso[]): LinhaDeUso[] =>
  modelos.toSorted((a, b) => (b.custo ?? -1) - (a.custo ?? -1) || tokensDoModelo(b) - tokensDoModelo(a));

function usoDaSecao(
  etapa: MetricasDaEtapa,
  maximo: number,
  { anteriores }: ReturnType<typeof recorte>,
  rotuloDoMes: string,
): string {
  const { definicao, valor: uso } = usoDaEtapa(etapa);
  const dosAnteriores = anteriores.map(
    (m) => (valorDaEtapa(m, etapa.etapa, "uso") as ValorDaMetricaDoTipo<"uso">).custo.conhecido,
  );
  const sessoes = uso.custoExterno.sessoes;
  const partes = [`${compacto(uso.tokens.total)} tokens`];
  if (sessoes > 0) partes.push(plural(sessoes, "sessão declarada pelo produtor", "sessões declaradas pelo produtor"));
  if (uso.execucoes > 0 || sessoes === 0) {
    partes.push(plural(uso.execucoes, "execução", "execuções"), plural(uso.falhas, "falha", "falhas"));
    if (uso.execucoes > 0) partes.push(`${duracao(uso.duracaoMs / uso.execucoes)} por execução`);
  }
  const modelos =
    uso.modelos.length > 0
      ? modelosPorCusto(uso.modelos)
          .map((x) => linhaDoModelo(x, maximo))
          .join("")
      : `<p class="muted" style="margin:0">Nenhum modelo usado em ${rotuloDoMes}.</p>`;
  return `<div class="uso-etapa"><span class="rotulo">${escapar(definicao.rotulo)}</span>
      <span class="kpi-valor">${custoEmDestaque(uso.textoDoCusto)}</span>
      <span class="kpi-media">${comparacaoComAMedia(uso.custo.conhecido, dosAnteriores, custo)}</span>
      <span class="fonte">${partes.join(" · ")}</span>
      <div class="modelos-etapa">${modelos}</div></div>`;
}

function porEtapa(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const contexto = recorte(meses, e.foco);
  const rotuloDoMes = rotuloMes(e.foco);
  const ordem = Object.keys(SECOES_DAS_ETAPAS);
  const etapas = contexto.atual.etapas.toSorted((a, b) => ordem.indexOf(a.etapa) - ordem.indexOf(b.etapa));
  const maximo = Math.max(1, ...etapas.flatMap((x) => usoDaEtapa(x).valor.modelos.map(tokensDoModelo)));
  const secoes = etapas.map((etapa) => {
    const { titulo, modo, escopo } = SECOES_DAS_ETAPAS[etapa.etapa];
    const deSucesso = etapa.metricas.filter((m) => m.definicao.tipo !== "uso");
    const metricas =
      deSucesso.length > 0
        ? deSucesso.map((m) => metricaDeSucesso(m, etapa.etapa, contexto)).join("")
        : '<p class="muted" style="margin:0">Só Uso: o catálogo não declara outra Métrica.</p>';
    return `<section class="grafico superficie etapa-metricas" aria-label="${titulo}">
    <div class="grafico-cabeca"><h3>${titulo}</h3><span class="sub">${modo} · por ${escopo}</span></div>
    <div class="metricas-sucesso">${metricas}</div>
    ${usoDaSecao(etapa, maximo, contexto, rotuloDoMes)}
  </section>`;
  });
  return `<div class="legenda modelos-legenda"><span><i style="background:var(--serie-3)"></i>cache</span><span><i style="background:var(--serie-1)"></i>entrada</span><span><i style="background:var(--serie-2)"></i>saída</span></div>
  <div class="etapas">${secoes.join("")}</div>`;
}

// ——— por nível ———

const NOME_DO_NIVEL: Record<Nivel, string> = {
  execucao: "Execução",
  sessao: "Sessão",
  ticket: "Ticket",
  rodada: "Rodada",
  demanda: "Demanda",
  projeto: "Projeto",
};

/** Os níveis do agrupamento execução → projeto: cada um soma o mesmo total do mês, e o aviso das sessões sem custo fecha o bloco. */
function porNivel(m: MetricasMes): string {
  const rotulo = rotuloMes(m.mes);
  const linhas = m.niveis.map(
    (n) => `<tr><td>${NOME_DO_NIVEL[n.nivel]}</td><td class="num">${qtd(n.grupos)}</td>
      <td class="num">${qtd(n.total.execucoes)}</td><td class="num">${compacto(n.total.tokens.total)}</td><td class="num">${n.total.textoDoCusto}</td></tr>`,
  );
  const semCusto = m.total.custo.trabalhosSemCusto;
  const aviso =
    semCusto > 0
      ? `\n    <p class="muted">≥: ${plural(semCusto, "sessão sem custo informado", "sessões sem custo informado")}; o custo delas fica fora da soma.</p>`
      : "";
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>${rotulo}</h3><span class="sub">execução → sessão → ticket → rodada → demanda → projeto: a soma de cada nível é o total do mês</span></div>
    <div class="rola"><table class="tabela"><thead><tr><th>Nível</th><th class="num">Grupos</th><th class="num">Execuções</th><th class="num">Tokens</th><th class="num">Custo</th></tr></thead>
    <tbody>${linhas.join("")}</tbody></table></div>${aviso}</section>`;
}

// ——— por modelo ———

function porModelo(m: MetricasMes): string {
  const rotulo = rotuloMes(m.mes);
  const modelos = modelosPorCusto(m.total.modelos);
  const maximo = Math.max(...modelos.map(tokensDoModelo)) || 1;
  const itens = modelos.map((x) => linhaDoModelo(x, maximo));
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>${rotulo}</h3><span class="sub">tokens por tipo e custo como o pi calculou</span></div>
    ${
      itens.length > 0
        ? `<div class="legenda modelos-legenda"><span><i style="background:var(--serie-3)"></i>cache</span><span><i style="background:var(--serie-1)"></i>entrada</span><span><i style="background:var(--serie-2)"></i>saída</span></div><div class="modelos">${itens.join("")}</div>`
        : `<p class="muted">Nenhum modelo usado em ${rotulo}.</p>`
    }</section>`;
}

// ——— por demanda ———

const TEXTO: ReadonlySet<Coluna> = new Set(["titulo", "projeto", "estado"]);

function valorDaColuna(d: MetricasDaDemandaNoPeriodo, c: Coluna): string | number | null {
  switch (c) {
    case "demanda":
      return d.demanda;
    case "titulo":
      return d.titulo;
    case "projeto":
      return d.projeto;
    case "estado": // ordena pelo rótulo que a tela mostra, não pelo valor interno
      return APARENCIA_DO_ESTADO_DA_DEMANDA[d.estado as EstadoDemanda][0];
    case "custo":
      return d.custo.conhecido;
    case "tokens":
      return d.tokens.total;
    case "duracao":
      return d.duracaoMs;
    case "conformidade":
      return d.conformidade;
    case "nota":
      return d.nota;
    default:
      return d[c];
  }
}

/** A ordem depois de um clique no cabeçalho: a mesma coluna inverte; outra começa crescente no texto e na demanda. */
export function proximaOrdem(
  [coluna, direcao]: EstadoDasMetricas["ordem"],
  clicada: Coluna,
): EstadoDasMetricas["ordem"] {
  if (coluna === clicada) return [clicada, direcao === 1 ? -1 : 1];
  return [clicada, TEXTO.has(clicada) || clicada === "demanda" ? 1 : -1];
}

function ordenar(demandas: readonly MetricasDaDemandaNoPeriodo[], [coluna, direcao]: EstadoDasMetricas["ordem"]) {
  return demandas.toSorted((a, b) => {
    const va = valorDaColuna(a, coluna);
    const vb = valorDaColuna(b, coluna);
    const d =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb, "pt-BR", { numeric: true })
        : Number(va ?? -1) - Number(vb ?? -1);
    return d * direcao;
  });
}

/** O Jaccard do plano × arquivos alterados, de 0 a 1 com duas casas. */
const conformidadeEmTexto = (percentual: number | null): string =>
  percentual === null ? "—" : numero(percentual / 100, 2);
const notaEmTexto = (nota: number | null): string => (nota === null ? "—" : numero(nota, 1));

function tabelaDeDemandas(
  { demandas, totalDasDemandas }: Pick<DadosDasMetricas, "demandas" | "totalDasDemandas">,
  e: EstadoDasMetricas,
): string {
  const todos = e.projeto === "";
  const [coluna, direcao] = e.ordem;
  const aria = direcao < 0 ? "descending" : "ascending";
  const th = (c: Coluna, rotulo: string, num = true) => {
    const sort = coluna === c ? ` aria-sort="${aria}"` : "";
    return `<th class="${num ? "num " : ""}ordenavel"${sort}><button type="button" data-ordem="${c}">${rotulo}</button></th>`;
  };
  const linhas = ordenar(demandas, e.ordem).map(
    (d) => `<tr><td><a class="id" href="${caminhoDaDemanda(d.demanda)}">${escapar(d.demanda)}</a></td>
      <td>${escapar(d.titulo)}</td>
      ${todos ? `<td class="muted">${escapar(d.projeto)}</td>` : ""}
      <td>${pilula(APARENCIA_DO_ESTADO_DA_DEMANDA[d.estado as EstadoDemanda])}</td>
      <td class="num">${d.textoDoCusto}</td><td class="num">${compacto(d.tokens.total)}</td>
      <td class="num">${qtd(d.execucoes)}</td><td class="num">${qtd(d.falhas)}</td><td class="num">${qtd(d.reprovacoes)}</td>
      <td class="num">${duracao(d.duracaoMs)}</td><td class="num">${conformidadeEmTexto(d.conformidade)}</td><td class="num">${notaEmTexto(d.nota)}</td></tr>`,
  );
  const soma = (f: (d: MetricasDaDemandaNoPeriodo) => number) => demandas.reduce((t, d) => t + f(d), 0);
  return `<div class="rola"><table class="tabela tabela-demandas"><thead><tr>${th("demanda", "Demanda", false)}${th("titulo", "Título", false)}${todos ? th("projeto", "Projeto", false) : ""}${th("estado", "Fase", false)}${th("custo", "Custo")}${th("tokens", "Tokens")}${th("execucoes", "Execuções")}${th("falhas", "Falhas")}${th("reprovacoes", "Reprovações")}${th("duracao", "Duração")}${th("conformidade", "Conformidade")}${th("nota", "Nota humana")}</tr></thead>
    <tbody>${linhas.join("")}</tbody>
    <tfoot><tr><td colspan="${todos ? "4" : "3"}">${plural(demandas.length, "demanda", "demandas")}</td><td class="num">${totalDasDemandas.textoDoCusto}</td><td class="num">${compacto(totalDasDemandas.tokens.total)}</td><td class="num">${qtd(soma((d) => d.execucoes))}</td><td class="num">${qtd(soma((d) => d.falhas))}</td><td class="num">${qtd(soma((d) => d.reprovacoes))}</td><td class="num">${duracao(soma((d) => d.duracaoMs))}</td><td class="num">${conformidadeEmTexto(totalDasDemandas.conformidade)}</td><td class="num">${notaEmTexto(totalDasDemandas.nota)}</td></tr></tfoot>
    </table></div>`;
}

function porDemanda(dados: Pick<DadosDasMetricas, "demandas" | "totalDasDemandas">, e: EstadoDasMetricas): string {
  const escopo = e.projeto === "" ? "todos os projetos" : escapar(e.projeto);
  const corpo =
    dados.demandas.length > 0
      ? tabelaDeDemandas(dados, e)
      : '<p class="muted">Nenhuma demanda com execução no período.</p>';
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>Demandas com execução no período</h3><span class="sub">${rotuloMes(e.de)} a ${rotuloMes(e.ate)} · ${escopo} · clique no cabeçalho para ordenar · ≥ há sessão sem custo informado · conformidade: Jaccard do plano × arquivos alterados · nota: média do Gate do PR</span></div>
    ${corpo}</section>`;
}

/** A página `/metrics`. O gráfico de evolução entra depois, em `[data-evolucao]`, com a largura medida na página. */
export function paginaDeMetricas(dados: DadosDasMetricas, e: EstadoDasMetricas): string {
  const { meses } = dados;
  const { atual } = recorte(meses, e.foco);
  return `<div class="cabeca-pagina"><h1>Métricas</h1></div>
  ${filtros(dados, e)}
  ${regua(meses, e.foco)}
  <div class="titulo-secao primeiro"><h2>${rotuloMes(e.foco)}</h2><span class="muted">valor do mês, média dos meses anteriores do período e a diferença · clique num card para ver a evolução</span></div>
  ${cards(meses, e)}
  <div class="titulo-secao"><h2>Evolução por mês</h2></div>
  ${blocoDaEvolucao(meses, e)}
  <div class="titulo-secao"><h2>Por etapa</h2><span class="muted">${rotuloMes(e.foco)} · as Métricas de Sucesso de cada Etapa e o Uso, contra a média dos meses anteriores</span></div>
  ${porEtapa(meses, e)}
  <div class="titulo-secao"><h2>Por nível</h2></div>
  ${porNivel(atual)}
  <div class="titulo-secao"><h2>Por modelo</h2></div>
  ${porModelo(atual)}
  <div class="titulo-secao"><h2>Por demanda</h2></div>
  ${porDemanda(dados, e)}
  <div class="dica" data-dica hidden></div>`;
}

// ——— o mês corrente no Início e no Projeto ———

/** A frase do Início (F7 §4.4): o mês corrente de todos os projetos, com as contagens como nas Métricas e o link para elas. */
export function fraseDoMes(m: MetricasMes): string {
  const b = (v: number) => `<b>${qtd(v)}</b>`;
  const nome = extenso(m.mes);
  return `<p class="frase-mes">${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${m.mes.slice(0, 4)}, todos os projetos: <b>${m.total.textoDoCusto}</b> · <b>${compacto(m.total.tokens.total)}</b> tokens · demandas ${b(m.demandas.registradas)} registradas, ${b(m.demandas.concluidas)} concluídas · tickets ${b(m.tickets.criados)} criados, ${b(m.tickets.concluidos)} concluídos · PRs ${b(m.prs.abertos)} abertos, ${b(m.prs.mergeados)} mergeados <a href="/metrics">Métricas →</a></p>`;
}

/** Os 6 cards do Projeto (F7 §4.4): o mês corrente só do projeto. */
export function cardsDoMes(m: MetricasMes): string {
  const t = m.total.tokens;
  const alteracoes = alteracoesDoMes(m);
  const card = (rotulo: string, valor: string, sub: string) =>
    `<div class="kpi superficie"><span class="rotulo">${rotulo}</span><span class="kpi-valor">${valor}</span><span class="kpi-sub">${sub}</span></div>`;
  const par = (a: number, b: number) => `${qtd(a)} <small class="muted">/ ${qtd(b)}</small>`;
  return `<div class="kpis-mes">
    ${card(`Custo · ${extenso(m.mes)}`, m.total.textoDoCusto, plural(m.total.execucoes, "execução", "execuções"))}
    ${card("Tokens", compacto(t.total), `${compacto(t.entrada)} entrada · ${compacto(t.saida)} saída · ${compacto(t.cacheLeitura)} cache lido · ${compacto(t.cacheEscrita)} cache escrito`)}
    ${card("Demandas", par(m.demandas.registradas, m.demandas.concluidas), "registradas / concluídas")}
    ${card("Tickets", par(m.tickets.criados, m.tickets.concluidos), "criados / concluídos")}
    ${card("PRs", par(m.prs.abertos, m.prs.mergeados), "abertos / mergeados")}
    ${card("Alterações posteriores", par(alteracoes.alteradasPorHumanos, alteracoes.adicionadas), "linhas alteradas / adicionadas")}
  </div>`;
}
