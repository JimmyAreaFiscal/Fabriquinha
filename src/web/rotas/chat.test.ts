// Rotas do chat (F7 §4.2) contra o serviço de verdade, numa raiz temporária e numa porta livre, com git real e o pi
// falso do e2e: registro pelo chat com o SSE, C2 e o gate; diálogos; aborto e redirecionamento; concluir a sessão.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { avisar, encerrar, situacao } from "../../execucao/gerente.ts";
import { iniciarServico, type Servico } from "../../execucao/servico.ts";
import { submeter } from "../../evidencias/submissao.ts";
import type { DadosDoChatDemanda } from "./chat.ts";
import { criarDemanda } from "../../persistencia/demandas.ts";
import { proporIssue } from "../../persistencia/issues.ts";
import { gravarConfiguracaoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { iniciarExecucaoDemanda, interromperExecucaoDemanda } from "../../execucao/execucao_demanda.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../../persistencia/sessoes.ts";
import { execucoesEmAndamento } from "../../persistencia/servico.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import type { Pedido } from "../rotas.ts";
import { type CabecalhoDoChat, type DadosDoChat, ROTAS_DO_CHAT } from "./chat.ts";
import { demanda } from "./demandas_cenario.test.ts";
import type { PainelRegistro } from "./issue.ts";

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
  delete process.env.SONAR_HOST_URL;
  servico = await iniciarServico(raiz);
  registrarProjeto(servico.banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    // Sem SONAR_HOST_URL, a coleta depois do pi do desenvolvimento falha o ticket sem depender do SonarQube da máquina;
    // uma reprovação o devolveria ao agente.
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
  const { corpo } = await postar("/api/registros", { projeto: "loja", descricao: "Exportar pedidos em CSV" });
  const { sessao } = corpo as { sessao: string };
  await esperarEstado(sessao, "aguardando_humano: conversa");
  return [sessao, ((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).issue.id];
}

const textos = (conversa: Record<string, unknown>[]) =>
  conversa.map((e) => {
    const m = e.message as { role: string; content: string | { text?: string }[] };
    return `${m.role}: ${typeof m.content === "string" ? m.content : m.content.map((b) => b.text).join("")}`;
  });

test("registro sem descrição, ou só com espaços, dá 422 e nenhuma issue nasce", async () => {
  for (const corpo of [{ projeto: "loja" }, { projeto: "loja", descricao: "  \n " }]) {
    const r = await postar("/api/registros", corpo);
    assert.equal(r.status, 422);
    assert.match(JSON.stringify(r.corpo), /descricao/);
  }
  assert.deepEqual((await pedir("/api/board")).corpo, []);
});

test("registro pelo chat: SSE com o retrato e os eventos, C2 do Auditor, envio ao gate, devolver e aprovar", async () => {
  const { corpo } = await postar("/api/registros", { projeto: "loja", descricao: "Exportar pedidos em CSV" });
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
  assert.deepEqual([chat.issue.titulo, chat.issue.fase, chat.execucoes.length], [null, "registro", 1]);
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
  // O agente enviou (C25): o painel do gate fica na página da issue, não no chat.
  const pagina = (await pedir(issue)).corpo as { issue: { titulo: string }; registro?: PainelRegistro };
  assert.deepEqual(
    [
      pagina.issue.titulo,
      pagina.registro?.comportamento,
      pagina.registro?.criterios.map((c) => c.id),
      pagina.registro?.faltando,
    ],
    ["Exportar pedidos em CSV", "hoje a contabilidade copia os pedidos à mão", ["CA-1", "CA-2"], []],
  );
  assert.ok(
    sse.eventos.some((e) => e.type === "estado" && (e as Evento & CabecalhoDoChat).sessao.motivo === "gate_registro"),
  );
  const recusada = await enviar("mais uma");
  assert.equal(recusada.status, 409, "o gate não recebe mensagem");
  assert.match((recusada.corpo as { erro: string }).erro, /decida na página da issue/);

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

test("proposta de issue no chat do registro: cabeçalho, 422, 404, aceitar com o aviso marcado, 409; recusar", async () => {
  const [sessao, issue] = await registro();
  const { ticket, execucoes } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  const agente = { tipo: "agente", execucao: execucoes[0]?.id ?? 0, ticket: ticket.id } as const;
  const proposta = { titulo: "Tela de relatório", mensagem: "Parte B: tela de relatório", arquivos: 31 };
  assert.deepEqual(((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).propostas, []);
  const a = proporIssue(servico.banco, issue, proposta, agente);
  const b = proporIssue(servico.banco, issue, { ...proposta, titulo: "Outra" }, agente);
  const abertas = ((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).propostas;
  assert.deepEqual(
    abertas?.map((p) => [p.id, p.titulo, p.mensagem, p.arquivos]),
    [
      [a.id, "Tela de relatório", "Parte B: tela de relatório", 31],
      [b.id, "Outra", "Parte B: tela de relatório", 31],
    ],
  );

  assert.equal((await postar(`/api/propostas/${String(a.id)}`, { aceita: "sim" })).status, 422);
  assert.equal((await postar(`/api/propostas/${String(a.id)}`, {})).status, 422);
  assert.equal((await postar("/api/propostas/9999", { aceita: true })).status, 404);
  const aceita = await postar(`/api/propostas/${String(a.id)}`, { aceita: true });
  assert.equal(aceita.status, 200);
  const nova = (aceita.corpo as { issue: number }).issue;
  assert.deepEqual(
    ((await pedir(`/api/issues/${String(nova)}`)).corpo as { dependencias: { id: number }[] }).dependencias.map(
      (d) => d.id,
    ),
    [issue],
  );
  await esperarEstado(sessao, "aguardando_humano: conversa");

  const chat = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(
    chat.propostas?.map((p) => p.id),
    [b.id],
    "só a aberta continua no cartão",
  );
  assert.deepEqual(
    chat.conversa.filter((e) => e.aviso),
    [],
    "com a P-2 aberta, a IA não recebeu aviso",
  );
  const segundo = await postar(`/api/propostas/${String(a.id)}`, { aceita: true });
  assert.equal(segundo.status, 409);
  assert.match((segundo.corpo as { erro: string }).erro, /a proposta P-\d+ já foi decidida: aceita/);

  assert.equal((await postar(`/api/issues/${String(issue)}/registro`, { aprovado: true })).status, 409);
  assert.deepEqual((await postar(`/api/propostas/${String(b.id)}`, { aceita: false })).corpo, {});
  await esperarEstado(sessao, "aguardando_humano: conversa");
  const depois = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(depois.propostas, []);
  const avisos = depois.conversa.filter((e) => e.aviso);
  assert.deepEqual(
    avisos.map((e) => e.fabriquinha),
    [undefined],
  );
  const aviso = textos(avisos)[0] ?? "";
  assert.match(aviso, /^user: O Auditor decidiu as suas propostas de issue:\n/);
  assert.match(
    aviso,
    new RegExp(`- P-${String(a.id)}: A Fabriquinha criou a I-${String(nova)} \\(«Tela de relatório»\\)`),
  );
  assert.match(aviso, new RegExp(`- P-${String(b.id)}: O Auditor recusou a sua proposta de issue «Outra»`));
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
  let iteracoes = 0;
  for (const [metodo, corpo, eco] of casos) {
    await postar(`/api/sessoes/${sessao}/mensagens`, { texto: `pergunte ${metodo}`, modo: "prompt" });
    await esperarEstado(sessao, "aguardando_humano: dialogo");
    const { sessao: info } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
    assert.equal(info.dialogos[0]?.method, metodo);
    assert.equal((await responder(`d-${metodo}`, { valor: 1 })).status, 422);
    assert.equal((await responder(`d-${metodo}`, { valor: "a", cancelado: true })).status, 422);
    assert.equal((await responder(`d-${metodo}`, corpo)).status, 204);
    iteracoes += 1;
    assert.equal(
      servico.banco.prepare("SELECT count(*) AS n FROM iteracao WHERE tipo = 'dialogo'").get()?.n,
      iteracoes,
      "a resposta pela rota grava a iteração",
    );
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
    () => sse.eventos.some((e) => JSON.stringify(e).includes('"delta":"esperam a "')),
    "o texto começar a chegar em fluxo",
  );
  sse.fechar();
  // Quem assina no meio da mensagem recebe, logo depois do retrato, o resultado da ferramenta, que o pi pode ainda
  // não ter gravado (o chat ignora o que o retrato já tem), o começo da mensagem e os pedaços já escritos.
  const tarde = await assinar(sessao);
  await ate(() => tarde.eventos.length >= 6, "o retrato e a mensagem em andamento");
  assert.deepEqual(
    tarde.eventos
      .slice(1, 6)
      .map((e) => [
        e.type,
        (e.message as { role?: string } | undefined)?.role,
        (e.assistantMessageEvent as { delta?: string } | undefined)?.delta,
      ]),
    [
      ["message_end", "toolResult", undefined],
      ["message_start", "assistant", undefined],
      ["message_update", undefined, undefined],
      ["message_update", undefined, "Os testes "],
      ["message_update", undefined, "esperam a "],
    ],
  );
  await ate(
    () => tarde.eventos.some((e) => JSON.stringify(e).includes('"delta":"**ordem antiga**"')),
    "o resto chegar ao vivo",
  );
  tarde.fechar();
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

test("o fim de uma ferramenta do pi avisa o chat com um estado novo", async () => {
  const [sessao] = await registro();
  const sse = await assinar(sessao);
  assert.equal((await postar(`/api/sessoes/${sessao}/mensagens`, { texto: "[ao vivo]", modo: "prompt" })).status, 204);
  await ate(() => sse.eventos.some((e) => e.type === "tool_execution_end"), "o fim da ferramenta");
  const fim = sse.eventos.findIndex((e) => e.type === "tool_execution_end");
  await ate(() => sse.eventos.slice(fim).some((e) => e.type === "estado"), "o estado depois da ferramenta");
  sse.fechar();
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await esperarEstado(sessao, "aguardando_humano: conversa");
});

test("o cabeçalho traz a evidência submetida pelo agente; a consulta traz a lista vazia", async () => {
  const [sessao] = await registro();
  const { ticket, execucoes } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).evidencias, []);
  const execucao = execucoes[0]?.id ?? 0;
  const arquivo = join(raiz, "execucoes", `E-${String(execucao)}`, "saida", "tela.webm");
  mkdirSync(dirname(arquivo), { recursive: true });
  writeFileSync(arquivo, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]));
  const agente = { tipo: "agente", execucao, ticket: ticket.id } as const;
  await submeter(servico.banco, agente, "comportamento", { descricao: "lento", comoReproduzir: ["abrir"] }, [arquivo]);
  const { evidencias } = (await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat;
  assert.deepEqual(
    evidencias.map((e) => e.tipo),
    ["comportamento"],
  );
  const { corpo } = await postar(`/api/tickets/${String(ticket.id)}/consulta`);
  const { sessao: consulta } = corpo as { sessao: string };
  await esperarEstado(consulta, "aguardando_humano: conversa");
  assert.deepEqual(((await pedir(`/api/sessoes/${consulta}`)).corpo as DadosDoChat).evidencias, []);
});

test("SSE: o cliente que sai enquanto o chat abre não fica assinando a sessão", async () => {
  const [sessao] = await registro();
  const resposta = new ServerResponse(new IncomingMessage(new Socket()));
  const escritos: unknown[] = [];
  resposta.write = (dado: unknown) => escritos.push(dado) > 0;
  // O navegador fecha antes de `abrirChat` resolver (ele espera o C6 de um pi que está parando).
  resposta.destroy();
  const rota = ROTAS_DO_CHAT.find((r) => r.caminho === "/api/sessoes/:sessao/eventos");
  await rota?.tratar({ banco: servico.banco, params: { sessao }, resposta } as unknown as Pedido);
  avisar(sessao, join(base, "log"));
  assert.deepEqual(escritos, []);
});

test("concluir só a sessão em aberto; entrada inválida dá 422 e sessão ou ticket inexistente, 404", async () => {
  const [sessao] = await registro();
  const { ticket } = ((await pedir(`/api/sessoes/${sessao}`)).corpo as DadosDoChat).sessao;
  const concluir = await postar(`/api/tickets/${String(ticket)}/concluir-sessao`);
  assert.equal(concluir.status, 409);
  assert.match((concluir.corpo as { erro: string }).erro, /só a sessão em aberto/);
  assert.equal((await postar("/api/tickets/999/concluir-sessao")).status, 404);
  assert.equal((await postar("/api/registros", { projeto: 3, descricao: "x" })).status, 422);
  assert.equal((await pedir("/api/sessoes/nada")).status, 404);
  assert.equal((await pedir("/api/sessoes/nada/eventos")).status, 404);
});

test("falha: responder e retomar (C20 e C9); consulta com o histórico de outra sessão anexado; histórico em Markdown", async () => {
  const t0 = "2026-10-11T12:00:00.000Z";
  const sessao = crypto.randomUUID();
  servico.banco.exec(
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
       VALUES (900, 'loja', 'Timeout no checkout', 'problema', '', 'desenvolvimento', '${t0}');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em)
       VALUES (900, 900, 'desenvolvimento', 'Buscar cupons', 'falhou', 'fabriquinha', 'a execução caiu', '${t0}');
     INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
       VALUES (900, 900, 'autonomo', '${sessao}', 'falha', 'a execução caiu', '${t0}', '${t0}');`,
  );
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  const conversa = (role: string, text: string) =>
    JSON.stringify({ type: "message", message: { role, content: [{ type: "text", text }] } });
  writeFileSync(
    join(raiz, "sessoes", `2026-10-11T12-00-00-000Z_${sessao}.jsonl`),
    `${conversa("user", "busque os cupons")}\n${conversa("assistant", "feito")}\n`,
  );
  const dados = async (s: string) => (await pedir(`/api/sessoes/${s}`)).corpo as DadosDoChat;
  await esperarEstado(sessao, "aguardando_humano: falha");
  const falha = await dados(sessao);
  assert.equal(falha.ticket.status, "falhou");
  assert.ok(falha.ticket.erro);
  const enviar = await postar(`/api/sessoes/${sessao}/mensagens`, { texto: "oi", modo: "prompt" });
  assert.equal(enviar.status, 409);
  assert.match((enviar.corpo as { erro: string }).erro, /responda e retome o ticket/);

  // C20 pela rota do desenho e C9 com a instrução: o ticket volta a aberto e o chat sai da falha pelo SSE.
  const modelo = { provedor: "anthropic", modelo: "claude-opus-5-5" };
  assert.equal((await postar("/api/tickets/900/modelo", { modelo })).status, 204);
  const sse = await assinar(sessao);
  assert.equal((await postar("/api/tickets/900/reabrir", { instrucao: "ordene pela validade" })).status, 204);
  await ate(
    () => sse.eventos.some((e) => e.type === "estado" && (e as Evento & CabecalhoDoChat).sessao.estado === "rodando"),
    "o aviso do estado novo",
  );
  sse.fechar();
  const reaberto = (await dados(sessao)).ticket;
  assert.deepEqual([reaberto.status, reaberto.instrucao, reaberto.modelo], ["aberto", "ordene pela validade", modelo]);
  const deNovo = await postar("/api/tickets/900/reabrir", {});
  assert.equal(deNovo.status, 409, "só se reabre ticket que falhou");
  assert.equal((await postar("/api/tickets/900/reabrir", { instrucao: 3 })).status, 422);
  assert.equal((await postar("/api/tickets/999/reabrir", {})).status, 404);

  servico.banco.exec("UPDATE ticket SET status = 'falhou', erro = 'caiu de novo' WHERE id = 900");
  // Responder e retomar com o histórico de outra sessão anexado (F4 §6.8): o anexo vai na instrução da próxima tentativa.
  const [outra] = await registro();
  const { ticket: doRegistro, issue: daOutra } = (await dados(outra)).sessao;
  assert.equal((await postar("/api/tickets/900/reabrir", { anexos: ["nada"] })).status, 404);
  assert.equal((await postar("/api/tickets/900/reabrir", { anexos: [outra], extra: 1 })).status, 422);
  assert.equal(
    (await postar("/api/tickets/900/reabrir", { anexos: [outra] })).status,
    204,
    "sem instrução também retoma",
  );
  const comAnexo = new RegExp(
    `^Histórico da sessão T-${String(doRegistro)} \\(I-${String(daOutra)}, registro\\) em \`(.+historico-T-${String(doRegistro)}\\.md)\`; leia antes de responder\\.$`,
  ).exec(String((await dados(sessao)).ticket.instrucao));
  assert.ok(comAnexo?.[1], String((await dados(sessao)).ticket.instrucao));
  assert.match(readFileSync(comAnexo[1], "utf8"), /^# Histórico da sessão T-/);

  // Conversar sobre esta sessão: a consulta começa com a conversa da principal.
  const { corpo } = await postar("/api/tickets/900/consulta");
  const { sessao: consulta } = corpo as { sessao: string };
  await esperarEstado(consulta, "aguardando_humano: conversa");
  const aberta = await dados(consulta);
  assert.equal(aberta.sessao.modo, "consulta");
  assert.ok(aberta.conversa.length > 0);
  assert.equal(aberta.conversa.length, (await dados(sessao)).conversa.length);
  assert.equal((await postar("/api/tickets/999/consulta")).status, 404);

  // + Anexar histórico: a exportação da outra sessão vai para a saída da execução, e a mensagem ganha a linha dela.
  const perguntar = (anexos: unknown) =>
    postar(`/api/sessoes/${consulta}/mensagens`, { texto: "o que houve?", modo: "prompt", anexos });
  assert.equal((await perguntar("x")).status, 422);
  assert.equal((await perguntar(["nada"])).status, 404);
  assert.equal((await perguntar([outra])).status, 204);
  await ate(async () => (await dados(consulta)).conversa.length > aberta.conversa.length + 1, "a resposta");
  const pergunta = textos((await dados(consulta)).conversa).find((t) => t.startsWith("user: o que houve?"));
  const linha = new RegExp(
    `^user: o que houve\\?\\nHistórico da sessão T-${String(doRegistro)} \\(I-${String(daOutra)}, registro\\) em \`(.+historico-T-${String(doRegistro)}\\.md)\`; leia antes de responder\\.$`,
  ).exec(String(pergunta));
  assert.ok(linha?.[1], String(pergunta));
  assert.match(readFileSync(linha[1], "utf8"), /^# Histórico da sessão T-/);

  // Exportar histórico: o Markdown como download, com o nome do anexo.
  const baixar = (s: string) => fetch(`${origem}/api/sessoes/${s}/historico.md`, { headers: { cookie: cookie() } });
  const principal = await baixar(sessao);
  assert.equal(principal.status, 200);
  assert.equal(principal.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(principal.headers.get("content-disposition"), 'attachment; filename="historico-T-900.md"');
  assert.match(await principal.text(), /^# Histórico da sessão T-900 \(I-900, desenvolvimento\)/);
  assert.equal(
    (await baixar(consulta)).headers.get("content-disposition"),
    `attachment; filename="historico-T-900-consulta-${consulta}.md"`,
  );
  assert.equal((await baixar("nada")).status, 404);
});

test("sessão de ticket da demanda: o chat, o SSE e o histórico saem do serviço da demanda; id desconhecido segue o das issues", async () => {
  const em = "2026-01-01T00:00:00.000Z";
  criarDemanda(
    servico.banco,
    demanda("I-310", "planejamento", {
      tickets: [
        {
          demanda_id: "I-310",
          ticket_id: 1,
          etapa: "planejar",
          status: "em_execucao",
          status_alterado_em: em,
          devolucoes: 0,
        },
      ],
    }),
  );
  comSessoesDoTicket(servico.banco, { demanda_id: "I-310", ticket_id: 1 }, (e) => ({
    ...e,
    sessoes: [{ demanda_id: "I-310", ticket_id: 1, id: "sd-310", modo: "interativo", conversa_referencia: "sd-310" }],
    execucoes: [{ id: "ed-310", sessao_id: "sd-310", inicio: em, fim: em, falha: false }],
  }));
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  const mensagem = (role: string, text: string) => ({
    type: "message",
    message: { role, content: [{ type: "text", text }] },
  });
  writeFileSync(
    join(raiz, "sessoes", "2026-01-01T00-00-00-000Z_sd-310.jsonl"),
    [mensagem("user", "planeje"), mensagem("assistant", "Qual a prioridade?")]
      .map((l) => JSON.stringify(l))
      .join("\n") + "\n",
  );

  const chat = (await pedir("/api/sessoes/sd-310")).corpo as DadosDoChatDemanda;
  assert.deepEqual(
    [chat.origem, chat.demanda, chat.rodada, chat.ticket, chat.etapa, chat.sessao.estado, chat.sessao.motivo],
    ["demanda", "I-310", undefined, "I-310.T1", "planejar", "aguardando_humano", "conversa"],
  );
  assert.deepEqual(textos(chat.conversa), ["user: planeje", "assistant: Qual a prioridade?"]);

  const sse = await assinar("sd-310");
  await ate(() => sse.eventos.length > 0, "o retrato");
  const [retrato] = sse.eventos as [Evento & DadosDoChatDemanda];
  assert.deepEqual([retrato.type, retrato.origem, retrato.conversa.length], ["chat", "demanda", 2]);
  avisar("sd-310", join(raiz, "log"));
  await ate(() => sse.eventos.length > 1, "o estado novo");
  assert.deepEqual([sse.eventos[1]?.type, sse.eventos[1]?.origem], ["estado", "demanda"]);
  sse.fechar();

  const baixado = await fetch(`${origem}/api/sessoes/sd-310/historico.md`, { headers: { cookie: cookie() } });
  assert.equal(baixado.status, 200);
  assert.equal(baixado.headers.get("content-type"), "text/markdown; charset=utf-8");
  assert.equal(baixado.headers.get("content-disposition"), 'attachment; filename="historico-I-310.T1.md"');
  assert.match(
    await baixado.text(),
    /^# Histórico da sessão I-310.T1 \(planejar\)[\s\S]*## Auditor\n\nplaneje[\s\S]*## Agente\n\nQual a prioridade\?/,
  );

  // CA-9, CA-12: texto vazio recusado no schema; steer na conversa, diálogo e aborto sem pi são recusados.
  const vazio = await postar("/api/sessoes/sd-310/mensagens", { texto: "   ", modo: "prompt" });
  assert.equal(vazio.status, 422);
  assert.equal((await postar("/api/sessoes/sd-310/mensagens", { texto: "x", modo: "steer" })).status, 409);
  assert.equal((await postar("/api/sessoes/sd-310/dialogos/d1", { valor: "x" })).status, 409);
  assert.equal((await postar("/api/sessoes/sd-310/abortar")).status, 409);

  // CA-7: a sessão que nem a demanda nem as issues conhecem.
  const nada = await pedir("/api/sessoes/sd-nada");
  assert.equal(nada.status, 404);
  assert.match(JSON.stringify(nada.corpo), /a sessão sd-nada não existe[\s\S]*confira o endereço do chat/);
});

test("sessão de ticket da demanda com o pi vivo: responder o diálogo, enviar a mensagem e abortar", async () => {
  gravarConfiguracaoProjeto(servico.banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: join(base, "repo"),
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const ref = { demanda_id: "I-311", ticket_id: 1 };
  criarDemanda(
    servico.banco,
    demanda("I-311", "planejamento", {
      demanda: { ...demanda("I-311", "planejamento").demanda, descricao: "pergunte perguntar" },
      tickets: [
        {
          ...ref,
          etapa: "planejar",
          status: "em_execucao",
          status_alterado_em: "2026-01-01T00:00:00.000Z",
          devolucoes: 0,
        },
      ],
    }),
  );
  const { fim } = iniciarExecucaoDemanda(servico.banco, ref, {
    limiteMin: 5,
    modo: "interativo",
    fechar: () => Promise.resolve(),
  });
  const sessao = String(carregarSessoesDoTicket(servico.banco, ref).sessoes[0]?.id);
  const dialogos = () => situacao(sessao)?.dialogos ?? [];
  await ate(() => dialogos().length === 1, "o diálogo");
  const resposta = await postar(`/api/sessoes/${sessao}/dialogos/${String(dialogos()[0]?.id)}`, { valor: "alta" });
  assert.equal(resposta.status, 204);
  await ate(() => situacao(sessao)?.ocupado === false, "o pi ocioso");

  assert.equal(
    (await postar(`/api/sessoes/${sessao}/mensagens`, { texto: "pergunte perguntar", modo: "prompt" })).status,
    204,
  );
  await ate(() => dialogos().length === 1, "o diálogo da mensagem");
  assert.equal((await postar(`/api/sessoes/${sessao}/abortar`)).status, 204);
  await ate(() => situacao(sessao)?.ocupado === false, "o aborto");
  interromperExecucaoDemanda(servico.banco, ref);
  await fim;
});
