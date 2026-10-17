// Rotas da auditoria do Histórico (F4; F7 §4.2): abrir a auditoria de um mês, a conversa, os eventos ao vivo por SSE,
// o índice, as mensagens e o aborto. Cada rota só converte a entrada e chama o F4; as regras ficam lá.
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  abortarAuditoria,
  abrirAuditoria,
  enviarNaAuditoria,
  indiceDaAuditoria,
  iniciarAuditoria,
  sessoesDoMes,
} from "../../execucao/auditoria.ts";
import { mesPorExtenso, Mes } from "../../metricas/periodo.ts";
import { ErroHttp } from "../erros.ts";
import type { Rota } from "../rotas.ts";
import { configuracao } from "../../persistencia/servico.ts";
import { opcoes } from "./chat.ts";

/** As opções do chat com o modelo da Auditoria da Configuração de agora. */
const opcoesDaAuditoria = (banco: DatabaseSync) => ({
  ...opcoes(banco),
  modelo: configuracao(banco).modeloAuditoria,
});

const NovaAuditoria = z.strictObject({ mes: Mes, pedido: z.string().trim().max(4000).optional() });
const NovaMensagem = z.strictObject({ texto: z.string().trim().min(1) });

/** O `:sessao` do caminho, validado antes de tocar no disco. */
const sessaoDe = (params: Record<string, unknown>): string => z.uuid().parse(params.sessao);

/**
 * SSE como o do chat: primeiro `{ type: "auditoria" }` com o mês, o estado e a conversa até agora, lidos logo antes de
 * assinar; depois cada evento do pi (o prompt da auditoria vai com `fabriquinha`) e `{ type: "estado", estado }`.
 */
function eventos(banco: DatabaseSync, sessao: string, resposta: ServerResponse): void {
  const auditoria = abrirAuditoria(banco, sessao);
  const escrever = (dado: object) => resposta.write(`data: ${JSON.stringify(dado)}\n\n`);
  resposta.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
  escrever({ type: "auditoria", ...auditoria }); // `assinar` é função: o JSON a omite
  resposta.on("close", auditoria.assinar(escrever));
}

export const ROTAS_DA_AUDITORIA: Rota[] = [
  {
    metodo: "POST",
    caminho: "/api/auditorias",
    tratar: async ({ banco, corpo }) => {
      const { mes, pedido } = NovaAuditoria.parse(corpo);
      const lista = await sessoesDoMes(banco, mes);
      if (lista.length === 0)
        throw new ErroHttp(409, `Nenhuma sessão terminada em ${mesPorExtenso(mes)} para auditar.`);
      return { sessao: await iniciarAuditoria(banco, mes, lista, opcoesDaAuditoria(banco), pedido || undefined) };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/auditorias/:sessao",
    tratar: ({ banco, params }) => abrirAuditoria(banco, sessaoDe(params)),
  },
  {
    metodo: "GET",
    caminho: "/api/auditorias/:sessao/eventos",
    tratar: ({ banco, params, resposta }) => {
      eventos(banco, sessaoDe(params), resposta);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/auditorias/:sessao/indice.md",
    tratar: ({ banco, params, resposta }) => {
      const indice = indiceDaAuditoria(banco, sessaoDe(params)); // antes do cabeçalho: o erro ainda vira 422 ou 404
      resposta.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" }).end(indice);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/auditorias/:sessao/mensagens",
    tratar: ({ banco, params, corpo }) => {
      enviarNaAuditoria(banco, sessaoDe(params), NovaMensagem.parse(corpo).texto, opcoesDaAuditoria(banco));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/auditorias/:sessao/abortar",
    tratar: ({ params }) => {
      abortarAuditoria(sessaoDe(params));
    },
  },
];
