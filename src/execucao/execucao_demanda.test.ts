// Execução do ticket da demanda com banco real, git real e um pi falso que fala o protocolo RPC (CA-1 a CA-7, CA-11 a CA-14).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { criarSessao, iniciarExecucao } from "../dominio/sessoes.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../persistencia/sessoes.ts";
import { cenarioDemanda } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda } from "../repositorio/worktree-demanda.ts";
import { interromperExecucaoDemanda, iniciarExecucaoDemanda, recuperarExecucoesDemanda } from "./execucao_demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-exec-demanda-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

/**
 * pi falso. Anota em $FALSO_PI_REGISTRO o início (argumentos, pasta, ambiente) e o prompt, e grava a resposta na sessão
 * como o pi faz. $FALSO_PI: sucesso (padrão), sem-custo (o `usage` sem `cost`), erro e dorme (nunca assenta).
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
const variante = process.env.FALSO_PI ?? "sucesso";
const anotar = (o) => appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify(o) + "\\n");
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
anotar({ evento: "inicio", argv: process.argv.slice(2), cwd: process.cwd(), execucao: process.env.FABRIQUINHA_EXECUCAO });
function assistente(stopReason) {
  const usage = { input: 10, output: 2, cacheRead: 100, cacheWrite: 3, totalTokens: 115 };
  if (variante !== "sem-custo") usage.cost = { total: 0.01 };
  const message = { role: "assistant", content: [], provider: "anthropic", model: "claude-teste", stopReason, usage,
    ...(stopReason === "error" && { errorMessage: "limite de uso" }) };
  mkdirSync(arg("--session-dir"), { recursive: true });
  appendFileSync(arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
    JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
  emitir({ type: "message_end", message });
}
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type !== "prompt") continue;
    anotar({ evento: "prompt", mensagem: c.message });
    emitir({ type: "response", command: "prompt", success: true });
    emitir({ type: "agent_start" });
    if (variante === "dorme") continue;
    assistente(variante === "erro" ? "error" : "stop");
    emitir({ type: "agent_settled" });
  }
});
`;
const pi = join(temporario, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

interface Opcoes {
  etapas?: { etapa: string; modelo_provedor?: string; modelo_nome?: string; effort?: string }[];
  variante?: string;
  /** O serviço cria a worktree da demanda (ticket global); senão ela já existe, para os tickets de rodada. */
  semWorktree?: boolean;
  /** Comando de preparação da worktree (padrão `true`). */
  preparacao?: string;
}

/** Projeto `loja` configurado, demanda I-1 em execução (rodadas 1 e 2) e a worktree da demanda criada. */
async function cenario({ etapas = [], variante, semWorktree, preparacao = "true" }: Opcoes = {}) {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', ?, 'integracao', 'github', '["t"]', 'k', '[{"nome":"f"}]')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas,
    preparacao: [{ ordem: 1, comando: preparacao }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-1",
    ticket_id,
    etapa,
    status: "aberto",
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  const rodada = (rodada_id: number) => ({
    demanda_id: "I-1",
    rodada_id,
    titulo: `r${String(rodada_id)}`,
    fase: "desenvolvimento",
    e2e: false,
    branch: `fabriquinha/I-1-${String(rodada_id)}`,
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-1",
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [rodada(1), rodada(2)],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(1, "implementar", { rodada_id: 2 }),
      ticket(2, "implementar", { rodada_id: 2, effort: "high" }),
      ticket(3, "planejar"),
      ticket(4, "revisar_demanda"),
      ticket(5, "encerrar_demanda"),
      ticket(6, "resolver_conflito"),
      ticket(7, "implementar", { rodada_id: 1 }),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  if (!semWorktree) await garantirWorktreeDemanda(c.raiz, c.projeto, "I-1", c.log, () => Promise.resolve());
  const registro = join(c.dir, "registro.jsonl");
  process.env.FABRIQUINHA_PI = pi;
  process.env.FALSO_PI_REGISTRO = registro;
  if (variante) process.env.FALSO_PI = variante;
  else delete process.env.FALSO_PI;
  return {
    c,
    banco,
    /** O que o pi falso anotou, de todas as execuções. */
    registro: () =>
      (existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n") : []).map(
        (l) => JSON.parse(l) as { evento: string; argv: string[]; cwd: string; mensagem: string },
      ),
    sessoes: (ticket_id: number) => carregarSessoesDoTicket(banco, { demanda_id: "I-1", ticket_id }),
  };
}

const ref = (ticket_id: number) => ({ demanda_id: "I-1", ticket_id });
const valorDe = (argv: string[], nome: string) => argv[argv.indexOf(nome) + 1];

test("CA-1: sessão ligada ao ticket e execução aberta com o grupo de processo do pi", async () => {
  const { banco, sessoes } = await cenario({ variante: "dorme" });
  const { id, fim } = iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 0.05 });
  let e = sessoes(1).execucoes[0];
  assert.equal(e?.id, id);
  assert.equal(e.fim, null);
  while (e?.grupo_processo === undefined) {
    await dormir(20);
    e = sessoes(1).execucoes[0];
  }
  const [sessao] = sessoes(1).sessoes;
  assert.deepEqual(
    { demanda: sessao?.demanda_id, ticket: sessao?.ticket_id, conversa: sessao?.conversa_referencia === sessao?.id },
    { demanda: "I-1", ticket: 1, conversa: true },
  );
  assert.equal(sessao?.modo, "autonomo");
  assert.equal(e.fim, null);
  process.kill(-e.grupo_processo, 0); // o grupo existe: lança se não
  await fim;
});

test("CA-2: retomar o ticket usa a mesma sessão e passa o identificador ao pi", async () => {
  const { banco, sessoes, registro } = await cenario();
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1, modo: "interativo" }).fim;
  const { sessoes: ss, execucoes } = sessoes(1);
  assert.equal(ss.length, 1);
  assert.equal(ss[0]?.modo, "autonomo"); // o modo é o da sessão
  assert.deepEqual(
    execucoes.map((e) => [e.sessao_id, e.fim !== null]),
    [
      [ss[0].id, true],
      [ss[0].id, true],
    ],
  );
  const inicios = registro().filter((r) => r.evento === "inicio");
  assert.deepEqual(
    inicios.map((r) => valorDe(r.argv, "--session-id")),
    [ss[0].id, ss[0].id],
  );
});

test("CA-3: effort do ticket e modelo da etapa, gravados e passados ao pi", async () => {
  const { banco, sessoes, registro } = await cenario({
    etapas: [{ etapa: "implementar", modelo_provedor: "anthropic", modelo_nome: "claude-etapa", effort: "low" }],
  });
  await iniciarExecucaoDemanda(banco, ref(2), { limiteMin: 1 }).fim;
  const e = sessoes(2).execucoes[0];
  assert.deepEqual([e?.modelo_provedor, e?.modelo_nome, e?.effort], ["anthropic", "claude-etapa", "high"]);
  const argv = registro()[0]?.argv ?? [];
  assert.deepEqual(
    [valorDe(argv, "--provider"), valorDe(argv, "--model"), valorDe(argv, "--thinking")],
    ["anthropic", "claude-etapa", "high"],
  );
});

test("CA-4: sem modelo nem effort, nada é gravado e o pi roda com o padrão", async () => {
  const { banco, sessoes, registro } = await cenario();
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const e = sessoes(1).execucoes[0];
  assert.deepEqual([e?.modelo_provedor, e?.modelo_nome, e?.effort], [undefined, undefined, undefined]);
  const argv = registro()[0]?.argv ?? [];
  for (const opcao of ["--provider", "--model", "--thinking"]) assert.equal(argv.includes(opcao), false);
});

test("CA-5: ticket de rodada roda na worktree da rodada", async () => {
  const { c, banco, registro } = await cenario();
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  assert.equal(registro()[0]?.cwd, join(c.raiz, "worktrees", "loja", "I-1", "rodadas", "2"));
});

test("CA-6: ticket global roda na worktree da demanda", async () => {
  const { c, banco, registro } = await cenario({ semWorktree: true });
  for (const ticket of [3, 4, 5, 6]) await iniciarExecucaoDemanda(banco, ref(ticket), { limiteMin: 1 }).fim;
  assert.deepEqual(
    registro()
      .filter((r) => r.evento === "inicio")
      .map((r) => r.cwd),
    Array(4).fill(join(c.raiz, "worktrees", "loja", "I-1", "demanda")),
  );
});

test("CA-7: devolução e reabertura levam o motivo ao prompt", async () => {
  const { banco, registro } = await cenario();
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  await iniciarExecucaoDemanda(banco, ref(1), {
    limiteMin: 1,
    retomada: { tipo: "devolucao", motivo: "testes falharam" },
  }).fim;
  await iniciarExecucaoDemanda(banco, ref(1), {
    limiteMin: 1,
    retomada: { tipo: "reabertura", motivo: "faltou X" },
  }).fim;
  const [primeiro, devolucao, reabertura] = registro()
    .filter((r) => r.evento === "prompt")
    .map((r) => r.mensagem);
  assert.doesNotMatch(primeiro ?? "", /Motivo:/);
  assert.match(devolucao ?? "", /## Devolução[\s\S]*Motivo: testes falharam/);
  assert.match(reabertura ?? "", /## Reabertura[\s\S]*Motivo: faltou X/);
});

test("CA-11: sucesso grava fim, falha falsa e o uso por modelo com tokens e custo", async () => {
  const { banco, sessoes, c } = await cenario();
  const { id, fim } = iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 });
  await fim;
  const { execucoes, usos } = sessoes(1);
  assert.equal(execucoes[0]?.falha, false);
  assert.equal(typeof execucoes[0].fim, "string");
  assert.equal(execucoes[0].erro, undefined);
  assert.deepEqual(usos, [
    {
      execucao_id: id,
      modelo_provedor: "anthropic",
      modelo_nome: "claude-teste",
      tokens_entrada: 10,
      tokens_saida: 2,
      tokens_cache_leitura: 100,
      tokens_cache_escrita: 3,
      custo: 0.01,
    },
  ]);
  assert.ok(existsSync(join(c.raiz, "execucoes", `E-${id}`, "prompt.md")));
});

test("CA-13: o pi que não informa o custo grava custo nulo, não zero", async () => {
  const { banco, sessoes } = await cenario({ variante: "sem-custo" });
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const [uso] = sessoes(1).usos;
  assert.equal(uso?.tokens_entrada, 10);
  assert.equal("custo" in uso, false);
  const linha = banco.prepare("SELECT custo FROM uso_modelo_execucao").get();
  assert.equal(linha?.custo, null);
});

test("CA-12, CA-14: pi que falha encerra com falha e erro, sem tocar a demanda", async () => {
  const { banco, sessoes } = await cenario({ variante: "erro" });
  const antes = carregarDemanda(banco, "I-1");
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const e = sessoes(1).execucoes[0];
  assert.equal(e?.falha, true);
  assert.equal(typeof e.fim, "string");
  assert.match(e.erro ?? "", /stopReason error: limite de uso/);
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

test("CA-12, CA-14: tempo limite estourado encerra com falha e erro, sem tocar a demanda", async () => {
  const { banco, sessoes } = await cenario({ variante: "dorme" });
  const antes = carregarDemanda(banco, "I-1");
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 0.01 }).fim;
  const e = sessoes(1).execucoes[0];
  assert.equal(e?.falha, true);
  assert.match(e.erro ?? "", /tempo limite/);
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

test("CA-12, CA-14: pi que não sobe encerra com falha e erro, sem grupo de processo", async () => {
  const { banco, sessoes } = await cenario();
  process.env.FABRIQUINHA_PI = join(temporario, "nao-existe");
  const antes = carregarDemanda(banco, "I-1");
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const e = sessoes(1).execucoes[0];
  assert.equal(e?.falha, true);
  assert.equal(e.grupo_processo, undefined);
  assert.match(e.erro ?? "", /o pi saiu antes de terminar/);
  assert.equal(sessoes(1).usos.length, 0);
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

test("falha antes do pi (worktree da rodada ocupada) encerra com o erro e sem lançar o pi", async () => {
  const { c, banco, sessoes, registro } = await cenario();
  mkdirSync(join(c.raiz, "worktrees", "loja", "I-1", "rodadas", "1"), { recursive: true });
  await iniciarExecucaoDemanda(banco, ref(7), { limiteMin: 1 }).fim;
  const e = sessoes(7).execucoes[0];
  assert.equal(e?.falha, true);
  assert.match(e.erro ?? "", /destino ocupado/);
  assert.equal(registro().length, 0);
});

test("a coleta de uso que falha vai para o log e não impede o encerramento", async () => {
  const { c, banco, sessoes } = await cenario({ variante: "dorme" });
  const { id, fim } = iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 0.02 });
  const sessao = sessoes(1).sessoes[0]?.id ?? "";
  const dir = join(c.raiz, "sessoes");
  mkdirSync(dir, { recursive: true });
  for (const n of ["a", "b"]) writeFileSync(join(dir, `${n}_${sessao}.jsonl`), "");
  await fim;
  const e = sessoes(1).execucoes[0];
  assert.equal(typeof e?.fim, "string");
  assert.equal(sessoes(1).usos.length, 0);
  assert.match(readFileSync(join(c.raiz, "execucoes", `E-${id}`, "log"), "utf8"), /coleta de uso falhou/);
});

test("a recusa é síncrona: ticket inexistente", async () => {
  const { banco } = await cenario();
  assert.throws(() => iniciarExecucaoDemanda(banco, ref(99), { limiteMin: 1 }), ErroDeInexistente);
});

test("CA-8: interromper manda SIGTERM ao grupo do pi e a execução falha como interrompida", async () => {
  const { banco, sessoes } = await cenario({ variante: "dorme" });
  const { fim } = iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 });
  while (sessoes(1).execucoes[0]?.grupo_processo === undefined) await dormir(20);
  interromperExecucaoDemanda(banco, ref(1));
  await fim;
  const [e] = sessoes(1).execucoes;
  assert.notEqual(e?.fim, null);
  assert.equal(e?.falha, true);
  assert.equal(e.erro, "interrompida pelo Auditor");
});

test("CA-8: interromper durante a preparação da worktree encerra interrompida e o pi recebe o término ao subir", async () => {
  const { banco, sessoes } = await cenario({ semWorktree: true, preparacao: "sleep 1" });
  const { fim } = iniciarExecucaoDemanda(banco, ref(3), { limiteMin: 1 });
  await dormir(300);
  interromperExecucaoDemanda(banco, ref(3));
  await fim;
  const [e] = sessoes(3).execucoes;
  assert.deepEqual([e?.falha, e?.erro, e?.fim !== null], [true, "interrompida pelo Auditor", true]);
});

test("CA-8: execução órfã (sem condutor) leva SIGKILL no grupo e é encerrada direto", async () => {
  const { banco, sessoes } = await cenario();
  const filho = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const pgid = filho.pid ?? 0;
  const morreu = new Promise((r) => filho.on("exit", r));
  comSessoesDoTicket(banco, ref(1), (estado) => {
    const sessao = { ...ref(1), id: "s-orfa", modo: "autonomo" as const, conversa_referencia: "s-orfa" };
    const sessoesNovas = criarSessao(estado.sessoes, sessao);
    const execucao = { id: "e-orfa", sessao_id: "s-orfa", inicio: em, falha: false, grupo_processo: pgid };
    return { ...estado, sessoes: sessoesNovas, execucoes: iniciarExecucao(sessoesNovas, estado.execucoes, execucao) };
  });
  interromperExecucaoDemanda(banco, ref(1));
  await morreu;
  const [e] = sessoes(1).execucoes;
  assert.deepEqual([e?.falha, e?.erro, e?.fim !== null], [true, "interrompida pelo Auditor", true]);
});

test("CA-9: sem execução aberta a interrupção é recusada e nada muda", async () => {
  const { banco, sessoes } = await cenario();
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const antes = sessoes(1);
  assert.throws(() => {
    interromperExecucaoDemanda(banco, ref(1));
  }, ErroDeRegra);
  assert.deepEqual(sessoes(1), antes);
});

test("CA-10, CA-14: reinício mata o grupo gravado, falha as abertas (com ou sem grupo) e não toca o ticket", async () => {
  const { banco, sessoes } = await cenario();
  const filho = spawn("sleep", ["30"], { detached: true, stdio: "ignore" });
  const morreu = new Promise((r) => filho.on("exit", r));
  const abrirOrfa = (ticket: number, id: string, grupo_processo?: number) =>
    comSessoesDoTicket(banco, ref(ticket), (estado) => {
      const sessao = { ...ref(ticket), id: `s-${id}`, modo: "autonomo" as const, conversa_referencia: id };
      const sessoesNovas = criarSessao(estado.sessoes, sessao);
      const execucao = {
        id,
        sessao_id: sessao.id,
        inicio: em,
        falha: false,
        ...(grupo_processo && { grupo_processo }),
      };
      return { ...estado, sessoes: sessoesNovas, execucoes: iniciarExecucao(sessoesNovas, estado.execucoes, execucao) };
    });
  abrirOrfa(1, "e-com-grupo", filho.pid);
  abrirOrfa(2, "e-sem-grupo");
  const antes = carregarDemanda(banco, "I-1");
  recuperarExecucoesDemanda(banco);
  await morreu;
  for (const t of [1, 2]) {
    const [e] = sessoes(t).execucoes;
    assert.deepEqual([e?.falha, e?.erro, e?.fim !== null], [true, "serviço reiniciado", true]);
  }
  assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
});

const emExecucao = (banco: DatabaseSync, ticket_id: number) =>
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    tickets: ag.tickets.map((t) => (t.ticket_id === ticket_id ? { ...t, status: "em_execucao" as const } : t)),
  }));
const statusDe = (banco: DatabaseSync, ticket_id: number) =>
  carregarDemanda(banco, "I-1").tickets.find((t) => t.ticket_id === ticket_id);

test("CA-9, CA-10: pi com falha falha o ticket implementar, sem evidência nem devolução", async () => {
  const { banco } = await cenario({ variante: "erro" });
  emExecucao(banco, 1);
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1 }).fim;
  const ag = carregarDemanda(banco, "I-1");
  const t = ag.tickets.find((x) => x.ticket_id === 1);
  assert.equal(t?.status, "falhou");
  assert.match(t.motivo_falha ?? "", /limite de uso/);
  assert.equal(t.devolucoes, 0);
  assert.equal(ag.evidencias.length, 0);
});

test("o fechamento recebe a falha e o fim só resolve depois dele", async () => {
  const { banco } = await cenario({ variante: "erro" });
  const chamadas: unknown[] = [];
  await iniciarExecucaoDemanda(banco, ref(1), {
    limiteMin: 1,
    fechar: async (_b, r, o) => {
      await dormir(20);
      chamadas.push([r, o.falha]);
    },
  }).fim;
  assert.equal(chamadas.length, 1);
  assert.match((chamadas[0] as [unknown, string])[1], /limite de uso/);
});

test("erro do fechamento vai ao log e falha o ticket com o motivo", async () => {
  const { banco, c } = await cenario();
  emExecucao(banco, 1);
  const { id, fim } = iniciarExecucaoDemanda(banco, ref(1), {
    limiteMin: 1,
    fechar: () => Promise.reject(new Error("boom")),
  });
  await fim;
  assert.match(readFileSync(join(c.raiz, "execucoes", `E-${id}`, "log"), "utf8"), /fechamento falhou: boom/);
  assert.equal(statusDe(banco, 1)?.status, "falhou");
  assert.match(statusDe(banco, 1)?.motivo_falha ?? "", /boom/);
});

test("erro do fechamento com falhar também falhando só é anotado", async () => {
  const { banco, c } = await cenario();
  const { id, fim } = iniciarExecucaoDemanda(banco, ref(1), {
    limiteMin: 1,
    fechar: () => {
      banco.exec("PRAGMA query_only = ON");
      return Promise.reject(new Error("boom"));
    },
  });
  await fim;
  assert.match(readFileSync(join(c.raiz, "execucoes", `E-${id}`, "log"), "utf8"), /também falhou/);
});

test("interrupção do Auditor e reinício falham o ticket em execução", async () => {
  const { banco } = await cenario();
  for (const t of [1, 2]) emExecucao(banco, t);
  const abrirOrfa = (ticket: number, id: string) =>
    comSessoesDoTicket(banco, ref(ticket), (estado) => {
      const sessao = { ...ref(ticket), id: `s-${id}`, modo: "autonomo" as const, conversa_referencia: id };
      const sessoesNovas = criarSessao(estado.sessoes, sessao);
      const execucao = { id, sessao_id: sessao.id, inicio: em, falha: false };
      return { ...estado, sessoes: sessoesNovas, execucoes: iniciarExecucao(sessoesNovas, estado.execucoes, execucao) };
    });
  abrirOrfa(1, "e1");
  abrirOrfa(2, "e2");
  interromperExecucaoDemanda(banco, ref(1));
  recuperarExecucoesDemanda(banco);
  assert.equal(statusDe(banco, 1)?.motivo_falha, "interrompida pelo Auditor");
  assert.equal(statusDe(banco, 2)?.motivo_falha, "serviço reiniciado");
});

test("reinício falha o ticket em execução cuja execução já foi encerrada (fechamento interrompido)", async () => {
  const { banco } = await cenario();
  emExecucao(banco, 1);
  await iniciarExecucaoDemanda(banco, ref(1), { limiteMin: 1, fechar: () => Promise.resolve() }).fim;
  assert.equal(statusDe(banco, 1)?.status, "em_execucao");
  recuperarExecucoesDemanda(banco);
  assert.equal(statusDe(banco, 1)?.status, "falhou");
  assert.equal(statusDe(banco, 1)?.motivo_falha, "serviço reiniciado");
});

test("CA-12: reinício falha as revisões e o encerrar_rodada em encerramento; o gate do PR e o planejar ficam", async () => {
  const { banco } = await cenario();
  banco.exec(`UPDATE rodada SET fase = 'encerramento' WHERE rodada_id = 1;
    UPDATE rodada SET fase = 'aprovacao_pull_request' WHERE rodada_id = 2;
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id) VALUES
      ('I-1', 8, 'revisar_rodada', 'em_execucao', '${em}', 1),
      ('I-1', 9, 'encerrar_rodada', 'em_execucao', '${em}', 1),
      ('I-1', 10, 'encerrar_rodada', 'em_execucao', '${em}', 2)`);
  for (const t of [3, 4]) emExecucao(banco, t); // planejar e revisar_demanda
  recuperarExecucoesDemanda(banco);
  assert.deepEqual(
    [3, 4, 8, 9, 10].map((t) => statusDe(banco, t)?.status),
    ["em_execucao", "falhou", "falhou", "falhou", "em_execucao"],
  );
});

test("CA-12: reinício falha o planejar com execução aberta, com a demanda em planejamento", async () => {
  const { banco } = await cenario();
  banco.exec("UPDATE demanda SET fase = 'planejamento' WHERE id = 'I-1'");
  emExecucao(banco, 3);
  comSessoesDoTicket(banco, ref(3), (estado) => {
    const sessao = { ...ref(3), id: "s-p", modo: "autonomo" as const, conversa_referencia: "p" };
    const sessoesNovas = criarSessao(estado.sessoes, sessao);
    const execucao = { id: "p", sessao_id: sessao.id, inicio: em, falha: false };
    return { ...estado, sessoes: sessoesNovas, execucoes: iniciarExecucao(sessoesNovas, estado.execucoes, execucao) };
  });
  recuperarExecucoesDemanda(banco);
  assert.equal(statusDe(banco, 3)?.status, "falhou");
});

test("CA-7: o motivo da falha de preparação vai ao log da execução", async () => {
  const { c, banco } = await cenario({ semWorktree: true });
  banco.prepare("UPDATE projeto SET repo = '/nao/existe' WHERE nome = 'loja'").run();
  await iniciarExecucaoDemanda(banco, ref(7), { limiteMin: 1 }).fim;
  const [dir] = readdirSync(join(c.raiz, "execucoes"));
  assert.match(readFileSync(join(c.raiz, "execucoes", String(dir), "log"), "utf8"), /preparação falhou: /);
});
