import assert from "node:assert/strict";
import { test } from "node:test";
import { criarApiDoAgente } from "./cliente.ts";
import { ErroDoComando } from "./comando.ts";

const ENV = { FABRIQUINHA_API: "127.0.0.1:4567", FABRIQUINHA_TOKEN: "segredo" };

interface Chamada {
  url: string;
  init: RequestInit;
}

/** Um `fetch` que anota o pedido e responde `resposta`. */
function fetchQueResponde(resposta: () => Response | Error) {
  const chamadas: Chamada[] = [];
  const falso = ((url: string, init: RequestInit) => {
    chamadas.push({ url, init });
    const devolvida = resposta();
    return devolvida instanceof Error ? Promise.reject(devolvida) : Promise.resolve(devolvida);
  }) as unknown as typeof fetch;
  return { falso, chamadas };
}

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });

test("get e post mandam o token, o corpo e o endereço do host local sem esquema, e devolvem o JSON da resposta", async () => {
  const { falso, chamadas } = fetchQueResponde(() => json({ ok: 1 }));
  const api = criarApiDoAgente(ENV, falso);
  assert.deepEqual(await api.get("/api/agente/projeto"), { ok: 1 });
  assert.deepEqual(await api.post("/api/agente/tickets", { rodada: "I-1.R1" }), { ok: 1 });
  assert.equal(chamadas[0]?.url, "http://127.0.0.1:4567/api/agente/projeto");
  assert.deepEqual(chamadas[0].init, {
    method: "GET",
    headers: { authorization: "Bearer segredo" },
    body: undefined,
  });
  assert.equal(chamadas[1]?.url, "http://127.0.0.1:4567/api/agente/tickets");
  assert.deepEqual(chamadas[1].init, {
    method: "POST",
    headers: { authorization: "Bearer segredo", "content-type": "application/json" },
    body: '{"rodada":"I-1.R1"}',
  });
});

test("FABRIQUINHA_API com esquema é usada como está (o endereço do host visto pelo container)", async () => {
  const { falso, chamadas } = fetchQueResponde(() => json({}));
  await criarApiDoAgente({ ...ENV, FABRIQUINHA_API: "http://host.docker.internal:80" }, falso).get("/x");
  assert.equal(chamadas[0]?.url, "http://host.docker.internal:80/x");
});

test("sem FABRIQUINHA_API ou sem FABRIQUINHA_TOKEN o pedido nem sai", async () => {
  const { falso, chamadas } = fetchQueResponde(() => json({}));
  await assert.rejects(
    criarApiDoAgente({ FABRIQUINHA_TOKEN: "t" }, falso).get("/x"),
    new ErroDoComando("falta FABRIQUINHA_API (o pi a define ao lançar o agente)"),
  );
  await assert.rejects(
    criarApiDoAgente({ FABRIQUINHA_API: "a:1" }, falso).get("/x"),
    new ErroDoComando("falta FABRIQUINHA_TOKEN (o pi o define ao lançar o agente)"),
  );
  assert.equal(chamadas.length, 0);
});

test("serviço parado: a mensagem diz que a Fabriquinha está fora", async () => {
  const { falso } = fetchQueResponde(() => new TypeError("fetch failed"));
  await assert.rejects(
    criarApiDoAgente(ENV, falso).get("/x"),
    new ErroDoComando("a Fabriquinha está fora: nada respondeu em 127.0.0.1:4567 (confira FABRIQUINHA_API)"),
  );
});

test("a recusa da API volta com a mensagem e o código de saída do corpo", async () => {
  for (const codigo_de_saida of [1, 2] as const) {
    const { falso } = fetchQueResponde(() => json({ mensagem: "não pode (use outro)", codigo_de_saida }, 409));
    await assert.rejects(
      criarApiDoAgente(ENV, falso).get("/x"),
      (erro: ErroDoComando) =>
        erro instanceof ErroDoComando && erro.message === "não pode (use outro)" && erro.codigo === codigo_de_saida,
    );
  }
});

test("resposta que não é o contrato (corpo que não é JSON, erro sem formato ou 200 sem JSON) é erro de código 1", async () => {
  for (const [resposta, status] of [
    [() => new Response("<html>", { status: 502 }), 502],
    [() => json({ erro: "x" }, 500), 500],
    [() => new Response("", { status: 200 }), 200],
  ] as const) {
    const { falso } = fetchQueResponde(resposta);
    await assert.rejects(
      criarApiDoAgente(ENV, falso).get("/x"),
      (erro: ErroDoComando) =>
        erro.message === `resposta inesperada da Fabriquinha (status ${String(status)})` && erro.codigo === 1,
    );
  }
});
