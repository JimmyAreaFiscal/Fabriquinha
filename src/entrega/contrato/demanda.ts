// O contrato das rotas das demandas na API: o board, a página de uma demanda e a reabertura de um ticket. Só tipos e
// schemas; quem monta cada resposta é a consulta da aplicação, e o cliente web depende só destes tipos.
import { z } from "zod";
import {
  Decisao,
  Demanda,
  RodadaDemanda,
  TicketDemanda,
  TipoDemanda,
} from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import {
  EstadoDemanda,
  EstadoRodada,
  EtapaTicket,
  EstadoTicket,
  Instante,
} from "../../compartilhado/nucleo/primitivos.ts";
import type { AcaoEsperada, TipoPendencia } from "../../sdlc/nucleo/demanda/pendencia.ts";

const TIPOS_DE_PENDENCIA = [
  "gate_humano",
  "item_bloqueado",
  "dialogo_do_agente",
  "revisao_parada",
  "acao_externa",
  "despacho_parado",
] as const satisfies readonly TipoPendencia[];
const ACOES_ESPERADAS = [
  "decidir_gate",
  "reabrir_com_instrucao",
  "responder",
  "integrar_na_plataforma",
  "executar",
] as const satisfies readonly AcaoEsperada[];

/**
 * Uma Pendência como as telas a mostram: `item` pelo endereço público, a demanda e a rodada (quando o item é de uma) que o
 * board e o cartão usam, e a `sessao` do chat quando é o diálogo do agente.
 */
export const PendenciaDoInicio = z.object({
  tipo: z.enum(TIPOS_DE_PENDENCIA),
  item: z.string(),
  motivo: z.string(),
  acao_esperada: z.enum(ACOES_ESPERADAS),
  desde: Instante,
  demanda: z.string(),
  rodada: z.string().optional(),
  projeto: z.string(),
  titulo: z.string(),
  sessao: z.string().optional(),
});
export type PendenciaDoInicio = z.infer<typeof PendenciaDoInicio>;

const PrDaRodada = z.object({ id: z.string(), url: z.string() });
/** Um ticket com a sessão do pi aberta: o `em_execucao` é o pi, não o sistema. */
export const PiAtivo = z.literal(true);
const Predecessora = z.object({ demanda_id: z.string(), estado: EstadoDemanda });

/** `GET /api/demandas`: as demandas fora das arquivadas e, no total, o trabalho global ativo. */
export const BoardDeDemandas = z.object({
  demandas: z.array(
    z.object({
      id: z.string(),
      projeto: z.string(),
      titulo: z.string(),
      estado: EstadoDemanda,
      terminal: z.boolean(),
      rodadas: z.array(z.object({ ref: z.string(), estado: EstadoRodada, pr: PrDaRodada.optional() })),
      /** As predecessoras que ainda não satisfazem a dependência. */
      bloqueios: z.array(Predecessora),
      /** O que a demanda tem parado esperando o Auditor, como o servidor derivou. */
      pendencias: z.array(PendenciaDoInicio),
    }),
  ),
  trabalho: z.array(
    z.object({ ref: z.string(), etapa: EtapaTicket, rodada: z.string().optional(), pi_ativo: PiAtivo.optional() }),
  ),
});
export type BoardDeDemandas = z.infer<typeof BoardDeDemandas>;

const LinhaDeUso = z.object({
  modelo: z.string(),
  tokens_entrada: z.number(),
  tokens_saida: z.number(),
  tokens_cache_leitura: z.number(),
  tokens_cache_escrita: z.number(),
  custo: z.number().nullable(),
  chamadas: z.number(),
});

const Anexo = z.object({
  nome: z.string(),
  classe: z.enum(["imagem", "video", "html", "texto", "outro"]),
  mime: z.string(),
  bytes: z.number(),
  link: z.string(),
});

/** `GET /api/demandas/:id`: a página da demanda. */
export const PaginaDaDemanda = z.object({
  /** O que a demanda tem parado esperando o Auditor, como o servidor derivou. */
  pendencias: z.array(PendenciaDoInicio),
  /** O achado da avaliação que originou a demanda. */
  origem: z.object({ avaliacao: z.string(), achado: z.number(), titulo: z.string() }).optional(),
  demanda: z.object({
    id: z.string(),
    projeto: z.string(),
    titulo: z.string(),
    tipo: TipoDemanda,
    descricao: z.string(),
    estado: EstadoDemanda,
    terminal: z.boolean(),
    arquivavel: z.boolean(),
  }),
  /** O Uso da demanda; o custo já vem em texto (`textoDoCusto`), com ≥ e o aviso quando falta custo. */
  uso: z.object({
    modelos: z.array(LinhaDeUso),
    custo: z.object({ conhecido: z.number(), trabalhosSemCusto: z.number() }),
    textoDoCusto: z.string(),
  }),
  rodadas: z.array(
    z.object({
      ref: z.string(),
      titulo: z.string(),
      estado: EstadoRodada,
      pr: PrDaRodada.optional(),
      /** O endereço do ticket atual de cada etapa que a rodada já teve. */
      ticket_atual_por_etapa: z.partialRecord(EtapaTicket, z.string()),
    }),
  ),
  tickets: z.array(
    z.object({
      ref: z.string(),
      etapa: EtapaTicket,
      estado: EstadoTicket,
      satisfaz_dependencia: z.boolean(),
      elegivel: z.boolean(),
      sessao: z.string().optional(),
      pi_ativo: PiAtivo.optional(),
      rodada: z.string().optional(),
      titulo: z.string().optional(),
      instrucao: z.string().optional(),
      motivo: z.string().optional(),
    }),
  ),
  decisoes: z.array(
    z.object({
      ticket: z.string(),
      gate: z.string(),
      resultado: z.enum(["aprovado", "reprovado"]),
      nota: z.number().optional(),
      motivo: z.string().optional(),
      /** O tipo do Ator: a tela mostra o texto. */
      por: z.string(),
      em: Instante,
    }),
  ),
  evidencias: z.array(
    z.object({
      tipo: z.string(),
      rodada: z.string().optional(),
      ticket: z.string().optional(),
      em: Instante,
      dados: z.unknown(),
      anexos: z.array(Anexo),
    }),
  ),
  encerramento: z.object({
    passos: z.array(z.object({ passo: z.enum(["verificacao", "pr", "integracao"]), feito: z.boolean() })),
    limpeza_pendente: z.array(z.string()),
    falha: z.object({ etapa: z.enum(["check_final", "integracao", "limpeza"]), motivo: z.string() }).optional(),
    aguardando_merge: z.object({ url: z.string() }).optional(),
  }),
  dependencias: z.array(Predecessora),
  /** As que o cancelamento leva junto (diretas e indiretas, ainda não terminadas). */
  dependentes: z.array(z.object({ demanda_id: z.string(), titulo: z.string(), estado: EstadoDemanda })),
});
export type PaginaDaDemanda = z.infer<typeof PaginaDaDemanda>;

/** O corpo de `POST /api/demandas/tickets/:ref/reabrir`: a instrução vira a do ticket reaberto. */
export const ReaberturaDoTicket = z.object({
  instrucao: z
    .string({ error: "informe o motivo da reabertura, como instrução para o ticket" })
    .trim()
    .min(1, "informe o motivo da reabertura, como instrução para o ticket"),
});

/** A resposta de `POST /api/demandas/tickets/:ref/reabrir`. */
export const TicketReaberto = z.object({ ticket: TicketDemanda });

/**
 * A demanda como as ações a devolvem: o agregado em JSON. O contrato cobre o que as telas e o CLI leem; o resto (as
 * `tentativas`, os planos) segue no corpo sem schema, porque seus Endereços saem em texto e o schema do núcleo os quer como objeto.
 */
export const DemandaEmJson = z.looseObject({
  demanda: Demanda,
  tickets: z.array(TicketDemanda),
  decisoes: z.array(Decisao),
  rodadas: z.array(RodadaDemanda),
});

/** A resposta de `POST /api/demandas/:id/decisao` e de `.../cancelar`: a demanda e as que o gate ou o cancelamento levou junto. */
export const DemandaComCanceladas = z.object({ demanda: DemandaEmJson, canceladas: z.array(z.string()) });

/** A resposta de `POST /api/demandas/rodadas/:ref/pr`: a demanda decidida, ou a `sessao` de ajustes quando o PR é reprovado. */
export const DecisaoDoPR = z.union([DemandaEmJson, z.object({ sessao: z.string() })]);

/** A resposta de `POST /api/demandas/:id/arquivar`. */
export const DemandaArquivada = z.object({ demanda: DemandaEmJson });
