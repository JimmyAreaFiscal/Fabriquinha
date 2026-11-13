// provisório: remover no ticket 22. As sessões, as execuções e o Uso delas mudaram para src/modulos/sessoes/, pela
// fachada, com os nomes de lá; aqui ficam os nomes antigos, a correlação com o endereço do ticket e o SQL que junta as
// sessões às tabelas do Ciclo de Vida (`ticketsEmExecucaoSemProcesso`, da política provisória que o ticket 15 absorve na
// Condução).
import type { DatabaseSync } from "node:sqlite";
import type { z } from "zod";
import { formatarTicketRef, type TicketRef } from "../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { CATALOGO_DE_ETAPAS } from "../../etapas/catalogo.ts";
import {
  carregarSessoesDoContexto,
  type SessoesDoContexto,
  execucoesAbertas,
  sessaoDeCadaTicketDasDemandas,
} from "../../sessoes/publico.ts";

export {
  comSessoesDoContexto as comTrabalhosDoTicket,
  contextoDaExecucao as ticketDoProcesso,
  contextoDaSessao as ticketDoTrabalho,
  execucaoVivaDoToken as processoVivoDoToken,
  execucoesAbertas as processosAbertos,
  gravarAmbienteDaExecucao as gravarAmbienteDoProcesso,
  gravarTokenDaExecucao as gravarTokenDoProcesso,
  sessaoDeCadaTicketDasDemandas,
  sessoesDaDemanda as trabalhosComTicketDaDemanda,
} from "../../sessoes/publico.ts";

export const carregarTrabalhosDoTicket = (banco: DatabaseSync, ref: z.infer<typeof TicketRef>): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, ref);

export const carregarTrabalhosDaDemanda = (banco: DatabaseSync, demandaId: string): SessoesDoContexto =>
  carregarSessoesDoContexto(banco, { demanda_id: demandaId, ticket_id: null });

/**
 * Os tickets (`I-n.Tm`) com o pi no ar: execução aberta e com o grupo do pi gravado. A execução abre antes da preparação
 * da worktree e o grupo só é gravado quando o pi sobe; a coleta de evidências roda depois que ela fecha.
 */
export const ticketsComPiAtivo = (banco: DatabaseSync): Set<string> =>
  new Set(
    execucoesAbertas(banco)
      .filter((e) => e.grupo_processo !== null)
      .map(({ demanda_id, ticket_id }) => formatarTicketRef({ demanda_id, ticket_id })),
  );

/**
 * As Etapas cujo fechamento roda depois que a execução fecha: as que o agente faz sozinho ou a Fabriquinha faz (as
 * interativas ficam de fora: a retomada do despacho as assume). A Etapa da rodada cujo Gate espera num estado próprio só
 * conta enquanto a rodada está no estado da Etapa: no do Gate, o ticket espera o Auditor.
 * ponytail: só a Etapa da rodada com Gate em estado próprio; a da demanda com Gate assim ficaria de fora, e não há nenhuma.
 */
const etapasFechadasDepoisDaExecucao = Object.values(CATALOGO_DE_ETAPAS).filter(
  ({ executor }) => executor === "agente_autonomo" || executor === "fabriquinha",
);
const ETAPAS_FECHADAS_SEMPRE = etapasFechadasDepoisDaExecucao
  .filter(({ gate }) => gate?.esperaEmEstadoProprio !== true)
  .map(({ nome }) => nome);
const ETAPAS_FECHADAS_NO_ESTADO_DA_RODADA = etapasFechadasDepoisDaExecucao
  .filter(({ gate, escopo }) => gate?.esperaEmEstadoProprio === true && escopo === "rodada")
  .map(({ nome }) => nome);

/** Os tickets `em_execucao` que nenhuma execução aberta segura, das Etapas que fecham depois da execução. */
export const ticketsEmExecucaoSemProcesso = (banco: DatabaseSync): z.infer<typeof TicketRef>[] =>
  banco
    .prepare(
      `SELECT demanda_id, ticket_id FROM ticket_demanda t WHERE estado = 'em_execucao' AND (
         etapa IN (SELECT value FROM json_each(?))
         OR (etapa IN (SELECT value FROM json_each(?)) AND EXISTS (SELECT 1 FROM rodada r
           WHERE r.demanda_id = t.demanda_id AND r.rodada_id = t.rodada_id AND r.estado = t.etapa)))`,
    )
    .all(JSON.stringify(ETAPAS_FECHADAS_SEMPRE), JSON.stringify(ETAPAS_FECHADAS_NO_ESTADO_DA_RODADA))
    .map((l) => ({ ...l }) as unknown as z.infer<typeof TicketRef>);

/** O id da sessão de cada ticket da demanda; com mais de uma no ticket, vale a mais recente. */
export const sessaoDeCadaTicketDaDemanda = (banco: DatabaseSync, id: string): Map<number, string> =>
  new Map(sessaoDeCadaTicketDasDemandas(banco, [id]).get(id));
