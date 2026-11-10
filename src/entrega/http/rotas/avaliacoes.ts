// Rotas da avaliação de melhoria do SDLC (D12, I-240): disparar, listar, abrir, conversar, acompanhar por SSE, abortar e
// encaminhar um achado como demanda. Cada rota só converte a entrada e chama a consulta ou o caso de uso; as recusas
// voltam pelo mapa de erros e cada resposta JSON é um tipo de `entrega/contrato/avaliacoes.ts`.
import { z } from "zod";
import {
  abortarAvaliacao,
  abrir,
  encaminharAchado,
  enviarNaAvaliacao,
  iniciarAvaliacao,
} from "../../../aplicacao/avaliacao.ts";
import { consultarAvaliacoes, consultarDemandasDoPeriodo } from "../../../aplicacao/consultas/avaliacoes.ts";
import {
  AchadoEncaminhado,
  AvaliacaoCriada,
  AvaliacaoNaLista,
  DadosDaAvaliacao,
  DemandaDoPeriodo,
  NovaAvaliacao,
  NovaMensagemDaAvaliacao,
  PeriodoDaAvaliacao,
} from "../../contrato/avaliacoes.ts";
import { IdDoCaminho, SemCorpoEmJson, type Rota } from "../rotas.ts";
import { abrirFluxoSse } from "../sse.ts";

const idDe = (params: Record<string, unknown>): string => z.uuid().parse(params.id);

export const ROTAS_DAS_AVALIACOES: Rota[] = [
  {
    metodo: "POST",
    caminho: "/api/avaliacoes",
    resposta: AvaliacaoCriada,
    tratar: async ({ banco, corpo }) => {
      const { pedido, ...escopo } = NovaAvaliacao.parse(corpo);
      return { id: await iniciarAvaliacao(banco, { ...escopo, pedido: pedido || undefined }) };
    },
  },
  {
    metodo: "GET",
    caminho: "/api/avaliacoes",
    resposta: z.array(AvaliacaoNaLista),
    tratar: ({ banco }) => consultarAvaliacoes(banco),
  },
  // Antes de `/:id`, que casa qualquer segmento.
  {
    metodo: "GET",
    caminho: "/api/avaliacoes/demandas",
    resposta: z.array(DemandaDoPeriodo),
    tratar: ({ banco, query }) => {
      const { projeto, de, ate } = PeriodoDaAvaliacao.parse(Object.fromEntries(query));
      return consultarDemandasDoPeriodo(banco, projeto, de, ate);
    },
  },
  {
    metodo: "GET",
    caminho: "/api/avaliacoes/:id",
    resposta: DadosDaAvaliacao,
    tratar: ({ banco, params }) => abrir(banco, idDe(params)),
  },
  {
    metodo: "GET",
    caminho: "/api/avaliacoes/:id/eventos",
    fluxoSse: true,
    // Primeiro `{ type: "avaliacao" }` com a avaliação lida logo antes de assinar; depois os eventos do pi e `estado`.
    tratar: ({ banco, params, resposta }) => {
      const { assinar, ...dados } = abrir(banco, idDe(params));
      abrirFluxoSse(resposta, { type: "avaliacao", ...dados }, assinar);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/mensagens",
    resposta: SemCorpoEmJson,
    tratar: ({ banco, params, corpo }) => {
      enviarNaAvaliacao(banco, idDe(params), NovaMensagemDaAvaliacao.parse(corpo).texto);
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/abortar",
    resposta: SemCorpoEmJson,
    tratar: ({ params }) => {
      abortarAvaliacao(idDe(params));
    },
  },
  {
    metodo: "POST",
    caminho: "/api/avaliacoes/:id/achados/:n/encaminhar",
    resposta: AchadoEncaminhado,
    tratar: ({ banco, params }) => {
      const ag = encaminharAchado(banco, idDe(params), IdDoCaminho.parse(params.n));
      return { demanda: ag.demanda.id };
    },
  },
];
