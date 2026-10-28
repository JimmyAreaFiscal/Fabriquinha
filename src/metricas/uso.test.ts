// Soma de uso (F6 §3, §10) sobre sessões JSONL no formato que o pi grava: entradas com `type`, `id`,
// `parentId` e `timestamp` ISO; `message.usage` com `cost.total`; e o `details.results[].usage` da extensão
// `subagents` do Auditor, com `cost` já somado e `turns`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { somar } from "./uso.ts";

const SESSAO = "019f7639-8a5d-7794-9dd5-03edad5607ab";

let seq = 0;
const em = (hora: string) => `2026-10-11T${hora}.000Z`;
const entrada = (hora: string, campos: object) =>
  JSON.stringify({ id: `e${String(++seq)}`, parentId: null, timestamp: em(hora), ...campos });
const usage = (input: number, output: number, cacheRead: number, cacheWrite: number, total: number) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  totalTokens: input + output + cacheRead + cacheWrite,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total },
});
const assistente = (hora: string, provider: string, model: string, u: object) =>
  entrada(hora, {
    type: "message",
    message: {
      role: "assistant",
      content: [{ type: "toolCall", id: "c", name: "bash", arguments: {} }],
      api: "x",
      provider,
      model,
      responseModel: null,
      usage: u,
      stopReason: "toolUse",
      timestamp: Date.parse(em(hora)),
    },
  });
const resultado = (hora: string, toolName: string, campos: object = {}) =>
  entrada(hora, {
    type: "message",
    message: { role: "toolResult", toolCallId: "c", toolName, content: [], isError: false, usage: null, ...campos },
  });
const subagente = (model: string | undefined, input: number, cost: number, turns: number) => ({
  agent: "scout",
  task: "procure",
  exitCode: 0,
  output: "ok",
  ...(model === undefined ? {} : { model }),
  usage: { input, output: 1, cacheRead: 2, cacheWrite: 3, cost, turns },
});

/** A soma da janela `[inicio, fim]` no formato das colunas de uso, em ordem de provedor e modelo. */
const linhasDeUso = (linhas: string[], inicio: string, fim: string) =>
  somar(linhas.join("\n"), Date.parse(inicio), Date.parse(fim))
    .map((s) => ({
      provedor: s.provedor,
      modelo: s.modelo,
      chamadas: s.chamadas,
      input: s.input,
      output: s.output,
      cache_read: s.cacheRead,
      cache_write: s.cacheWrite,
      custo: Math.round(s.custo * 1e6) / 1e6,
    }))
    .toSorted((x, y) => x.provedor.localeCompare(y.provedor) || x.modelo.localeCompare(y.modelo));

/**
 * Sessão principal de um ticket com duas execuções: E-1 em [10:00, 10:30] e E-2 em [11:00, 11:30]. Uma entrada antes
 * (cópia de um fork) e outra entre as janelas não contam; a última linha foi cortada quando o pi morreu.
 */
const SESSAO_COMPARTILHADA = () => [
  JSON.stringify({ type: "session", version: 3, id: SESSAO, timestamp: em("10:00:00"), cwd: "/w" }),
  entrada("09:00:00", { type: "model_change", provider: "anthropic", modelId: "claude-sonnet-5" }),
  assistente("09:00:01", "anthropic", "claude-sonnet-5", usage(9000, 9000, 9000, 9000, 9)),
  // E-1
  entrada("10:00:01", { type: "message", message: { role: "user", content: "oi", timestamp: 0 } }),
  assistente("10:01:00", "anthropic", "claude-sonnet-5", usage(100, 20, 1000, 50, 0.5)),
  resultado("10:01:30", "bash"),
  assistente("10:02:00", "openai", "gpt-5", usage(200, 30, 0, 0, 0.25)),
  resultado("10:02:30", "busca", { usage: usage(10, 5, 0, 0, 0.01) }),
  entrada("10:03:00", { type: "compaction", summary: "…", firstKeptEntryId: "e1", tokensBefore: 9 }),
  entrada("10:04:00", {
    type: "compaction",
    summary: "…",
    firstKeptEntryId: "e1",
    tokensBefore: 9,
    usage: usage(40, 4, 0, 0, 0.04),
  }),
  assistente("10:05:00", "anthropic", "claude-sonnet-5", usage(300, 40, 2000, 0, 0.75)),
  resultado("10:06:00", "subagent", {
    details: {
      mode: "parallel",
      results: [subagente("anthropic/claude-haiku-4-5", 500, 0.02, 3), subagente(undefined, 70, 0.03, 2)],
    },
  }),
  resultado("10:06:30", "subagent", { details: { mode: "management", results: [] } }),
  resultado("10:06:40", "subagent", { isError: true }),
  entrada("10:07:00", {
    type: "custom",
    customType: "filechanges",
    data: { arquivo: "x".repeat(200_000) },
    usage: usage(1e6, 1e6, 1e6, 1e6, 1000),
  }),
  entrada("10:07:30", { type: "custom_message", customType: "aviso", content: "…", display: true }),
  // Entre as janelas: de nenhuma execução.
  assistente("10:45:00", "anthropic", "claude-sonnet-5", usage(7000, 7000, 7000, 7000, 7)),
  // E-2: o resumo de ramo vem antes de qualquer assistente da janela e fica com o último assistente da sessão.
  entrada("11:00:00", { type: "branch_summary", fromId: "e3", summary: "…", usage: usage(60, 6, 0, 0, 0.06) }),
  assistente("11:10:00", "openai", "gpt-5", usage(1, 2, 3, 4, 0.001)),
  `{"type":"message","id":"zz","parentId":"e9","timestamp":"${em("11:20:00")}","message":{"role":"assis`,
];

const E1 = [
  {
    provedor: "anthropic",
    modelo: "claude-haiku-4-5",
    chamadas: 3,
    input: 500,
    output: 1,
    cache_read: 2,
    cache_write: 3,
    custo: 0.02,
  },
  // 2 assistentes + o subagente sem modelo (2 turnos), que fica com o último assistente antes dele.
  {
    provedor: "anthropic",
    modelo: "claude-sonnet-5",
    chamadas: 4,
    input: 470,
    output: 61,
    cache_read: 3002,
    cache_write: 53,
    custo: 1.28,
  },
  // assistente + toolResult com usage + compactação com usage.
  {
    provedor: "openai",
    modelo: "gpt-5",
    chamadas: 3,
    input: 250,
    output: 39,
    cache_read: 0,
    cache_write: 0,
    custo: 0.3,
  },
];
const E2 = [
  {
    provedor: "anthropic",
    modelo: "claude-sonnet-5",
    chamadas: 1,
    input: 60,
    output: 6,
    cache_read: 0,
    cache_write: 0,
    custo: 0.06,
  },
  {
    provedor: "openai",
    modelo: "gpt-5",
    chamadas: 1,
    input: 1,
    output: 2,
    cache_read: 3,
    cache_write: 4,
    custo: 0.001,
  },
];

test("soma por provedor e modelo só a janela de cada execução da sessão compartilhada", () => {
  assert.deepEqual(linhasDeUso(SESSAO_COMPARTILHADA(), em("10:00:00"), em("10:30:00")), E1);
  assert.deepEqual(linhasDeUso(SESSAO_COMPARTILHADA(), em("11:00:00"), em("11:30:00")), E2);
  assert.deepEqual(linhasDeUso([], em("10:00:00"), em("10:30:00")), []);
});

test("sem assistente antes, o uso fica com modelo desconhecido; subagente sem provedor ou sem chamada", () => {
  const linhas = [
    entrada("10:00:01", { type: "compaction", summary: "…", usage: usage(1, 1, 1, 1, 0.1) }),
    resultado("10:00:02", "subagent", {
      details: {
        mode: "parallel",
        // O modelo que a extensão grava depois da primeira resposta vem sem provedor; sem turno, não houve chamada.
        results: [subagente("claude-haiku-4-5", 5, 0.2, 1), subagente("anthropic/claude-haiku-4-5", 0, 0, 0)],
      },
    }),
  ];
  assert.deepEqual(linhasDeUso(linhas, em("10:00:00"), em("10:30:00")), [
    {
      provedor: "desconhecido",
      modelo: "claude-haiku-4-5",
      chamadas: 1,
      input: 5,
      output: 1,
      cache_read: 2,
      cache_write: 3,
      custo: 0.2,
    },
    {
      provedor: "desconhecido",
      modelo: "desconhecido",
      chamadas: 1,
      input: 1,
      output: 1,
      cache_read: 1,
      cache_write: 1,
      custo: 0.1,
    },
  ]);
});

test("somar marca semCusto quando alguma parcela do modelo não traz cost.total (CA-13)", () => {
  const sem = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 };
  const texto = (...us: object[]) =>
    us.map((u, i) => assistente(`10:0${String(i)}:00`, "anthropic", "m", u)).join("\n");
  const janela = [Date.parse(em("10:00:00")), Date.parse(em("10:59:00"))] as const;

  const informado = somar(texto(usage(1, 1, 0, 0, 0.5)), ...janela);
  assert.deepEqual([informado[0]?.custo, informado[0]?.semCusto], [0.5, false]);

  const ausente = somar(texto(sem), ...janela);
  assert.deepEqual([ausente[0]?.custo, ausente[0]?.semCusto], [0, true]);

  const parcial = somar(texto(usage(1, 1, 0, 0, 0.5), { ...sem, cost: {} }), ...janela);
  assert.deepEqual([parcial[0]?.custo, parcial[0]?.semCusto], [0.5, true]);
});
