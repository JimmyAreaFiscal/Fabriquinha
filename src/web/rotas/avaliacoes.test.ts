// Rotas da avaliação contra o serviço de verdade, numa raiz temporária e numa porta livre, com um pi falso próprio:
// disparo e recusas, lista, detalhe, SSE, conversa, aborto, encaminhamento e a `origem` de GET /api/demandas/:id.
import assert from "node:assert/strict";
import { once } from "node:events";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { estadoDaAvaliacao } from "../../execucao/avaliacao.ts";
import { encerrar, situacao } from "../../execucao/gerente.ts";
import { iniciarServico, type Servico } from "../../execucao/servico.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-avaliacoes-rotas-")));
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");

// Grava dois achados no primeiro prompt (a menos que $FALSO_PI seja "espera", que não responde) e responde "ok".
const PI_FALSO = `#!/usr/bin/env node
import { appendFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
if (process.argv.includes("--version")) { console.log("0.0.0-falso"); process.exit(0); }
const dir = arg("--session-dir");
const id = arg("--session-id");
mkdirSync(dir, { recursive: true });
const existente = readdirSync(dir).find((nome) => nome.endsWith("_" + id + ".jsonl"));
const sessao = join(dir, existente ?? "2026-10-11T10-00-00-000Z_" + id + ".jsonl");
if (!existente) appendFileSync(sessao, JSON.stringify({ type: "session", version: 3, id }) + "\\n");
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const guardar = (message) =>
  appendFileSync(sessao, JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type === "prompt") {
      emitir({ type: "response", command: "prompt", success: true });
      emitir({ type: "agent_start" });
      guardar({ role: "user", content: c.message });
      if (process.env.FALSO_PI === "espera") continue;
      const achados = join(process.cwd(), "achados.jsonl");
      if (!existsSync(achados))
        for (const n of [1, 2]) appendFileSync(achados, JSON.stringify({ titulo: "Achado " + n, descricao: "desc " + n, evidencia: "ev " + n }) + "\\n");
      const message = { role: "assistant", provider: "p", model: "m", content: [{ type: "text", text: "ok" }], stopReason: "stop",
        usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } } };
      guardar(message);
      emitir({ type: "message_end", message });
      emitir({ type: "agent_end" });
      emitir({ type: "agent_settled" });
    }
    if (c.type === "abort") {
      emitir({ type: "response", command: "abort", success: true });
      emitir({ type: "agent_settled" });
    }
  }
});
`;
const pi = join(base, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;
process.env.FALSO_PI = "conversa";

const raiz = join(base, "raiz");
let servico: Servico;
let origem: string;
const ids: string[] = [];

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `http://127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  servico = await iniciarServico(raiz);
  for (const nome of ["loja", "site"]) {
    registrarProjeto(servico.banco, {
      nome,
      repo: join(base, nome),
      branchBase: "main",
      hospedagem: "github",
      preparacao: [],
      testes: ["true"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      modelos: {},
    });
  }
  const T = "'2026-10-10T10:00:00.000Z'";
  for (const [id, projeto] of [
    ["I-10", "loja"],
    ["I-11", "loja"],
    ["I-13", "site"],
  ] as const) {
    servico.banco.exec(
      `INSERT INTO demanda VALUES ('${id}', '${projeto}', 'Título ${id}', 'problema', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/${id}');
       INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', ${T});
       INSERT INTO sessao VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');
       INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('e-${id}', 's-${id}', ${T}, '2026-10-10T11:00:00.000Z', 0);`,
    );
  }
});
after(async () => {
  for (const id of ids) if (situacao(id)) encerrar(id);
  await ate(() => ids.every((id) => !situacao(id)), "o fim dos pis");
  await servico.parar();
  rmSync(base, { recursive: true, force: true });
});

const cookie = () =>
  `fabriquinha=${String(new URL(readFileSync(join(raiz, "web.url"), "utf8")).searchParams.get("token"))}`;

interface Json {
  erro: string;
  origem?: unknown;
  demanda: { titulo: string };
}

async function pedir(caminho: string, enviar?: unknown) {
  const r = await fetch(`${origem}${caminho}`, {
    method: enviar === undefined ? "GET" : "POST",
    headers: { cookie: cookie(), "sec-fetch-site": "same-origin", "content-type": "application/json" },
    ...(enviar !== undefined && { body: JSON.stringify(enviar) }),
  });
  const texto = await r.text();
  const corpo = r.headers.get("content-type")?.includes("json") ? (JSON.parse(texto) as Json) : ({} as Json);
  return { status: r.status, texto, corpo };
}

async function ate(condicao: () => boolean, oQue: string): Promise<void> {
  for (let espera = 0; !condicao(); espera += 20) {
    assert.ok(espera < 10_000, `${oQue} não aconteceu em 10 s`);
    await dormir(20);
  }
}

const periodo = { de: "2026-10-01", ate: "2026-10-31" };
const AV = "/api/avaliacoes";

async function disparar(corpo: object): Promise<string> {
  const r = await pedir(AV, { projeto: "loja", ...periodo, ...corpo });
  assert.equal(r.status, 200, r.texto);
  const { id } = r.corpo as unknown as { id: string };
  ids.push(id);
  return id;
}

test("recusas do disparo: período sem demanda, demanda de outro projeto, entrada inválida e pi que não sobe (CA-2, 5, 17)", async () => {
  const vazio = await pedir(AV, { projeto: "site", de: "2026-01-01", ate: "2026-01-31" });
  assert.equal(vazio.status, 409);
  assert.match(vazio.corpo.erro, /site.*2026-01-01.*2026-01-31/);

  const outra = await pedir(AV, { projeto: "loja", ...periodo, demandas: ["I-13"] });
  assert.equal(outra.status, 409);
  assert.match(outra.corpo.erro, /I-13/);

  assert.equal((await pedir(AV, { projeto: "loja", ...periodo, extra: 1 })).status, 422);
  assert.equal((await pedir(AV, { ...periodo })).status, 422);

  process.env.FABRIQUINHA_PI = "false";
  try {
    const r = await pedir(AV, { projeto: "loja", ...periodo });
    assert.equal(r.status, 502);
    assert.match(r.corpo.erro, /o agente da avaliação não subiu/);
  } finally {
    process.env.FABRIQUINHA_PI = pi;
  }
  assert.deepEqual((await pedir(AV)).corpo, []);
});

test("demandas do período: só as com sessão, e `demandas` não é lido como :id (CA-4)", async () => {
  const r = await pedir(`${AV}/demandas?projeto=loja&de=2026-10-01&ate=2026-10-31`);
  assert.deepEqual(r.corpo, [
    { id: "I-10", titulo: "Título I-10" },
    { id: "I-11", titulo: "Título I-11" },
  ]);
  assert.deepEqual((await pedir(`${AV}/demandas?projeto=loja&de=2026-01-01&ate=2026-01-31`)).corpo, []);
  assert.equal((await pedir(`${AV}/demandas?projeto=loja`)).status, 422);
});

test("dispara com pedido em branco, lista com estado e achados, abre o detalhe e o SSE (CA-1, 3, 4, 8, 16)", async () => {
  const id = await disparar({ pedido: "  ", demandas: ["I-10"] });
  await ate(() => situacao(id)?.ocupado === false, "a resposta do agente");
  await ate(() => nAchados(id) === 2, "os achados");

  const lista = (await pedir(AV)).corpo as unknown as {
    id: string;
    projeto: string;
    achados: number;
    estado: string;
  }[];
  assert.equal(lista.length, 1);
  assert.deepEqual(
    { id: lista[0]?.id, projeto: lista[0]?.projeto, achados: lista[0]?.achados },
    { id, projeto: "loja", achados: 2 },
  );
  assert.equal(lista[0]?.estado, estadoDaAvaliacao(id));

  const detalhe = (await pedir(`${AV}/${id}`)).corpo as unknown as {
    demandas: string[];
    achados: { titulo: string }[];
  };
  assert.deepEqual(detalhe.demandas, ["I-10"]);
  assert.deepEqual(
    detalhe.achados.map((a) => a.titulo),
    ["Achado 1", "Achado 2"],
  );

  const controle = new AbortController();
  const sse = await fetch(`${origem}${AV}/${id}/eventos`, { headers: { cookie: cookie() }, signal: controle.signal });
  assert.equal(sse.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const leitor = sse.body?.pipeThrough(new TextDecoderStream()).getReader();
  const primeiro = JSON.parse(String((await leitor?.read())?.value).replace(/^data: /, "")) as {
    type: string;
    projeto: string;
  };
  assert.deepEqual([primeiro.type, primeiro.projeto], ["avaliacao", "loja"]);
  controle.abort();
});

const nAchados = (id: string) =>
  servico.banco.prepare("SELECT count(*) AS n FROM achado_avaliacao WHERE avaliacao_id = ?").get(id)?.n;

test("id que não é UUID dá 422; avaliação que não existe, 404", async () => {
  const inexistente = "11111111-1111-4111-8111-111111111111";
  for (const caminho of ["", "/eventos"]) {
    assert.equal((await pedir(`${AV}/xx${caminho}`)).status, 422, caminho);
    assert.equal((await pedir(`${AV}/${inexistente}${caminho}`)).status, 404, caminho);
  }
  assert.equal((await pedir(`${AV}/xx/mensagens`, { texto: "oi" })).status, 422);
  assert.equal((await pedir(`${AV}/${inexistente}/mensagens`, { texto: "oi" })).status, 404);
  assert.equal((await pedir(`${AV}/xx/abortar`, {})).status, 422);
  assert.equal((await pedir(`${AV}/xx/achados/1/encaminhar`, {})).status, 422);
});

test("conversa, aborto, encaminhar, reencaminhar e a origem da demanda (CA-9, 10, 11, 12, 14)", async () => {
  const id = ids[0] ?? "";
  assert.equal((await pedir(`${AV}/${id}/mensagens`, { texto: "  " })).status, 422);
  encerrar(id);
  await ate(() => !situacao(id) && estadoDaAvaliacao(id) === "concluida", "a parada do pi");
  assert.equal((await pedir(`${AV}/${id}/mensagens`, { texto: "e a primeira melhoria?" })).status, 204);
  await ate(() => situacao(id)?.ocupado === false, "a resposta da retomada");
  assert.ok(readFileSync(join(raiz, "avaliacoes", id, "achados.jsonl"), "utf8").length > 0);
  assert.ok(JSON.stringify((await pedir(`${AV}/${id}`)).corpo).includes("e a primeira melhoria?"));
  assert.equal((await pedir(`${AV}/${id}/abortar`, {})).status, 204);

  const antes = await pedir("/api/demandas/I-10");
  assert.equal("origem" in antes.corpo, false);

  const enc = await pedir(`${AV}/${id}/achados/1/encaminhar`, {});
  assert.equal(enc.status, 200, enc.texto);
  const { demanda } = enc.corpo as unknown as { demanda: string };
  const pagina = await pedir(`/api/demandas/${demanda}`);
  assert.deepEqual(pagina.corpo.origem, { avaliacao: id, achado: 1, titulo: "Achado 1" });
  assert.equal(pagina.corpo.demanda.titulo, "Achado 1");

  const de_novo = await pedir(`${AV}/${id}/achados/1/encaminhar`, {});
  assert.equal(de_novo.status, 409);
  assert.match(de_novo.corpo.erro, new RegExp(demanda));
  assert.equal((await pedir(`${AV}/${id}/achados/9/encaminhar`, {})).status, 409);
});
