// Uso de tokens e custo por execução (F6 §3): soma, por provedor e modelo, as entradas da sessão do pi que caem na
// janela da execução e regrava as linhas de `uso` dela.
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { escrever, raizDo } from "../persistencia/banco.ts";
import { anotar, arquivoDaSessao, logDaExecucao, noLog } from "../persistencia/execucoes.ts";

/** O `usage` das mensagens, compactações e resumos de ramo do pi. */
interface Usage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: { total: number };
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
  custo: number;
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
  const lista: Parcela[] = u ? [{ dono: ultimo, chamadas: 1, uso: u, custo: u.cost.total }] : [];
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
function somar(texto: string, inicio: number, fim: number): Soma[] {
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
      };
      somas.set(chave, {
        ...s,
        chamadas: s.chamadas + chamadas,
        input: s.input + uso.input,
        output: s.output + uso.output,
        cacheRead: s.cacheRead + uso.cacheRead,
        cacheWrite: s.cacheWrite + uso.cacheWrite,
        custo: s.custo + custo,
      });
    }
  }
  return [...somas.values()];
}

/**
 * F6 §3.3: regrava as linhas de `uso` da execução terminada com a soma da sua janela na sessão do pi. Idempotente.
 * Sessão inexistente deixa a execução sem linhas.
 * ponytail: lê o arquivo inteiro na memória; sessões têm poucos MB. Passar a `readline` se alguma passar de centenas.
 */
export function coletarUso(banco: DatabaseSync, execucao: Id): void {
  const e = banco.prepare("SELECT sessao_pi, iniciada_em, terminada_em FROM execucao WHERE id = ?").get(execucao);
  if (!e) throw new ErroDeInexistente(`a execução E-${String(execucao)} não existe`, "confira o número da execução");
  if (e.terminada_em === null) {
    throw new ErroDeRegra(`a E-${String(execucao)} ainda está em andamento`, "colete o uso depois do C6");
  }
  const arquivo = arquivoDaSessao(raizDo(banco), String(e.sessao_pi));
  const somas = arquivo
    ? somar(readFileSync(arquivo, "utf8"), Date.parse(String(e.iniciada_em)), Date.parse(String(e.terminada_em)))
    : [];
  escrever(banco, () => {
    banco.prepare("DELETE FROM uso WHERE execucao = ?").run(execucao);
    const inserir = banco.prepare("INSERT INTO uso VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    for (const s of somas) {
      inserir.run(execucao, s.provedor, s.modelo, s.chamadas, s.input, s.output, s.cacheRead, s.cacheWrite, s.custo);
    }
  });
}

/**
 * F4 §6.2: chamado depois de cada C6, inclusive no reinício. Coleta o uso, e uma falha só vai para o log da execução
 * (ou para o stderr do serviço, se nem o diretório dela existe): métrica nunca para o fluxo, e o relatório recoleta.
 */
export function depoisDoC6(banco: DatabaseSync, execucao: Id): void {
  try {
    coletarUso(banco, execucao);
  } catch (error_) {
    const texto = `coleta de uso falhou: ${String(error_)}`;
    try {
      anotar(logDaExecucao(raizDo(banco), execucao), texto);
    } catch {
      noLog(`E-${String(execucao)}: ${texto}`);
    }
  }
}
