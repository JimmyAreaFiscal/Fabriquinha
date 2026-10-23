import assert from "node:assert/strict";
import { test } from "node:test";
import {
  barraDaAuditoria,
  conversaDaAuditoria,
  type DadosDaAuditoria,
  envioDaAuditoria,
  ladoDaAuditoria,
  linhaDoInicio,
  modeloDaAuditoria,
} from "./auditoria.ts";

const dados = (d: Partial<DadosDaAuditoria> = {}): DadosDaAuditoria => ({
  sessao: "7b1c/0e2a",
  mes: "2026-09",
  rotulo: "setembro de 2026",
  sessoes: 9,
  projetos: { fabriquinha: 5, "loja <api>": 4 },
  estado: "conversa",
  conversa: [],
  ...d,
});

const resposta = { role: "assistant", provider: "anthropic", model: "claude-opus-5-5" };

test("modelo: o da última resposta do agente, ou o padrão do pi enquanto ele não respondeu", () => {
  assert.equal(modeloDaAuditoria([]), "modelo padrão do pi");
  assert.equal(
    modeloDaAuditoria([{ type: "session" }, { type: "message", message: { role: "user" } }]),
    "modelo padrão do pi",
  );
  assert.equal(
    modeloDaAuditoria([
      { type: "message", message: { ...resposta, model: "claude-sonnet-5-5" } },
      { type: "message", message: resposta },
      { type: "message", message: { role: "toolResult" } },
    ]),
    "anthropic / claude-opus-5-5",
  );
});

test("barra: Auditoria e o mês, o escopo, a etiqueta de estado, o modelo e o link do índice em outra aba", () => {
  const html = barraDaAuditoria(dados(), "anthropic / claude-opus-5-5");
  assert.match(html, /<span class="id">Auditoria<\/span> setembro de 2026<\/span>/);
  assert.match(html, /<span class="muted">todos os projetos · 9 sessões<\/span>/);
  assert.match(html, /<span class="pill pill-aguarda">aguarda você · conversa<\/span>/);
  assert.match(html, /<span class="modelo" title="anthropic \/ claude-opus-5-5">/);
  assert.match(
    html,
    /<a class="link" href="\/api\/auditorias\/7b1c%2F0e2a\/indice\.md" target="_blank" rel="noopener">índice do mês<\/a>/,
  );
});

test("barra: rodando tem a etiqueta azul, e uma sessão só é singular", () => {
  const html = barraDaAuditoria(dados({ estado: "rodando", sessoes: 1, rotulo: "<mês>" }), "m");
  assert.match(html, /<span class="pill pill-rodando">rodando<\/span>/);
  assert.match(html, /todos os projetos · 1 sessão</);
  assert.match(html, /&#60;mês&#62;/);
});

test("lado: o mês, as sessões, os projetos escapados e a frase de que o agente só propõe", () => {
  const html = ladoDaAuditoria(dados());
  assert.match(html, /<h3>O que o agente recebeu<\/h3>/);
  assert.match(html, /<dt>Mês<\/dt><dd>setembro de 2026<\/dd>/);
  assert.match(html, /<dt>Sessões<\/dt><dd>9 terminadas<\/dd>/);
  assert.match(html, /<dt>Projetos<\/dt><dd>fabriquinha \(5\) · loja &#60;api&#62; \(4\)<\/dd>/);
  assert.match(html, /O agente só propõe melhorias: não registra issue nem altera projeto\./);
  assert.match(ladoDaAuditoria(dados({ sessoes: 1 })), /<dd>1 terminada<\/dd>/);
});

test("envio: em conversa, o compositor com Enviar; rodando, só Abortar", () => {
  const conversa = envioDaAuditoria("conversa");
  assert.ok("placeholder" in conversa);
  assert.equal(conversa.placeholder, "Pergunte sobre a auditoria");
  assert.match(conversa.linha, /<button class="btn btn-primario">Enviar<\/button>/);
  assert.doesNotMatch(conversa.linha, /data-abortar/);
  const rodando = envioDaAuditoria("rodando");
  assert.ok("html" in rodando);
  assert.match(rodando.html, /<button type="button" class="btn btn-perigo" data-abortar>Abortar<\/button>/);
  assert.doesNotMatch(rodando.html, /textarea|Enviar/);
});

test("conversa: o prompt marcado vira a linha do início, a chamada recebe o resultado e o resto segue", () => {
  const mensagens = conversaDaAuditoria(
    dados({
      conversa: [
        { type: "session" },
        { type: "message", fabriquinha: true, message: { role: "user", content: "# Auditoria…", timestamp: 1 } },
        {
          type: "message",
          message: {
            ...resposta,
            timestamp: 2,
            content: [{ type: "toolCall", id: "c1", name: "subagent", arguments: { tasks: [] } }],
          },
        },
        {
          type: "message",
          message: { role: "toolResult", toolCallId: "c1", timestamp: 3, content: [{ type: "text", text: "ok" }] },
        },
        { type: "message", message: { ...resposta, timestamp: 4, content: [{ type: "text", text: "## Custos" }] } },
      ],
    }),
  );
  assert.deepEqual(
    mensagens.map(({ id, role }) => [id, role]),
    [
      ["user-1", "system"],
      ["assistant-2", "assistant"],
      ["assistant-4", "assistant"],
    ],
  );
  const [inicio, chamada, final] = mensagens;
  assert.deepEqual([inicio], linhaDoInicio({ role: "user", timestamp: 1 }, dados()));
  assert.equal(
    (inicio?.metadata?.custom as { html: string }).html,
    '<div class="sistema">Auditoria de setembro de 2026 iniciada</div>',
  );
  const [parte] = chamada?.content as unknown as { artifact: { resultado?: { toolCallId?: string } } }[];
  assert.equal(parte?.artifact.resultado?.toolCallId, "c1");
  assert.deepEqual(final?.content, [{ type: "text", text: "## Custos" }]);
});

test("conversa: com pedido, o balão do Auditor vem logo abaixo da linha do início; sem pedido, só a linha", () => {
  const prompt = {
    type: "message",
    fabriquinha: true,
    message: { role: "user", content: "# Auditoria…", timestamp: 1 },
  };
  const [inicio, pedido, ...resto] = conversaDaAuditoria(
    dados({ pedido: "Verifique <b>repetições</b>", conversa: [prompt] }),
  );
  assert.deepEqual([inicio?.id, inicio?.role], ["user-1", "system"]);
  assert.deepEqual(
    [pedido?.id, pedido?.role, pedido?.content],
    ["user-1-pedido", "user", [{ type: "text", text: "Verifique <b>repetições</b>" }]],
  );
  assert.equal(resto.length, 0);
  assert.equal(conversaDaAuditoria(dados({ conversa: [prompt] })).length, 1);
});
