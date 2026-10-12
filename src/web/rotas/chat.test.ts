// Rotas do chat (F7 §4.2) contra o serviço de verdade, numa raiz temporária e numa porta livre, com git real e o pi
// falso do e2e: registro pelo chat com o SSE, C2 e o gate; diálogos; aborto e redirecionamento; concluir a sessão.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { encerrar } from "../../execucao/gerente.ts";
import { iniciarServico, type Servico } from "../../execucao/servico.ts";
import { execucoesEmAndamento } from "../../persistencia/servico.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import type { CabecalhoDoChat, DadosDoChat } from "./chat.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-chat-")));
const gitconfig = join(base, "gitconfig");
writeFileSync(gitconfig, "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = gitconfig;
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
process.env.FABRIQUINHA_PI = resolve(import.meta.dirname, "../../../e2e/pi-falso.ts");

let servico: Servico;
let origem: string;
const raiz = join(base, "raiz");

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `http://127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });
  const bare = join(base, "origin.git");
  const repo = join(base, "repo");
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "LEIAME"), "loja\n");
  git(repo, "add", "LEIAME");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "push", "-q", "origin", "main");
  servico = await iniciarServico(raiz);
  registrarProjeto(servico.banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    modelos: {},
  });
});
after(async () => {
  // Os pis interativos ociosos ficariam vivos até a ociosidade: param aqui, e o C6 de cada um vem antes de fechar.
  for (const { id } of execucoesEmAndamento(servico.banco)) encerrar(id);
  await ate(() => execucoesEmAndamento(servico.banco).length === 0, "o C6 das sessões");
  await servico.parar();
  rmSync(base, { recursive: true, force: true });
});

const cookie = () =>
  `fabriquinha=${String(new URL(readFileSync(join(raiz, "web.url"), "utf8")).searchParams.get("token"))}`;

async function pedir(caminho: string, corpo?: unknown): Promise<{ status: number; corpo: unknown; texto: string }> {
  const r = await fetch(`${origem}${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { cookie: cookie(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const texto = await r.text();
  return {
    status: r.status,
    texto,
    corpo: r.headers.get("content-type")?.includes("json") ? JSON.parse(texto) : texto,
  };
}

const postar = (caminho: string, corpo: unknown = {}) => pedir(caminho, corpo);

/** Espera `condicao` ficar verdadeira, até 10 s. */
async function ate(condicao: () => boolean | Promise<boolean>, oQue: string): Promise<void> {
  for (let espera = 0; !(await condicao()); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

type Evento = Record<string, unknown> & { type: string };

/** Assina o SSE da sessão e junta os eventos que chegam. */
async function assinar(sessao: string) {
  const controle = new AbortController();
  const r = await fetch(`${origem}/api/sessoes/${sessao}/eventos`, {
    headers: { cookie: cookie() },
    signal: controle.signal,
  });
  assert.equal(r.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const eventos: Evento[] = [];
  const corpo = r.body;
  assert.ok(corpo);
  void (async () => {
    let resto = "";
    for await (const parte of corpo.pipeThrough(new TextDecoderStream())) {
      const blocos = (resto + parte).split("\n\n");
      resto = blocos.pop() ?? "";
      for (const bloco of blocos) eventos.push(JSON.parse(bloco.replace(/^data: /, "")) as Evento);
    }
  })().catch(() => undefined);
  return {
    eventos,
    fechar: () => {
      controle.abort();
    },
  };
}

const estado = async (sessao: string) => {
  const { sessao: s } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  return s.motivo ? `${s.estado}: ${s.motivo}` : s.estado;
};

const esperarEstado = (sessao: string, alvo: string) =>
  ate(async () => (await estado(sessao)) === alvo, `a sessão ficar ${alvo}`);

/** Um registro novo pelo chat, já com a primeira resposta do agente. Devolve a sessão e a issue. */
async function registro(): Promise<[string, number]> {
  const { corpo } = await postar("/api/registros", { projeto: "loja" });
  const { sessao } = corpo as { sessao: string };
  await esperarEstado(sessao, "aguardando_humano: conversa");
  return [sessao, ((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).issue.id];
}

const textos = (conversa: Record<string, unknown>[]) =>
  conversa.map((e) => {
    const m = e.message as { role: string; content: string | { text?: string }[] };
    return `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((b) => b.text).join("")}`;
  });

test("registro pelo chat: SSE com o retrato e os eventos, C2 do Auditor, gate com o painel, devolver e aprovar", async () => {
  const { corpo } = await postar("/api/registros", { projeto: "loja" });
  const { sessao } = corpo as { sessao: string };
  const sse = await assinar(sessao);
  await ate(() => sse.eventos.length > 0, "o retrato");
  const [retrato] = sse.eventos as [Evento & DadosDoChat];
  assert.equal(retrato.type, "chat");
  assert.equal(retrato.sessao.sessao, sessao);
  await esperarEstado(sessao, "aguardando_humano: conversa");

  // O prompt da Fabriquinha vem marcado, no retrato ou ao vivo; a resposta do agente, não.
  const chat = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(
    chat.conversa.map((e) => e.fabriquinha ?? false),
    [true, false],
  );
  assert.match(textos(chat.conversa)[0] ?? "", /^user: # Contexto[\s\S]*Vamos registrar uma necessidade/);
  assert.equal(textos(chat.conversa)[1], "assistant: pronto");
  const aoVivo = [...retrato.conversa, ...sse.eventos.filter((e) => e.type === "message_end")];
  assert.equal(aoVivo.filter((e) => e.fabriquinha).length, 1);
  assert.deepEqual(
    [chat.issue.titulo, chat.issue.fase, chat.execucoes.length, chat.registro],
    [null, "registro", 1, undefined],
  );
  assert.ok(sse.eventos.some((e) => e.type === "estado" && (e as Evento & CabecalhoDoChat).issue.id === chat.issue.id));

  // C2 do Auditor, ao lado da conversa.
  const issue = `/api/issues/${String(chat.issue.id)}`;
  const editada = await postar(issue, { descricao: "Botão no painel de pedidos." });
  assert.equal((editada.corpo as { descricao: string }).descricao, "Botão no painel de pedidos.");
  assert.equal((await postar(issue, { titulo: "" })).status, 422);
  assert.equal((await postar("/api/issues/999", { titulo: "x" })).status, 404);

  const enviar = (texto: string, modo = "prompt") => postar(`/api/sessoes/${sessao}/mensagens`, { texto, modo });
  assert.equal((await enviar("registre", "steer")).status, 409, "conversa não recebe steer");
  assert.equal((await enviar("   ")).status, 422);
  assert.equal((await enviar("registre")).status, 204);
  await esperarEstado(sessao, "aguardando_humano: gate_registro");
  const auditor = sse.eventos.find(
    (e) => e.type === "message_end" && (e.message as { content: unknown }).content === "registre",
  );
  assert.equal(auditor?.fabriquinha, undefined);
  const gate = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(
    [
      gate.issue.titulo,
      gate.registro?.comportamento,
      gate.registro?.criterios.map((c) => c.id),
      gate.registro?.faltando,
    ],
    ["Exportar pedidos em CSV", "hoje a contabilidade copia os pedidos à mão", ["CA-1", "CA-2"], []],
  );
  assert.ok(sse.eventos.some((e) => e.type === "estado" && (e as Evento & CabecalhoDoChat).registro));
  assert.equal((await enviar("mais uma")).status, 409, "o gate não recebe mensagem");

  // Devolver exige o motivo, que vai ao agente; depois de trabalhar de novo, ele volta ao gate.
  const decidir = `${issue}/registro`;
  assert.equal((await postar(decidir, { aprovado: false })).status, 422);
  assert.equal((await postar(decidir, { aprovado: false, motivo: "faltou o formato" })).status, 204);
  await esperarEstado(sessao, "aguardando_humano: conversa");
  const devolvida = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.ok(textos(devolvida.conversa).includes("user: O Auditor devolveu o registro. Motivo: faltou o formato"));
  assert.equal((await enviar("registre")).status, 204);
  await esperarEstado(sessao, "aguardando_humano: gate_registro");
  assert.equal((await postar(decidir, { aprovado: true })).status, 204);
  await esperarEstado(sessao, "terminada");
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 409, "sem pi vivo, nada a abortar");
  assert.equal(((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).issue.fase, "desenho");
  assert.equal((await postar("/api/issues/abc/registro", { aprovado: true })).status, 422);
  sse.fechar();
});

test("diálogos: select, confirm, input e editor respondidos ou cancelados no formato do pi; corpo inválido dá 422", async () => {
  const [sessao] = await registro();
  const responder = (id: string, corpo: unknown) => postar(`/api/sessoes/${sessao}/dialogos/${id}`, corpo);
  const casos: [string, unknown, string][] = [
    ["select", { valor: "Validade mais próxima" }, '{"value":"Validade mais próxima"}'],
    ["confirm", { confirmado: false }, '{"confirmed":false}'],
    ["input", { cancelado: true }, '{"cancelled":true}'],
    ["editor", { valor: "linha 1" }, '{"value":"linha 1"}'],
  ];
  for (const [metodo, corpo, eco] of casos) {
    await postar(`/api/sessoes/${sessao}/mensagens`, { texto: `pergunte ${metodo}`, modo: "prompt" });
    await esperarEstado(sessao, "aguardando_humano: dialogo");
    const { sessao: info } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
    assert.equal(info.dialogos[0]?.method, metodo);
    assert.equal((await responder(`d-${metodo}`, { valor: 1 })).status, 422);
    assert.equal((await responder(`d-${metodo}`, { valor: "a", cancelado: true })).status, 422);
    assert.equal((await responder(`d-${metodo}`, corpo)).status, 204);
    await esperarEstado(sessao, "aguardando_humano: conversa");
    const { conversa } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
    assert.equal(textos(conversa).at(-1), `assistant: Resposta do diálogo: ${eco}`);
  }
  const outra = await responder("d-select", { valor: "x" });
  assert.equal(outra.status, 409);
  assert.match((outra.corpo as { erro: string }).erro, /não está pendente/);
  assert.equal((await postar("/api/sessoes/nada/dialogos/d", { valor: "x" })).status, 404);
});

test("rodando: redirecionar e abortar; sessão inexistente dá 404", async () => {
  const [sessao] = await registro();
  const enviar = (texto: string, modo: string) => postar(`/api/sessoes/${sessao}/mensagens`, { texto, modo });
  const sse = await assinar(sessao);
  assert.equal((await enviar("[ao vivo]", "prompt")).status, 204);
  await ate(
    () => sse.eventos.some((e) => JSON.stringify(e).includes('"delta":"**ordem antiga**"')),
    "o texto chegar em fluxo",
  );
  sse.fechar();
  assert.equal((await enviar("use a validade", "steer")).status, 204);
  await esperarEstado(sessao, "aguardando_humano: dialogo");
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await esperarEstado(sessao, "aguardando_humano: conversa");
  const { conversa } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(textos(conversa).slice(-4), [
    "assistant: Os testes esperam a **ordem antiga**",
    "user: use a validade",
    "assistant: Redirecionado: use a validade",
    'assistant: Resposta do diálogo: {"cancelled":true}',
  ]);

  // Abortar de novo: o pi interativo ocioso ainda está vivo e só assenta. Parado, não há o que abortar.
  assert.equal((await enviar("[ao vivo]", "prompt")).status, 204);
  await esperarEstado(sessao, "rodando");
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await esperarEstado(sessao, "aguardando_humano: conversa");
  const { conversa: depois } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.equal((depois.at(-1)?.message as { stopReason: string }).stopReason, "aborted");
  assert.equal((await postar("/api/sessoes/nada/abortar")).status, 404);
});

test("concluir só a sessão em aberto; entrada inválida dá 422 e sessão ou ticket inexistente, 404", async () => {
  const [sessao] = await registro();
  const { ticket } = ((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).sessao;
  const concluir = await postar(`/api/tickets/${String(ticket)}/concluir-sessao`);
  assert.equal(concluir.status, 409);
  assert.match((concluir.corpo as { erro: string }).erro, /só a sessão em aberto/);
  assert.equal((await postar("/api/tickets/999/concluir-sessao")).status, 404);
  assert.equal((await postar("/api/registros", { projeto: 3 })).status, 422);
  assert.equal((await pedir("/api/sessoes/nada")).status, 404);
  assert.equal((await pedir("/api/sessoes/nada/eventos")).status, 404);
});
