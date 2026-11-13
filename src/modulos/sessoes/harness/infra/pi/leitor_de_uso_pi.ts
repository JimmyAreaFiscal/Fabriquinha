// Leitura do Uso de uma sessão do pi (F6 §3): soma, por provedor e modelo, as entradas da sessão que caem na janela
// do Trabalho.

import type { LinhaDeUso } from "../../nucleo/uso.ts";

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

/** O nome do modelo como `provedor/modelo`, a chave de `LinhaDeUso.modelo`. */
const nomeDoModelo = ({ provedor, modelo }: Modelo): string => `${provedor}/${modelo}`;

/**
 * Soma por provedor + modelo as entradas que o `/session` do pi soma (`getSessionStats`) mais o uso dos subagentes,
 * só as de `timestamp` dentro de `[inicio, fim]` (F6 §3.1, §3.2). O uso sem modelo próprio fica com o último
 * assistente da sessão, mesmo que ele esteja fora da janela. Se alguma parcela do modelo não traz `cost.total`, o custo
 * dele é desconhecido (`null`), não zero.
 */
export function lerUsoDoPi(jsonl: string, inicio: number, fim: number): LinhaDeUso[] {
  const linhas = new Map<string, LinhaDeUso>();
  let ultimo: Modelo = { provedor: DESCONHECIDO, modelo: DESCONHECIDO };
  for (const linha of jsonl.split("\n")) {
    const e = lerLinha(linha);
    if (!e) continue;
    const m = e.type === "message" ? e.message : undefined;
    if (m?.role === "assistant") ultimo = { provedor: String(m.provider), modelo: String(m.model) };
    const t = Date.parse(String(e.timestamp));
    if (!(t >= inicio && t <= fim)) continue;
    for (const { dono, chamadas, uso, custo } of parcelas(e, m, ultimo)) {
      const chave = nomeDoModelo(dono);
      const l = linhas.get(chave) ?? {
        modelo: chave,
        tokens_entrada: 0,
        tokens_saida: 0,
        tokens_cache_leitura: 0,
        tokens_cache_escrita: 0,
        custo: 0,
        chamadas: 0,
      };
      linhas.set(chave, {
        ...l,
        tokens_entrada: l.tokens_entrada + uso.input,
        tokens_saida: l.tokens_saida + uso.output,
        tokens_cache_leitura: l.tokens_cache_leitura + uso.cacheRead,
        tokens_cache_escrita: l.tokens_cache_escrita + uso.cacheWrite,
        custo: l.custo === null || custo === undefined ? null : l.custo + custo,
        chamadas: l.chamadas + chamadas,
      });
    }
  }
  return [...linhas.values()];
}
