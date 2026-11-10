// Rotas do chat da sessão de ticket da demanda (F7 §4.2, §4.4; F4 §5.4, §6.8): a sessão com a conversa, os eventos ao
// vivo por SSE, as mensagens, os diálogos de extensão, o aborto e o histórico em Markdown. A sessão que não é de uma
// demanda não existe (404). Cada rota só converte a entrada e chama o F4; as regras ficam lá. A resposta JSON é o tipo
// de `entrega/contrato/chat.ts`.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente } from "../../../nucleo/erros.ts";
import {
  abortarDemanda,
  abrirChatDemanda,
  type CabecalhoDemanda,
  type ChatDemanda,
  enviarDemanda,
  exportarHistoricoDemanda,
  responderDialogoDemanda,
} from "../../../aplicacao/sessoes_demanda.ts";
import { DadosDoChatDemanda as RespostaDoChat, NovaMensagemDoChat, RespostaDoDialogo } from "../../contrato/chat.ts";
import type { Rota } from "../rotas.ts";
import { abrirFluxoSse } from "../sse.ts";

// shortcut: o cliente web ainda importa estes dois tipos daqui; saem quando ele passar a importar `entrega/contrato/chat.ts`.
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

export const ROTAS_DO_CHAT: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao",
    resposta: RespostaDoChat,
    tratar: ({ banco, params }) => {
      const chat = chatDa(banco, String(params.sessao));
      return { ...chat.cabecalho, conversa: chat.conversa };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/eventos",
    fluxoSse: true,
    // Primeiro `{ type: "chat" }` com a sessão e a conversa até agora, lidas logo antes de assinar; depois cada evento
    // do pi como veio e `{ type: "estado" }` com o cabeçalho novo (F4 §5.4).
    tratar: ({ banco, params, resposta }) => {
      const chat = chatDa(banco, String(params.sessao));
      abrirFluxoSse(resposta, { type: "chat", ...chat.cabecalho, conversa: chat.conversa }, (escrever) =>
        chat.assinar(escrever),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/mensagens",
    tratar: ({ banco, params, corpo }) => {
      const { texto, modo } = NovaMensagemDoChat.parse(corpo);
      const sessao = String(params.sessao);
      if (!enviarDemanda(banco, sessao, texto, modo)) throw naoExiste(sessao);
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
      const resposta = RespostaDoDialogo.parse(corpo);
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
