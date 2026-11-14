// Rotas do chat da sessão de ticket da demanda (F7 §4.2, §4.4; F4 §5.4, §6.8): a sessão com a conversa, os eventos ao
// vivo por SSE, as mensagens, os diálogos de extensão, o aborto e o histórico em Markdown. A sessão que não é de uma
// demanda não existe (404). Cada rota só converte a entrada e chama o F4; as regras ficam lá. A resposta JSON é o tipo
// de `contrato/sessoes/chat.ts`.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import { ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import { abrirChatDemanda, type ChatDemanda, exportarHistoricoDemanda } from "../../../consultas/sessoes/chat.ts";
import { DadosDoChatDemanda, NovaMensagemDoChat, RespostaDoDialogo } from "../../../contrato/sessoes/chat.ts";
import { SemCorpoEmJson, type Rota } from "../../rotas.ts";
import { abrirFluxoSse } from "../../sse.ts";

/** O erro da sessão que não é de nenhuma demanda. */
const naoExiste = (sessao: string): ErroDeInexistente =>
  new ErroDeInexistente(`a sessão ${sessao} não existe`, "confira o endereço do chat");

/** A sessão da demanda aberta, ou 404. */
function chatDa(banco: DatabaseSync, gestaoDeDemandas: GestaoDeDemandas, sessao: string): ChatDemanda {
  const chat = abrirChatDemanda(banco, gestaoDeDemandas, sessao);
  if (!chat) throw naoExiste(sessao);
  return chat;
}

export const ROTAS_DO_CHAT: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao",
    resposta: DadosDoChatDemanda,
    tratar: ({ banco, demandas, params }) => {
      const chat = chatDa(banco, demandas, String(params.sessao));
      return { ...chat.cabecalho, conversa: chat.conversa };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/eventos",
    fluxoSse: true,
    // Primeiro `{ type: "chat" }` com a sessão e a conversa até agora, lidas logo antes de assinar; depois cada evento
    // do pi como veio e `{ type: "estado" }` com o cabeçalho novo (F4 §5.4).
    tratar: ({ banco, demandas, params, resposta }) => {
      const chat = chatDa(banco, demandas, String(params.sessao));
      abrirFluxoSse(resposta, { type: "chat", ...chat.cabecalho, conversa: chat.conversa }, (escrever) =>
        chat.assinar(escrever),
      );
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/mensagens",
    resposta: SemCorpoEmJson,
    tratar: ({ cicloDeVida, params, corpo }) => {
      const { texto, modo } = NovaMensagemDoChat.parse(corpo);
      const sessao = String(params.sessao);
      if (!cicloDeVida.mandar(sessao, texto, modo)) throw naoExiste(sessao);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/sessoes/:sessao/historico.md",
    resposta: SemCorpoEmJson,
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
    resposta: SemCorpoEmJson,
    tratar: ({ cicloDeVida, params, corpo }) => {
      const resposta = RespostaDoDialogo.parse(corpo);
      const sessao = String(params.sessao);
      if (!cicloDeVida.responder(sessao, String(params.id), resposta)) throw naoExiste(sessao);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/sessoes/:sessao/abortar",
    resposta: SemCorpoEmJson,
    tratar: ({ cicloDeVida, params }) => {
      const sessao = String(params.sessao);
      if (!cicloDeVida.abortar(sessao)) throw naoExiste(sessao);
    },
  },
];
