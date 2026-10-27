// Despacho das demandas (CA-1 a CA-8, CA-15 a CA-17) contra banco real em raiz temporária. O início do `implementar` é
// injetável (nada sobe o pi); as demais etapas rodam de verdade, com o repositório inexistente (falham ao preparar) ou
// com git real e um pi falso.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, type TestContext, test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { criarSessao, iniciarExecucao } from "../dominio/sessoes.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { registrarDependenciaDemanda } from "../persistencia/dependencias_demanda.ts";
import { alterarLimiteParalelismo, configuracao } from "../persistencia/servico.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../persistencia/sessoes.ts";
import { cenarioDemanda } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda } from "../repositorio/worktree-demanda.ts";
import { despacharDemandas, type DepsDespacho, executarAgoraDemanda } from "./despacho_demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-despacho-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

/** pi falso: assenta; com $FALSO_PI=erro responde com stopReason de erro. */
const pi = join(temporario, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  if (!linhas.some((l) => JSON.parse(l).type === "prompt")) return;
  const erro = process.env.FALSO_PI === "erro";
  const message = { role: "assistant", content: [], provider: "p", model: "m", stopReason: erro ? "error" : "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
    ...(erro && { errorMessage: "limite de uso" }) };
  mkdirSync(arg("--session-dir"), { recursive: true });
  appendFileSync(arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
    JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "message_end", message });
  emitir({ type: "agent_settled" });
});
`,
);
chmodSync(pi, 0o755);

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

interface TicketSpec {
  etapa: string;
  rodada?: number;
  status?: string;
  id?: number;
}
interface DemandaSpec {
  fase?: string;
  /** A fase de cada rodada, na ordem (rodada_id 1, 2...). */
  rodadas?: string[];
  tickets?: TicketSpec[];
}

/** Banco novo; `real` usa o repositório git de verdade (e a worktree da demanda I-2), senão o repositório não existe. */
async function cenario(limite: number, real = false) {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
  abertos.push(banco);
  const repo = real ? c.repo : "/nao/existe";
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', ?, 'integracao', 'github', '["t"]', 'k', '[{"nome":"f"}]')`,
    )
    .run(repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  alterarLimiteParalelismo(banco, limite);
  if (real) {
    process.env.FABRIQUINHA_PI = pi;
    await garantirWorktreeDemanda(c.raiz, c.projeto, "I-2", c.log, () => Promise.resolve());
  }
  return { c, banco, config: configuracao(banco) };
}

/** A demanda I-`n`. Os tickets sem `id` recebem 1, 2... pela ordem. */
function demanda(banco: DatabaseSync, n: number, { fase = "execucao", rodadas = [], tickets = [] }: DemandaSpec): void {
  const id = `I-${String(n)}`;
  criarDemanda(banco, {
    demanda: {
      id,
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: `fabriquinha/${id}`,
    },
    rodadas: rodadas.map((f, i) => ({
      demanda_id: id,
      rodada_id: i + 1,
      titulo: `r${String(i + 1)}`,
      fase: f,
      e2e: false,
      branch: `fabriquinha/${id}-${String(i + 1)}`,
    })),
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: tickets.map((t, i) => ({
      demanda_id: id,
      ticket_id: t.id ?? i + 1,
      etapa: t.etapa,
      status: t.status ?? "aberto",
      status_alterado_em: em,
      devolucoes: 0,
      ...(t.rodada !== undefined && { rodada_id: t.rodada }),
    })),
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
}

const implementar = (rodada: number, id?: number): TicketSpec => ({ etapa: "implementar", rodada, id });
const status = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarDemanda(banco, `I-${String(n)}`).tickets.find((t) => t.ticket_id === ticket_id)?.status;
const aberta = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarSessoesDoTicket(banco, { demanda_id: `I-${String(n)}`, ticket_id }).execucoes.filter((e) => e.fim == null)
    .length;
const execucoes = (banco: DatabaseSync, n: number, ticket_id: number) =>
  carregarSessoesDoTicket(banco, { demanda_id: `I-${String(n)}`, ticket_id }).execucoes.length;

/** Abre sessão e execução como o serviço da execução, sem subir o pi. */
const iniciarFalso: NonNullable<DepsDespacho["iniciarExecucao"]> = (banco, ref) => {
  const id = randomUUID();
  const sessao = { ...ref, id: randomUUID(), modo: "autonomo" as const, conversa_referencia: "c" };
  comSessoesDoTicket(banco, ref, (estado) => {
    const sessoes = criarSessao(estado.sessoes, sessao);
    return {
      ...estado,
      sessoes,
      execucoes: iniciarExecucao(sessoes, estado.execucoes, { id, sessao_id: sessao.id, inicio: em, falha: false }),
    };
  });
  return { id, fim: Promise.resolve() };
};
const deps: DepsDespacho = { iniciarExecucao: iniciarFalso };
const silenciar = (t: TestContext) => t.mock.method(console, "error", () => undefined);

test("CA-1: o ciclo reserva o implementar elegível e cria a execução aberta", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 2, 1), aberta(banco, 2, 1)], ["em_execucao", 1]);
});

test("CA-2: com o limite global de 2, só dois de três tickets de demandas diferentes entram", async () => {
  const { banco, config } = await cenario(2);
  for (const n of [2, 3, 5]) demanda(banco, n, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual(
    [2, 3, 5].map((n) => status(banco, n, 1)),
    ["em_execucao", "em_execucao", "aberto"],
  );
});

test("CA-3: com o limite 1, a demanda de menor número leva a vaga", async () => {
  const { banco, config } = await cenario(1);
  for (const n of [5, 3]) demanda(banco, n, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 3, 1), status(banco, 5, 1)], ["em_execucao", "aberto"]);
});

test("CA-4: com o limite 1, a rodada 1 leva a vaga antes da rodada 2", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 3, { rodadas: ["desenvolvimento", "desenvolvimento"], tickets: [implementar(2), implementar(1)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 3, 2), status(banco, 3, 1)], ["em_execucao", "aberto"]);
});

test("CA-5: com o limite 1, o ticket de menor número da rodada leva a vaga", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 3, { rodadas: ["desenvolvimento"], tickets: [implementar(1, 4), implementar(1, 2)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 3, 2), status(banco, 3, 4)], ["em_execucao", "aberto"]);
});

test("CA-6 e CA-16: o planejar com predecessora pendente não é despachado nem executado agora", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 4, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  demanda(banco, 6, { fase: "planejamento", tickets: [{ etapa: "planejar" }] });
  banco.exec("UPDATE demanda SET enviada = 0 WHERE id = 'I-6'"); // a dependência só se registra antes do envio
  registrarDependenciaDemanda(banco, "I-6", "I-4");
  banco.exec("UPDATE demanda SET enviada = 1 WHERE id = 'I-6'");
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 6, 1), execucoes(banco, 6, 1)], ["aberto", 0]);
  assert.throws(() => executarAgoraDemanda(banco, { demanda_id: "I-6", ticket_id: 1 }, config, deps), /predecessoras/);
  assert.deepEqual([status(banco, 6, 1), execucoes(banco, 6, 1)], ["aberto", 0]);
});

test("CA-7: repositório inexistente não deixa o ticket em execução e o motivo vai ao log", async () => {
  const { c, banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  await Promise.all(despacharDemandas(banco, config));
  assert.deepEqual([status(banco, 2, 1), aberta(banco, 2, 1)], ["falhou", 0]);
  const [dir] = readdirSync(join(c.raiz, "execucoes"));
  assert.match(
    readFileSync(join(c.raiz, "execucoes", String(dir), "log"), "utf8"),
    /preparação falhou: .*\/nao\/existe/,
  );
});

test("CA-8: com as rodadas concluídas o ciclo inicia a revisão integral e o revisar_demanda entra em execução", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 3, { rodadas: ["concluida"], tickets: [{ etapa: "implementar", rodada: 1, status: "concluido" }] });
  const fins = despacharDemandas(banco, config);
  const ag = carregarDemanda(banco, "I-3");
  assert.equal(ag.demanda.fase, "revisao_demanda");
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "revisar_demanda").map((t) => t.status),
    ["em_execucao"],
  );
  await Promise.all(fins);
});

test("a revisão integral recusada pelo domínio vai ao log e a demanda segue em execucao", async (t) => {
  const log = silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 3, { rodadas: ["concluida"], tickets: [{ etapa: "implementar", rodada: 1, status: "falhou" }] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.equal(carregarDemanda(banco, "I-3").demanda.fase, "execucao");
  assert.equal(log.mock.callCount(), 1);
});

test("o planejar sem predecessoras pendentes é reservado e iniciado pelo ciclo", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 6, { fase: "planejamento", tickets: [{ etapa: "planejar" }] });
  const fins = despacharDemandas(banco, config);
  assert.deepEqual([status(banco, 6, 1), aberta(banco, 6, 1)], ["em_execucao", 1]);
  await Promise.all(fins);
});

test("o revisar_rodada despachado reserva o ticket e a falha de preparação o leva a falhou", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 4, { rodadas: ["revisao"], tickets: [{ etapa: "revisar_rodada", rodada: 1 }] });
  const fins = despacharDemandas(banco, config);
  assert.equal(status(banco, 4, 1), "em_execucao");
  await Promise.all(fins);
  assert.equal(status(banco, 4, 1), "falhou");
});

test("CA-15 e CA-17: executar agora cria uma só execução; a segunda tentativa é recusada", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  const ref = { demanda_id: "I-2", ticket_id: 1 };
  const fim = executarAgoraDemanda(banco, ref, config, deps);
  assert.throws(() => executarAgoraDemanda(banco, ref, config, deps), /está em_execucao/);
  await fim;
  assert.deepEqual([status(banco, 2, 1), aberta(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 1, 1]);
});

test("executar agora recusa demanda fora das fases lidas, ticket inexistente e limite global ocupado", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  demanda(banco, 3, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  demanda(banco, 4, { fase: "concluida", tickets: [{ etapa: "encerrar_demanda" }] });
  const agora = (demanda_id: string, ticket_id: number) =>
    executarAgoraDemanda(banco, { demanda_id, ticket_id }, config, deps);
  assert.throws(() => agora("I-4", 1), /não está em planejamento, execução, revisão da demanda nem encerramento/);
  assert.throws(() => agora("I-2", 9), /não existe/);
  await agora("I-2", 1);
  assert.throws(() => agora("I-3", 1), /limite global de paralelismo está ocupado/);
  assert.equal(status(banco, 3, 1), "aberto");
});

test("falha síncrona ao iniciar desfaz a reserva e vai ao log; fim rejeitado também só vai ao log", async (t) => {
  const log = silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  demanda(banco, 3, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  const quebrado: DepsDespacho = {
    iniciarExecucao: (b, ref, o) => {
      if (ref.demanda_id === "I-2") throw new Error("sem sessão");
      return { ...iniciarFalso(b, ref, o), fim: Promise.reject(new Error("pi caiu")) };
    },
  };
  await Promise.all(despacharDemandas(banco, config, quebrado));
  assert.deepEqual([status(banco, 2, 1), execucoes(banco, 2, 1)], ["aberto", 0]);
  assert.equal(status(banco, 3, 1), "em_execucao");
  assert.equal(log.mock.callCount(), 2);
});

test("planejar reprovado é retomado antes da seleção, mesmo com o limite 1, e ocupa a vaga", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 1, { fase: "planejamento", tickets: [{ etapa: "planejar", status: "em_execucao" }] });
  demanda(banco, 2, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  banco.exec(`INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, resultado, motivo, por, em)
    VALUES ('I-1', 1, 1, 'recusado', 'refaça o plano', 'auditor', '${em}')`);
  const fins = despacharDemandas(banco, config, deps);
  assert.deepEqual([execucoes(banco, 1, 1), status(banco, 2, 1)], [1, "aberto"]);
  await Promise.all(fins);
  assert.equal(despacharDemandas(banco, config, deps).length, 1); // já retomado: só o implementar entra
});

test("encerrar_rodada: a falha do agente falha o ticket; sem falha ele segue para a conferência", async (t) => {
  silenciar(t); // a conferência recusa: o agente falso não entrega a documentação
  const { banco, config } = await cenario(3, true);
  demanda(banco, 2, { rodadas: ["encerramento"], tickets: [{ etapa: "encerrar_rodada", rodada: 1 }] });
  process.env.FALSO_PI = "erro";
  await Promise.all(despacharDemandas(banco, config));
  assert.equal(status(banco, 2, 1), "falhou");

  const outro = await cenario(3, true);
  demanda(outro.banco, 2, { rodadas: ["encerramento"], tickets: [{ etapa: "encerrar_rodada", rodada: 1 }] });
  delete process.env.FALSO_PI;
  await Promise.all(despacharDemandas(outro.banco, outro.config));
  assert.equal(status(outro.banco, 2, 1), "falhou"); // conclusão recusada: não fica preso em execução
});

const encerrar = (status = "aberto"): TicketSpec => ({ etapa: "encerrar_demanda", status });

test("CA-1 e CA-12: o ciclo reserva o encerrar_demanda sem abrir agente; a falha do encerramento falha o ticket", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { fase: "encerramento", rodadas: ["concluida"], tickets: [encerrar()] });
  const fins = despacharDemandas(banco, config);
  assert.deepEqual([status(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 0]);
  await Promise.all(fins);
  assert.equal(status(banco, 2, 1), "falhou");
  assert.equal(carregarDemanda(banco, "I-2").demanda.fase, "encerramento");
});

test("a recusa do encerramento que não falhou o ticket não o deixa preso em execução", async (t) => {
  silenciar(t);
  const { banco, config } = await cenario(3);
  demanda(banco, 2, { fase: "encerramento", rodadas: ["concluida"], tickets: [encerrar()] });
  banco.exec("DELETE FROM linguagem_projeto;"); // sem a configuração do SDLC
  await Promise.all(despacharDemandas(banco, config));
  assert.equal(status(banco, 2, 1), "falhou");
});

test("CA-3 e CA-4: executar agora no encerrar_demanda reserva sem agente; com o limite ocupado, recusa", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { fase: "encerramento", rodadas: ["concluida"], tickets: [encerrar()] });
  demanda(banco, 3, { fase: "encerramento", rodadas: ["concluida"], tickets: [encerrar()] });
  const agora = (n: number) => executarAgoraDemanda(banco, { demanda_id: `I-${String(n)}`, ticket_id: 1 }, config);
  const fim = agora(2);
  assert.deepEqual([status(banco, 2, 1), execucoes(banco, 2, 1)], ["em_execucao", 0]);
  assert.throws(() => agora(3), /limite global de paralelismo está ocupado/);
  assert.equal(status(banco, 3, 1), "aberto");
  await fim;
});

test("CA-5: o encerrar_demanda em execução ocupa a vaga do limite 1", async () => {
  const { banco, config } = await cenario(1);
  demanda(banco, 2, { fase: "encerramento", rodadas: ["concluida"], tickets: [encerrar("em_execucao")] });
  demanda(banco, 3, { rodadas: ["desenvolvimento"], tickets: [implementar(1)] });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.equal(status(banco, 3, 1), "aberto");
});

test("CA-7 e CA-10: o resolver_conflito aberto é reservado com execução aberta; o encerrar_demanda seguinte entra sozinho", async () => {
  const { banco, config } = await cenario(3);
  demanda(banco, 2, {
    fase: "encerramento",
    rodadas: ["concluida"],
    tickets: [{ etapa: "resolver_conflito" }, encerrar()],
  });
  await Promise.all(despacharDemandas(banco, config, deps));
  assert.deepEqual([status(banco, 2, 1), aberta(banco, 2, 1)], ["em_execucao", 1]);

  demanda(banco, 3, {
    fase: "encerramento",
    rodadas: ["concluida"],
    tickets: [{ etapa: "resolver_conflito", status: "concluido" }, encerrar()],
  });
  const fins = despacharDemandas(banco, config, deps);
  assert.deepEqual([status(banco, 3, 2), execucoes(banco, 3, 2)], ["em_execucao", 0]);
  await Promise.all(fins);
});
