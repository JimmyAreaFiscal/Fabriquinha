// O contrato da API do Início (comparacao-sdlc §9.1, "Board com demanda"): o mês corrente, o que aguarda o Auditor, as
// sessões que rodam e o board das demandas em andamento. Só tipos e schemas; quem monta o valor é a consulta da tela (api/consultas/).
import { z } from "zod";
import { EstadoTicket, ModoTrabalho } from "../compartilhado/nucleo/primitivos.ts";
import { EstadoDemanda, EstadoRodada } from "../sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { EtapaTicket } from "../etapas/catalogo.ts";
import { PendenciaDoInicio, PiAtivo } from "./demanda.ts";
import { SessaoDeDemanda } from "./sessoes/historico.ts";
import { MetricasDoMes } from "./metricas.ts";

/** Uma sessão que roda, com o que o agente faz: o que o processo vivo diz ou, sem ele, o título do ticket. */
const SessaoRodando = SessaoDeDemanda.extend({ fazendo: z.string().optional() });
export type SessaoRodando = z.infer<typeof SessaoRodando>;

/** A coluna do board: o estado da demanda antes e depois da execução e, na execução, o estado de cada rodada. */
const ColunaDoBoard = z.union([
  EstadoDemanda.exclude(["em_execucao", "concluida", "arquivada", "cancelada"]),
  EstadoRodada.exclude(["concluida"]),
]);
export type ColunaDoBoard = z.infer<typeof ColunaDoBoard>;

/** Um ticket como o Início o mostra; `modo` é o da sessão ativa dele, quando tem. */
const TicketDoInicio = z.object({
  ref: z.string(),
  etapa: EtapaTicket,
  estado: EstadoTicket,
  modo: ModoTrabalho.optional(),
  /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
  pi_ativo: PiAtivo.optional(),
});

/** Um cartão do board: a demanda (`I-n`) ou, na execução, uma rodada dela (`I-n.Rm`). */
const CartaoDoBoard = z.object({
  coluna: ColunaDoBoard,
  ref: z.string(),
  demanda: z.string(),
  projeto: z.string(),
  titulo: z.string(),
  /** O ticket em curso: o falho ou em execução antes do aberto. */
  ticket: TicketDoInicio.optional(),
  /** Quantos outros tickets do cartão ainda não terminaram. */
  outros: z.number().int().nonnegative(),
  /** As predecessoras que ainda não satisfazem a dependência. */
  bloqueios: z.array(z.string()),
});
export type CartaoDoBoard = z.infer<typeof CartaoDoBoard>;

/** `GET /api/inicio`. */
export const DadosDoInicio = z.object({
  mes: MetricasDoMes,
  aguarda: z.array(PendenciaDoInicio),
  rodando: z.array(SessaoRodando),
  /** As demandas em andamento, que o board distribui nos cartões. */
  quantidadeEmAndamento: z.number().int().nonnegative(),
  board: z.array(CartaoDoBoard),
});
export type DadosDoInicio = z.infer<typeof DadosDoInicio>;
