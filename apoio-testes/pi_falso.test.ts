import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarPiFalso, type PassoPi } from "./pi_falso.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-pi-falso-"));
const piFalso = join(import.meta.dirname, "pi_falso.ts");
// O pi falso que o teste dirige é o do arquivo; nada aqui chama o CLI sem uma raiz temporária.
const ambiente = (roteiro: PassoPi[] | undefined, extra: Record<string, string> = {}) => ({
  ...process.env,
  FABRIQUINHA_ROOT: join(base, "raiz"),
  FALSO_PI_ROTEIRO: roteiro ? JSON.stringify(roteiro) : "",
  FALSO_PI_REGISTRO: "",
  ...extra,
});
let numero = 0;
const pasta = () => mkdtempSync(join(base, `t${String(++numero)}-`));

after(() => {
  rmSync(base, { recursive: true, force: true });
});

type Evento = Record<string, unknown> & { type: string };

/** Um pi em RPC: manda comandos pelo stdin e espera eventos do stdout. */
function subir(roteiro: PassoPi[] | undefined, argumentos: string[] = [], extra: Record<string, string> = {}) {
  const cwd = pasta();
  const filho: ChildProcess = spawn(piFalso, ["--mode", "rpc", ...argumentos], { cwd, env: ambiente(roteiro, extra) });
  const eventos: Evento[] = [];
  let resto = "";
  let stderr = "";
  filho.stdout?.setEncoding("utf8").on("data", (parte: string) => {
    const linhas = (resto + parte).split("\n");
    resto = linhas.pop() ?? "";
    for (const linha of linhas) eventos.push(JSON.parse(linha) as Evento);
  });
  filho.stderr?.setEncoding("utf8").on("data", (parte: string) => (stderr += parte));
  const saida = new Promise<{ codigo: number | null; sinal: string | null }>((pronto) =>
    filho.on("close", (codigo, sinal) => {
      pronto({ codigo, sinal });
    }),
  );
  const esperar = async (condicao: () => boolean) => {
    for (let i = 0; i < 300 && !condicao(); i++) await new Promise((p) => setTimeout(p, 20));
    assert.ok(condicao(), `não chegou: ${JSON.stringify(eventos)}`);
  };
  return {
    cwd,
    eventos,
    saida,
    stderr: () => stderr,
    filho,
    enviar: (comando: object) => filho.stdin?.write(`${JSON.stringify(comando)}\n`),
    esperarEvento: (tipo: string, quantos = 1) =>
      esperar(() => eventos.filter((e) => e.type === tipo).length >= quantos),
    tipos: () => eventos.map((e) => e.type),
    fechar: () => filho.stdin?.end(),
  };
}

/** Um prompt até o fim: devolve os eventos, depois do `agent_settled`, e encerra o pi. */
async function umPrompt(roteiro: PassoPi[] | undefined, texto = "oi", argumentos: string[] = []) {
  const pi = subir(roteiro, argumentos);
  pi.enviar({ type: "prompt", message: texto });
  await pi.esperarEvento("agent_settled");
  pi.fechar();
  await pi.saida;
  return pi;
}

const rodar = (argumentos: string[], roteiro?: PassoPi[], extra: Record<string, string> = {}) =>
  spawnSync(piFalso, argumentos, { cwd: pasta(), env: ambiente(roteiro, extra), encoding: "utf8", input: "" });

test("--version e --list-models respondem como o pi, sem roteiro", () => {
  assert.equal(rodar(["--version"]).stdout.trim(), "0.0.0-falso");
  const modelos = rodar(["--list-models"]).stdout.split("\n");
  assert.match(modelos[0] ?? "", /^provider\s+model/);
  assert.match(modelos[1] ?? "", /^anthropic\s{2,}claude-opus-5-5\s/);
});

test("--list-models aceita tabela crua, stderr e código do roteiro", () => {
  const tabela = "provider  model\nlocal  modelo com espaços\n";
  const listado = rodar(["--list-models", "local/modelo"], [{ listaDeModelos: { tabela } }]);
  assert.deepEqual([listado.status, listado.stdout], [0, tabela]);
  const falha = rodar(["--list-models"], [{ listaDeModelos: { tabela: "", stderr: "sem configuração", codigo: 2 } }]);
  assert.deepEqual([falha.status, falha.stdout, falha.stderr], [2, "", "sem configuração"]);
});

test("saída crua preserva stdout, stderr e código; esperaEof mantém o processo até fechar o stdin", async () => {
  const saida = rodar([], [{ saidaDoProcesso: { stdout: "null\n5\naviso\n", stderr: "erro", codigo: 3 } }]);
  assert.deepEqual([saida.status, saida.stdout, saida.stderr], [3, "null\n5\naviso\n", "erro"]);
  const pi = spawn(piFalso, [], { cwd: pasta(), env: ambiente([{ saidaDoProcesso: { esperaEof: true } }]) });
  const fim = new Promise((pronto) => pi.on("close", pronto));
  await new Promise((pronto) => setTimeout(pronto, 200));
  assert.equal(pi.exitCode, null);
  pi.stdin.end();
  assert.equal(await fim, 0);
});

test("-p imprime a saída do passo (objeto em JSON, texto cru) e sem saída sai com 1", () => {
  const decisao = rodar(["-p", "triar"], [{ chamadaUnica: { saida: { decisao: "responder", resposta: "Sim" } } }]);
  assert.deepEqual([decisao.status, JSON.parse(decisao.stdout)], [0, { decisao: "responder", resposta: "Sim" }]);
  const resumo = rodar(["-p", "resumir"], [{ chamadaUnica: { saida: "resumo pronto" } }]);
  assert.deepEqual([resumo.status, resumo.stdout], [0, "resumo pronto\n"]);
  assert.equal(rodar(["-p", "x"], [{}]).status, 1);
  assert.equal(rodar(["-p", "x"], [{ chamadaUnica: { saida: "parcial", codigo: 2 } }]).status, 2);
});

test("--mode json espera o EOF do stdin e entrega o relatório; relatório null, texto cru e ordem", () => {
  const saida = pasta();
  const ordem = join(saida, "ordem");
  const extra = { FABRIQUINHA_SAIDA: saida, FALSO_PI_ORDEM: ordem, FABRIQUINHA_LINK: "http://x", GH_TOKEN: "segredo" };
  const normal = rodar(["--mode", "json", "prompt"], [{ simulacao: { demoraMs: 10, registraArgs: true } }], extra);
  assert.equal(normal.status, 0);
  assert.equal((JSON.parse(normal.stdout.trim()) as Evento).type, "agent_start");
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(saida, "relatorio.json"), "utf8")) as object), [
    "usabilidade",
    "bugs",
  ]);
  assert.equal(readFileSync(ordem, "utf8"), "ini\nfim\n");
  const sinal = (cwd: string) => JSON.parse(readFileSync(join(cwd, "args.json"), "utf8")) as Record<string, unknown>;
  const cwd = pasta();
  spawnSync(piFalso, ["--mode", "json", "p"], {
    cwd,
    env: ambiente([{ simulacao: { demoraMs: 0, registraArgs: true } }], extra),
    input: "",
  });
  assert.deepEqual(
    [sinal(cwd).args, sinal(cwd).link, sinal(cwd).token, sinal(cwd).saida],
    [["--mode", "json", "p"], "http://x", "segredo", saida],
  );
  rodar(["--mode", "json"], [{ simulacao: { relatorio: "isso não é json", demoraMs: 0 } }], extra);
  assert.equal(readFileSync(join(saida, "relatorio.json"), "utf8"), "isso não é json");
  rmSync(join(saida, "relatorio.json"));
  rodar(["--mode", "json"], [{ simulacao: { relatorio: null, demoraMs: 0 } }], extra);
  assert.equal(existsSync(join(saida, "relatorio.json")), false);
});

test("--mode json com nuncaTermina segue vivo depois do EOF até ser morto", async () => {
  const pi = spawn(piFalso, ["--mode", "json"], {
    cwd: pasta(),
    env: ambiente([{ simulacao: { nuncaTermina: true } }], { FABRIQUINHA_SAIDA: pasta() }),
  });
  pi.stdin.end();
  await new Promise((p) => setTimeout(p, 300));
  assert.equal(pi.exitCode, null);
  pi.kill();
  await new Promise((p) => pi.on("close", p));
});

test("RPC: o passo vazio responde, grava user e assistant (com custo) na sessão e assenta", async () => {
  const sessoes = join(pasta(), "sessoes");
  const pi = await umPrompt([{}], "olá", [
    "--session-dir",
    sessoes,
    "--session-id",
    "s1",
    "--provider",
    "p",
    "--model",
    "m",
  ]);
  assert.deepEqual(pi.tipos(), ["response", "agent_start", "message_end", "message_end", "agent_settled"]);
  const [arquivo] = readdirSync(sessoes);
  assert.match(arquivo ?? "", /^.+_s1\.jsonl$/);
  const mensagens = readFileSync(join(sessoes, arquivo ?? ""), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as { type: string; message: Record<string, unknown> });
  assert.deepEqual(
    mensagens.map((m) => [m.type, m.message.role]),
    [
      ["message", "user"],
      ["message", "assistant"],
    ],
  );
  const assistente = mensagens.at(-1)?.message ?? {};
  assert.deepEqual([assistente.provider, assistente.model, assistente.stopReason], ["p", "m", "stop"]);
  assert.deepEqual(assistente.usage, {
    input: 10,
    output: 2,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 12,
    cost: { total: 0.01 },
  });
});

test("RPC: resposta, parada com erro, custo e uso do passo; sem sessão nem usuário só emite", async () => {
  const sessoes = join(pasta(), "sessoes");
  const pi = await umPrompt(
    [
      {
        resposta: "",
        parada: "error",
        custo: null,
        uso: { cacheRead: 100 },
        sessao: false,
        usuario: false,
        inicio: false,
      },
    ],
    "x",
    ["--session-dir", sessoes, "--session-id", "s2"],
  );
  assert.deepEqual(pi.tipos(), ["response", "message_end", "agent_settled"]);
  assert.equal(existsSync(sessoes), false);
  const message = pi.eventos[1]?.message as Record<string, unknown>;
  assert.deepEqual([message.content, message.stopReason, message.errorMessage], [[], "error", "limite de uso"]);
  assert.deepEqual(message.usage, { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, totalTokens: 12 });
  const semUso = await umPrompt([{ uso: null }]);
  assert.equal("usage" in (semUso.eventos.at(-2)?.message as object), false);
});

test("RPC: a sessão reaproveita o arquivo do id, leva o cabeçalho pedido e copia o --fork", async () => {
  const sessoes = join(pasta(), "sessoes");
  await umPrompt([{ cabecalhoDaSessao: true }], "um", ["--session-dir", sessoes, "--session-id", "s3"]);
  await umPrompt([{}], "dois", ["--session-dir", sessoes, "--session-id", "s3"]);
  const [arquivo, ...outros] = readdirSync(sessoes);
  assert.deepEqual(outros, []);
  const linhas = readFileSync(join(sessoes, arquivo ?? ""), "utf8")
    .trim()
    .split("\n");
  assert.deepEqual(JSON.parse(linhas[0] ?? ""), { type: "session", version: 3, id: "s3" });
  assert.equal(linhas.length, 5);
  await umPrompt([{}], "fork", [
    "--session-dir",
    sessoes,
    "--session-id",
    "s4",
    "--fork",
    join(sessoes, arquivo ?? ""),
  ]);
  const copia = readFileSync(join(sessoes, `2026-10-11T00-00-00-000Z_s4.jsonl`), "utf8").trim().split("\n");
  assert.equal(copia.length, 5 + 2);
});

test("RPC: cada prompt consome um passo e o último se repete; a recusa vira response com erro", async () => {
  const pi = subir([{ termina: "nunca" }, { recusa: "Agent is already processing." }, { resposta: "fim" }]);
  pi.enviar({ type: "prompt", message: "um" });
  await pi.esperarEvento("agent_start");
  pi.enviar({ type: "prompt", message: "dois" });
  await pi.esperarEvento("response", 2);
  assert.deepEqual(
    pi.eventos.filter((e) => e.type === "response").map((e) => e.success),
    [true, false],
  );
  assert.equal(pi.eventos.at(-1)?.error, "Agent is already processing.");
  pi.enviar({ type: "prompt", message: "três" });
  await pi.esperarEvento("agent_settled");
  pi.fechar();
  await pi.saida;
});

test("RPC: eventos crus, pausas e diálogo; a resposta do diálogo assenta, o cancelamento não", async () => {
  const dialogo = { type: "extension_ui_request", id: "c1", method: "confirm", title: "Seguir?", timeout: 150 };
  const pi = subir([{ eventos: [{ pausaMs: 30 }, dialogo], termina: "nunca" }]);
  pi.enviar({ type: "prompt", message: "x" });
  await pi.esperarEvento("extension_ui_request");
  assert.deepEqual(pi.eventos.at(-1), dialogo);
  pi.enviar({ type: "extension_ui_response", id: "c1", cancelled: true });
  pi.enviar({ type: "follow_up", message: "y" });
  await pi.esperarEvento("response", 2);
  assert.equal(pi.tipos().includes("agent_settled"), false);
  pi.enviar({ type: "extension_ui_response", id: "c1", value: "Sim" });
  await pi.esperarEvento("agent_settled");
  pi.fechar();
  await pi.saida;
});

test("RPC: mensagem aberta que não fecha, trava e abort (com e sem mensagem)", async () => {
  const aberta = subir([{ mensagemAberta: true, termina: "nunca" }]);
  aberta.enviar({ type: "prompt", message: "x" });
  await aberta.esperarEvento("message_start");
  aberta.enviar({ type: "abort" });
  await aberta.esperarEvento("agent_settled");
  assert.equal(aberta.tipos().filter((t) => t === "message_end").length, 1);
  aberta.fechar();
  await aberta.saida;

  const abortada = subir([{ termina: "nunca", abortaComMensagem: true }]);
  abortada.enviar({ type: "prompt", message: "x" });
  await abortada.esperarEvento("agent_start");
  abortada.enviar({ type: "abort" });
  await abortada.esperarEvento("agent_settled");
  assert.equal((abortada.eventos.at(-2)?.message as { stopReason: string }).stopReason, "aborted");
  abortada.fechar();
  await abortada.saida;

  const trava = subir([{ termina: "trava" }]);
  trava.enviar({ type: "prompt", message: "x" });
  await trava.esperarEvento("agent_start");
  trava.fechar();
  await new Promise((p) => setTimeout(p, 300));
  assert.equal(trava.filho.exitCode, null);
  trava.filho.kill();
  assert.equal((await trava.saida).sinal, "SIGTERM");
});

test("RPC: sai com código e stderr no prompt, ao iniciar (com sessão) ou antes da sessão", async () => {
  const noPrompt = subir([{ sai: { codigo: 1, stderr: "falha do pi falso" } }]);
  noPrompt.enviar({ type: "prompt", message: "x" });
  assert.equal((await noPrompt.saida).codigo, 1);
  assert.match(noPrompt.stderr(), /falha do pi falso/);
  assert.equal(noPrompt.eventos.length, 0);

  const sessoes = join(pasta(), "sessoes");
  const argumentos = ["--session-dir", sessoes, "--session-id", "s5"];
  const antes = subir(
    [{ sai: { codigo: 3, stderr: "nenhum modelo", quando: "antes_da_sessao" }, cabecalhoDaSessao: true }],
    argumentos,
  );
  assert.equal((await antes.saida).codigo, 3);
  assert.equal(existsSync(sessoes), false);
  const aoIniciar = subir([{ sai: { codigo: 3, quando: "ao_iniciar" }, cabecalhoDaSessao: true }], argumentos);
  assert.equal((await aoIniciar.saida).codigo, 3);
  assert.equal(readdirSync(sessoes).length, 1);
});

test("RPC: SIGTERM mata o pi, ou assenta e sai com 0 quando o passo manda", async () => {
  const mata = subir([{ termina: "nunca" }]);
  mata.enviar({ type: "prompt", message: "x" });
  await mata.esperarEvento("agent_start");
  mata.filho.kill("SIGTERM");
  assert.equal((await mata.saida).sinal, "SIGTERM");

  const assenta = subir([{ termina: "nunca", sigterm: "assenta" }]);
  assenta.enviar({ type: "prompt", message: "x" });
  await assenta.esperarEvento("agent_start");
  assenta.filho.kill("SIGTERM");
  assert.deepEqual(await assenta.saida, { codigo: 0, sinal: null });
  assert.equal(assenta.tipos().at(-1), "agent_settled");

  const ignora = subir([{ termina: "trava", sigterm: "ignora" }]);
  ignora.enviar({ type: "prompt", message: "x" });
  await ignora.esperarEvento("agent_start");
  ignora.filho.kill("SIGTERM");
  await new Promise((p) => setTimeout(p, 300));
  assert.equal(ignora.filho.exitCode, null);
  ignora.filho.kill("SIGKILL");
  assert.equal((await ignora.saida).sinal, "SIGKILL");
});

// Com a regressão, o pi não sai: o limite reprova o teste e o SIGKILL do `after` impede que ele trave o `node --test`.
test("RPC: o pi que trava sai sozinho quando a pasta do teste que o instalou some", { timeout: 5000 }, async (t) => {
  const pastaDoTeste = pasta();
  const trava = subir([{ termina: "trava", sigterm: "ignora" }], [], {
    FALSO_PI_REGISTRO: join(pastaDoTeste, "pi-registro.jsonl"),
  });
  t.after(() => trava.filho.kill("SIGKILL"));
  trava.enviar({ type: "prompt", message: "x" });
  await trava.esperarEvento("agent_start");
  rmSync(pastaDoTeste, { recursive: true, force: true });
  assert.deepEqual(await trava.saida, { codigo: 1, sinal: null });
});

test("RPC: o agente escreve, apaga, acrescenta, roda shell, chama o CLI e um módulo, e o fim do agente", async () => {
  const agente = join(pasta(), "agente.mjs");
  writeFileSync(
    agente,
    'import { writeFileSync } from "node:fs";\nexport default async () => writeFileSync("do-agente", "feito");\n',
  );
  const cwd = pasta();
  writeFileSync(join(cwd, "velho"), "x");
  const passo: PassoPi = {
    escreve: { novo: "conteudo", velho: null },
    anexa: { "achados.jsonl": "a\n" },
    shell: "echo ok > pelo-shell",
    cli: [["--help"]],
    agente,
    fimDoAgente: true,
  };
  const pi = spawn(piFalso, ["--mode", "rpc"], { cwd, env: ambiente([passo, { ...passo, escreve: undefined }]) });
  const eventos: string[] = [];
  pi.stdout.on("data", (parte: Buffer) => eventos.push(parte.toString()));
  pi.stdin.write(`${JSON.stringify({ type: "prompt", message: "x" })}\n`);
  await new Promise((p) => setTimeout(p, 800));
  pi.stdin.write(`${JSON.stringify({ type: "prompt", message: "y" })}\n`);
  pi.stdin.end();
  await new Promise((p) => pi.on("close", p));
  assert.deepEqual(readdirSync(cwd).sort(), ["achados.jsonl", "do-agente", "novo", "pelo-shell"]);
  assert.equal(readFileSync(join(cwd, "achados.jsonl"), "utf8"), "a\na\n");
  assert.equal(eventos.join("").includes('"agent_end"'), true);
});

test("RPC: chamar um comando que o CLI não conhece derruba o pi", async () => {
  const pi = subir([{ cli: [["comando-que-nao-existe"]] }]);
  pi.enviar({ type: "prompt", message: "x" });
  assert.notEqual((await pi.saida).codigo, 0);
});

test("RPC: sem roteiro vale o comportamento do e2e, escolhido pelas marcas do prompt", async () => {
  const eco = await umPrompt(undefined, "eco: exatamente isto");
  const resposta = eco.eventos.filter((e) => e.type === "message_end").at(-1)?.message as {
    content: { text: string }[];
  };
  assert.equal(resposta.content[0]?.text, "exatamente isto");

  const padrao = await umPrompt(undefined, "qualquer coisa");
  assert.equal((padrao.eventos.at(-2)?.message as { content: { text: string }[] }).content[0]?.text, "pronto");

  const pergunta = subir(undefined);
  pergunta.enviar({ type: "prompt", message: "pergunte perguntar" });
  await pergunta.esperarEvento("extension_ui_request");
  assert.equal(
    pergunta.eventos.some((e) => e.type === "tool_execution_start" && e.toolName === "perguntar"),
    true,
  );
  pergunta.enviar({ type: "extension_ui_response", id: "d-select", value: "Validade mais próxima" });
  await pergunta.esperarEvento("agent_settled");
  const eco2 = pergunta.eventos.filter((e) => e.type === "message_end").at(-1)?.message as {
    content: { text: string }[];
  };
  assert.match(eco2.content[0]?.text ?? "", /Resposta do diálogo: .*Validade mais próxima/);
  pergunta.fechar();
  await pergunta.saida;

  const auditoria = await umPrompt(undefined, "# Auditoria do mês");
  assert.equal(
    auditoria.eventos.some((e) => e.type === "message_end" && (e.message as { role: string }).role === "toolResult"),
    true,
  );
});

test("RPC (marcas): [ao vivo] transmite sem terminar, o steer o redireciona e o abort fecha o fluxo", async () => {
  const pi = subir(undefined);
  pi.enviar({ type: "prompt", message: "[ao vivo] vai" });
  await pi.esperarEvento("message_update", 3);
  assert.equal(
    pi.eventos.some((e) => e.type === "tool_execution_end" && e.isError === true),
    true,
  );
  pi.enviar({ type: "steer", message: "outra ordem" });
  await pi.esperarEvento("extension_ui_request");
  const fechada = pi.eventos
    .filter((e) => e.type === "message_end")
    .map((e) => e.message as { role: string; content: { text?: string }[] });
  assert.match(fechada.at(-1)?.content[0]?.text ?? "", /Redirecionado: outra ordem/);
  pi.enviar({ type: "abort" });
  await pi.esperarEvento("agent_settled");
  pi.fechar();
  await pi.saida;
});

test("RPC (marcas): a avaliação grava os achados na pasta, e [20 achados] grava vinte", async () => {
  const tres = await umPrompt(undefined, "# Avaliação do mês");
  assert.equal(readFileSync(join(tres.cwd, "achados.jsonl"), "utf8").trim().split("\n").length, 3);
  const vinte = await umPrompt(undefined, "# Avaliação [20 achados]");
  assert.equal(readFileSync(join(vinte.cwd, "achados.jsonl"), "utf8").trim().split("\n").length, 20);
  assert.equal(vinte.tipos().includes("agent_end"), true);
});

test("instalarPiFalso aponta o ambiente para o pi, roteiriza e registra início, comandos e prompts", async () => {
  const antes = { ...process.env };
  try {
    const dir = pasta();
    const falso = instalarPiFalso(dir);
    assert.equal(process.env.FABRIQUINHA_PI, falso.caminho);
    assert.equal(process.env.FALSO_PI_ROTEIRO, join(dir, "pi-roteiro.json"));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "pi-roteiro.json"), "utf8")), [{}]);
    falso.roteirizar([{ resposta: "a" }, { resposta: "b" }]);
    const cwd = pasta();
    for (const texto of ["um", "dois"]) {
      const pi = spawn(falso.caminho, ["--mode", "rpc", "--session-id", "reg"], { cwd, env: process.env });
      pi.stdin.end(`${JSON.stringify({ type: "prompt", message: texto })}\n`);
      await new Promise((p) => pi.on("close", p));
    }
    assert.deepEqual(
      falso.prompts().map((p) => [p.prompt, p.sessao, p.cwd === cwd]),
      [
        ["um", "reg", true],
        ["dois", "reg", true],
      ],
    );
    assert.deepEqual(
      falso.registro().map((e) => e.evento),
      ["inicio", "comando", "inicio", "comando"],
    );
    // Outro pi no meio da escrita de uma linha: a leitura a ignora até ela terminar.
    writeFileSync(join(dir, "pi-registro.jsonl"), '{"evento":"inicio"}\n{"evento":"com');
    assert.deepEqual(
      falso.registro().map((e) => e.evento),
      ["inicio"],
    );
    assert.deepEqual(falso.roteirizar().registro(), []);
  } finally {
    process.env = antes;
  }
});
