// Sessões (F4 §5, §6.6): o estado calculado em cada caso e, de ponta a ponta contra banco real, git real e um pi
// falso que fala o protocolo RPC (F4 §12), registro, ociosidade e retomada, diálogo pendente, steer e aborto.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { type Agregado, AUDITOR, CANCELADA, type Execucao, type Ticket } from "../dominio/agregado.ts";
import { ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import type { Fase } from "../dominio/primitivos.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, propostasDaIssue, proporIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { caminhoDaWorktree, garantirWorktree } from "../repositorio/worktree.ts";
import { abortar, atividadeDo, type Dialogo, encerrar, responderDialogo, type Situacao, situacao } from "./gerente.ts";
import { type EventoPi, PACOTE } from "./pi.ts";
import {
  abrirChat,
  avisoDaProposta,
  concluirSessao,
  conversarSobre,
  decidirProposta,
  decidirGate,
  encerrarIssue,
  enviar,
  estadoDaSessao,
  infoDaSessao,
  pedirMudancas,
  registrarNecessidade,
  sessoes,
} from "./sessoes.ts";

// ---------------------------------------------------------------------------------------------------------------
// Estado calculado (F4 §5.2), sobre agregados montados à mão.

const T0 = "2026-10-11T10:00:00.000Z";
const T1 = "2026-10-11T11:00:00.000Z";
const SESSAO = "00000000-0000-4000-8000-000000000001";

const ticket = (t: Partial<Ticket> & Pick<Ticket, "id" | "etapa" | "status">): Ticket => ({
  issue: 1,
  titulo: "t",
  descricao: "",
  origem: "fabriquinha",
  criadoEm: T0,
  ...(t.status === "concluido" && { concluidoEm: T1 }),
  ...(t.status === "falhou" && { erro: "deu ruim" }),
  ...t,
});

const execucao = (e: Partial<Execucao> & Pick<Execucao, "ticket" | "modo" | "resultado">): Execucao => ({
  id: 1,
  sessaoPi: SESSAO,
  iniciadaEm: T0,
  ...(e.resultado !== "em_andamento" && { terminadaEm: T1 }),
  ...e,
});

const agregadoCom = (
  fase: Fase,
  tickets: Ticket[],
  execucoes: Execucao[],
  extra: Partial<Agregado> = {},
): Agregado => ({
  issue: { id: 1, projeto: "loja", titulo: null, tipo: null, descricao: "", fase, deps: [], criadaEm: T0 },
  tickets,
  execucoes,
  decisoes: [],
  evidencias: [],
  ...extra,
});

const estado = (ag: Agregado, viva?: Situacao) => {
  const { estado, motivo, desde } = estadoDaSessao(ag, SESSAO, { viva });
  return [estado, motivo, desde];
};

test("a sessão leva o modelo da última execução, quando ele foi escolhido", () => {
  const modelo = { provedor: "anthropic", modelo: "claude-opus-5-5" };
  const ag = (e: Partial<Execucao>) =>
    agregadoCom(
      "desenho",
      [ticket({ id: 2, etapa: "desenho", status: "em_execucao" })],
      [execucao({ ticket: 2, modo: "autonomo", resultado: "em_andamento", ...e })],
    );
  const fatos = { viva: undefined };
  assert.deepEqual(estadoDaSessao(ag({ modelo }), SESSAO, fatos).modelo, modelo);
  assert.equal("modelo" in estadoDaSessao(ag({}), SESSAO, fatos), false, "o padrão do pi");
});

test("estado: autônoma rodando, inclusive na coleta depois do C6 e reaberta à espera do agendador", () => {
  const desenho = (status: Ticket["status"], resultado: Execucao["resultado"]) =>
    agregadoCom(
      "revisao",
      [ticket({ id: 2, etapa: "revisao", status })],
      [execucao({ ticket: 2, modo: "autonomo", resultado })],
    );
  assert.deepEqual(estado(desenho("em_execucao", "em_andamento")), ["rodando", undefined, T0]);
  const viva = { execucao: 1, ocupado: true, desde: T1, dialogos: [] };
  assert.deepEqual(estado(desenho("em_execucao", "em_andamento"), viva), ["rodando", undefined, T1]);
  assert.deepEqual(estado(desenho("em_execucao", "sucesso")), ["rodando", undefined, T1]);
  assert.deepEqual(estado(desenho("aberto", "falha")), ["rodando", undefined, T1]);
  assert.deepEqual(estado(desenho("falhou", "falha")), ["aguardando_humano", "falha", T1]);
});

test("atividade: a ferramenta com o comando ou o caminho, ou a primeira linha do texto do agente; o resto não diz", () => {
  const ferramenta = (args: unknown) => atividadeDo({ type: "tool_execution_start", toolName: "bash", args });
  assert.equal(ferramenta({ command: "npm test" }), "bash npm test");
  assert.equal(ferramenta({ path: "src/a.ts", content: "x" }), "bash src/a.ts");
  assert.equal(ferramenta(undefined), "bash");
  assert.equal(ferramenta({ command: "x".repeat(200) }), `bash ${"x".repeat(94)}…`);
  const doAgente = (content: unknown, role = "assistant") =>
    atividadeDo({ type: "message_end", message: { role, content } });
  assert.equal(
    doAgente([
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "\n  Escrevendo o relatório de complexidade\nresto" },
    ]),
    "Escrevendo o relatório de complexidade",
  );
  assert.equal(doAgente([{ type: "toolCall", id: "t" }]), undefined);
  assert.equal(doAgente("texto"), undefined);
  assert.equal(doAgente([{ type: "text", text: "oi" }], "user"), undefined);
  assert.equal(atividadeDo({ type: "message_end", message: null }), undefined);
  assert.equal(atividadeDo({ type: "agent_start" }), undefined);
});

test("estado: diálogo pendente vence tudo, com o instante em que chegou", () => {
  const ag = agregadoCom(
    "desenho",
    [ticket({ id: 2, etapa: "desenho", status: "em_execucao" })],
    [execucao({ ticket: 2, modo: "autonomo", resultado: "em_andamento" })],
  );
  const dialogo: Dialogo = { type: "extension_ui_request", id: "d", method: "editor", em: T1 };
  assert.deepEqual(estado(ag, { execucao: 1, ocupado: true, desde: T0, dialogos: [dialogo] }), [
    "aguardando_humano",
    "dialogo",
    T1,
  ]);
  assert.deepEqual(
    estadoDaSessao(ag, SESSAO, {
      viva: { execucao: 1, ocupado: true, desde: T0, dialogos: [dialogo] },
    }).dialogos,
    [dialogo],
  );
});

test("estado: registro e desenho em conversa até o agente enviar (C25); enviados, o gate desde o envio", () => {
  const ocioso = { execucao: 1, ocupado: false, desde: T1, dialogos: [] };
  const ENVIO = "2026-10-11T10:30:00.000Z";
  for (const [etapa, fase, gate] of [
    ["registro", "registro", "gate_registro"],
    ["desenho", "aprovacao_desenho", "gate_desenho"],
  ] as const) {
    const conversando = ticket({ id: 1, etapa, status: "em_execucao" });
    const vivo = execucao({ ticket: 1, modo: "interativo", resultado: "em_andamento" });
    const ag = agregadoCom(etapa, [conversando], [vivo]);
    assert.deepEqual(estado(ag, ocioso), ["aguardando_humano", "conversa", T1], etapa);
    assert.deepEqual(estado(ag, { ...ocioso, ocupado: true }), ["rodando", undefined, T1], etapa);
    // Enviado: o gate vale com o pi ainda ocioso ou já parado, e conta do envio.
    const enviado = agregadoCom(fase, [{ ...conversando, enviadoEm: ENVIO }], [vivo]);
    assert.deepEqual(estado(enviado, ocioso), ["aguardando_humano", gate, ENVIO], etapa);
    const parado = { ...enviado, execucoes: [execucao({ ticket: 1, modo: "interativo", resultado: "sucesso" })] };
    assert.deepEqual(estado(parado), ["aguardando_humano", gate, ENVIO], etapa);
    // O desenho do formato anterior, que esperava o gate com execuções autônomas, também.
    const autonomo = { ...enviado, execucoes: [execucao({ ticket: 1, modo: "autonomo", resultado: "sucesso" })] };
    assert.deepEqual(estado(autonomo), ["aguardando_humano", gate, ENVIO], etapa);
  }
});

test("estado: o gate do PR só para o último encerramento concluído; os tickets concluídos terminam", () => {
  const desenhos = [
    ticket({ id: 2, etapa: "desenho", status: "concluido", concluidoEm: T0 }),
    ticket({ id: 3, etapa: "desenho", status: "concluido" }),
  ];
  const outra = "00000000-0000-4000-8000-000000000002";
  const execs = [
    execucao({ id: 1, ticket: 2, modo: "autonomo", resultado: "sucesso" }),
    execucao({ id: 2, ticket: 3, modo: "interativo", resultado: "sucesso", sessaoPi: outra }),
  ];
  assert.deepEqual(estado(agregadoCom("desenvolvimento", desenhos, execs)), ["terminada", undefined, T0]);
  const ultimo = estadoDaSessao(agregadoCom("desenvolvimento", desenhos, execs), outra, { viva: undefined });
  assert.deepEqual([ultimo.estado, ultimo.motivo, ultimo.desde], ["terminada", undefined, T1]);

  const encerramento = agregadoCom(
    "aprovacao_pr",
    [ticket({ id: 2, etapa: "encerramento", status: "concluido" })],
    [execucao({ ticket: 2, modo: "autonomo", resultado: "sucesso" })],
  );
  assert.deepEqual(estado(encerramento), ["aguardando_humano", "gate_pr", T1]);
  const revisao = agregadoCom(
    "encerramento",
    [ticket({ id: 2, etapa: "revisao", status: "concluido" })],
    [execucao({ ticket: 2, modo: "autonomo", resultado: "sucesso" })],
  );
  assert.deepEqual(estado(revisao), ["terminada", undefined, T1]);
});

test("estado: sessão em aberto parada é conversa; sessão desconhecida é erro", () => {
  const ag = agregadoCom(
    "ajuste_pr",
    [ticket({ id: 2, etapa: "sessao", status: "em_execucao" })],
    [execucao({ ticket: 2, modo: "interativo", resultado: "falha", erro: "serviço reiniciado" })],
  );
  assert.deepEqual(estado(ag), ["aguardando_humano", "conversa", T1]);
  assert.throws(
    () => estadoDaSessao(ag, "00000000-0000-4000-8000-000000000009", { viva: undefined }),
    (e) =>
      e instanceof ErroDeRegra && e.message.startsWith("a sessão 00000000-0000-4000-8000-000000000009 não é da I-1"),
  );
});

test("estado: a consulta só conversa, sem a falha nem os gates do ticket, e parada termina com o ticket", () => {
  const consulta = (fase: Fase, status: Ticket["status"], resultado: Execucao["resultado"] = "sucesso") =>
    agregadoCom(
      fase,
      [ticket({ id: 2, etapa: "desenho", status })],
      [execucao({ ticket: 2, modo: "consulta", resultado })],
    );
  assert.deepEqual(estado(consulta("desenho", "falhou")), ["aguardando_humano", "conversa", T1]);
  assert.deepEqual(estado(consulta("desenho", "aberto")), ["aguardando_humano", "conversa", T1]);
  assert.deepEqual(estado(consulta("aprovacao_desenho", "em_execucao")), ["aguardando_humano", "conversa", T1]);
  assert.deepEqual(estado(consulta("desenvolvimento", "concluido")), ["terminada", undefined, T1]);
  const ociosa = { execucao: 1, ocupado: false, desde: T1, dialogos: [] };
  const viva = consulta("desenvolvimento", "concluido", "em_andamento");
  assert.deepEqual(estado(viva, ociosa), ["aguardando_humano", "conversa", T1], "o pi vivo espera a pergunta");
  assert.deepEqual(estado(viva, { ...ociosa, ocupado: true }), ["rodando", undefined, T1]);
});

test("estado: a sessão de issue cancelada é terminada, a principal e a de consulta", () => {
  const cancelada = (modo: Execucao["modo"], status: Ticket["status"]) => {
    const ag = agregadoCom(
      "desenvolvimento",
      [ticket({ id: 2, etapa: "desenvolvimento", status })],
      [execucao({ ticket: 2, modo, resultado: "falha", erro: CANCELADA })],
    );
    return { ...ag, issue: { ...ag.issue, canceladaEm: T1 } };
  };
  assert.deepEqual(estado(cancelada("autonomo", "cancelado")), ["terminada", undefined, T1]);
  assert.deepEqual(estado(cancelada("interativo", "cancelado")), ["terminada", undefined, T1]);
  assert.deepEqual(estado(cancelada("consulta", "fechado")), ["terminada", undefined, T1]);
});

// ---------------------------------------------------------------------------------------------------------------
// Ponta a ponta com o pi falso.

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-sessoes-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
const src = resolve(import.meta.dirname, "..");

const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * pi falso interativo. Anota em $FALSO_PI_REGISTRO o início e cada comando, grava a conversa no JSONL da sessão
 * (`<session-dir>/<instante>_<session-id>.jsonl`, como o pi) e responde conforme $FALSO_PI:
 * - conversa: roda o "agente" de $FALSO_PI_AGENTE, se houver, responde e assenta;
 * - dialogo: responde, assenta e depois abre um `editor` (como o gancho de uma extensão);
 * - espera: fica trabalhando; `steer` o faz responder e assentar, `follow_up` abre um `editor`, `abort` o faz
 *   parar com stopReason aborted;
 * - sai: sai com código 3 ao receber o prompt.
 * Com --fork, a sessão nova começa com as entradas da de origem.
 * Uma mensagem que termina em "pergunte" não roda o agente: ele só pergunta; com "edite o título", ele só edita a issue. $FALSO_PI_RECUSA ("prompt", "steer") faz o pi recusar
 * o primeiro prompt ou todo steer.
 */
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const anotar = (o) => appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify(o) + "\\n");
if (process.argv.includes("--version")) {
  console.log("0.84.4-falso");
  process.exit(0);
}
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const variante = process.env.FALSO_PI;
anotar({ evento: "inicio", argv: process.argv.slice(2), cwd: process.cwd(), pid: process.pid });
const dir = arg("--session-dir");
const id = arg("--session-id");
mkdirSync(dir, { recursive: true });
const existente = readdirSync(dir, { withFileTypes: true }).find((f) => f.name.endsWith("_" + id + ".jsonl"));
const sessao = join(dir, existente ? existente.name : "2026-10-11T10-00-00-000Z_" + id + ".jsonl");
// --fork copia as entradas da sessão de origem para a nova, como o SessionManager.forkFrom do pi.
const copia = process.argv.includes("--fork") ? readFileSync(arg("--fork"), "utf8").split("\\n").slice(1).join("\\n") : "";
if (!existente) appendFileSync(sessao, JSON.stringify({ type: "session", version: 3, id }) + "\\n" + copia);
// Como o pi 0.84.4, emite o message_end antes de gravar e, numa sessão sem resposta do agente, só grava quando a
// primeira chega, junto com o que veio antes.
let naoGravadas = readFileSync(sessao, "utf8").includes('"assistant"') ? undefined : [];
const guardar = (message) => {
  const linha = JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n";
  if (naoGravadas && message.role !== "assistant") return void naoGravadas.push(linha);
  appendFileSync(sessao, (naoGravadas ?? []).join("") + linha);
  naoGravadas = undefined;
};
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const responder = (texto, stopReason = "stop") => {
  const message = {
    role: "assistant", content: [{ type: "text", text: texto }], provider: "anthropic", model: "claude-teste", stopReason,
    usage: { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, totalTokens: 112, cost: { total: 0.01 } },
  };
  emitir({ type: "message_end", message });
  guardar(message);
  emitir({ type: "agent_settled" });
};
const recusa = (process.env.FALSO_PI_RECUSA ?? "").split(",");
async function aoPrompt(c) {
  if (recusa.includes("prompt")) {
    recusa.splice(recusa.indexOf("prompt"), 1);
    return emitir({ type: "response", command: "prompt", success: false, error: "modelo ocupado" });
  }
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "agent_start" });
  const usuario = { role: "user", content: c.message, timestamp: Date.now() };
  emitir({ type: "message_end", message: usuario });
  guardar(usuario);
  if (variante === "espera") {
    emitir({ type: "tool_execution_start", toolCallId: "t1", toolName: "bash", args: { command: "npm test" } });
    return;
  }
  if (variante === "sai") process.exit(3);
  if (process.env.FALSO_PI_AGENTE && !/pergunte\\.?$/.test(c.message)) await (await import(process.env.FALSO_PI_AGENTE)).default(c.message.includes("edite o título"));
  responder("entendi:\\u2028tudo");
  if (variante === "dialogo") emitir({ type: "extension_ui_request", id: "e1", method: "editor", title: "Explique" });
}
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    anotar({ evento: "comando", comando: c });
    if (c.type === "prompt") void aoPrompt(c);
    if (c.type === "steer" && recusa.includes("steer")) {
      emitir({ type: "response", command: "steer", success: false, error: "o agente não está rodando" });
    } else if (c.type === "steer") {
      emitir({ type: "response", command: "steer", success: true });
      responder("redirecionado");
      emitir({ type: "extension_ui_request", id: "c3", method: "confirm", title: "Seguir?", timeout: 60000 });
    }
    if (c.type === "follow_up") {
      emitir({ type: "response", command: "follow_up", success: true });
      emitir({ type: "extension_ui_request", id: "e2", method: "editor", title: "Por quê?" });
    }
    if (c.type === "abort") {
      emitir({ type: "response", command: "abort", success: true });
      responder("", "aborted");
    }
  }
});
`;
const pi = join(base, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

/**
 * "Agente" do registro com o "sim" do Auditor: dá título e tipo à issue, submete as evidências do registro (salvo
 * `soEditar`, que mantém as que já existem) e envia o registro à aprovação (C25).
 */
const agente = join(base, "agente.mjs");
writeFileSync(
  agente,
  `import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { enviarParaAprovacao } from "${src}/dominio/gates.ts";
import { editarIssue } from "${src}/dominio/issue.ts";
import { submeter } from "${src}/evidencias/submissao.ts";
import { abrir } from "${src}/persistencia/banco.ts";
import { comIssue } from "${src}/persistencia/issues.ts";
export default async function (soEditar) {
  const banco = abrir(process.env.FABRIQUINHA_ROOT);
  const execucao = Number(process.env.FABRIQUINHA_EXECUCAO);
  const { ticket, issue } = banco
    .prepare("SELECT e.ticket, t.issue FROM execucao e JOIN ticket t ON t.id = e.ticket WHERE e.id = ?")
    .get(execucao);
  const ator = { tipo: "agente", execucao, ticket };
  const titulo = soEditar ? "Busca lenta com mil itens" : "Busca lenta";
  comIssue(banco, issue, "editarIssue", ator, (ag) => editarIssue(ag, { titulo, tipo: "problema" }, ator));
  if (!soEditar) {
    const log = join(process.env.FABRIQUINHA_SAIDA, "busca.log");
    writeFileSync(log, "busca levou 8 s\\n");
    await submeter(banco, ator, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }, [log]);
    await submeter(banco, ator, "criterios_aceite",
      { criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }] }, []);
  }
  comIssue(banco, issue, "enviarParaAprovacao", ator, (ag, ctx) => enviarParaAprovacao(ag, { ticket }, ator, ctx));
  banco.close();
}
`,
);

interface Cenario {
  raiz: string;
  banco: DatabaseSync;
  /** O que o pi falso anotou. */
  registro(): Record<string, unknown>[];
  comandos(): Record<string, unknown>[];
  log(execucao: number): string;
  execucoes(): { id: number; resultado: string; sessao_pi: string; modo: string }[];
}

let n = 0;
function cenario({ variante = "conversa", comAgente = false, preparacao = [] as string[], recusa = "" } = {}): Cenario {
  const dir = join(base, `c${String(++n)}`);
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
    modelos: {},
  });
  const registro = join(dir, "registro.jsonl");
  process.env.FALSO_PI_REGISTRO = registro;
  process.env.FALSO_PI = variante;
  process.env.FALSO_PI_RECUSA = recusa;
  if (comAgente) process.env.FALSO_PI_AGENTE = agente;
  else delete process.env.FALSO_PI_AGENTE;
  const lerRegistro = () =>
    existsSync(registro)
      ? readFileSync(registro, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as Record<string, unknown>)
      : [];
  return {
    raiz,
    banco,
    registro: lerRegistro,
    comandos: () =>
      lerRegistro()
        .filter((r) => r.evento === "comando")
        .map((r) => r.comando as Record<string, unknown>),
    log: (execucao) => readFileSync(join(raiz, "execucoes", `E-${String(execucao)}`, "log"), "utf8"),
    execucoes: () =>
      banco.prepare("SELECT id, resultado, sessao_pi, modo FROM execucao ORDER BY id").all() as {
        id: number;
        resultado: string;
        sessao_pi: string;
        modo: string;
      }[],
  };
}

/** Espera `condicao` ficar verdadeira, até 10 s. */
async function ate(condicao: () => boolean | Promise<boolean>, oQue: string): Promise<void> {
  for (let espera = 0; !(await condicao()); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

const estadoDe = async (c: Cenario, sessao: string) => {
  const info = await infoDaSessao(c.banco, sessao);
  return info.motivo ? `${info.estado}: ${info.motivo}` : info.estado;
};

const vivo = (pid: unknown) => {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch {
    return false;
  }
};

const rejeitaCom = (mensagem: string) => (e: unknown) => e instanceof ErroDeRegra && e.message === mensagem;

test("registro: C1, worktree, sessão interativa com a mensagem inicial; o envio abre o gate, devolver retoma e aprovar", async () => {
  const c = cenario({ comAgente: true });
  const opcoes = { ociosidadeMin: 1 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  assert.equal(await estadoDe(c, sessao), "rodando", "a preparação da worktree conta como rodando");
  const chat = await abrirChat(c.banco, sessao);
  assert.deepEqual(chat.conversa, [], "o pi ainda não gravou a sessão");
  const eventos: EventoPi[] = [];
  const cancelar = chat.assinar((e) => eventos.push(e));
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: gate_registro", "o gate do registro");

  const [inicio] = c.registro();
  assert.equal(inicio?.cwd, caminhoDaWorktree(c.raiz, "loja", 1));
  assert.deepEqual((inicio.argv as string[]).slice(4, 6), ["--session-id", sessao]);
  const [primeiro] = c.comandos();
  const prompt = readFileSync(join(c.raiz, "execucoes", "E-1", "prompt.md"), "utf8");
  assert.deepEqual(primeiro, { type: "prompt", message: prompt });
  assert.match(prompt, /## Modo de trabalhar: registro/);
  assert.match(prompt, /## Descrição da issue\n\nExportar pedidos em CSV\n/);
  assert.doesNotMatch(prompt, /Execução autônoma/);
  assert.match(prompt, /\nVamos registrar uma necessidade no projeto loja \(issue I-1\)\.\n$/);
  assert.ok(eventos.some((e) => e.type === "agent_settled"));
  const estados = () => eventos.filter((e) => e.type === "estado").map((e) => (e.sessao as { estado: string }).estado);
  assert.deepEqual([estados()[0], estados().at(-1)], ["rodando", "aguardando_humano"]);

  // O agente enviou (C25): a decisão fica na página da issue, e o chat não recebe mensagem.
  await assert.rejects(
    enviar(c.banco, sessao, "mais uma coisa", "prompt", opcoes),
    rejeitaCom(
      "a sessão de T-1 está aguardando_humano: gate_registro e não recebe mensagem (decida na página da issue; " +
        "devolver leva o motivo ao agente nesta conversa)",
    ),
  );
  const conversa = (await abrirChat(c.banco, sessao)).conversa as { type: string; message?: { role: string } }[];
  assert.deepEqual(
    conversa.map((e) => e.message?.role ?? e.type),
    ["session", "user", "assistant"],
  );

  // Devolvido, o envio sai e a sessão volta à conversa; o agente só pergunta, e as evidências antigas não bastam.
  await decidirGate(c.banco, 1, "registro", { aprovado: false, motivo: "Falta o passo a passo; pergunte" }, opcoes);
  assert.deepEqual(
    c.execucoes().map((e) => [e.id, e.resultado, e.sessao_pi, e.modo]),
    [
      [1, "sucesso", sessao, "interativo"],
      [2, "em_andamento", sessao, "interativo"],
    ],
    "o pi ocioso parou (C6), e a sessão retomou com o motivo",
  );
  assert.equal(agregado(c.banco, 1)?.decisoes.at(-1)?.motivo, "Falta o passo a passo; pergunte");
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a pergunta do agente");
  assert.equal(c.comandos().at(-1)?.message, "O Auditor devolveu o registro. Motivo: Falta o passo a passo; pergunte");
  assert.equal(c.registro().filter((r) => r.evento === "inicio").length, 2);

  // O Auditor responde; o agente edita a issue, sem evidência nova, e envia de novo.
  await enviar(c.banco, sessao, "Buscar com mil itens; edite o título.", "prompt", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: gate_registro", "o gate de novo");
  assert.equal(agregado(c.banco, 1)?.issue.titulo, "Busca lenta com mil itens");
  assert.equal(agregado(c.banco, 1)?.evidencias.length, 2, "nenhuma evidência nova");

  // Aprovado, o que a sessão deixou na worktree é descartado antes do C10 (F3 §7).
  const worktree = caminhoDaWorktree(c.raiz, "loja", 1);
  writeFileSync(join(worktree, "rascunho.txt"), "do registro\n");
  writeFileSync(join(worktree, "LEIAME"), "mudado\n");
  await decidirGate(c.banco, 1, "registro", { aprovado: true }, opcoes);
  assert.equal(agregado(c.banco, 1)?.issue.fase, "desenho");
  assert.equal(existsSync(join(worktree, "rascunho.txt")), false);
  assert.equal(readFileSync(join(worktree, "LEIAME"), "utf8"), "loja\n");
  assert.match(c.log(2), /descarte removeu: rascunho\.txt\n/);
  assert.equal(await estadoDe(c, sessao), "terminada");
  assert.equal(estados().at(-1), "terminada", "avisou o fim");
  await assert.rejects(
    enviar(c.banco, sessao, "oi", "prompt", opcoes),
    rejeitaCom(
      "a sessão de T-1 está terminada e não recebe mensagem (a sessão é só leitura; converse sobre ela numa consulta)",
    ),
  );
  cancelar();
  assert.deepEqual(await sessoes(c.banco, { escopo: "ativas" }), []);
  assert.deepEqual(
    (await sessoes(c.banco, { escopo: "historico", projeto: "loja", issue: 1, etapa: "registro" })).map(
      (s) => s.sessao,
    ),
    [sessao],
  );
  assert.deepEqual(await sessoes(c.banco, { escopo: "historico", etapa: "desenho" }), []);
  assert.deepEqual(await sessoes(c.banco, { escopo: "historico", projeto: "outro" }), []);
  await assert.rejects(
    infoDaSessao(c.banco, "nenhuma"),
    rejeitaCom("a sessão nenhuma não existe (confira o endereço do chat)"),
  );
  c.banco.close();
});

/** Para os pis ociosos que o teste deixou vivos e espera o C6 deles, para o processo do teste poder sair. */
async function pararTudo(c: Cenario): Promise<void> {
  for (const e of c.execucoes().filter((x) => x.resultado === "em_andamento")) encerrar(e.id);
  await ate(() => c.execucoes().every((e) => e.resultado !== "em_andamento"), "os pis pararem");
}

const PROPOSTA = { titulo: "Tela de relatório", mensagem: "Parte B: tela de relatório", arquivos: 31 };

/** Registra a I-1 e espera a sessão do registro em conversa, com o pi ocioso; devolve a sessão e a IA do ticket. */
async function registroEmConversa(c: Cenario, opcoes: { ociosidadeMin: number }) {
  const sessao = registrarNecessidade(c.banco, "loja", [], "Relatórios de vendas", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a conversa do registro");
  return { sessao, agente: { tipo: "agente", execucao: 1, ticket: 1 } as const };
}

test("proposta no registro: aceitar cria a issue dependente, abre o registro dela e retoma a IA com o aviso", async () => {
  const c = cenario();
  const opcoes = { ociosidadeMin: 1 };
  const { sessao, agente } = await registroEmConversa(c, opcoes);
  const proposta = proporIssue(c.banco, 1, PROPOSTA, agente);

  assert.deepEqual(await decidirProposta(c.banco, proposta.id, true, opcoes), { issue: 2 });

  const nova = agregado(c.banco, 2);
  assert.deepEqual(
    [nova?.issue.deps, nova?.issue.titulo, nova?.issue.descricao, nova?.issue.fase],
    [[1], "Tela de relatório", "Parte B: tela de relatório", "registro"],
  );
  const decidida = propostasDaIssue(c.banco, 1)[0];
  assert.ok(decidida);
  assert.deepEqual([decidida.status, decidida.issueCriada], ["aceita", 2]);
  const aviso = avisoDaProposta(decidida, 1);
  assert.match(
    aviso,
    /^A Fabriquinha criou a I-2 \(«Tela de relatório»\) a partir da sua proposta, que o Auditor aceitou; ela depende da I-1\. Reduza o escopo da I-1: /,
  );
  assert.deepEqual(
    c.execucoes().map((e) => [e.id, e.resultado, e.modo]),
    [
      [1, "sucesso", "interativo"],
      [2, "em_andamento", "interativo"],
      [3, "em_andamento", "interativo"],
    ],
    "o pi ocioso da I-1 parou (C6) e retomou; o registro da I-2 abriu",
  );
  assert.equal(c.execucoes()[1]?.sessao_pi, sessao);
  assert.notEqual(c.execucoes()[2]?.sessao_pi, sessao);
  await ate(() => c.comandos().some((m) => m.message === aviso), "o aviso chegar ao pi");
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a IA responder ao aviso");
  await ate(
    async () => (await estadoDe(c, c.execucoes()[2]?.sessao_pi ?? "")) === "aguardando_humano: conversa",
    "o registro da I-2",
  );

  await assert.rejects(
    decidirProposta(c.banco, proposta.id, true, opcoes),
    rejeitaCom("a proposta P-1 já foi decidida: aceita (uma proposta só se decide uma vez)"),
  );
  assert.equal(agregado(c.banco, 3), undefined, "o segundo aceite não criou outra issue");
  await pararTudo(c);
  c.banco.close();
});

test("proposta no registro: recusar só grava a decisão e retoma a IA com o aviso", async () => {
  const c = cenario();
  const opcoes = { ociosidadeMin: 1 };
  const { sessao, agente } = await registroEmConversa(c, opcoes);
  const proposta = proporIssue(c.banco, 1, PROPOSTA, agente);

  assert.deepEqual(await decidirProposta(c.banco, proposta.id, false, opcoes), {});

  assert.equal(propostasDaIssue(c.banco, 1)[0]?.status, "recusada");
  assert.equal(agregado(c.banco, 2), undefined);
  const aviso = "O Auditor recusou a sua proposta de issue «Tela de relatório»; mantenha o escopo atual da I-1.";
  assert.equal(avisoDaProposta({ ...proposta, status: "recusada" }, 1), aviso);
  await ate(() => c.comandos().some((m) => m.message === aviso), "o aviso chegar ao pi");
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a IA responder ao aviso");
  assert.deepEqual(
    c.execucoes().map((e) => [e.id, e.resultado]),
    [
      [1, "sucesso"],
      [2, "em_andamento"],
    ],
  );
  await pararTudo(c);
  c.banco.close();
});

test("proposta: agente ocupado recusa antes de gravar, e proposta inexistente é erro", async () => {
  const c = cenario({ variante: "espera" });
  const opcoes = { ociosidadeMin: 1 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Relatórios de vendas", opcoes);
  await ate(async () => (await infoDaSessao(c.banco, sessao)).atividade !== undefined, "o agente trabalhar");
  const proposta = proporIssue(c.banco, 1, PROPOSTA, { tipo: "agente", execucao: 1, ticket: 1 });

  await assert.rejects(
    decidirProposta(c.banco, proposta.id, true, opcoes),
    rejeitaCom("a sessão de T-1 ainda está rodando (espere o agente terminar)"),
  );
  assert.equal(propostasDaIssue(c.banco, 1)[0]?.status, "pendente");
  assert.equal(agregado(c.banco, 2), undefined);
  await assert.rejects(decidirProposta(c.banco, 9, true, opcoes), /a proposta P-9 não existe/);
  await pararTudo(c);
  c.banco.close();
});

test("proposta no desenho: aceitar reprova o desenho, retoma a IA dele com o motivo e abre o registro da nova", async () => {
  const c = cenario();
  const opcoes = { ociosidadeMin: 1 };
  registrarIssue(c.banco, { projeto: "loja" }, AUDITOR);
  c.banco.exec(`UPDATE issue SET fase = 'desenho', titulo = 'Busca lenta', tipo = 'funcionalidade';
    UPDATE ticket SET status = 'concluido', concluido_em = '${T1}';
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (2, 1, 'desenho', 'Desenhar', 'em_execucao', 'fabriquinha', '${T1}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em)
      VALUES (1, 2, 'interativo', '${SESSAO}', 'em_andamento', '${T1}');
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 2), ('execucao', 1)
      ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor;`);
  const recusada = proporIssue(
    c.banco,
    1,
    { ...PROPOSTA, titulo: "Outra" },
    { tipo: "agente", execucao: 1, ticket: 2 },
  );
  const proposta = proporIssue(c.banco, 1, PROPOSTA, { tipo: "agente", execucao: 1, ticket: 2 });
  // O agente enviou o desenho (C25) e o pi parou.
  c.banco.exec(`UPDATE issue SET fase = 'aprovacao_desenho';
    UPDATE ticket SET enviado_em = '${T1}' WHERE id = 2;
    UPDATE execucao SET resultado = 'sucesso', terminada_em = '${T1}';`);

  // Recusar só marca a proposta: o gate continua, sem mensagem à IA.
  assert.deepEqual(await decidirProposta(c.banco, recusada.id, false, opcoes), {});
  assert.equal(c.execucoes().length, 1);
  assert.equal(agregado(c.banco, 1)?.issue.fase, "aprovacao_desenho");

  assert.deepEqual(await decidirProposta(c.banco, proposta.id, true, opcoes), { issue: 2 });

  const ag = agregado(c.banco, 1);
  assert.ok(ag);
  assert.equal(ag.issue.fase, "desenho");
  assert.equal(ag.decisoes.at(-1)?.aprovado, false);
  const motivo = ag.decisoes.at(-1)?.motivo ?? "";
  assert.match(motivo, /I-2 \(«Tela de relatório»\)/);
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "desenho").map((t) => [t.id, t.status, t.enviadoEm]),
    [[2, "em_execucao", undefined]],
    "o mesmo desenho, de volta à conversa",
  );
  assert.equal(agregado(c.banco, 2)?.issue.descricao, "Parte B: tela de relatório");
  assert.deepEqual(
    c.execucoes().map((e) => [e.id, e.sessao_pi === SESSAO, e.modo]),
    [
      [1, true, "interativo"],
      [2, true, "interativo"],
      [3, false, "interativo"],
    ],
    "a IA do desenho retoma a mesma sessão; o registro da I-2 abre outra",
  );
  await ate(
    () => c.comandos().some((m) => String(m.message).endsWith(`O Auditor reprovou o desenho. Motivo: ${motivo}\n`)),
    "o motivo chegar à IA do desenho",
  );
  await ate(async () => (await estadoDe(c, SESSAO)) === "aguardando_humano: conversa", "a IA do desenho responder");
  await ate(
    async () => (await estadoDe(c, c.execucoes()[2]?.sessao_pi ?? "")) === "aguardando_humano: conversa",
    "o registro da I-2",
  );
  await pararTudo(c);
  c.banco.close();
});

test("ociosidade: o pi para com C6 sucesso, a sessão segue em conversa, e a próxima mensagem a retoma no mesmo modo", async () => {
  const c = cenario();
  const opcoes = { ociosidadeMin: 0.01 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  // Um ouvinte do chat que lança não derruba a execução: o erro vai para o log dela.
  (await abrirChat(c.banco, sessao)).assinar(() => {
    throw new Error("o navegador fechou");
  });
  await ate(() => c.execucoes()[0]?.resultado === "sucesso", "a parada por ociosidade");
  const [inicio] = c.registro();
  await ate(() => !vivo(inicio?.pid), "o fim do pi");
  assert.match(c.log(1), /sessão ociosa por 0\.01 min; o pi para\n.*E-1 terminou\n/);
  assert.match(c.log(1), /um ouvinte da sessão falhou com o evento agent_settled: o navegador fechou\n/);
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa");
  assert.deepEqual(
    (await sessoes(c.banco, { escopo: "ativas" })).map((s) => [s.sessao, s.motivo]),
    [[sessao, "conversa"]],
  );
  await assert.rejects(
    enviar(c.banco, sessao, "oi", "steer", opcoes),
    rejeitaCom("a sessão de T-1 está aguardando_humano: conversa e não recebe steer (envie com prompt)"),
  );

  await enviar(c.banco, sessao, "voltei", "prompt", opcoes);
  await ate(() => c.execucoes()[1]?.resultado === "sucesso", "a nova parada por ociosidade");
  assert.deepEqual(
    c.execucoes().map((e) => [e.sessao_pi, e.modo]),
    [
      [sessao, "interativo"],
      [sessao, "interativo"],
    ],
  );
  const inicios = c.registro().filter((r) => r.evento === "inicio");
  assert.deepEqual((inicios[1]?.argv as string[]).slice(4, 6), ["--session-id", sessao]);
  assert.deepEqual(c.comandos().at(-1), { type: "prompt", message: "voltei" }, "a retomada leva só a mensagem");
  // F6 §3.3: o uso foi coletado depois de cada C6, e cada execução da sessão ficou só com a sua resposta.
  const uso = (e: number) =>
    c.banco
      .prepare("SELECT provedor, modelo, chamadas, custo FROM uso WHERE execucao = ?")
      .all(e)
      .map((l) => ({ ...l }));
  const umaResposta = [{ provedor: "anthropic", modelo: "claude-teste", chamadas: 1, custo: 0.01 }];
  assert.deepEqual([uso(1), uso(2)], [umaResposta, umaResposta]);

  const outra = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(() => c.execucoes()[2]?.resultado === "sucesso", "a parada da outra sessão");
  assert.deepEqual(
    (await sessoes(c.banco, { escopo: "ativas" })).map((s) => s.sessao),
    [sessao, outra],
    "da que espera há mais tempo para a mais recente",
  );
  c.banco.close();
});

test("diálogo pendente: a sessão interativa espera o Auditor sem parar por ociosidade; respondido, a ociosidade volta a contar", async () => {
  const c = cenario({ variante: "dialogo" });
  const opcoes = { ociosidadeMin: 0.01 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: dialogo", "o diálogo");
  const info = await infoDaSessao(c.banco, sessao);
  assert.deepEqual(
    info.dialogos.map((d) => [d.id, d.method, d.expiraEm]),
    [["e1", "editor", undefined]],
  );
  await assert.rejects(
    enviar(c.banco, sessao, "oi", "prompt", opcoes),
    rejeitaCom(
      "a sessão de T-1 está aguardando_humano: dialogo e não recebe mensagem (responda o diálogo aberto pelo agente)",
    ),
  );
  await dormir(1500); // mais que a ociosidade de 0,6 s
  assert.equal(c.execucoes()[0]?.resultado, "em_andamento");
  responderDialogo(info.execucao, "e1", { value: "porque sim" });
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa");
  await ate(() => c.execucoes()[0]?.resultado === "sucesso", "a parada por ociosidade");
  assert.deepEqual(c.comandos().at(-1), { type: "extension_ui_response", id: "e1", value: "porque sim" });
  c.banco.close();
});

test("rodando: steer e follow_up conforme o estado; abortar cancela o diálogo pendente e manda abort", async () => {
  const c = cenario({ variante: "espera", preparacao: ["sleep 0.5"] });
  const opcoes = { ociosidadeMin: 1 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await assert.rejects(
    enviar(c.banco, sessao, "já?", "steer", opcoes),
    rejeitaCom("o pi da sessão de T-1 ainda não subiu (espere a preparação da worktree)"),
  );
  await ate(() => c.comandos().length === 1, "o prompt chegar ao pi");
  assert.equal(await estadoDe(c, sessao), "rodando");
  // O pi já emitiu o prompt, mas não o gravou: a sessão ainda não tem resposta do agente. Quem abre o chat agora
  // recebe a mensagem logo depois do retrato, que não a tem.
  const replay = async () => {
    const chat = await abrirChat(c.banco, sessao);
    const eventos: EventoPi[] = [];
    chat.assinar((e) => eventos.push(e))();
    return { conversa: chat.conversa, eventos };
  };
  await ate(async () => (await replay()).eventos.length > 0, "a mensagem do prompt no replay");
  const tarde = await replay();
  assert.deepEqual(
    tarde.conversa.map((e) => (e as { type: string }).type),
    ["session"],
  );
  assert.deepEqual(
    tarde.eventos.map((e) => [e.type, (e.message as { role: string }).role]),
    [["message_end", "user"]],
  );
  // O que o agente faz, pelo processo vivo, só enquanto roda.
  await ate(async () => (await infoDaSessao(c.banco, sessao)).atividade === "bash npm test", "a ferramenta começar");
  await assert.rejects(
    enviar(c.banco, sessao, "oi", "prompt", opcoes),
    rejeitaCom("a sessão de T-1 está rodando e não recebe prompt (envie com steer ou follow_up)"),
  );
  await assert.rejects(
    concluirSessao(c.banco, 1),
    rejeitaCom("T-1 é da etapa registro (só a sessão em aberto se conclui pelo chat)"),
  );
  await assert.rejects(
    decidirGate(c.banco, 1, "registro", { aprovado: false, motivo: "x" }, opcoes),
    rejeitaCom("a sessão de T-1 ainda está rodando (espere o agente terminar)"),
  );

  await enviar(c.banco, sessao, "faça só a busca", "follow_up", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: dialogo", "o diálogo");
  const { execucao } = await infoDaSessao(c.banco, sessao);
  abortar(execucao);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "o agente parar");
  assert.equal((await infoDaSessao(c.banco, sessao)).atividade, undefined);
  assert.deepEqual(c.comandos().slice(1), [
    { type: "follow_up", message: "faça só a busca" },
    { type: "extension_ui_response", id: "e2", cancelled: true },
    { type: "abort" },
  ]);
  await enviar(c.banco, sessao, "agora sim", "prompt", opcoes);
  assert.equal(await estadoDe(c, sessao), "rodando");
  await enviar(c.banco, sessao, "mudei de ideia", "steer", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: dialogo", "o diálogo com tempo limite");
  const [c3] = (await infoDaSessao(c.banco, sessao)).dialogos;
  assert.equal(Date.parse(String(c3?.expiraEm)) - Date.parse(String(c3?.em)), 60_000);
  assert.deepEqual(c.comandos().slice(-2), [
    { type: "prompt", message: "agora sim" },
    { type: "steer", message: "mudei de ideia" },
  ]);
  assert.throws(() => {
    abortar(99);
  }, rejeitaCom("a execução E-99 não tem pi rodando (nada a abortar)"));
  // Entre a ordem de parar e o C6 o estado espera o C6, em vez de mostrar `rodando`.
  encerrar(execucao);
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa");
  assert.equal(c.execucoes()[0]?.resultado, "sucesso");
  c.banco.close();
});

test("interativa: a recusa de um comando vai ao chat e ao log sem derrubar o pi", async () => {
  const c = cenario({ variante: "espera", recusa: "prompt,steer" });
  const opcoes = { ociosidadeMin: 1 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a recusa do prompt");
  assert.match(c.log(1), /o pi recusou o comando prompt: modelo ocupado\n/);
  await enviar(c.banco, sessao, "de novo", "prompt", opcoes);
  await enviar(c.banco, sessao, "pare", "steer", opcoes);
  await ate(() => c.log(1).includes("o pi recusou o comando steer: o agente não está rodando"), "a recusa do steer");
  assert.equal(await estadoDe(c, sessao), "rodando");
  const viva = situacao(sessao);
  assert.ok(viva, "o pi segue vivo");
  encerrar(viva.execucao);
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa");
  c.banco.close();
});

test("autônoma sem pi: steer explica se o ticket espera o agendador ou a coleta", async () => {
  const c = cenario();
  registrarIssue(c.banco, { projeto: "loja" }, AUDITOR);
  // Um desenho que falhou e foi reaberto (C9), direto no banco.
  c.banco.exec(`UPDATE issue SET fase = 'desenho', titulo = 'Busca lenta', tipo = 'problema';
    UPDATE ticket SET status = 'concluido', concluido_em = '${T1}';
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (2, 1, 'desenho', 'Desenhar', 'aberto', 'fabriquinha', '${T1}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'falha', 'deu ruim', '${T0}', '${T1}');`);
  const opcoes = { ociosidadeMin: 1 };
  await assert.rejects(
    enviar(c.banco, SESSAO, "rápido", "steer", opcoes),
    rejeitaCom(
      "T-2 espera o agendador para a próxima execução, que já leva a resposta do Auditor (use Executar agora " +
        "para não esperar)",
    ),
  );
  c.banco.exec(
    `UPDATE execucao SET resultado = 'sucesso', erro = NULL; UPDATE ticket SET status = 'em_execucao' WHERE id = 2;`,
  );
  await assert.rejects(
    enviar(c.banco, SESSAO, "rápido", "steer", opcoes),
    rejeitaCom("o agente de T-2 já terminou, e a Fabriquinha confere as evidências (espere o resultado)"),
  );
  c.banco.close();
});

/**
 * `gh` falso na frente do PATH (F5 §9): devolve $FALSO_GH no stdout. Com $FALSO_GH_SQL, antes roda esse SQL no banco
 * de $FALSO_GH_BANCO, como algo que acontece enquanto a Fabriquinha lê o PR.
 */
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/bin/sh
if [ -n "$FALSO_GH_SQL" ]; then
  "${process.execPath}" -e 'new (require("node:sqlite").DatabaseSync)(process.env.FALSO_GH_BANCO).exec(process.env.FALSO_GH_SQL)'
fi
printf '%s' "$FALSO_GH"
`,
);
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${String(process.env.PATH)}`;
const URL_PR = "https://github.com/dono/loja/pull/7";
const prNoGitHub = (state: "OPEN" | "MERGED") => {
  process.env.FALSO_GH = JSON.stringify({
    state,
    url: URL_PR,
    mergedAt: state === "MERGED" ? "2026-10-11T13:00:00Z" : null,
    mergeCommit: null,
  });
};

/**
 * A I-1 no gate do PR, como o encerramento a deixa: registro e encerramento T-2 concluídos, a execução autônoma do
 * encerramento, com o arquivo da sessão, e a evidência `pr_aberto`; com a worktree e a branch publicada. C1 e a worktree são os reais; o resto,
 * SQL direto.
 */
async function noGatePR(c: Cenario): Promise<string> {
  const { issue } = registrarIssue(c.banco, { projeto: "loja" }, AUDITOR);
  const repo = String(c.banco.prepare("SELECT repo FROM projeto").get()?.repo);
  const projeto = { nome: "loja", repo, branchBase: "main", preparacao: [] };
  const worktree = await garantirWorktree(c.raiz, projeto, issue, join(c.raiz, "log"), () => Promise.resolve());
  git(worktree, "push", "-q", "-u", "origin", "fabriquinha/I-1");
  mkdirSync(join(c.raiz, "sessoes"), { recursive: true });
  writeFileSync(
    join(c.raiz, "sessoes", `2026-10-11T10-00-00-000Z_${SESSAO}.jsonl`),
    JSON.stringify({ type: "session", version: 3, id: SESSAO }) + "\n",
  );
  delete process.env.FALSO_GH_SQL;
  const pr = { hospedagem: "github", id: "7", url: URL_PR, branch: "fabriquinha/I-1", base: "main" };
  c.banco.exec(`UPDATE issue SET fase = 'aprovacao_pr', titulo = 'Busca lenta', tipo = 'problema';
    UPDATE ticket SET status = 'concluido', concluido_em = '${T1}';
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (2, 1, 'encerramento', 'Publicar o PR', 'concluido', 'fabriquinha', '${T1}', '${T1}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'sucesso', '${T0}', '${T1}');
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em)
      VALUES (1, 2, 'pr_aberto', 'fabriquinha', '${JSON.stringify(pr)}', '${T1}');
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 2), ('execucao', 1), ('evidencia', 1)
      ON CONFLICT (nome) DO UPDATE SET valor = excluded.valor;`);
  return worktree;
}

test("gate do PR: encerrar recusado com o PR aberto; pedir mudanças abre a sessão em aberto, que volta ao desenvolvimento", async () => {
  const c = cenario();
  await noGatePR(c);
  const opcoes = { ociosidadeMin: 1 };
  prNoGitHub("OPEN");
  await assert.rejects(
    encerrarIssue(c.banco, 1, 4),
    rejeitaCom(
      "a I-1 não pode ser encerrada: o PR está aberto, não mergeado (faça o merge na plataforma, com merge commit, e encerre de novo)",
    ),
  );
  assert.equal(agregado(c.banco, 1)?.issue.fase, "aprovacao_pr", "nada mudou");
  assert.equal(await estadoDe(c, SESSAO), "aguardando_humano: gate_pr");

  const sessao = await pedirMudancas(c.banco, 1, "  Falta o índice da busca.  ", opcoes);
  await ate(async () => (await estadoDe(c, sessao)) === "aguardando_humano: conversa", "a sessão em aberto");
  const ag = agregado(c.banco, 1);
  assert.equal(ag?.issue.fase, "ajuste_pr");
  assert.deepEqual(
    ag.decisoes.map((d) => [d.gate, d.ticket, d.aprovado, d.motivo, d.nota]),
    [["pr", 2, false, "Falta o índice da busca.", undefined]],
  );
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "sessao").map((t) => [t.id, t.status, t.descricao]),
    [[3, "em_execucao", "Falta o índice da busca."]],
  );
  const prompt = c.comandos().find((cmd) => cmd.type === "prompt")?.message;
  assert.match(
    String(prompt),
    /O Auditor pediu mudanças no PR https:\/\/github\.com\/dono\/loja\/pull\/7\. Motivo: Falta o índice da busca\.\n$/,
  );
  assert.equal(await estadoDe(c, SESSAO), "terminada", "a sessão do encerramento sai do gate");

  await assert.rejects(
    concluirSessao(c.banco, 3),
    rejeitaCom(
      "T-3 não pode concluir: a sessão em aberto não criou ticket de desenvolvimento (o agente de T-3 cria com fabriquinha ticket criar I-1 --titulo <título>)",
    ),
  );
  assert.equal(situacao(sessao), undefined, "o pi ocioso parou antes do C7");
  // O que a sessão deixou na worktree é descartado antes do C7 (F3 §7).
  const worktree = caminhoDaWorktree(c.raiz, "loja", 1);
  writeFileSync(join(worktree, "rascunho.txt"), "da sessão\n");
  // O ticket que o agente da sessão criaria com C11.
  c.banco.exec(`INSERT INTO ticket (id, issue, etapa, titulo, status, origem, origem_ticket, criado_em)
    VALUES (4, 1, 'desenvolvimento', 'Criar o índice', 'aberto', 'agente', 3, '${T1}')`);
  await concluirSessao(c.banco, 3);
  assert.equal(agregado(c.banco, 1)?.issue.fase, "desenvolvimento");
  assert.equal(existsSync(join(worktree, "rascunho.txt")), false);
  assert.match(c.log(2), /descarte removeu: rascunho\.txt\n/);
  assert.equal(await estadoDe(c, sessao), "terminada");
  await assert.rejects(pedirMudancas(c.banco, 1, "de novo", opcoes), /a I-1 está na fase desenvolvimento/);
  c.banco.close();
});

test("gate do PR: encerrar com o PR mergeado conclui a issue com a nota e remove a worktree, mantendo as branches", async () => {
  const c = cenario();
  const worktree = await noGatePR(c);
  prNoGitHub("MERGED");
  const opcoes = { ociosidadeMin: 1 };
  // Uma consulta ociosa sobre o encerramento, com o pi na worktree.
  const consulta = await conversarSobre(c.banco, 2, opcoes);
  await ate(() => situacao(consulta)?.ocupado === false, "a consulta subir");
  await assert.rejects(
    pedirMudancas(c.banco, 1, "tarde demais", opcoes),
    rejeitaCom("a I-1 não pode pedir mudanças: o PR já foi mergeado (encerre a issue com a nota)"),
  );
  assert.equal(situacao(consulta)?.ocupado, false, "a decisão recusada não para a consulta");
  // O `gh` que falha (502) também não para nada: o PR é lido antes.
  process.env.FALSO_GH = "não é JSON";
  await assert.rejects(encerrarIssue(c.banco, 1, 5), ErroExterno);
  assert.equal(situacao(consulta)?.ocupado, false, "a leitura do PR que falhou não para a consulta");
  prNoGitHub("MERGED");

  assert.deepEqual(await encerrarIssue(c.banco, 1, 5), []);
  assert.equal(situacao(consulta), undefined, "a consulta parou antes da limpeza");
  assert.equal(c.execucoes().find((e) => e.sessao_pi === consulta)?.resultado, "sucesso");
  const ag = agregado(c.banco, 1);
  assert.equal(ag?.issue.fase, "concluida");
  assert.ok(ag.issue.concluidaEm);
  assert.deepEqual(
    ag.decisoes.map((d) => [d.gate, d.ticket, d.aprovado, d.nota]),
    [["pr", 2, true, 5]],
  );
  assert.equal(await estadoDe(c, SESSAO), "terminada");
  assert.equal(existsSync(worktree), false);
  const repo = String(c.banco.prepare("SELECT repo FROM projeto").get()?.repo);
  assert.equal(git(repo, "branch", "--list", "fabriquinha/I-1").toString().trim(), "fabriquinha/I-1");
  assert.match(
    git(repo, "ls-remote", "--heads", "origin", "fabriquinha/I-1").toString(),
    /refs\/heads\/fabriquinha\/I-1/,
  );
  c.banco.close();
});

test("gate do PR: pedir mudanças com uma execução em andamento na issue não grava nada", async () => {
  const c = cenario();
  await noGatePR(c);
  const opcoes = { ociosidadeMin: 1 };
  prNoGitHub("OPEN");
  const intacta = () => {
    const ag = agregado(c.banco, 1);
    assert.equal(ag?.issue.fase, "aprovacao_pr");
    assert.deepEqual(ag.decisoes, []);
    assert.equal(ag.tickets.length, 2, "sem ticket sessao");
    assert.equal(c.banco.prepare("SELECT 1 FROM comando WHERE nome = 'decidirPR'").get(), undefined);
  };
  const consulta = (id: number, sessao: string) =>
    `INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em)
       VALUES (${String(id)}, 2, 'consulta', '${sessao}', 'em_andamento', '${T1}')`;

  // Uma consulta em andamento sem pi neste serviço não é parada: a decisão espera.
  c.banco.exec(consulta(8, "00000000-0000-4000-8000-000000000008"));
  await assert.rejects(
    pedirMudancas(c.banco, 1, "falta o índice", opcoes),
    rejeitaCom("a sessão de T-2 ainda está rodando (espere o agente terminar)"),
  );
  intacta();

  // Uma consulta que começa enquanto o PR é lido também faz a decisão esperar: as consultas são vistas depois da leitura.
  c.banco.exec(`UPDATE execucao SET resultado = 'sucesso', terminada_em = '${T1}' WHERE id = 8`);
  process.env.FALSO_GH_BANCO = join(c.raiz, "fabriquinha.db");
  process.env.FALSO_GH_SQL = consulta(9, "00000000-0000-4000-8000-000000000009");
  await assert.rejects(
    pedirMudancas(c.banco, 1, "falta o índice", opcoes),
    rejeitaCom("a sessão de T-2 ainda está rodando (espere o agente terminar)"),
  );
  delete process.env.FALSO_GH_SQL;
  intacta();
  c.banco.close();
});

test("banco fechado ao fim da sessão interativa: o término vai para o log em vez de derrubar o serviço", async () => {
  const c = cenario();
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", { ociosidadeMin: 0.01 });
  await ate(() => situacao(sessao)?.ocupado === false, "a conversa");
  c.banco.close();
  await ate(() => c.log(1).includes("E-1 não gravou o término:"), "o registro do erro no log");
});

test("sessão com dois arquivos (F6 §3.1): a retomada falha com o motivo, e o chat diz como resolver", async () => {
  const c = cenario();
  const opcoes = { ociosidadeMin: 0.01 };
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(() => c.execucoes()[0]?.resultado === "sucesso", "a parada por ociosidade");
  const dir = join(c.raiz, "sessoes");
  const [arquivo] = readdirSync(dir);
  copyFileSync(join(dir, String(arquivo)), join(dir, `2026-10-12T00-00-00-000Z_${sessao}.jsonl`));

  await enviar(c.banco, sessao, "voltei", "prompt", opcoes);
  await ate(() => c.execucoes()[1]?.resultado === "falha", "o C6 da falha");
  assert.match(c.log(2), /E-2 terminou com falha: a sessão \S+ tem 2 arquivos/);
  assert.match(c.log(2), /coleta de uso falhou: ErroDeRegra: a sessão \S+ tem 2 arquivos/);
  await assert.rejects(abrirChat(c.banco, sessao), /tem 2 arquivos .*\(deixe só o arquivo da sessão/);
  c.banco.close();
});

test("pi que sai sozinho: C6 falha, mas o ticket interativo não falha e a sessão segue em conversa", async () => {
  const c = cenario({ variante: "sai" });
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", { ociosidadeMin: 1 });
  await ate(() => c.execucoes()[0]?.resultado === "falha", "o C6 da falha");
  assert.match(c.log(1), /E-1 terminou com falha: o pi saiu antes de terminar a execução \(código 3\)/);
  assert.equal(agregado(c.banco, 1)?.tickets[0]?.status, "em_execucao");
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa");
  c.banco.close();
});

/** O arquivo da sessão que o pi falso grava. */
const arquivoFalso = (c: Cenario, sessao: string) =>
  join(c.raiz, "sessoes", `2026-10-11T10-00-00-000Z_${sessao}.jsonl`);

/** O último início do pi falso na sessão. */
const inicioDe = (c: Cenario, sessao: string) =>
  c.registro().findLast((r) => r.evento === "inicio" && (r.argv as string[]).includes(sessao)) as {
    argv: string[];
    cwd: string;
  };

test("consulta: copia a sessão principal, sem ferramentas de escrita, sem prompt e sem mudar o ticket", async () => {
  const c = cenario({ comAgente: true });
  const opcoes = { ociosidadeMin: 1 };
  const principal = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(async () => (await estadoDe(c, principal)) === "aguardando_humano: gate_registro", "o gate do registro");
  await decidirGate(c.banco, 1, "registro", { aprovado: true }, opcoes);
  const original = readFileSync(arquivoFalso(c, principal), "utf8");
  const comandos = c.comandos().length;

  const consulta = await conversarSobre(c.banco, 1, opcoes);
  assert.notEqual(consulta, principal);
  // Antes de o pi gravar a cópia, o chat da consulta já mostra a conversa da principal.
  assert.equal(existsSync(arquivoFalso(c, consulta)), false);
  assert.deepEqual((await abrirChat(c.banco, consulta)).conversa, (await abrirChat(c.banco, principal)).conversa);
  assert.deepEqual(
    { ...c.execucoes().at(-1) },
    { id: 2, resultado: "em_andamento", sessao_pi: consulta, modo: "consulta" },
  );
  await ate(async () => (await estadoDe(c, consulta)) === "aguardando_humano: conversa", "a consulta pronta");
  await ate(() => existsSync(arquivoFalso(c, consulta)), "a cópia da sessão");
  const inicio = inicioDe(c, consulta);
  assert.equal(inicio.cwd, caminhoDaWorktree(c.raiz, "loja", 1), "issue não concluída: a worktree");
  assert.deepEqual(inicio.argv.slice(4, 6), ["--session-id", consulta]);
  assert.deepEqual(inicio.argv.slice(-4), [
    "--fork",
    arquivoFalso(c, principal),
    "--exclude-tools",
    "edit,write,bash,powershell",
  ]);
  assert.equal(c.comandos().length, comandos, "a consulta sobe sem prompt, à espera da pergunta");
  assert.equal(existsSync(join(c.raiz, "execucoes", "E-2", "prompt.md")), false);
  const conversa = (await abrirChat(c.banco, consulta)).conversa as { message?: { role: string } }[];
  assert.deepEqual(
    conversa.map((e) => e.message?.role),
    [undefined, "user", "assistant"],
    "a conversa da principal",
  );
  assert.deepEqual(
    (await sessoes(c.banco, { escopo: "ativas" })).map((s) => [s.sessao, s.modo, s.ticket]),
    [[consulta, "consulta", 1]],
  );

  await enviar(c.banco, consulta, "Por que esse título? Só pergunte.", "prompt", opcoes);
  await ate(() => situacao(consulta)?.ocupado === false, "a resposta");
  assert.deepEqual(c.comandos().at(-1), { type: "prompt", message: "Por que esse título? Só pergunte." });
  assert.equal(readFileSync(arquivoFalso(c, principal), "utf8"), original, "a principal não recebe a consulta");
  const ag = agregado(c.banco, 1);
  assert.deepEqual([ag?.issue.fase, ag?.tickets[0]?.status], ["desenho", "concluido"], "nada muda no ticket");

  // Parada, a consulta de um ticket concluído termina com ele.
  encerrar((await infoDaSessao(c.banco, consulta)).execucao);
  assert.equal(await estadoDe(c, consulta), "terminada");
  assert.deepEqual(
    (await sessoes(c.banco, { escopo: "historico" })).map((s) => s.sessao).toSorted(),
    [consulta, principal].toSorted(),
  );

  // Issue concluída: a nova consulta roda no repositório do projeto.
  c.banco.exec(`UPDATE issue SET fase = 'concluida', concluida_em = '${T1}'`);
  const outra = await conversarSobre(c.banco, 1, opcoes);
  await ate(() => existsSync(arquivoFalso(c, outra)), "a outra consulta");
  assert.equal(inicioDe(c, outra).cwd, join(c.raiz, "..", "repo"));
  assert.deepEqual(inicioDe(c, outra).argv.slice(-4, -2), ["--fork", arquivoFalso(c, principal)]);
  encerrar((await infoDaSessao(c.banco, outra)).execucao);
  assert.equal(await estadoDe(c, outra), "terminada");
  c.banco.close();
});

test("consulta de um ticket por decidir: para o pi ocioso, segue em conversa depois da ociosidade e retoma como consulta", async () => {
  const c = cenario({ comAgente: true });
  const principal = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", { ociosidadeMin: 1 });
  await ate(async () => (await estadoDe(c, principal)) === "aguardando_humano: gate_registro", "o gate do registro");
  const opcoes = { ociosidadeMin: 0.01 };
  const consulta = await conversarSobre(c.banco, 1, opcoes);
  assert.deepEqual(c.execucoes()[0]?.resultado, "sucesso", "o pi ocioso da principal parou antes do C21");
  await ate(() => c.execucoes()[1]?.resultado === "sucesso", "a parada da consulta por ociosidade");
  assert.equal(await estadoDe(c, consulta), "aguardando_humano: conversa");
  assert.equal(await estadoDe(c, principal), "aguardando_humano: gate_registro", "o gate fica na principal");

  await enviar(c.banco, consulta, "E o critério? Só pergunte.", "prompt", opcoes);
  await ate(() => c.execucoes()[2]?.resultado === "sucesso", "a parada da retomada");
  // F6 §3.3: depoisDoC6 coleta o uso de cada C6 da consulta; a cópia da principal fica fora da janela dela.
  const uso = (e: number) =>
    c.banco
      .prepare("SELECT modelo, chamadas FROM uso WHERE execucao = ?")
      .all(e)
      .map((l) => ({ ...l }));
  assert.deepEqual([uso(2), uso(3)], [[], [{ modelo: "claude-teste", chamadas: 1 }]]);
  assert.doesNotMatch(c.log(2) + c.log(3), /coleta de uso falhou/);
  assert.deepEqual(
    c.execucoes().map((e) => [e.sessao_pi, e.modo]),
    [
      [principal, "interativo"],
      [consulta, "consulta"],
      [consulta, "consulta"],
    ],
    "a retomada é uma consulta na mesma sessão",
  );
  const retomada = inicioDe(c, consulta);
  assert.deepEqual(retomada.argv.slice(-3), [
    join(PACOTE, "extensions", "guarda.ts"),
    "--exclude-tools",
    "edit,write,bash,powershell",
  ]);
  assert.deepEqual(c.comandos().at(-1), { type: "prompt", message: "E o critério? Só pergunte." }, "só a mensagem");
  assert.equal(agregado(c.banco, 1)?.tickets[0]?.status, "em_execucao");
  c.banco.close();
});

test("consulta recusada: ticket sem sessão, sessão sem conversa gravada e agente trabalhando", async () => {
  const c = cenario({ variante: "espera" });
  const opcoes = { ociosidadeMin: 1 };
  registrarIssue(c.banco, { projeto: "loja" }, AUDITOR);
  await assert.rejects(
    conversarSobre(c.banco, 1, opcoes),
    rejeitaCom("T-1 ainda não tem sessão (consulte um ticket que já executou)"),
  );
  await assert.rejects(
    conversarSobre(c.banco, 9, opcoes),
    rejeitaCom("o ticket T-9 não existe (confira o número do ticket)"),
  );
  c.banco.exec(`INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
    VALUES (50, 1, 'interativo', '${SESSAO}', 'sucesso', '${T0}', '${T1}')`);
  await assert.rejects(
    conversarSobre(c.banco, 1, opcoes),
    rejeitaCom("a sessão de T-1 ainda não tem conversa gravada (espere o agente responder)"),
  );
  const sessao = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(() => c.comandos().length === 1, "o prompt chegar ao pi");
  await assert.rejects(
    conversarSobre(c.banco, 2, opcoes),
    rejeitaCom("a sessão de T-2 ainda está rodando (espere o agente terminar)"),
  );
  encerrar((await infoDaSessao(c.banco, sessao)).execucao);
  assert.equal(await estadoDe(c, sessao), "aguardando_humano: conversa", "espera o C6");
  c.banco.close();
});

test("consulta sem cópia: a primeira execução falhou antes de o pi subir, e a retomada copia a principal", async () => {
  const c = cenario({ comAgente: true });
  const opcoes = { ociosidadeMin: 1 };
  const principal = registrarNecessidade(c.banco, "loja", [], "Exportar pedidos em CSV", opcoes);
  await ate(async () => (await estadoDe(c, principal)) === "aguardando_humano: gate_registro", "o gate do registro");
  encerrar((await infoDaSessao(c.banco, principal)).execucao);
  assert.equal(await estadoDe(c, principal), "aguardando_humano: gate_registro");
  // O C21 gravou a consulta, e o serviço reiniciou antes do pi subir: não há cópia.
  const consulta = "00000000-0000-4000-8000-0000000000c1";
  c.banco.exec(`INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
    VALUES (50, 1, 'consulta', '${consulta}', 'falha', 'serviço reiniciado', '${T0}', '${T1}')`);
  assert.equal(await estadoDe(c, consulta), "aguardando_humano: conversa");

  await enviar(c.banco, consulta, "Do que tratamos? Só pergunte.", "prompt", opcoes);
  await ate(() => situacao(consulta)?.ocupado === false, "a resposta");
  const retomada = inicioDe(c, consulta);
  assert.deepEqual(retomada.argv.slice(-4), [
    "--fork",
    arquivoFalso(c, principal),
    "--exclude-tools",
    "edit,write,bash,powershell",
  ]);
  const conversa = (await abrirChat(c.banco, consulta)).conversa as { message?: { role: string } }[];
  assert.deepEqual(
    conversa.map((e) => e.message?.role),
    [undefined, "user", "assistant", "user", "assistant"],
    "a cópia da principal e depois a pergunta",
  );
  const viva = situacao(consulta);
  assert.ok(viva, "o pi da retomada");
  encerrar(viva.execucao);
  await ate(() => c.execucoes().every((e) => e.resultado !== "em_andamento"), "o C6 da retomada");
  c.banco.close();
});
