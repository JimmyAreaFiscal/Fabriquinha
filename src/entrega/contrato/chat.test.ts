import assert from "node:assert/strict";
import { test } from "node:test";
import { DadosDoChatDemanda, NovaMensagemDoChat, RespostaDoDialogo } from "./chat.ts";

const T = "2026-01-01T00:00:00.000Z";

test("o chat leva o cabeçalho, a pendência, as execuções e a conversa", () => {
  const chat = {
    origem: "demanda",
    sessao: {
      sessao: "s-1",
      projeto: "p",
      modo: "autonomo",
      execucao: "e-1",
      modelo: { provedor: "anthropic", nome: "m" },
      estado: "aguardando_humano",
      pendencia: {
        tipo: "dialogo_do_agente",
        item: "I-1.T1",
        motivo: "pergunta",
        acao_esperada: "responder",
        desde: T,
      },
      desde: T,
      dialogos: [{ type: "extension_ui_request", em: T }],
    },
    demanda: "I-1",
    rodada: "I-1.R1",
    ticket: "I-1.T1",
    etapa: "implementar",
    erro: "falhou",
    execucoes: [{ id: "e-1", trabalho_id: "s-1", inicio: T, fim: T, falha: true, motivo: "falhou" }],
    pendencias: [],
    conversa: [{ type: "message_end" }, { type: "message_end", fabriquinha: true }],
  };
  assert.deepEqual(DadosDoChatDemanda.parse(chat), chat);
  assert.throws(() => DadosDoChatDemanda.parse({ ...chat, origem: "avaliacao" }));
});

test("a mensagem do chat tem texto e modo", () => {
  assert.deepEqual(NovaMensagemDoChat.parse({ texto: " oi ", modo: "steer" }), { texto: "oi", modo: "steer" });
  assert.throws(() => NovaMensagemDoChat.parse({ texto: "oi", modo: "outro" }));
});

test("a resposta do diálogo vira o `extension_ui_response` do pi", () => {
  assert.deepEqual(RespostaDoDialogo.parse({ valor: "a" }), { value: "a" });
  assert.deepEqual(RespostaDoDialogo.parse({ confirmado: false }), { confirmed: false });
  assert.deepEqual(RespostaDoDialogo.parse({ cancelado: true }), { cancelled: true });
  assert.throws(() => RespostaDoDialogo.parse({ cancelado: false }));
});
