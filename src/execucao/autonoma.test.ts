// Ponta a ponta do F4 §6.2 contra banco real, git real e um pi falso que fala o protocolo RPC (F4 §12).
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
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import type { Ator } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { iniciarExecucao, reabrirTicket, terminarExecucao } from "../dominio/execucao.ts";
import { decidirRegistro } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { submeter } from "../evidencias/submissao.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { caminhoDaWorktree } from "../repositorio/worktree.ts";
import { executarAutonomo } from "./autonoma.ts";
import { dialogosPendentes, responderDialogo } from "./gerente.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-autonoma-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const src = resolve(import.meta.dirname, "..");

// git sem a configuração do usuário da máquina.
const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

// Confiança do pi do "Auditor" (F4 §6.1.1), num diretório só do teste.
const agenteDir = join(base, "pi-agent");
mkdirSync(agenteDir);
process.env.PI_CODING_AGENT_DIR = agenteDir;

// Credenciais que o pi não pode receber (F4 §6.1.2).
process.env.GH_TOKEN = "segredo-gh";
process.env.AZURE_DEVOPS_EXT_PAT = "segredo-az";

/**
 * pi falso (F4 §12). Anota em $FALSO_PI_REGISTRO os argumentos, o cwd, o ambiente e cada comando recebido, e responde
 * ao prompt conforme $FALSO_PI: sucesso (roda o "agente" de $FALSO_PI_AGENTE), erro, recusa, dialogo, dorme
 * (ignora SIGTERM) e filho (deixa um processo filho e sai sem assentar).
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync } from "node:fs";
import { spawn } from "node:child_process";
const anotar = (o) => appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify(o) + "\\n");
if (process.argv.includes("--version")) {
  if (process.env.FALSO_PI === "versao-trava") setInterval(() => undefined, 1000);
  else {
    console.log("0.84.4-falso");
    process.exit(0);
  }
}
const variante = process.env.FALSO_PI;
const env = Object.fromEntries(
  Object.entries(process.env).filter(([k]) => /^(FABRIQUINHA_|GH_|AZURE_)/.test(k) && k !== "FABRIQUINHA_PI"),
);
anotar({ evento: "inicio", argv: process.argv.slice(2), cwd: process.cwd(), env, pid: process.pid });
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
process.stdout.write("aviso do pi fora do protocolo\\n");
process.stderr.write("stderr do pi falso\\n");
if (variante === "dorme") process.on("SIGTERM", () => anotar({ evento: "SIGTERM ignorado" }));
// Como o pi, grava cada resposta do assistente na sessão <session-dir>/<timestamp>_<session-id>.jsonl.
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
function assistente(stopReason, extra = {}) {
  const message = {
    role: "assistant", content: [], provider: "anthropic", model: "claude-teste", stopReason, ...extra,
    usage: { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, totalTokens: 112, cost: { total: 0.01 } },
  };
  mkdirSync(arg("--session-dir"), { recursive: true });
  appendFileSync(
    arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
    JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n",
  );
  emitir({ type: "message_end", message });
}
async function terminar() {
  if (process.env.FALSO_PI_AGENTE) await (await import(process.env.FALSO_PI_AGENTE)).default();
  assistente("stop");
  emitir({ type: "agent_settled" });
}
function aoPrompt(c) {
  if (variante === "recusa") return emitir({ type: "response", command: "prompt", success: false, error: "modelo inexistente" });
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  emitir({ type: "message_end" });
  emitir({ type: "message_end", message: { role: "user", content: c.message } });
  if (variante === "erro") {
    assistente("error", { errorMessage: "limite\\u2028de uso " + "x".repeat(3000) });
    emitir({ type: "agent_settled" });
  } else if (variante === "dialogo") {
    emitir({ type: "extension_ui_request", id: "n1", method: "notify", message: "olá" });
    emitir({ type: "extension_ui_request", id: "c1", method: "confirm", title: "Seguir?", timeout: 1000 });
    emitir({ type: "extension_ui_request", id: "d1", method: "select", title: "Qual?", options: ["a", "b"] });
    emitir({ type: "extension_ui_request", id: "d2", method: "editor", title: "Explique" });
  } else if (variante === "filho") {
    const filho = spawn("sleep", ["300"], { stdio: "ignore" });
    anotar({ evento: "filho", pid: filho.pid });
    process.exit(3);
  } else if (variante !== "dorme") {
    void terminar();
  }
}
const respondidos = new Set();
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    anotar({ evento: "comando", comando: c });
    if (c.type === "prompt") aoPrompt(c);
    if (c.type === "extension_ui_response") {
      respondidos.add(c.id);
      if (respondidos.has("d1") && respondidos.has("d2")) void terminar();
    }
  }
});
`;
const pi = join(base, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

/** "Agente" do desenho: usa o ambiente da execução para submeter as evidências, criar o ticket e sujar a worktree. */
const agente = join(base, "agente.mjs");
writeFileSync(
  agente,
  `import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { adicionarTicketDesenvolvimento } from "${src}/dominio/tickets.ts";
import { submeter } from "${src}/evidencias/submissao.ts";
import { abrir } from "${src}/persistencia/banco.ts";
import { comIssue } from "${src}/persistencia/issues.ts";
export default async function () {
  const banco = abrir(process.env.FABRIQUINHA_ROOT);
  const execucao = Number(process.env.FABRIQUINHA_EXECUCAO);
  const { ticket, issue } = banco
    .prepare("SELECT e.ticket, t.issue FROM execucao e JOIN ticket t ON t.id = e.ticket WHERE e.id = ?")
    .get(execucao);
  const ator = { tipo: "agente", execucao, ticket };
  const html = (nome) => {
    const caminho = join(process.env.FABRIQUINHA_SAIDA, nome);
    writeFileSync(caminho, "<!DOCTYPE html><html><body>" + nome + "</body></html>");
    return caminho;
  };
  submeter(banco, ator, "desenho_solucao", {
    resumo: "cache na busca",
    arquivosPrevistos: [{ caminho: "src/busca.ts", acao: "alterar", motivo: "lê do cache" }],
  }, [html("desenho.html")]);
  submeter(banco, ator, "relatorio_complexidade", {
    variaveis: [{ simbolo: "n", significado: "itens" }],
    fluxos: [{ nome: "Busca", gatilho: "GET /busca", situacao: "novo", depois: { tempo: "O(log n)", espaco: "O(n)" } }],
  }, [html("fluxos.html")]);
  submeter(banco, ator, "relatorio_impactos_arquitetura",
    { impacto: "baixo", novasDependencias: [], novosAcoplamentos: [], riscos: [] }, [html("impactos.html")]);
  comIssue(banco, issue, "adicionarTicketDesenvolvimento", ator, (ag, ctx) =>
    adicionarTicketDesenvolvimento(ag, { titulo: "Cache na busca" }, ator, ctx));
  writeFileSync("rascunho-do-prototipo.txt", "descartável\\n");
  banco.close();
}
`,
);

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const PACOTE = "/opt/pi-fabriquinha";

interface Cenario {
  raiz: string;
  banco: DatabaseSync;
  repo: string;
  worktree: string;
  /** O que o pi falso anotou. */
  registro(): Record<string, unknown>[];
  log(execucao: number): string;
  /** Ticket, execuções e fase da issue, lidos do banco. */
  estado(): {
    fase: string;
    ticket: { status: string; erro?: string; instrucao?: string };
    execucoes: { id: number; resultado: string; erro?: string; sessaoPi: string }[];
  };
}

let n = 0;
/**
 * Projeto `loja` com repositório e `origin` bare reais, e a I-1 (problema) com o registro aprovado: o desenho T-2
 * aberto, na fase `desenho`. A E-1 foi a sessão de registro.
 */
function cenario({ preparacao = [] as string[], variante = "sucesso", comAgente = true } = {}): Cenario {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, ".gitignore"), "node_modules/\n");
  git(repo, "add", ".gitignore");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "push", "-q", "origin", "main");
  writeFileSync(join(agenteDir, "trust.json"), JSON.stringify({ [repo]: true }));

  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao,
    testes: ["npm test"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    modelos: { desenho: { provedor: "anthropic", modelo: "claude-teste" } },
  });
  registrarIssue(banco, { projeto: "loja" }, auditor);
  comIssue(banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(ag, { ticket: 1, modo: "interativo", sessaoPi: crypto.randomUUID() }, fabriquinha, ctx),
  );
  const saida1 = join(raiz, "execucoes", "E-1", "saida");
  mkdirSync(saida1, { recursive: true });
  writeFileSync(join(saida1, "busca.log"), "busca levou 8 s\n");
  const registrador: Ator = { tipo: "agente", execucao: 1, ticket: 1 };
  submeter(banco, registrador, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }, [
    join(saida1, "busca.log"),
  ]);
  submeter(
    banco,
    registrador,
    "criterios_aceite",
    { criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }] },
    [],
  );
  comIssue(banco, 1, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "Busca lenta", tipo: "problema" }, auditor),
  );
  comIssue(banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
    terminarExecucao(ag, { execucao: 1, resultado: "sucesso" }, fabriquinha, ctx),
  );
  comIssue(banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, { aprovado: true }, auditor, ctx));

  const registro = join(dir, "registro.jsonl");
  process.env.FALSO_PI_REGISTRO = registro;
  process.env.FALSO_PI = variante;
  if (comAgente) process.env.FALSO_PI_AGENTE = agente;
  else delete process.env.FALSO_PI_AGENTE;
  return {
    raiz,
    banco,
    repo,
    worktree: caminhoDaWorktree(raiz, "loja", 1),
    registro: () =>
      existsSync(registro)
        ? readFileSync(registro, "utf8")
            .trim()
            .split("\n")
            .map((l) => JSON.parse(l) as Record<string, unknown>)
        : [],
    log: (execucao) => readFileSync(join(raiz, "execucoes", `E-${String(execucao)}`, "log"), "utf8"),
    estado() {
      const ag = agregado(banco, 1);
      assert.ok(ag);
      const ticket = ag.tickets.find((t) => t.id === 2);
      assert.ok(ticket);
      return { fase: ag.issue.fase, ticket, execucoes: ag.execucoes.filter((e) => e.ticket === 2) };
    },
  };
}

/** As linhas de `uso` da execução, como listas. */
const uso = (banco: DatabaseSync, execucao: number) =>
  banco
    .prepare("SELECT * FROM uso WHERE execucao = ? ORDER BY provedor, modelo")
    .all(execucao)
    .map((l) => Object.values(l).slice(1));

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** Espera até 2 s o processo sumir (o SIGKILL não espera o reap); devolve se ele morreu. */
async function morreu(pid: number): Promise<boolean> {
  for (let i = 0; vivo(pid) && i < 100; i++) await dormir(20);
  return !vivo(pid);
}

test("sucesso: pi em grupo próprio com as flags e o ambiente do F4, prompt.md e log, coleta, C6 e C7", async () => {
  const c = cenario();
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });

  const { fase, ticket, execucoes } = c.estado();
  assert.equal(fase, "aprovacao_desenho");
  assert.equal(ticket.status, "concluido");
  assert.equal(execucoes.length, 1);
  const [execucao] = execucoes;
  assert.ok(execucao);
  assert.equal(execucao.resultado, "sucesso");
  assert.equal(execucao.id, 2);

  const [inicio, ...comandos] = c.registro();
  assert.ok(inicio);
  const dir = join(c.raiz, "execucoes", "E-2");
  assert.deepEqual(inicio.argv, [
    "--mode",
    "rpc",
    "--session-dir",
    join(c.raiz, "sessoes"),
    "--session-id",
    execucao.sessaoPi,
    "--provider",
    "anthropic",
    "--model",
    "claude-teste",
    "--skill",
    `${PACOTE}/skills/artefato-desenho-solucao`,
    "--skill",
    `${PACOTE}/skills/artefato-prototipo`,
    "--skill",
    `${PACOTE}/skills/artefato-complexidade`,
    "--skill",
    `${PACOTE}/skills/artefato-impactos-arquitetura`,
    "-e",
    `${PACOTE}/extensions/guarda.ts`,
    "--approve",
  ]);
  assert.equal(inicio.cwd, c.worktree);
  assert.deepEqual(inicio.env, {
    FABRIQUINHA_EXECUCAO: "2",
    FABRIQUINHA_ROOT: c.raiz,
    FABRIQUINHA_SAIDA: join(dir, "saida"),
    GH_CONFIG_DIR: join(dir, "vazio"),
    AZURE_CONFIG_DIR: join(dir, "vazio"),
  });
  // Grupo próprio: o pi é o líder, e o banco guarda o grupo para o reinício (F4 §7).
  const pgid = c.banco.prepare("SELECT pgid_pi FROM execucao WHERE id = 2").get()?.pgid_pi;
  assert.equal(pgid, inicio.pid);
  assert.ok(await morreu(Number(inicio.pid)), "o pi foi parado depois de assentar");

  const prompt = readFileSync(join(dir, "prompt.md"), "utf8");
  assert.deepEqual(comandos, [{ evento: "comando", comando: { type: "prompt", message: prompt } }]);
  assert.match(prompt, /^# Contexto\n/);
  assert.match(prompt, /CA-1\*\*: dado mil itens/);
  assert.match(prompt, /`artefato-impactos-arquitetura`/);
  assert.match(prompt, /## Execução autônoma/);

  const log = c.log(2);
  assert.match(log, /pi --version: 0\.84\.4-falso\n/);
  assert.match(log, /^stderr do pi falso$/m);
  assert.match(log, /fora do protocolo: aviso do pi fora do protocolo/);
  assert.match(log, /T-2 concluído\n$/);
  // F6 §3.3: o uso da sessão foi coletado logo depois do C6.
  assert.deepEqual(uso(c.banco, 2), [["anthropic", "claude-teste", 1, 10, 2, 100, 0, 0.01]]);
  // Coleta do desenho (F3 §7): o rascunho do agente foi descartado, e as evidências ficaram.
  assert.match(log, /descarte removeu: rascunho-do-prototipo\.txt/);
  assert.equal(existsSync(join(c.worktree, "rascunho-do-prototipo.txt")), false);
  c.banco.close();
});

test("stopReason error: C6 + C8 com o erro do pi inteiro, mesmo com U+2028, cortado em 2.000 caracteres; responder e retomar continua a mesma sessão", async () => {
  const c = cenario({ variante: "erro" });
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });

  let { ticket, execucoes } = c.estado();
  assert.equal(ticket.status, "falhou");
  const erro = String(ticket.erro);
  assert.ok(erro.startsWith("o agente parou com stopReason error: limite\u2028de uso xxx"));
  assert.equal(erro.length, 2000);
  assert.deepEqual(
    execucoes.map((e) => [e.resultado, e.erro]),
    [["falha", erro]],
  );
  assert.equal(c.banco.prepare("SELECT 1 FROM execucao WHERE resultado = 'em_andamento'").get(), undefined);

  // F4 §6.4: o Auditor responde (C9), e a nova execução continua a mesma sessão, com a instrução primeiro.
  comIssue(c.banco, 1, "reabrirTicket", auditor, (ag) =>
    reabrirTicket(ag, { ticket: 2, instrucao: "Use o índice que já existe." }, auditor),
  );
  process.env.FALSO_PI = "sucesso";
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });

  ({ ticket, execucoes } = c.estado());
  assert.equal(ticket.status, "concluido");
  assert.equal(ticket.instrucao, undefined, "C5 consumiu a instrução");
  assert.deepEqual(
    execucoes.map((e) => e.resultado),
    ["falha", "sucesso"],
  );
  assert.equal(execucoes[1]?.sessaoPi, execucoes[0]?.sessaoPi);
  // Mesma sessão, uma resposta em cada janela: a da falha também foi coletada depois do seu C6.
  assert.deepEqual(uso(c.banco, 2), [["anthropic", "claude-teste", 1, 10, 2, 100, 0, 0.01]]);
  assert.deepEqual(uso(c.banco, 3), [["anthropic", "claude-teste", 1, 10, 2, 100, 0, 0.01]]);
  const inicios = c.registro().filter((r) => r.evento === "inicio");
  const sessao = (r: Record<string, unknown> | undefined) => (r?.argv as string[]).at(5);
  assert.equal(sessao(inicios[1]), sessao(inicios[0]));
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "E-3", "prompt.md"), "utf8"),
    /^# Instrução do Auditor\n\nUse o índice/,
  );
  c.banco.close();
});

test("diálogo: o tempo esperando o Auditor não conta; respondido, a execução segue, e o C7 sem evidência vira C8", async () => {
  const c = cenario({ variante: "dialogo", comAgente: false });
  // Limite de 3 s: folga para o pi falso subir numa máquina carregada antes de abrir os diálogos.
  const execucao = executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 0.05 });
  for (let espera = 0; dialogosPendentes(2).length < 3; espera += 20) {
    assert.ok(espera < 10_000, "os diálogos não chegaram em 10 s");
    await dormir(20);
  }
  assert.deepEqual(
    dialogosPendentes(2).map((d) => [d.id, d.method, d.expiraEm !== undefined]),
    [
      ["c1", "confirm", true],
      ["d1", "select", false],
      ["d2", "editor", false],
    ],
    "notify não fica pendente; o diálogo com timeout fica, com a expiração",
  );
  const c1 = dialogosPendentes(2)[0];
  assert.equal(Date.parse(String(c1?.expiraEm)) - Date.parse(String(c1?.em)), 1000);
  await dormir(1200); // o pi resolve o c1 sozinho quando expira
  assert.deepEqual(
    dialogosPendentes(2).map((d) => d.id),
    ["d1", "d2"],
  );
  await dormir(3500); // além do limite de 3 s
  assert.equal(c.estado().execucoes[0]?.resultado, "em_andamento");
  assert.throws(
    () => {
      responderDialogo(2, "x9", { cancelled: true });
    },
    (e) => e instanceof ErroDeRegra && e.message === "o diálogo x9 não está pendente na E-2 (atualize o chat)",
  );
  responderDialogo(2, "d1", { value: "a" });
  await dormir(3500); // um diálogo ainda pendente: o relógio continua parado
  assert.equal(c.estado().execucoes[0]?.resultado, "em_andamento");
  responderDialogo(2, "d2", { value: "porque sim" });
  await execucao;

  assert.deepEqual(dialogosPendentes(2), []);
  assert.throws(
    () => {
      responderDialogo(2, "d1", { value: "a" });
    },
    (e) => e instanceof ErroDeRegra && e.message === "a execução E-2 não tem pi rodando (nada a responder)",
  );
  const respostas = c
    .registro()
    .filter((r) => r.evento === "comando")
    .map((r) => r.comando)
    .slice(1);
  assert.deepEqual(respostas, [
    { type: "extension_ui_response", id: "d1", value: "a" },
    { type: "extension_ui_response", id: "d2", value: "porque sim" },
  ]);
  const { ticket, execucoes } = c.estado();
  assert.equal(execucoes[0]?.resultado, "sucesso");
  assert.equal(ticket.status, "falhou");
  assert.match(
    String(ticket.erro),
    /^T-2 não pode concluir: falta a evidência desenho_solucao, relatorio_complexidade/,
  );
  c.banco.close();
});

test("tempo limite: SIGTERM no grupo, 10 s, SIGKILL, e C8 com tempo limite de N min", async () => {
  const c = cenario({ variante: "dorme" });
  const inicio = Date.now();
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 0.005 });
  const duracao = Date.now() - inicio;

  const { ticket, execucoes } = c.estado();
  assert.equal(ticket.status, "falhou");
  assert.equal(ticket.erro, "tempo limite de 0.005 min");
  assert.equal(execucoes[0]?.erro, "tempo limite de 0.005 min");
  const registro = c.registro();
  assert.ok(registro.some((r) => r.evento === "SIGTERM ignorado"));
  assert.ok(duracao >= 10_000, `esperou ${String(duracao)} ms antes do SIGKILL`);
  assert.ok(await morreu(Number(registro[0]?.pid)));
  c.banco.close();
});

test("pi que deixa um filho e some: falha dizendo que o pi saiu, e o grupo inteiro morre", async () => {
  const c = cenario({ variante: "filho" });
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });

  const { ticket, execucoes } = c.estado();
  const log = join(c.raiz, "execucoes", "E-2", "log");
  assert.equal(ticket.status, "falhou");
  assert.equal(ticket.erro, `o pi saiu antes de terminar a execução (código 3); veja o log em ${log}`);
  assert.equal(execucoes[0]?.resultado, "falha");
  const filho = Number(c.registro().find((r) => r.evento === "filho")?.pid);
  assert.ok(await morreu(filho), "o filho que o pi deixou foi morto com o grupo");
  c.banco.close();
});

test("pi que recusa o prompt falha na hora, sem esperar o tempo limite", async () => {
  const c = cenario({ variante: "recusa" });
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });
  assert.equal(c.estado().ticket.erro, "o pi recusou o comando prompt: modelo inexistente");
  c.banco.close();
});

test("pi --version travado conta no tempo limite: C8 em vez de execução presa em andamento", async () => {
  const c = cenario({ variante: "versao-trava" });
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 0.005 });
  const { ticket, execucoes } = c.estado();
  assert.equal(ticket.erro, "tempo limite de 0.005 min em pi --version");
  assert.equal(execucoes[0]?.resultado, "falha");
  assert.ok(
    c.registro().every((r) => !(r.argv as string[]).includes("--mode")),
    "o pi não chegou a ser lançado em modo RPC",
  );
  c.banco.close();
});

test("um throw que não é Error também vira C6 + C8 com o texto, nunca sucesso", async (t) => {
  const c = cenario();
  const original = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (...args: Parameters<typeof fs.writeFileSync>) => {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- é o caso testado
    if (String(args[0]).endsWith("prompt.md")) throw "disco cheio";
    original(...args);
  });
  syncBuiltinESMExports();
  try {
    await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });
  } finally {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  }
  const { ticket, execucoes } = c.estado();
  assert.equal(ticket.status, "falhou");
  assert.equal(ticket.erro, "disco cheio");
  assert.equal(execucoes[0]?.erro, "disco cheio");
  c.banco.close();
});

test("falha antes do pi (preparação da worktree): C6 + C8 com a mensagem, sem lançar o pi nem deixar execução órfã", async () => {
  const c = cenario({ preparacao: ["exit 7"] });
  await executarAutonomo(c.banco, 2, { pacote: PACOTE, timeoutMin: 1 });

  const { ticket, execucoes } = c.estado();
  assert.equal(ticket.status, "falhou");
  assert.match(String(ticket.erro), /^a preparação da worktree falhou em "exit 7": saiu com código 7/);
  assert.equal(execucoes[0]?.resultado, "falha");
  assert.deepEqual(c.registro(), []);
  assert.match(c.log(2), /T-2 falhou: a preparação da worktree falhou/);
  c.banco.close();
});

test("C5 recusado ou ticket inexistente: rejeita sem criar execução nem lançar o pi", async () => {
  const c = cenario();
  await assert.rejects(
    executarAutonomo(c.banco, 99, { pacote: PACOTE, timeoutMin: 1 }),
    (e) => e instanceof ErroDeRegra && e.message === "o ticket T-99 não existe (confira o número do ticket)",
  );
  await assert.rejects(
    executarAutonomo(c.banco, 1, { pacote: PACOTE, timeoutMin: 1 }),
    (e) => e instanceof ErroDeRegra && e.message.startsWith("T-1 é da etapa registro, que roda em modo interativo"),
  );
  assert.deepEqual(c.estado().execucoes, []);
  assert.deepEqual(c.registro(), []);
  c.banco.close();
});
