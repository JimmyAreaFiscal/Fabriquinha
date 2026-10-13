// Servidor web do F7 §4.1 e §7 (web) contra o serviço de verdade, numa raiz temporária e numa porta livre.
import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { request } from "node:http";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { iniciarServico, type Servico } from "../execucao/servico.ts";
import { ROTAS } from "./servidor.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-web-"));
let raiz: string;
let servico: Servico;
let origem: string;

before(async () => {
  const livre = createServer().listen(0, "127.0.0.1");
  await once(livre, "listening");
  process.env.FABRIQUINHA_PORTA = String((livre.address() as { port: number }).port);
  livre.close();
  await once(livre, "close");
  origem = `127.0.0.1:${process.env.FABRIQUINHA_PORTA}`;
  raiz = mkdtempSync(join(base, "raiz-"));
  servico = await iniciarServico(raiz);
});
after(async () => {
  await servico.parar();
  rmSync(base, { recursive: true, force: true });
});

const link = () => new URL(readFileSync(join(raiz, "web.url"), "utf8"));
const token = () => String(link().searchParams.get("token"));

interface Resposta {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  corpo: Buffer;
  texto: string;
  json: () => unknown;
}

/** Uma requisição com controle total dos cabeçalhos (o `fetch` não deixa trocar o `Host`). */
async function pedir(
  caminho: string,
  { metodo = "GET", headers = {}, corpo }: { metodo?: string; headers?: Record<string, string>; corpo?: string } = {},
): Promise<Resposta> {
  // Com o tamanho, como o navegador: sem ele, o cliente do Node manda o corpo do DELETE solto na conexão.
  const tamanho = corpo === undefined ? {} : { "content-length": String(Buffer.byteLength(corpo)) };
  const pedido = request(`http://${origem}${caminho}`, {
    method: metodo,
    headers: { host: origem, ...tamanho, ...headers },
  });
  pedido.end(corpo);
  const [resposta] = (await once(pedido, "response")) as [import("node:http").IncomingMessage];
  const partes: Buffer[] = [];
  for await (const parte of resposta as AsyncIterable<Buffer>) partes.push(parte);
  const tudo = Buffer.concat(partes);
  return {
    status: Number(resposta.statusCode),
    headers: resposta.headers,
    corpo: tudo,
    texto: tudo.toString("utf8"),
    json: () => JSON.parse(tudo.toString("utf8")) as unknown,
  };
}

const comCookie = (headers: Record<string, string> = {}) => ({ cookie: `fabriquinha=${token()}`, ...headers });
const mesmaOrigem = () => comCookie({ "sec-fetch-site": "same-origin", "content-type": "application/json" });

test("web.url: link de entrada com token de 32 bytes, só para o dono, trocado a cada subida", async () => {
  assert.equal(statSync(join(raiz, "web.url")).mode & 0o777, 0o600);
  assert.equal(existsSync(join(raiz, "web.url.novo")), false, "o temporário virou o web.url");
  assert.equal(link().origin, `http://${origem}`);
  assert.equal(link().pathname, "/entrar");
  assert.equal(Buffer.from(token(), "base64url").length, 32);

  const antes = token();
  await servico.parar();
  servico = await iniciarServico(raiz);
  assert.notEqual(token(), antes);
  assert.equal(
    (await pedir("/api/sessoes?escopo=ativas", { headers: { cookie: `fabriquinha=${antes}` } })).status,
    401,
  );
});

test("entrar com o token grava o cookie HttpOnly e SameSite=Strict e leva ao Início", async () => {
  const r = await pedir(`/entrar?token=${token()}`);
  assert.equal(r.status, 303);
  assert.equal(r.headers.location, "/home");
  assert.deepEqual(r.headers["set-cookie"], [`fabriquinha=${token()}; HttpOnly; SameSite=Strict; Path=/`]);
});

test("entrar com token errado, de outro tamanho ou sem token não grava cookie", async () => {
  const errado = `${token().slice(0, -1)}${token().endsWith("A") ? "B" : "A"}`;
  for (const consulta of [`?token=${errado}`, "?token=curto", `?token=${"é".repeat(43)}`, ""]) {
    const r = await pedir(`/entrar${consulta}`);
    assert.equal(r.status, 303);
    assert.equal(r.headers.location, "/home");
    assert.equal(r.headers["set-cookie"], undefined, consulta);
  }
});

test("Host diferente de 127.0.0.1:<porta> dá 403 em qualquer caminho, antes do cookie", async () => {
  for (const host of ["localhost:" + String(process.env.FABRIQUINHA_PORTA), "evil.example", "127.0.0.1"]) {
    for (const caminho of ["/home", "/static/estilo.css", `/entrar?token=${token()}`, "/api/sessoes?escopo=ativas"]) {
      const r = await pedir(caminho, { headers: comCookie({ host }) });
      assert.equal(r.status, 403, `${host} ${caminho}`);
      assert.match((r.json() as { erro: string }).erro, /só 127\.0\.0\.1/);
    }
  }
});

test("rota de dado sem o cookie certo dá 401 com a instrução de entrar de novo", async () => {
  for (const caminho of ["/api/sessoes?escopo=ativas", "/api/qualquer", "/arquivos/abc"]) {
    for (const cookie of [undefined, "fabriquinha=errado", "outro=1"]) {
      const r = await pedir(caminho, { headers: cookie ? { cookie } : {} });
      assert.equal(r.status, 401, `${caminho} ${String(cookie)}`);
      assert.deepEqual(r.json(), { erro: "o navegador não entrou nesta Fabriquinha (rode fabriquinha abrir)" });
    }
  }
});

test("mutação sem Sec-Fetch-Site ou de outra origem dá 403, mesmo com o cookie", async () => {
  for (const metodo of ["POST", "DELETE"]) {
    for (const site of [undefined, "cross-site", "same-site", "none"]) {
      const headers = comCookie(site ? { "sec-fetch-site": site } : {});
      const r = await pedir("/api/projetos", { metodo, headers, corpo: "{}" });
      assert.equal(r.status, 403, `${metodo} ${String(site)}`);
    }
  }
  assert.equal((await pedir("/home", { metodo: "POST" })).status, 403);
});

test("rota inexistente dá 404 com { erro }", async () => {
  assert.deepEqual((await pedir("/api/nada", { headers: comCookie() })).json(), { erro: "GET /api/nada não existe" });
  assert.equal((await pedir("/arquivos/abc", { headers: comCookie() })).status, 404);
  const post = await pedir("/api/nada", { metodo: "POST", headers: mesmaOrigem(), corpo: '{"a":1}' });
  assert.deepEqual(post.json(), { erro: "POST /api/nada não existe" });
  // Rota de API com outro método também não existe.
  assert.equal((await pedir("/api/sessoes", { metodo: "DELETE", headers: mesmaOrigem() })).status, 404);
  assert.equal((await pedir("/home", { metodo: "POST", headers: mesmaOrigem() })).status, 404);
});

test("corpo de mutação: JSON até 64 KiB; inválido ou grande demais dá 422", async () => {
  const invalido = await pedir("/api/nada", { metodo: "POST", headers: mesmaOrigem(), corpo: "{" });
  assert.deepEqual([invalido.status, invalido.json()], [422, { erro: "o corpo não é JSON válido" }]);
  const grande = await pedir("/api/nada", {
    metodo: "POST",
    headers: mesmaOrigem(),
    corpo: JSON.stringify("x".repeat(64 * 1024)),
  });
  assert.deepEqual([grande.status, grande.json()], [422, { erro: "o corpo passa de 64 KiB" }]);
  // No limite e vazio, o corpo passa e a rota é que não existe.
  const noLimite = JSON.stringify("x".repeat(64 * 1024 - 2));
  assert.equal((await pedir("/api/nada", { metodo: "POST", headers: mesmaOrigem(), corpo: noLimite })).status, 404);
  assert.equal((await pedir("/api/nada", { metodo: "POST", headers: mesmaOrigem() })).status, 404);
});

test("caminho de página sem cookie devolve o index.html, e a chamada de API dele dá 401", async () => {
  const index = readFileSync(join(import.meta.dirname, "cliente", "index.html"), "utf8");
  for (const caminho of ["/", "/home", "/projects/x/issues/I-1", "/sessions/abc", "/qualquer/coisa"]) {
    const r = await pedir(caminho);
    assert.equal(r.status, 200, caminho);
    assert.equal(r.headers["content-type"], "text/html; charset=utf-8");
    assert.equal(r.headers["x-content-type-options"], "nosniff");
    assert.equal(r.texto, index);
  }
  assert.match(index, /<script type="module" src="\/static\/app.ts"><\/script>/);
  assert.equal((await pedir("/api/sessoes?escopo=ativas")).status, 401);
});

test("estáticos sem token: o cliente TypeScript sai como JavaScript, CSS e fontes como estão", async () => {
  const app = await pedir("/static/app.ts");
  assert.equal(app.status, 200);
  assert.equal(app.headers["content-type"], "text/javascript; charset=utf-8");
  assert.match(app.texto, /from "\.\/caminhos\.ts"/);
  assert.doesNotMatch(app.texto, /: Montar|import type|<HTMLElement>/);
  assert.doesNotMatch((await pedir("/static/render.ts")).texto, /import type/);

  // O markdown-it do navegador, que o import map do index.html resolve.
  const md = await pedir("/static/markdown-it.js");
  assert.equal(md.headers["content-type"], "text/javascript; charset=utf-8");
  assert.match(md.texto, /^\/\*! markdown-it /);
  assert.match(
    readFileSync(join(import.meta.dirname, "cliente", "index.html"), "utf8"),
    /"markdown-it\/browser": "\/static\/markdown-it.js"/,
  );

  const css = await pedir("/static/estilo.css");
  assert.equal(css.headers["content-type"], "text/css; charset=utf-8");
  assert.match(css.texto, /url\("fontes\/plex-sans-400\.woff2"\)/);

  const fonte = await pedir("/static/fontes/plex-sans-400.woff2");
  assert.equal(fonte.headers["content-type"], "font/woff2");
  assert.deepEqual(fonte.corpo, readFileSync(join(import.meta.dirname, "cliente", "fontes", "plex-sans-400.woff2")));

  for (const caminho of [
    "/static/render.test.ts",
    "/static/index.html",
    "/static/fontes/OFL.txt",
    "/static/nada.ts",
    "/static/..%2fservidor.ts",
  ]) {
    assert.equal((await pedir(caminho)).status, 404, caminho);
  }
  // `..` sai de /static/ antes de chegar ao servidor: vira um caminho de página.
  assert.match((await pedir("/static/%2e%2e/servidor.ts")).texto, /^<!doctype html>/);
});

test("estáticos sem token: o .tsx sai empacotado, sem JSX, e o segundo pedido vem do cache", async () => {
  const caminho = "/static/telas/chat-conversa.tsx";
  const primeiro = await pedir(caminho);
  assert.equal(primeiro.status, 200);
  assert.equal(primeiro.headers["content-type"], "text/javascript; charset=utf-8");
  assert.doesNotMatch(primeiro.texto, /<ThreadPrimitive|jsxDEV|from"react"/);
  assert.match(primeiro.texto, /from"markdown-it\/browser"/);
  assert.equal((await pedir(caminho)).texto, primeiro.texto);
});

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

test("GET /api/sessoes: as sessões do escopo com o estado calculado; filtro inválido dá 422 com o campo", async () => {
  assert.deepEqual((await pedir("/api/sessoes?escopo=ativas", { headers: comCookie() })).json(), []);
  servico.banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/nao/existe', 'main', 'github', '["npm test"]', 'p', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'p', 'Busca', 'problema', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em)
      VALUES (1, 1, 'desenvolvimento', 'Cache', 'falhou', 'fabriquinha', 'testes falharam', '2026-10-11T12:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '${SESSAO}', 'falha', 'testes falharam', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z');
  `);
  const [sessao] = (
    await pedir("/api/sessoes?escopo=ativas&projeto=p&issue=1&etapa=desenvolvimento", {
      headers: comCookie(),
    })
  ).json() as Record<string, unknown>[];
  assert.deepEqual(
    { sessao: sessao?.sessao, estado: sessao?.estado, motivo: sessao?.motivo },
    { sessao: SESSAO, estado: "aguardando_humano", motivo: "falha" },
  );
  assert.deepEqual((await pedir("/api/sessoes?escopo=historico", { headers: comCookie() })).json(), []);

  const r = await pedir("/api/sessoes?escopo=todas&issue=x", { headers: comCookie() });
  assert.equal(r.status, 422);
  const { erro } = r.json() as { erro: string };
  assert.match(erro, /→ at escopo/);
  assert.match(erro, /→ at issue/);
});

test("rota que devolve nada dá 204; a que responde sozinha fica como está; erro inesperado dá 500 no log; erro depois de responder corta a conexão", async (t) => {
  const extras = [
    { metodo: "GET", caminho: "/api/teste/nada", tratar: () => undefined },
    {
      metodo: "GET",
      caminho: "/api/teste/texto",
      tratar: ({ resposta }) => {
        resposta.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" }).end("log");
        return "ignorado";
      },
    },
    {
      metodo: "GET",
      caminho: "/api/teste/quebra",
      tratar: () => {
        throw new Error("disco cheio");
      },
    },
    {
      metodo: "GET",
      caminho: "/api/teste/meio",
      tratar: ({ resposta }) => {
        resposta.writeHead(200, { "Content-Type": "text/event-stream" });
        resposta.write("data: 1\n\n");
        throw new Error("caiu no meio");
      },
    },
  ] satisfies typeof ROTAS;
  ROTAS.push(...extras);
  t.after(() => {
    ROTAS.splice(-extras.length);
  });
  const log = t.mock.method(console, "error", () => undefined);

  assert.equal((await pedir("/api/teste/nada", { headers: comCookie() })).status, 204);
  assert.equal((await pedir("/api/teste/texto", { headers: comCookie() })).texto, "log");
  const quebra = await pedir("/api/teste/quebra", { headers: comCookie() });
  assert.deepEqual([quebra.status, quebra.json()], [500, { erro: "disco cheio" }]);
  assert.equal(log.mock.callCount(), 1);
  await assert.rejects(pedir("/api/teste/meio", { headers: comCookie() }), /aborted|ECONNRESET|socket hang up/);
});

test("parar não espera conexão aberta: um pedido pela metade (como o SSE) é cortado", { timeout: 5000 }, async () => {
  const conexao = connect(Number(process.env.FABRIQUINHA_PORTA), "127.0.0.1");
  await once(conexao, "connect");
  conexao.write(`GET /api/sessoes HTTP/1.1\r\nHost: ${origem}\r\n`);
  // O corte chega como ECONNRESET: `once` rejeitaria com ele.
  const fechou = new Promise((fechada) => conexao.on("error", () => undefined).once("close", fechada));
  await servico.parar();
  await fechou;
  servico = await iniciarServico(raiz);
});
