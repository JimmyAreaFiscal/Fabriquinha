// Métricas (F7 §4.4) como funções puras: o período em meses, a página `/metrics` (mês em foco contra a média dos
// meses anteriores do período), a frase do mês do Início e os cards do mês do Projeto. O DOM e a rede ficam em
// metricas-montar.ts. A comparação com a média é feita aqui, sobre a lista de meses do F6 §5.7.
import type { Fase } from "../../../dominio/primitivos.ts";
import type { MetricasIssuePeriodo, MetricasMes } from "../../../metricas/periodo.ts";
import {
  caminhoDaIssue,
  compacto,
  custo,
  duracao,
  escapar,
  FASES,
  NOME_DA_ETAPA,
  plural as pluralDe,
  rotuloIssue,
} from "../render.ts";

// ——— meses (`AAAA-MM`) ———

const indice = (mes: string): number => {
  const [ano = 0, m = 0] = mes.split("-").map(Number);
  return ano * 12 + m - 1;
};

/** O mês de um instante, no fuso local (o do serviço, no servidor; o do navegador, que é a mesma máquina). */
export const mesDe = (d: Date): string => `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** O mês `n` meses depois (ou antes, com `n` negativo). */
export function somarMeses(mes: string, n: number): string {
  const i = indice(mes) + n;
  return `${String(Math.floor(i / 12))}-${String((i % 12) + 1).padStart(2, "0")}`;
}

/** Quantos meses há de `de` a `ate`, inclusive. */
export const contarMeses = (de: string, ate: string): number => indice(ate) - indice(de) + 1;

/** Os meses de `de` a `ate`, inclusive. */
const mesesDe = (de: string, ate: string): string[] =>
  Array.from({ length: contarMeses(de, ate) }, (_, i) => somarMeses(de, i));

/** `outubro`. */
const extenso = (mes: string): string =>
  new Date(Math.floor(indice(mes) / 12), indice(mes) % 12, 1).toLocaleString("pt-BR", { month: "long" });

/** `out/26`. */
export const rotuloMes = (mes: string): string => `${extenso(mes).slice(0, 3)}/${mes.slice(2, 4)}`;

// ——— números ———

const numero = (v: number, casas = 0): string =>
  v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

/** Uma contagem, ou a média de contagens com uma casa. */
const qtd = (v: number): string => numero(v, Number.isInteger(v) ? 0 : 1);

const somaDosTokens = ({ tokens: t }: MetricasMes["consumo"]): number =>
  t.input + t.output + t.cacheRead + t.cacheWrite;

/** A média simples, sem os `null` (mês sem nota fica fora); `null` quando não sobra nada. */
export function media(valores: readonly (number | null)[]): number | null {
  const v = valores.filter((x) => x !== null);
  return v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** A variação do valor contra a média, em %; vazia quando um dos dois falta ou a média é zero. */
export function variacao(atual: number | null, med: number | null): string {
  if (atual === null || med === null || med === 0) return "";
  const p = Math.round(((atual - med) / med) * 100);
  let seta = "=";
  if (p > 0) seta = "▲";
  else if (p < 0) seta = "▼";
  return `<span class="delta" title="contra a média">${seta} ${String(Math.abs(p))}%</span>`;
}

// ——— o que a página mostra ———

export type Metrica = "custo" | "tokens" | "issues" | "tickets" | "prs" | "nota";
export type Coluna =
  | "issue"
  | "titulo"
  | "projeto"
  | "fase"
  | "custo"
  | "tokens"
  | "execucoes"
  | "falhas"
  | "reprovacoes"
  | "duracao"
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
  issues: readonly MetricasIssuePeriodo[];
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

const METRICAS: Record<Metrica, DefMetrica> = {
  custo: {
    nome: "Custo",
    valor: (m) => m.consumo.custo,
    formato: custo,
    eixo: (v) => `$${v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })}`,
    extra: () => "",
  },
  tokens: {
    nome: "Tokens",
    valor: (m) => somaDosTokens(m.consumo),
    formato: compacto,
    eixo: compacto,
    extra: () => "",
    inteiro: true,
  },
  issues: {
    nome: "Issues concluídas",
    valor: (m) => m.issues.concluidas,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.issues.registradas, nome: "registradas" },
    extra: (m) => ` <small>de ${String(m.issues.registradas)} registradas</small>`,
    inteiro: true,
  },
  tickets: {
    nome: "Tickets concluídos",
    valor: (m) => m.tickets.concluidos,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.tickets.criados, nome: "criados" },
    extra: (m) => ` <small>de ${String(m.tickets.criados)} criados</small>`,
    inteiro: true,
  },
  prs: {
    nome: "PRs mergeados",
    valor: (m) => m.prs.mergeados,
    formato: qtd,
    eixo: qtd,
    par: { valor: (m) => m.prs.abertos, nome: "abertos" },
    extra: (m) => ` <small>de ${String(m.prs.abertos)} abertos</small>`,
    inteiro: true,
  },
  nota: {
    nome: "Nota média dos PRs",
    valor: (m) => m.notaPR.media,
    formato: (v) => numero(v, 1),
    eixo: qtd,
    par: { valor: (m) => m.notaPR.notas, nome: "notas dadas" },
    extra: (m) => ` <small>de 5 · ${plural(m.notaPR.notas, "nota", "notas")}</small>`,
    teto: 5,
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
  const maximo = Math.max(...meses.map((m) => m.consumo.custo));
  const botoes = meses.map((m) => {
    const altura = Math.max(3, maximo > 0 ? (m.consumo.custo / maximo) * 42 : 0);
    return `<button type="button" class="mes-btn${m.mes < foco ? " base" : ""}" data-mes="${m.mes}" aria-pressed="${String(m.mes === foco)}" title="${custo(m.consumo.custo)}"><i style="height:${altura.toFixed(1)}px"></i><span>${rotuloMes(m.mes)}</span></button>`;
  });
  return `<div class="regua" role="group" aria-label="Mês em foco">${botoes.join("")}</div>`;
}

// ——— cards ———

function cards(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const { atual, anteriores } = recorte(meses, e.foco);
  const card = (chave: Metrica) => {
    const def = METRICAS[chave];
    const valor = def.valor(atual);
    const med = media(anteriores.map((m) => def.valor(m)));
    const fmt = (v: number | null) => (v === null ? "—" : def.formato(v));
    const comparacao = anteriores.length === 0 ? "sem meses anteriores" : `média ${fmt(med)}`;
    return `<button type="button" class="kpi" data-metrica="${chave}" aria-pressed="${String(e.metrica === chave)}">
      <span class="rotulo">${def.nome}</span><span class="kpi-valor">${fmt(valor)}${def.extra(atual)}</span>
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
export type LinhaDaDica = readonly [cor: string, valor: string, nome: string];

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

type NumerosDaEtapa = MetricasMes["etapas"][number];

const numerosDaEtapa = (n: NumerosDaEtapa) => ({
  custo: n.custo,
  tokens: n.tokens.input + n.tokens.output + n.tokens.cacheRead + n.tokens.cacheWrite,
  execucoes: n.execucoes,
  falhas: n.falhas,
  reprovacoes: n.reprovacoes,
  // A duração média por execução; mês sem execução fica fora da média.
  duracao: n.execucoes > 0 ? n.duracaoMs / n.execucoes : null,
});

function porEtapa(meses: readonly MetricasMes[], e: EstadoDasMetricas): string {
  const { atual, anteriores } = recorte(meses, e.foco);
  const linhas = atual.etapas.map((n) => {
    const a = numerosDaEtapa(n);
    const ms = anteriores.flatMap((m) => m.etapas.filter((x) => x.etapa === n.etapa)).map(numerosDaEtapa);
    const med = (campo: keyof typeof a) => media(ms.map((x) => x[campo]));
    return { etapa: n.etapa, a, med };
  });
  const maximo = Math.max(...linhas.flatMap((l) => [l.a.custo, l.med("custo") ?? 0])) || 1;
  const mm = (v: number | null, f: (x: number) => string) => (v === null ? "—" : f(v));
  const um = (x: number) => numero(x, 1);
  const rotulo = rotuloMes(e.foco);
  const corpo = linhas.map(({ etapa, a, med }) => {
    const mc = med("custo");
    return `<tr><td>${NOME_DA_ETAPA[etapa]}</td>
      <td><div class="barras-cel"><i style="width:${((a.custo / maximo) * 100).toFixed(1)}%;background:var(--foco)"></i><i style="width:${(((mc ?? 0) / maximo) * 100).toFixed(1)}%;background:var(--base)"></i></div></td>
      <td class="num">${custo(a.custo)}</td><td class="num muted">${mm(mc, custo)}</td><td class="num">${variacao(a.custo, mc)}</td>
      <td class="num sep">${compacto(a.tokens)} <span class="muted">/ ${mm(med("tokens"), compacto)}</span></td>
      <td class="num">${String(a.execucoes)} <span class="muted">/ ${mm(med("execucoes"), um)}</span></td>
      <td class="num">${String(a.falhas)} <span class="muted">/ ${mm(med("falhas"), um)}</span></td>
      <td class="num">${String(a.reprovacoes)} <span class="muted">/ ${mm(med("reprovacoes"), um)}</span></td>
      <td class="num">${mm(a.duracao, duracao)} <span class="muted">/ ${mm(med("duracao"), duracao)}</span></td></tr>`;
  });
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>${rotulo} × média</h3><span class="sub">${rotulo} / média dos meses anteriores</span>
    <div class="legenda"><span><i style="background:var(--foco)"></i>${rotulo}</span><span><i style="background:var(--base)"></i>média</span></div></div>
    <div class="rola"><table class="tabela"><thead><tr><th>Etapa</th><th>Custo</th><th class="num">${rotulo}</th><th class="num">média</th><th class="num">Δ</th><th class="num sep">Tokens</th><th class="num">Execuções</th><th class="num">Falhas</th><th class="num">Reprovações</th><th class="num">Duração média</th></tr></thead>
    <tbody>${corpo.join("")}</tbody></table></div></section>`;
}

// ——— por modelo ———

function porModelo(m: MetricasMes): string {
  const rotulo = rotuloMes(m.mes);
  const total = (c: MetricasMes["consumo"]) => somaDosTokens(c);
  const modelos = m.modelos.toSorted((a, b) => b.custo - a.custo || total(b) - total(a));
  const maximo = Math.max(...modelos.map(total)) || 1;
  const itens = modelos.map((x) => {
    const partes = [
      ["cache", x.tokens.cacheRead + x.tokens.cacheWrite, "var(--serie-3)"],
      ["entrada", x.tokens.input, "var(--serie-1)"],
      ["saída", x.tokens.output, "var(--serie-2)"],
    ] as const;
    const trilha = partes
      .filter(([, v]) => v > 0)
      .map(([nome, v, cor]) => `<i style="flex:${String(v)};background:${cor}" title="${nome} ${compacto(v)}"></i>`)
      .join("");
    return `<div class="uso-modelo"><span class="nome">${escapar(x.modelo)}<small>${escapar(x.provedor)}</small></span><span class="vals"><b>${custo(x.custo)}</b><small>${compacto(total(x))}</small></span>
      <div class="trilha" style="width:${((total(x) / maximo) * 100).toFixed(1)}%">${trilha}</div></div>`;
  });
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>${rotulo}</h3><span class="sub">tokens por tipo e custo como o pi calculou</span></div>
    ${
      itens.length > 0
        ? `<div class="legenda modelos-legenda"><span><i style="background:var(--serie-3)"></i>cache</span><span><i style="background:var(--serie-1)"></i>entrada</span><span><i style="background:var(--serie-2)"></i>saída</span></div><div class="modelos">${itens.join("")}</div>`
        : `<p class="muted">Nenhum modelo usado em ${rotulo}.</p>`
    }</section>`;
}

// ——— por issue ———

const NOME_DA_FASE = Object.fromEntries([...FASES, ["concluida", "Concluída"]]) as Record<Fase, string>;
const ORDEM_DA_FASE = Object.keys(NOME_DA_FASE);
const TEXTO: ReadonlySet<Coluna> = new Set(["titulo", "projeto"]);

function valorDaColuna(i: MetricasIssuePeriodo, c: Coluna): string | number | null {
  switch (c) {
    case "issue":
      return i.issue;
    case "titulo":
      return i.titulo ?? "";
    case "projeto":
      return i.projeto;
    case "fase":
      return ORDEM_DA_FASE.indexOf(i.fase);
    case "custo":
      return i.consumo.custo;
    case "tokens":
      return somaDosTokens(i.consumo);
    case "duracao":
      return i.duracaoMs;
    case "nota":
      return i.notaPR;
    default:
      return i[c];
  }
}

/** A ordem depois de um clique no cabeçalho: a mesma coluna inverte; outra começa crescente no texto e na issue. */
export function proximaOrdem(
  [coluna, direcao]: EstadoDasMetricas["ordem"],
  clicada: Coluna,
): EstadoDasMetricas["ordem"] {
  if (coluna === clicada) return [clicada, direcao === 1 ? -1 : 1];
  return [clicada, TEXTO.has(clicada) || clicada === "issue" || clicada === "fase" ? 1 : -1];
}

function ordenar(issues: readonly MetricasIssuePeriodo[], [coluna, direcao]: EstadoDasMetricas["ordem"]) {
  return issues.toSorted((a, b) => {
    const va = valorDaColuna(a, coluna);
    const vb = valorDaColuna(b, coluna);
    const d =
      typeof va === "string" && typeof vb === "string"
        ? va.localeCompare(vb, "pt-BR", { numeric: true })
        : Number(va ?? -1) - Number(vb ?? -1);
    return d * direcao;
  });
}

function tabelaDeIssues(issues: readonly MetricasIssuePeriodo[], e: EstadoDasMetricas): string {
  const todos = e.projeto === "";
  const [coluna, direcao] = e.ordem;
  const aria = direcao < 0 ? "descending" : "ascending";
  const th = (c: Coluna, rotulo: string, num = true) => {
    const sort = coluna === c ? ` aria-sort="${aria}"` : "";
    return `<th class="${num ? "num " : ""}ordenavel"${sort}><button type="button" data-ordem="${c}">${rotulo}</button></th>`;
  };
  const linhas = ordenar(issues, e.ordem).map(
    (i) => `<tr><td><a class="id" href="${caminhoDaIssue(i.projeto, i.issue)}">${rotuloIssue(i.issue)}</a></td>
      <td>${i.titulo === null ? '<span class="muted">sem título</span>' : escapar(i.titulo)}</td>
      ${todos ? `<td class="muted">${escapar(i.projeto)}</td>` : ""}
      <td><span class="pill ${i.fase === "concluida" ? "pill-ok" : "fase"}">${NOME_DA_FASE[i.fase]}</span></td>
      <td class="num">${custo(i.consumo.custo)}</td><td class="num">${compacto(somaDosTokens(i.consumo))}</td>
      <td class="num">${String(i.execucoes)}</td><td class="num">${String(i.falhas)}</td><td class="num">${String(i.reprovacoes)}</td>
      <td class="num">${duracao(i.duracaoMs)}</td><td class="num">${i.notaPR === null ? "—" : String(i.notaPR)}</td></tr>`,
  );
  const soma = (f: (i: MetricasIssuePeriodo) => number) => issues.reduce((t, i) => t + f(i), 0);
  return `<div class="rola"><table class="tabela tabela-issues"><thead><tr>${th("issue", "Issue", false)}${th("titulo", "Título", false)}${todos ? th("projeto", "Projeto", false) : ""}${th("fase", "Fase", false)}${th("custo", "Custo")}${th("tokens", "Tokens")}${th("execucoes", "Execuções")}${th("falhas", "Falhas")}${th("reprovacoes", "Reprovações")}${th("duracao", "Duração")}${th("nota", "Nota do PR")}</tr></thead>
    <tbody>${linhas.join("")}</tbody>
    <tfoot><tr><td colspan="${todos ? "4" : "3"}">${plural(issues.length, "issue", "issues")}</td><td class="num">${custo(soma((i) => i.consumo.custo))}</td><td class="num">${compacto(soma((i) => somaDosTokens(i.consumo)))}</td><td class="num">${String(soma((i) => i.execucoes))}</td><td class="num">${String(soma((i) => i.falhas))}</td><td class="num">${String(soma((i) => i.reprovacoes))}</td><td class="num">${duracao(soma((i) => i.duracaoMs))}</td><td></td></tr></tfoot>
    </table></div>`;
}

function porIssue(issues: readonly MetricasIssuePeriodo[], e: EstadoDasMetricas): string {
  const escopo = e.projeto === "" ? "todos os projetos" : escapar(e.projeto);
  const corpo =
    issues.length > 0 ? tabelaDeIssues(issues, e) : '<p class="muted">Nenhuma issue com execução no período.</p>';
  return `<section class="grafico superficie"><div class="grafico-cabeca"><h3>Issues com execução no período</h3><span class="sub">${rotuloMes(e.de)} a ${rotuloMes(e.ate)} · ${escopo} · clique no cabeçalho para ordenar</span></div>
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
  <div class="titulo-secao"><h2>Por etapa</h2></div>
  ${porEtapa(meses, e)}
  <div class="titulo-secao"><h2>Por modelo</h2></div>
  ${porModelo(atual)}
  <div class="titulo-secao"><h2>Por issue</h2></div>
  ${porIssue(dados.issues, e)}
  <div class="dica" data-dica hidden></div>`;
}

// ——— o mês corrente no Início e no Projeto ———

/** A frase do Início (F7 §4.4): o mês corrente de todos os projetos, com o link para Métricas. */
export function fraseDoMes(m: MetricasMes): string {
  const b = (v: number) => `<b>${String(v)}</b>`;
  const nome = extenso(m.mes);
  return `<p class="frase-mes">${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${m.mes.slice(0, 4)}, todos os projetos: <b>${custo(m.consumo.custo)}</b> · <b>${compacto(somaDosTokens(m.consumo))}</b> tokens · issues ${b(m.issues.registradas)} registradas, ${b(m.issues.concluidas)} concluídas · tickets ${b(m.tickets.criados)} criados, ${b(m.tickets.concluidos)} concluídos · PRs ${b(m.prs.abertos)} abertos, ${b(m.prs.mergeados)} mergeados <a href="/metrics">Métricas →</a></p>`;
}

/** Os 5 cards do Projeto (F7 §4.4): o mês corrente só do projeto. */
export function cardsDoMes(m: MetricasMes): string {
  const t = m.consumo.tokens;
  const card = (rotulo: string, valor: string, sub: string) =>
    `<div class="kpi superficie"><span class="rotulo">${rotulo}</span><span class="kpi-valor">${valor}</span><span class="kpi-sub">${sub}</span></div>`;
  const par = (a: number, b: number) => `${String(a)} <small class="muted">/ ${String(b)}</small>`;
  return `<div class="kpis-mes">
    ${card(`Custo · ${extenso(m.mes)}`, custo(m.consumo.custo), `${plural(m.consumo.chamadas, "chamada", "chamadas")} de LLM`)}
    ${card("Tokens", compacto(somaDosTokens(m.consumo)), `${compacto(t.input)} entrada · ${compacto(t.output)} saída · ${compacto(t.cacheRead + t.cacheWrite)} cache`)}
    ${card("Issues", par(m.issues.registradas, m.issues.concluidas), "registradas / concluídas")}
    ${card("Tickets", par(m.tickets.criados, m.tickets.concluidos), "criados / concluídos")}
    ${card("PRs", par(m.prs.abertos, m.prs.mergeados), "abertos / mergeados")}
  </div>`;
}
