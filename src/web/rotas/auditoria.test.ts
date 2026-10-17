// Rotas da auditoria contra o serviço de verdade, numa raiz temporária e numa porta livre, com o pi falso do e2e:
// mês sem sessão (409), entrada inválida (422), pi que não sobe (502), a sessão, o índice, o SSE e a retomada.
process.env.TZ = "America/Sao_Paulo"; // o mês é o do fuso do serviço; o teste não pode depender do da máquina

import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { estadoDaAuditoria } from "../../execucao/auditoria.ts";
import { encerrar, situacao } from "../../execucao/gerente.ts";
import { iniciarServico, type Servico } from "../../execucao/servico.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-auditoria-rotas-")));
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
const PI_FALSO = resolve(import.meta.dirname, "../../../e2e/pi-falso.ts");
process.env.FABRIQUINHA_PI = PI_FALSO;

const raiz = join(base, "raiz");
const S1 = "11111111-1111-4111-8111-111111111111";
let servico: Servico;
let origem: string;

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `http://127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  servico = await iniciarServico(raiz);
  registrarProjeto(servico.banco, {
    nome: "loja",
    repo: join(base, "repo"),
    branchBase: "main",
    hospedagem: "github",
    preparacao: [],
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    modelos: {},
  });
  // Uma sessão terminada em setembro de 2026, de uma issue cancelada: o agendador não mexe nela.
  servico.banco.exec(`
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, cancelada_em)
      VALUES (1, 'loja', 'Busca', 'problema', 'desenvolvimento', '2026-09-01T12:00:00.000Z', '2026-09-20T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (1, 1, 'desenho', 'Desenhar', 'concluido', 'fabriquinha', '2026-09-01T12:00:00.000Z', '2026-09-10T12:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '${S1}', 'sucesso', NULL, '2026-09-10T11:00:00.000Z', '2026-09-10T12:00:00.000Z');`);
});
after(async () => {
  console.error(
    "AFTER",
    auditorias().map((s) => [estadoDaAuditoria(s), !!situacao(s)]),
  );
  for (const sessao of auditorias()) if (situacao(sessao)) encerrar(sessao);
  await ate(() => auditorias().every((s) => estadoDaAuditoria(s) === "conversa" && !situacao(s)), "o fim dos pis");
  console.error("PARANDO");
  await servico.parar();
  setTimeout(() => {
    console.error("RES", process.getActiveResourcesInfo());
  }, 1500).unref();
  console.error("PAROU");
  rmSync(base, { recursive: true, force: true });
});

const cookie = () =>
  `fabriquinha=${String(new URL(readFileSync(join(raiz, "web.url"), "utf8")).searchParams.get("token"))}`;

async function pedir(caminho: string, corpo?: unknown) {
  const r = await fetch(`${origem}${caminho}`, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { cookie: cookie(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(corpo !== undefined && { body: JSON.stringify(corpo) }),
  });
  const texto = await r.text();
  return {
    status: r.status,
    tipo: r.headers.get("content-type"),
    texto,
    corpo: r.headers.get("content-type")?.includes("json") ? (JSON.parse(texto) as Record<string, unknown>) : texto,
  };
}

const auditorias = () => (existsSync(join(raiz, "auditorias")) ? readdirSync(join(raiz, "auditorias")) : []);

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

test("mês sem sessão: 409 com a frase exata e nenhuma pasta criada (CA-9)", async () => {
  const r = await pedir("/api/auditorias", { mes: "2026-08" });
  assert.equal(r.status, 409);
  assert.deepEqual(r.corpo, { erro: "Nenhuma sessão terminada em agosto de 2026 para auditar." });
  assert.deepEqual(auditorias(), []);
});

test("pedido que não é texto dá 422 em pedido, e mês vazio com pedido dá 409, sem pasta (CA-9, CA-10)", async () => {
  const r = await pedir("/api/auditorias", { mes: "2026-10", pedido: 123 });
  assert.equal(r.status, 422);
  assert.match(r.texto, /at pedido/);
  assert.deepEqual(auditorias(), []);

  const vazio = await pedir("/api/auditorias", { mes: "2026-08", pedido: "olhe os custos" });
  assert.equal(vazio.status, 409);
  assert.deepEqual(auditorias(), []);
});

test("mês inválido e :sessao que não é UUID dão 422", async () => {
  assert.equal((await pedir("/api/auditorias", { mes: "2026-13" })).status, 422);
  assert.equal((await pedir("/api/auditorias", { mes: "2026-09", projeto: "loja" })).status, 422);
  const sessao = "nao-e-uuid";
  for (const caminho of ["", "/eventos", "/indice.md"]) {
    assert.equal((await pedir(`/api/auditorias/${sessao}${caminho}`)).status, 422, caminho);
  }
  assert.equal((await pedir(`/api/auditorias/${sessao}/mensagens`, { texto: "oi" })).status, 422);
  assert.equal((await pedir(`/api/auditorias/${sessao}/abortar`, {})).status, 422);
  assert.equal((await pedir(`/api/auditorias/${S1}/mensagens`, { texto: "  " })).status, 422);
});

test("auditoria que não existe: 404", async () => {
  for (const caminho of ["", "/eventos", "/indice.md"]) {
    assert.equal((await pedir(`/api/auditorias/${S1}${caminho}`)).status, 404, caminho);
  }
  assert.equal((await pedir(`/api/auditorias/${S1}/mensagens`, { texto: "oi" })).status, 404);
});

test("pi que não sobe: 502 e nenhuma pasta (CA-10)", async () => {
  process.env.FABRIQUINHA_PI = "false";
  try {
    const r = await pedir("/api/auditorias", { mes: "2026-09" });
    assert.equal(r.status, 502);
    assert.match((r.corpo as { erro: string }).erro, /o agente da auditoria não subiu/);
    assert.deepEqual(auditorias(), []);
  } finally {
    process.env.FABRIQUINHA_PI = PI_FALSO;
  }
});

interface Dados {
  mes: string;
  rotulo: string;
  sessoes: number;
  projetos: Record<string, number>;
  estado: string;
  conversa: unknown[];
}
const ler = async (sessao: string) => (await pedir(`/api/auditorias/${sessao}`)).corpo as unknown as Dados;

test("mês com sessões: devolve a sessão, o GET traz o mês e o estado, o índice e o SSE; a mensagem retoma a parada", async () => {
  const criada = await pedir("/api/auditorias", { mes: "2026-09", pedido: "  " }); // pedido em branco = sem pedido
  assert.equal(criada.status, 200);
  const { sessao } = criada.corpo as { sessao: string };
  assert.deepEqual(auditorias(), [sessao]);

  await ate(() => situacao(sessao)?.ocupado === false, "a resposta do agente");
  const { conversa: _, ...dados } = await ler(sessao);
  assert.deepEqual(dados, {
    mes: "2026-09",
    rotulo: "setembro de 2026",
    sessoes: 1,
    projetos: { loja: 1 },
    estado: "conversa",
  });

  const indice = await pedir(`/api/auditorias/${sessao}/indice.md`);
  assert.equal(indice.tipo, "text/markdown; charset=utf-8");
  assert.match(indice.texto, /^# Auditoria de setembro de 2026\n/);

  const controle = new AbortController();
  const sse = await fetch(`${origem}/api/auditorias/${sessao}/eventos`, {
    headers: { cookie: cookie() },
    signal: controle.signal,
  });
  assert.equal(sse.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const leitor = sse.body?.pipeThrough(new TextDecoderStream()).getReader();
  const primeiro = JSON.parse(String((await leitor?.read())?.value).replace(/^data: /, "")) as Dados & { type: string };
  assert.equal(primeiro.type, "auditoria");
  assert.equal(primeiro.mes, "2026-09");

  // O pi para; a mensagem o retoma na mesma sessão.
  encerrar(sessao);
  await ate(() => !situacao(sessao) && !existsSync(join(raiz, "auditorias", sessao, "pgid")), "a parada do pi");
  const enviada = await pedir(`/api/auditorias/${sessao}/mensagens`, { texto: "  e a primeira melhoria?  " });
  assert.equal(enviada.status, 204);
  await ate(() => JSON.stringify(situacao(sessao) ?? null) !== "null", "o pi da retomada");
  await ate(() => JSON.stringify(situacao(sessao)?.ocupado) === "false", "a resposta da retomada");
  assert.ok(JSON.stringify((await ler(sessao)).conversa).includes("e a primeira melhoria?"));
  assert.deepEqual(auditorias(), [sessao]);

  // Com o agente trabalhando, a mensagem é recusada e Abortar o para.
  assert.equal((await pedir(`/api/auditorias/${sessao}/mensagens`, { texto: "[ao vivo]" })).status, 204);
  await ate(() => situacao(sessao)?.ocupado === true, "o agente trabalhar");
  assert.equal((await pedir(`/api/auditorias/${sessao}/mensagens`, { texto: "outra" })).status, 409);
  assert.equal((await pedir(`/api/auditorias/${sessao}/abortar`, {})).status, 204);
  await ate(() => situacao(sessao)?.ocupado === false, "o aborto");
  controle.abort();
});
