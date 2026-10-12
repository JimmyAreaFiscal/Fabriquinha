// Coleta de uso (F6 §3, §10) contra banco real e sessões JSONL no formato que o pi grava: entradas com `type`, `id`,
// `parentId` e `timestamp` ISO; `message.usage` com `cost.total`; e o `details.results[].usage` da extensão
// `subagents` do Auditor, com `cost` já somado e `turns`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { dirDaExecucao } from "../persistencia/execucoes.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { coletarUso, depoisDoC6 } from "./uso.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-uso-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const SESSAO = "019f7639-8a5d-7794-9dd5-03edad5607ab";

/** Banco com a I-1 e o T-1 de desenvolvimento; as execuções vão direto em SQL, já no estado que o teste pede. */
function banco(): { banco: DatabaseSync; raiz: string } {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const b = abrir(raiz);
  registrarProjeto(b, {
    nome: "p",
    repo: "/nao/existe",
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "p" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  b.prepare(
    "INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'p', 'I', 'problema', 'desenvolvimento', ?)",
  ).run("2026-10-11T09:00:00.000Z");
  b.prepare(
    `INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
     VALUES (1, 1, 'desenvolvimento', 'T', 'em_execucao', 'fabriquinha', ?)`,
  ).run("2026-10-11T09:00:00.000Z");
  return { banco: b, raiz };
}

function execucao(b: DatabaseSync, id: number, iniciada: string, terminada: string | null, sessao = SESSAO): void {
  b.prepare(
    `INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
     VALUES (?, 1, 'interativo', ?, ?, NULL, ?, ?)`,
  ).run(id, sessao, terminada === null ? "em_andamento" : "sucesso", iniciada, terminada);
}

/** Grava a sessão como o pi: `<raiz>/sessoes/<timestamp>_<id>.jsonl`. */
function sessao(raiz: string, linhas: string[], nome = `2026-10-11T10-00-00-000Z_${SESSAO}.jsonl`): void {
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  writeFileSync(join(raiz, "sessoes", nome), linhas.join("\n") + "\n");
}

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

const linhasDeUso = (b: DatabaseSync, execucao: number) =>
  b
    .prepare(
      `SELECT provedor, modelo, chamadas, input, output, cache_read, cache_write, round(custo, 6) AS custo
       FROM uso WHERE execucao = ? ORDER BY provedor, modelo`,
    )
    .all(execucao)
    .map((l) => ({ ...l }));

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

test("soma por provedor e modelo só a janela de cada execução da sessão compartilhada, e recoletar dá o mesmo", () => {
  const { banco: b, raiz } = banco();
  execucao(b, 1, em("10:00:00"), em("10:30:00"));
  execucao(b, 2, em("11:00:00"), em("11:30:00"));
  // Outra sessão no diretório não atrapalha.
  sessao(raiz, [assistente("10:01:00", "x", "y", usage(1, 1, 1, 1, 1))], "2026-10-11T10-00-00-000Z_outra.jsonl");
  sessao(raiz, SESSAO_COMPARTILHADA());

  coletarUso(b, 1);
  coletarUso(b, 2);
  assert.deepEqual(linhasDeUso(b, 1), E1);
  assert.deepEqual(linhasDeUso(b, 2), E2);

  // Idempotente: uma linha velha some, e a soma não dobra.
  b.prepare("INSERT INTO uso VALUES (1, 'velho', 'modelo', 1, 1, 1, 1, 1, 1)").run();
  coletarUso(b, 1);
  coletarUso(b, 1);
  assert.deepEqual(linhasDeUso(b, 1), E1);
  assert.deepEqual(linhasDeUso(b, 2), E2);
  b.close();
});

test("sem assistente antes, o uso fica com modelo desconhecido; subagente sem provedor ou sem chamada", () => {
  const { banco: b, raiz } = banco();
  execucao(b, 1, em("10:00:00"), em("10:30:00"));
  sessao(raiz, [
    entrada("10:00:01", { type: "compaction", summary: "…", usage: usage(1, 1, 1, 1, 0.1) }),
    resultado("10:00:02", "subagent", {
      details: {
        mode: "parallel",
        // O modelo que a extensão grava depois da primeira resposta vem sem provedor; sem turno, não houve chamada.
        results: [subagente("claude-haiku-4-5", 5, 0.2, 1), subagente("anthropic/claude-haiku-4-5", 0, 0, 0)],
      },
    }),
  ]);
  coletarUso(b, 1);
  assert.deepEqual(linhasDeUso(b, 1), [
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
  b.close();
});

test("sessão inexistente não é erro: a execução fica sem linhas em uso", () => {
  const { banco: b, raiz } = banco();
  execucao(b, 1, em("10:00:00"), em("10:30:00"));
  b.prepare("INSERT INTO uso VALUES (1, 'velho', 'modelo', 1, 1, 1, 1, 1, 1)").run();
  coletarUso(b, 1); // nem o diretório de sessões existe
  assert.deepEqual(linhasDeUso(b, 1), []);
  sessao(raiz, [], "2026-10-11T10-00-00-000Z_outra.jsonl");
  coletarUso(b, 1);
  assert.deepEqual(linhasDeUso(b, 1), []);
  b.close();
});

test("recusa execução inexistente, em andamento ou com mais de um arquivo de sessão, sem mexer em uso", () => {
  const { banco: b, raiz } = banco();
  execucao(b, 1, em("10:00:00"), em("10:30:00"));
  execucao(b, 2, em("11:00:00"), null, crypto.randomUUID());
  assert.throws(() => {
    coletarUso(b, 9);
  }, /a execução E-9 não existe/);
  assert.throws(() => {
    coletarUso(b, 2);
  }, /a E-2 ainda está em andamento/);

  b.prepare("INSERT INTO uso VALUES (1, 'velho', 'modelo', 1, 1, 1, 1, 1, 1)").run();
  sessao(raiz, SESSAO_COMPARTILHADA());
  sessao(raiz, SESSAO_COMPARTILHADA(), `2026-10-12T10-00-00-000Z_${SESSAO}.jsonl`);
  assert.throws(
    () => {
      coletarUso(b, 1);
    },
    (erro: unknown) => erro instanceof ErroDeRegra && /a sessão .* tem 2 arquivos/.test(erro.message),
  );
  assert.equal(linhasDeUso(b, 1).length, 1);
  b.close();
});

test("depoisDoC6: coleta; uma falha só vai para o log da execução, ou para o stderr se nem o log existe", (t) => {
  const { banco: b, raiz } = banco();
  execucao(b, 1, em("10:00:00"), em("10:30:00"));
  execucao(b, 2, em("11:00:00"), em("11:30:00"), crypto.randomUUID());
  sessao(raiz, SESSAO_COMPARTILHADA());
  depoisDoC6(b, 1);
  assert.deepEqual(linhasDeUso(b, 1), E1);

  sessao(raiz, SESSAO_COMPARTILHADA(), `2026-10-12T10-00-00-000Z_${SESSAO}.jsonl`);
  mkdirSync(dirDaExecucao(raiz, 1), { recursive: true });
  depoisDoC6(b, 1);
  assert.match(
    readFileSync(join(dirDaExecucao(raiz, 1), "log"), "utf8"),
    /^\S+ coleta de uso falhou: ErroDeRegra: a sessão \S+ tem 2 arquivos .*\n$/,
  );
  assert.deepEqual(linhasDeUso(b, 1), E1, "a falha não apaga a coleta anterior");

  const stderr = t.mock.method(console, "error", () => undefined);
  depoisDoC6(b, 9); // nem execução, nem diretório
  assert.equal(stderr.mock.callCount(), 1);
  // O formato do log do serviço: horário, "fabriquinha:" e a mensagem.
  assert.match(
    String(stderr.mock.calls[0]?.arguments.join(" ")),
    /^\d{4}-\d\d-\d\dT\S+Z fabriquinha: E-9: coleta de uso falhou: .*E-9 não existe/,
  );
  b.close();
});
