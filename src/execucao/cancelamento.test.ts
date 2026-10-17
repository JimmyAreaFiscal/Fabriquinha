// Cancelamento da issue com execução viva (C22), de ponta a ponta contra banco real, git real e um pi falso que fala o
// protocolo RPC (F4 §12): autônoma rodando e interativa ociosa.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { type Ator, AUDITOR, CANCELADA } from "../dominio/agregado.ts";
import { ErroDeRegra, existe } from "../dominio/erros.ts";
import { iniciarExecucao, terminarExecucao } from "../dominio/execucao.ts";
import { decidirRegistro, enviarParaAprovacao } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { submeter } from "../evidencias/submissao.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregadoExistente, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { executarAutonomo } from "./autonoma.ts";
import { cancelarIssue } from "./cancelamento.ts";
import { foiCancelada, pararParaCancelar, situacao } from "./gerente.ts";
import { iniciarInterativa } from "./sessoes.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-cancelamento-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

const agenteDir = join(base, "pi-agent");
mkdirSync(agenteDir);
process.env.PI_CODING_AGENT_DIR = agenteDir;

/**
 * pi falso. Ao receber o prompt, grava uma resposta do assistente (com uso) na sessão e anota o pid em
 * $FALSO_PI_REGISTRO. `espera` fica trabalhando (a autônoma rodando); `conversa` assenta (a interativa ociosa).
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync } from "node:fs";
if (process.argv.includes("--version")) {
  if (process.env.FALSO_PI === "versao-trava") {
    // Espera o teste liberar (cria $FALSO_PI_REGISTRO.libera) e então responde como se nada tivesse acontecido.
    appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify({ versao: process.pid }) + "\\n");
    while (!existsSync(process.env.FALSO_PI_REGISTRO + ".libera")) await new Promise((r) => setTimeout(r, 20));
  }
  console.log("0.84.4-falso");
  process.exit(0);
}
if (process.env.FALSO_PI === "versao-trava") throw new Error("o pi não devia subir");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify({ pid: process.pid }) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    if (JSON.parse(linha).type !== "prompt") continue;
    emitir({ type: "response", command: "prompt", success: true });
    emitir({ type: "agent_start" });
    const message = {
      role: "assistant", content: [{ type: "text", text: "trabalhando" }], provider: "anthropic", model: "claude-teste",
      stopReason: "stop", usage: { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, totalTokens: 112, cost: { total: 0.01 } },
    };
    mkdirSync(arg("--session-dir"), { recursive: true });
    appendFileSync(
      arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
      JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n",
    );
    emitir({ type: "message_end", message });
    if (process.env.FALSO_PI === "conversa") emitir({ type: "agent_settled" });
  }
});
setInterval(() => undefined, 1000);
`;
const pi = join(base, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

const fabriquinha: Ator = { tipo: "fabriquinha" };

const dir = join(base, "c");
const bare = join(dir, "origin.git");
const repo = join(dir, "repo");
const raiz = join(dir, "raiz");
git(base, "init", "-q", "--bare", bare);
git(base, "clone", "-q", bare, repo);
git(repo, "checkout", "-q", "-b", "main");
writeFileSync(join(repo, "LEIAME"), "loja\n");
git(repo, "add", "LEIAME");
git(repo, "commit", "-q", "-m", "início");
git(repo, "push", "-q", "origin", "main");
writeFileSync(join(agenteDir, "trust.json"), JSON.stringify({ [repo]: true }));
const registro = join(dir, "registro.jsonl");
process.env.FALSO_PI_REGISTRO = registro;

const banco = abrir(raiz);
registrarProjeto(banco, {
  nome: "loja",
  repo,
  branchBase: "main",
  hospedagem: "github",
  preparacao: [],
  testes: ["npm test"],
  sonar: { projectKey: "loja" },
  fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  modelos: { revisao: { provedor: "anthropic", modelo: "claude-teste" } },
});
after(() => {
  banco.close();
});

/**
 * Issue nova, com o registro aprovado e um ticket autônomo aberto: o de desenho que o registro criou vira revisão por
 * UPDATE, como em autonoma.test.ts (o desenho é interativo). Devolve a issue e esse ticket.
 */
async function issueNaRevisao(deps: number[] = []): Promise<{ issue: number; ticket: number }> {
  const issue = registrarIssue(banco, { projeto: "loja", deps }, AUDITOR).issue.id;
  comIssue(banco, issue, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: aqui(ag.tickets[0]).id, modo: "interativo", sessaoPi: crypto.randomUUID() },
      fabriquinha,
      ctx,
    ),
  );
  const ag = lerIssue(issue);
  const { id: execucao, ticket } = aqui(ag.execucoes[0]);
  const saida = join(raiz, "execucoes", `E-${String(execucao)}`, "saida");
  mkdirSync(saida, { recursive: true });
  writeFileSync(join(saida, "busca.log"), "busca levou 8 s\n");
  const agente: Ator = { tipo: "agente", execucao, ticket };
  await submeter(banco, agente, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }, [
    join(saida, "busca.log"),
  ]);
  await submeter(
    banco,
    agente,
    "criterios_aceite",
    { criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }] },
    [],
  );
  comIssue(banco, issue, "editarIssue", AUDITOR, (a) =>
    editarIssue(a, { titulo: "Busca lenta", tipo: "problema" }, AUDITOR),
  );
  comIssue(banco, issue, "enviarParaAprovacao", agente, (a, ctx) => enviarParaAprovacao(a, { ticket }, agente, ctx));
  comIssue(banco, issue, "terminarExecucao", fabriquinha, (a, ctx) =>
    terminarExecucao(a, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
  );
  comIssue(banco, issue, "decidirRegistro", AUDITOR, (a, ctx) => decidirRegistro(a, { aprovado: true }, AUDITOR, ctx));
  const revisao = aqui(lerIssue(issue).tickets.find((t) => t.etapa === "desenho")).id;
  banco.exec(
    `UPDATE issue SET fase = 'revisao' WHERE id = ${String(issue)}; UPDATE ticket SET etapa = 'revisao' WHERE id = ${String(revisao)}`,
  );
  return { issue, ticket: revisao };
}

const lerIssue = (issue: number) => agregadoExistente(banco, issue);
const aqui = <T>(valor: T | undefined): T => existe(valor, "faltou no cenário do teste", "confira o teste");

/** Espera `condicao` ficar verdadeira, até 10 s. */
async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

const uso = (execucao: number) =>
  banco
    .prepare("SELECT * FROM uso WHERE execucao = ? ORDER BY provedor, modelo")
    .all(execucao)
    .map((l) => Object.values(l).slice(1));
const USO = [["anthropic", "claude-teste", 1, 10, 2, 100, 0, 0.01]];

const pids = () =>
  readFileSync(registro, "utf8")
    // O pi falso pode estar escrevendo a última linha agora: só conta a que já terminou em \n.
    .split("\n")
    .slice(0, -1)
    .map((l) => (JSON.parse(l) as { pid: number }).pid);
const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Uma issue com o ticket de registro numa sessão interativa ociosa (o pi vivo, esperando a próxima mensagem). */
async function interativaOciosa(deps: number[] = []): Promise<{ issue: number; execucao: number }> {
  const issue = registrarIssue(banco, { projeto: "loja", deps }, AUDITOR).issue.id;
  const sessao = iniciarInterativa(banco, aqui(lerIssue(issue).tickets[0]).id, "oi", { ociosidadeMin: 5 });
  const execucao = aqui(lerIssue(issue).execucoes[0]).id;
  await ate(() => situacao(sessao)?.ocupado === false, "a sessão ficar ociosa");
  return { issue, execucao };
}

test("autônoma rodando: o pi para, o log para de crescer, o ticket fica cancelado e o uso é contado", async () => {
  process.env.FALSO_PI = "espera";
  const { issue, ticket } = await issueNaRevisao();
  const rodando = executarAutonomo(banco, ticket, { timeoutMin: 1 });
  const execucao = (): number => lerIssue(issue).execucoes.find((e) => e.ticket === ticket)?.id ?? 0;
  await ate(
    () => execucao() > 0 && existsSync(join(raiz, "execucoes", `E-${String(execucao())}`, "saida")),
    "a execução",
  );
  await ate(() => existsSync(registro) && pids().length > 0, "o pi subir");
  const pid = aqui(pids().at(-1));
  const log = join(raiz, "execucoes", `E-${String(execucao())}`, "log");
  await ate(() => /"?pi /.test(readFileSync(log, "utf8")), "o pi lançado");
  await dormir(300); // o prompt chega ao pi e ele grava a resposta

  assert.deepEqual(await cancelarIssue(banco, issue), { canceladas: [issue] });
  await rodando;

  assert.equal(foiCancelada(execucao()), true);
  assert.equal(vivo(pid), false);
  const tamanho = statSync(log).size;
  await dormir(300);
  assert.equal(statSync(log).size, tamanho, "o log não cresce depois do cancelamento");
  assert.match(readFileSync(log, "utf8"), /E-\d+ cancelada com a I-\d+ pelo Auditor\n$/);

  const ag = lerIssue(issue);
  assert.match(String(ag.issue.canceladaEm), /^\d{4}-/);
  assert.equal(ag.tickets.find((t) => t.id === ticket)?.status, "cancelado");
  const e = aqui(ag.execucoes.find((x) => x.id === execucao()));
  assert.deepEqual([e.resultado, e.erro], ["falha", CANCELADA]);
  assert.deepEqual(uso(execucao()), USO);
});

test("interativa ociosa: o pi para, o ticket fica cancelado, a execução falha com CANCELADA e o uso é contado", async () => {
  process.env.FALSO_PI = "conversa";
  const { issue, execucao } = await interativaOciosa();
  const pid = aqui(pids().at(-1));

  assert.deepEqual(await cancelarIssue(banco, issue), { canceladas: [issue] });

  assert.equal(vivo(pid), false);
  const ag = lerIssue(issue);
  assert.equal(ag.tickets[0]?.status, "cancelado");
  const e = aqui(ag.execucoes.find((x) => x.id === execucao));
  assert.deepEqual([e.resultado, e.erro], ["falha", CANCELADA]);
  assert.deepEqual(uso(execucao), USO);
  assert.equal(situacao(e.sessaoPi), undefined);
});

test("dependentes: as execuções vivas delas também param, e a dependência não é cancelada", async () => {
  process.env.FALSO_PI = "conversa";
  const { issue: dependencia } = await issueNaRevisao();
  const a = await interativaOciosa();
  const b = await interativaOciosa([a.issue]);
  const c = await interativaOciosa([b.issue]);

  const { canceladas } = await cancelarIssue(banco, a.issue);

  assert.deepEqual(canceladas, [a.issue, b.issue, c.issue]);
  for (const { issue, execucao } of [a, b, c]) {
    const ag = lerIssue(issue);
    assert.equal(ag.tickets[0]?.status, "cancelado");
    assert.deepEqual([ag.execucoes.find((e) => e.id === execucao)?.erro, foiCancelada(execucao)], [CANCELADA, true]);
    assert.deepEqual(uso(execucao), USO);
  }
  assert.equal(lerIssue(dependencia).issue.canceladaEm, undefined);
});

test("sem execução: os tickets abertos ficam fechados; cancelar de novo é recusado", async () => {
  const { issue } = await issueNaRevisao();

  assert.deepEqual(await cancelarIssue(banco, issue), { canceladas: [issue] });

  const ag = lerIssue(issue);
  assert.equal(
    ag.tickets.some((t) => t.status === "aberto"),
    false,
  );
  assert.equal(ag.tickets.at(-1)?.status, "fechado");
  await assert.rejects(
    cancelarIssue(banco, issue),
    (e: unknown) =>
      e instanceof ErroDeRegra && e.message === `a I-${String(issue)} já está cancelada (não há mais nada a fazer)`,
  );
});

test("cancelada antes de o pi subir: nem o pi nem o pi --version são lançados, e a autônoma não grava nada", async () => {
  process.env.FALSO_PI = "versao-trava";
  const { issue, ticket } = await issueNaRevisao();
  const proxima = Number(banco.prepare("SELECT MAX(id) + 1 AS n FROM execucao").get()?.n);
  await pararParaCancelar(proxima);

  await executarAutonomo(banco, ticket, { timeoutMin: 1 });

  const ag = lerIssue(issue);
  assert.deepEqual(
    [aqui(ag.tickets.find((t) => t.id === ticket)).status, aqui(ag.execucoes.find((e) => e.id === proxima)).resultado],
    ["em_execucao", "em_andamento"],
  );
  await cancelarIssue(banco, issue); // quem grava o término é o cancelamento, e a issue fica livre
});

test("cancelada durante o pi --version: o pi não sobe e a autônoma não grava nada", async () => {
  process.env.FALSO_PI = "versao-trava";
  const { issue, ticket } = await issueNaRevisao();
  const pisAntes = readFileSync(registro, "utf8").split('"pid"').length;
  const rodando = executarAutonomo(banco, ticket, { timeoutMin: 1 });
  await ate(() => readFileSync(registro, "utf8").includes('"versao"'), "o pi --version");

  await cancelarIssue(banco, issue);
  writeFileSync(`${registro}.libera`, "");
  await rodando;

  const e = aqui(lerIssue(issue).execucoes.find((x) => x.ticket === ticket));
  assert.deepEqual([e.resultado, e.erro], ["falha", CANCELADA]);
  assert.equal(readFileSync(registro, "utf8").split('"pid"').length, pisAntes, "nenhum pi subiu");
});
