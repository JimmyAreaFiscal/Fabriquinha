// Rotas do chat da sessão de ticket da demanda (F7 §4.2, §4.4; F4 §5.4, §6.8): a sessão com a conversa, os eventos ao
// vivo por SSE, as mensagens, os diálogos de extensão, o aborto e o histórico em Markdown. A sessão que não é de uma
// demanda não existe (404). Cada rota só converte a entrada e chama o F4; as regras ficam lá.
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ErroDeInexistente } from "../../dominio/erros.ts";
import {
  abortarDemanda,
  abrirChatDemanda,
  type CabecalhoDemanda,
  type ChatDemanda,
  enviarDemanda,
  exportarHistoricoDemanda,
  responderDialogoDemanda,
} from "../../execucao/sessoes_demanda.ts";
import { configuracao } from "../../persistencia/servico.ts";
import type { Rota } from "../rotas.ts";

/** Uma entrada do JSONL do pi; o prompt montado pela Fabriquinha (F4 §6.3) vem com `fabriquinha`. */
export type Entrada = Record<string, unknown> & { fabriquinha?: true };

/** O chat de uma sessão de ticket da demanda: o cabeçalho com `origem: "demanda"` e a conversa. */
export type DadosDoChatDemanda = CabecalhoDemanda & { conversa: Entrada[] };

/** O erro da sessão que não é de nenhuma demanda. */
const naoExiste = (sessao: string): ErroDeInexistente =>
  new ErroDeInexistente(`a sessão ${sessao} não existe`, "confira o endereço do chat");

/** A sessão da demanda aberta, ou 404. */
function chatDa(banco: DatabaseSync, sessao: string): ChatDemanda {
  const chat = abrirChatDemanda(banco, sessao);
  if (!chat) throw naoExiste(sessao);
  return chat;
}

/**
 * SSE (F4 §5.4): primeiro `{ type: "chat" }` com a sessão e a conversa até agora, lidas logo antes de assinar, sem
 * nada no meio; depois cada evento do pi como veio e `{ type: "estado" }` com o cabeçalho novo. Quem reconecta recebe
 * o retrato inteiro de novo.
 */
function eventos(banco: DatabaseSync, sessao: string, resposta: ServerResponse): void {
  const chat = chatDa(banco, sessao);
  const escrever = (dado: object) => resposta.write(`data: ${JSON.stringify(dado)}\n\n`);
  resposta.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
  escrever({ type: "chat", ...chat.cabecalho, conversa: chat.conversa });
  resposta.on("close", chat.assinar(escrever));
}

const NovaMensagem = z.strictObject({
  texto: z.string().trim().min(1),
  modo: z.enum(["prompt", "steer", "follow_up"]),
});

/** `{ valor }`, `{ confirmado }` ou `{ cancelado: true }`, no formato do `extension_ui_response` do pi. */
const RespostaDialogo = z.union([
  z.strictObject({ valor: z.string() }).transform((r) => ({ value: r.valor })),
  z.strictObject({ confirmado: z.boolean() }).transform((r) => ({ confirmed: r.confirmado })),
  z.strictObject({ cancelado: z.literal(true) }).transform(() => ({ cancelled: true as const })),
]);

export const ROTAS_DO_CHAT: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao",
    tratar: ({ banco, params }): DadosDoChatDemanda => {
      const chat = chatDa(banco, String(params.sessao));
      return { ...chat.cabecalho, conversa: chat.conversa };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/eventos",
    tratar: ({ banco, params, resposta }) => {
      eventos(banco, String(params.sessao), resposta);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/mensagens",
    tratar: ({ banco, params, corpo }) => {
      const { texto, modo } = NovaMensagem.parse(corpo);
      const sessao = String(params.sessao);
      if (!enviarDemanda(banco, sessao, texto, modo, configuracao(banco).ociosidadeMin)) throw naoExiste(sessao);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/historico.md",
    tratar: ({ banco, params, resposta }) => {
      const sessao = String(params.sessao);
      const historico = exportarHistoricoDemanda(banco, sessao);
      if (!historico) throw naoExiste(sessao);
      resposta
        .writeHead(200, {
          "Content-Type": "text/markdown; charset=utf-8",
          "Content-Disposition": `attachment; filename="${historico.nome}"`,
        })
        .end(historico.markdown);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/dialogos/:id",
    tratar: ({ banco, params, corpo }) => {
      const resposta = RespostaDialogo.parse(corpo);
      const sessao = String(params.sessao);
      if (!responderDialogoDemanda(banco, sessao, String(params.id), resposta)) throw naoExiste(sessao);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/abortar",
    tratar: ({ banco, params }) => {
      const sessao = String(params.sessao);
      if (!abortarDemanda(banco, sessao)) throw naoExiste(sessao);
    },
  },
];
