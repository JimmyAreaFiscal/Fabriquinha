// Rotas da avaliação de melhoria do SDLC (D12, I-240): disparar, listar, abrir, conversar, acompanhar por SSE, abortar e
// encaminhar um achado como demanda. Cada rota só converte a entrada e chama o serviço; as recusas voltam pelo mapa de erros.
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  abortarAvaliacao,
  abrir,
  encaminharAchado,
  enviarNaAvaliacao,
  estadoDaAvaliacao,
  iniciarAvaliacao,
} from "../../execucao/avaliacao.ts";
import { carregarDemanda } from "../../persistencia/demandas.ts";
import { demandasComSessaoNoPeriodo, listarAvaliacoes } from "../../persistencia/avaliacoes.ts";
import { configuracao } from "../../persistencia/servico.ts";
import { IdDoCaminho, type Rota } from "../rotas.ts";
import { opcoes } from "./chat.ts";

/** As opções do chat com o modelo da Auditoria da Configuração de agora. */
const opcoesDaAvaliacao = (banco: DatabaseSync) => ({
  ...opcoes(banco),
  modelo: configuracao(banco).modeloAuditoria,
});

const Periodo = { projeto: z.string().min(1), de: z.string(), ate: z.string() };
const NovaAvaliacao = z.strictObject({
  ...Periodo,
  demandas: z.array(z.string().min(1)).optional(),
  pedido: z.string().trim().max(4000).optional(),
});
const NovaMensagem = z.strictObject({ texto: z.string().trim().min(1) });

const idDe = (params: Record<string, unknown>): string => z.uuid().parse(params.id);

/** SSE: primeiro `{ type: "avaliacao" }` com a avaliação lida logo antes de assinar; depois os eventos do pi e `estado`. */
function eventos(banco: DatabaseSync, id: string, resposta: ServerResponse): void {
  const avaliacao = abrir(banco, id);
  const escrever = (dado: object) => resposta.write(`data: ${JSON.stringify(dado)}\n\n`);
  resposta.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store" });
  escrever({ type: "avaliacao", ...avaliacao }); // `assinar` é função: o JSON a omite
  resposta.on("close", avaliacao.assinar(escrever));
}

export const ROTAS_DAS_AVALIACOES: Rota[] = [
  {
    metodo: "POST",
    caminho: "/api/avaliacoes",
    tratar: async ({ banco, corpo }) => {
      const { pedido, ...escopo } = NovaAvaliacao.parse(corpo);
      return {
        id: await iniciarAvaliacao(banco, { ...escopo, pedido: pedido || undefined }, opcoesDaAvaliacao(banco)),
      };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/avaliacoes",
    tratar: ({ banco }) => listarAvaliacoes(banco).map((a) => ({ ...a, estado: estadoDaAvaliacao(a.id) })),
  },
  // Antes de `/:id`, que casa qualquer segmento.
  {
    metodo: "GET",
    caminho: "/api/avaliacoes/demandas",
    tratar: ({ banco, query }) => {
      const { projeto, de, ate } = z.strictObject(Periodo).parse(Object.fromEntries(query));
      return demandasComSessaoNoPeriodo(banco, projeto, de, ate).map((id) => ({
        id,
        titulo: carregarDemanda(banco, id).demanda.titulo,
      }));
    },
  },
  { metodo: "GET", caminho: "/api/avaliacoes/:id", tratar: ({ banco, params }) => abrir(banco, idDe(params)) },
  {
    metodo: "GET",
    caminho: "/api/avaliacoes/:id/eventos",
    tratar: ({ banco, params, resposta }) => {
      eventos(banco, idDe(params), resposta);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/mensagens",
    tratar: ({ banco, params, corpo }) => {
      enviarNaAvaliacao(banco, idDe(params), NovaMensagem.parse(corpo).texto, opcoesDaAvaliacao(banco));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/abortar",
    tratar: ({ params }) => {
      abortarAvaliacao(idDe(params));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/achados/:n/encaminhar",
    tratar: ({ banco, params }) => {
      const ag = encaminharAchado(banco, idDe(params), IdDoCaminho.parse(params.n));
      return { demanda: ag.demanda.id };
    },
  },
];
