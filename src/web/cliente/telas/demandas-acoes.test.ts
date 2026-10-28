import assert from "node:assert/strict";
import { test } from "node:test";
import { sessaoDeAjustes } from "./demandas-acoes.ts";

const msg = (role: string, text: string, resto: object = {}) => ({
  type: "message",
  message: { role, content: [{ type: "text", text }] },
  ...resto,
});

test("a conversa vira balões do Auditor e do Agente, com markdown e HTML escapado", () => {
  const html = sessaoDeAjustes("I-5.R1", [msg("user", "<b>oi</b>"), msg("assistant", "**feito**")]);
  assert.match(html, /dm-msg-auditor"><span class="dm-msg-autor">Auditor<\/span><p>&lt;b&gt;oi&lt;\/b&gt;<\/p>/);
  assert.match(html, /dm-msg-agente"><span class="dm-msg-autor">Agente<\/span><p><strong>feito<\/strong><\/p>/);
});

test("omite o prompt da Fabriquinha, a entrada sem texto, a que não é mensagem e a de outro autor", () => {
  const html = sessaoDeAjustes("I-5.R1", [
    msg("user", "prompt", { fabriquinha: true }),
    msg("assistant", "  "),
    { type: "session", message: { role: "user", content: "x" } },
    msg("toolResult", "saída"),
    { type: "message" },
  ]);
  assert.match(html, /A conversa ainda não tem mensagens\./);
  assert.doesNotMatch(html, /dm-msg /);
});

test("sem conversa, mostra o motivo do servidor escapado", () => {
  assert.match(sessaoDeAjustes("I-5.R1", "sem <sessão>"), /sem &#60;sessão&#62;/);
});

test("traz o campo, o erro e os botões com os ids e data- que o DOM usa", () => {
  const html = sessaoDeAjustes("I-5.R1", []);
  assert.match(html, /<label for="ajuste-I-5\.R1">Mensagem ao agente<\/label><textarea id="ajuste-I-5\.R1"/);
  assert.match(html, /id="ajuste-I-5\.R1-erro" role="alert" hidden/);
  assert.doesNotMatch(html, /atualizar/i);
  assert.match(html, /data-ajuste="enviar"[^>]*>Enviar</);
  assert.match(
    html,
    /data-ajuste="concluir" data-ref="I-5\.R1" data-caminho="\/api\/demandas\/rodadas\/I-5\.R1\/ajustes\/concluir">Concluir a sessão</,
  );
});
