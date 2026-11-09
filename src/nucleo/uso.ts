// Uso de tokens e custo por execução (F6 §3): soma, por provedor e modelo, as entradas da sessão do pi que caem na
// janela da execução.

/** O `usage` das mensagens, compactações e resumos de ramo do pi. */
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost?: { total?: number };
}

/** O `usage` de cada subagente da extensão `subagents` (P1 §2.2): `cost` já é o total, e `turns` conta as chamadas. */
interface UsoSubagente extends Omit<Usage, "cost"> {
  cost: number;
  turns: number;
}

/** Os campos de uma linha da sessão do pi que a coleta lê. */
interface Entrada {
  type?: string;
  timestamp?: string;
  usage?: Usage | null;
  message?: {
    role?: string;
    provider?: string;
    model?: string;
    toolName?: string;
    usage?: Usage | null;
    details?: { results?: { model?: string; usage: UsoSubagente }[] };
  };
}

interface Modelo {
  provedor: string;
  modelo: string;
}

type Soma = Modelo & {
  chamadas: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  custo: number;
  /** Alguma parcela não trouxe `cost.total`: o custo do modelo é desconhecido, não zero. */
  semCusto: boolean;
};

const DESCONHECIDO = "desconhecido";

/**
 * O modelo de um subagente: `provedor/modelo` como no arquivo do agente, ou só o modelo, que é o que a extensão
 * grava depois da primeira resposta.
 * ponytail: sem provedor no `details`, ele fica `desconhecido`; a extensão teria de gravar o `provider` da resposta.
 */
function doSubagente(modelo: string): Modelo {
  const barra = modelo.indexOf("/");
  return barra < 0
    ? { provedor: DESCONHECIDO, modelo }
    : { provedor: modelo.slice(0, barra), modelo: modelo.slice(barra + 1) };
}

type Mensagem = NonNullable<Entrada["message"]>;

/** Uma parcela de uso atribuída a um modelo. */
interface Parcela {
  dono: Modelo;
  chamadas: number;
  uso: Omit<Usage, "cost">;
  custo: number | undefined;
}

/** A linha como entrada da sessão, ou `undefined` se não é JSON: a última fica pela metade quando o pi é morto. */
function lerLinha(linha: string): Entrada | undefined {
  try {
    return JSON.parse(linha) as Entrada;
  } catch {
    return undefined;
  }
}

/** O `usage` da própria entrada, nas que o `getSessionStats` do pi soma; `custom` e as demais não têm. */
function usageProprio(e: Entrada, m: Mensagem | undefined): Usage | null | undefined {
  if (m?.role === "assistant" || m?.role === "toolResult") return m.usage;
  return e.type === "compaction" || e.type === "branch_summary" ? e.usage : undefined;
}

/**
 * O que uma entrada da janela soma: o próprio `usage`, no modelo do último assistente, e o de cada subagente
 * (`details.results[].usage`), no modelo dele quando vier.
 */
function parcelas(e: Entrada, m: Mensagem | undefined, ultimo: Modelo): Parcela[] {
  const u = usageProprio(e, m);
  const lista: Parcela[] = u ? [{ dono: ultimo, chamadas: 1, uso: u, custo: u.cost?.total }] : [];
  if (m?.role !== "toolResult" || m.toolName !== "subagent") return lista;
  for (const r of m.details?.results ?? []) {
    if (r.usage.turns === 0) continue; // o subagente não chegou a chamar o modelo
    lista.push({
      dono: r.model ? doSubagente(r.model) : ultimo,
      chamadas: r.usage.turns,
      uso: r.usage,
      custo: r.usage.cost,
    });
  }
  return lista;
}

/**
 * Soma por provedor + modelo as entradas que o `/session` do pi soma (`getSessionStats`) mais o uso dos subagentes,
 * só as de `timestamp` dentro de `[inicio, fim]` (F6 §3.1, §3.2). O uso sem modelo próprio fica com o último
 * assistente da sessão, mesmo que ele esteja fora da janela.
 */
export function somar(texto: string, inicio: number, fim: number): Soma[] {
  const somas = new Map<string, Soma>();
  let ultimo: Modelo = { provedor: DESCONHECIDO, modelo: DESCONHECIDO };
  for (const linha of texto.split("\n")) {
    const e = lerLinha(linha);
    if (!e) continue;
    const m = e.type === "message" ? e.message : undefined;
    if (m?.role === "assistant") ultimo = { provedor: String(m.provider), modelo: String(m.model) };
    const t = Date.parse(String(e.timestamp));
    if (!(t >= inicio && t <= fim)) continue;
    for (const { dono, chamadas, uso, custo } of parcelas(e, m, ultimo)) {
      const chave = JSON.stringify([dono.provedor, dono.modelo]);
      const s = somas.get(chave) ?? {
        ...dono,
        chamadas: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        custo: 0,
        semCusto: false,
      };
      somas.set(chave, {
        ...s,
        chamadas: s.chamadas + chamadas,
        input: s.input + uso.input,
        output: s.output + uso.output,
        cacheRead: s.cacheRead + uso.cacheRead,
        cacheWrite: s.cacheWrite + uso.cacheWrite,
        custo: s.custo + (custo ?? 0),
        semCusto: s.semCusto || custo === undefined,
      });
    }
  }
  return [...somas.values()];
}

/**
 * O Uso de um modelo: tokens, chamadas e o custo, `null` quando desconhecido (D10), nunca 0.
 * @testes o chamador de produção (o leitor do pi e a avaliação) entra no I-278.T2; a marca sai com ele
 */
export interface LinhaDeUso {
  modelo: string;
  tokens_entrada: number;
  tokens_saida: number;
  tokens_cache_leitura: number;
  tokens_cache_escrita: number;
  custo: number | null;
  chamadas: number;
}

/** Soma dois custos: o desconhecido some diante do conhecido (o total vira piso, avisado por `trabalhosSemCusto`). */
function somarCustos(a: number | null, b: number | null): number | null {
  return a === null || b === null ? (a ?? b) : a + b;
}

function somarLinha(a: LinhaDeUso, b: LinhaDeUso): LinhaDeUso {
  return {
    modelo: a.modelo,
    tokens_entrada: a.tokens_entrada + b.tokens_entrada,
    tokens_saida: a.tokens_saida + b.tokens_saida,
    tokens_cache_leitura: a.tokens_cache_leitura + b.tokens_cache_leitura,
    tokens_cache_escrita: a.tokens_cache_escrita + b.tokens_cache_escrita,
    custo: somarCustos(a.custo, b.custo),
    chamadas: a.chamadas + b.chamadas,
  };
}

/**
 * O consumo de qualquer Trabalho Agêntico, agrupado por modelo, e quantos Trabalhos não trouxeram custo.
 * @testes o chamador de produção (o leitor do pi e a avaliação) entra no I-278.T2; a marca sai com ele
 */
export class Uso {
  readonly #linhas: ReadonlyMap<string, LinhaDeUso>;
  readonly #trabalhosSemCusto: number;

  private constructor(linhas: ReadonlyMap<string, LinhaDeUso>, trabalhosSemCusto: number) {
    this.#linhas = linhas;
    this.#trabalhosSemCusto = trabalhosSemCusto;
  }

  static vazio(): Uso {
    return new Uso(new Map(), 0);
  }

  /**
   * O Uso de `trabalhos` Trabalhos que produziram `linhas`: se alguma linha tem custo desconhecido, todos eles contam
   * como sem custo. Quem mede mais de um Trabalho com custos diferentes soma um `de` por Trabalho.
   * @throws RangeError se algum custo for negativo.
   */
  static de(linhas: readonly LinhaDeUso[], trabalhos: number): Uso {
    const porModelo = new Map<string, LinhaDeUso>();
    for (const linha of linhas) {
      if (linha.custo !== null && linha.custo < 0) throw new RangeError(`custo negativo para ${linha.modelo}`);
      const anterior = porModelo.get(linha.modelo);
      porModelo.set(linha.modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(porModelo, linhas.some((linha) => linha.custo === null) ? trabalhos : 0);
  }

  somar(outro: Uso): Uso {
    const porModelo = new Map(this.#linhas);
    for (const [modelo, linha] of outro.#linhas) {
      const anterior = porModelo.get(modelo);
      porModelo.set(modelo, anterior ? somarLinha(anterior, linha) : linha);
    }
    return new Uso(porModelo, this.#trabalhosSemCusto + outro.#trabalhosSemCusto);
  }

  /** As linhas em ordem de modelo. */
  porModelo(): LinhaDeUso[] {
    return [...this.#linhas.values()].toSorted((a, b) => a.modelo.localeCompare(b.modelo));
  }

  /** O custo conhecido (piso do total quando `trabalhosSemCusto > 0`) e quantos Trabalhos não trouxeram custo. */
  custo(): { conhecido: number; trabalhosSemCusto: number } {
    let conhecido = 0;
    for (const { custo } of this.#linhas.values()) conhecido += custo ?? 0;
    return { conhecido, trabalhosSemCusto: this.#trabalhosSemCusto };
  }
}
