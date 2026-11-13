// A sessão do ticket como o Auditor a vê no chat (comparacao-sdlc-implementacao.md §9.1): o estado dela e desde quando,
// que juntam a situação técnica informada por Sessões (o diálogo aberto, o pi ocupado ou ocioso, a última execução) à do
// desenvolvimento (a demanda e o ticket), e a Pendência que a segura parada. O chat, o Histórico e a mensagem do Auditor
// leem o estado daqui; a visão do chat é montada pela consulta do servidor.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import type { Instante } from "../../../../../shared/nucleo/primitivos.ts";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { Endereco } from "../../../etapas/publico.ts";
import {
  type AgregadoDemanda,
  carregarDemanda,
  CICLO_DA_DEMANDA,
  type Pendencia,
  pendenciasDoProcesso,
  type TicketDemanda,
  type TrabalhoVivo,
} from "../../../processo/publico.ts";
import { carregarSessoesDoContexto, type Execucao, type Sessao, type Situacao } from "../../../../sessoes/publico.ts";

/** O estado de uma sessão (F4 §5.2). */
export type EstadoDaSessao = "rodando" | "aguardando_humano" | "terminada";

/** A Pendência como o chat a leva: `item` pelo endereço público (D09). */
export type PendenciaDoChat = Omit<Pendencia, "item"> & { item: string };

export const pendenciaDoChat = (pendencia: Pendencia): PendenciaDoChat => ({
  ...pendencia,
  item: pendencia.item.toString(),
});

/** A sessão de um ticket com o agregado da demanda, o ticket e as execuções dela, em ordem. */
export interface SessaoDoTicket {
  ag: AgregadoDemanda;
  ticket: TicketDemanda;
  sessao: Sessao;
  execucoes: Execucao[];
}

type TicketDaSessao = Pick<Sessao, "demanda_id" | "ticket_id">;

export const execucaoDaSessao = (
  { sessao, execucoes }: SessaoDoTicket,
  quando: "primeira" | "ultima" = "ultima",
): Execucao =>
  encontrado(
    quando === "ultima" ? execucoes.at(-1) : execucoes[0],
    `a sessão ${sessao.id} não tem execução`,
    "confira o banco",
  );

/** A sessão `id` do ticket, com o agregado e as execuções dela; recusa o id que não é de uma sessão do ticket. */
export function carregarSessaoDoTicket(
  banco: DatabaseSync,
  ref: TicketDaSessao,
  id: string,
  ag = carregarDemanda(banco, ref.demanda_id),
): SessaoDoTicket {
  const erro = [`a sessão ${id} não existe`, "confira o endereço do chat"] as const;
  const { sessoes, execucoes } = carregarSessoesDoContexto(banco, ref);
  return {
    ag,
    ticket: encontrado(
      ag.tickets.find((t) => t.ticket_id === ref.ticket_id),
      ...erro,
    ),
    sessao: encontrado(
      sessoes.find((s) => s.id === id),
      ...erro,
    ),
    execucoes: execucoes.filter((e) => e.trabalho_id === id),
  };
}

/**
 * O estado da sessão e desde quando: diálogo pendente espera o Auditor; execução aberta com o pi trabalhando roda;
 * parada, a demanda encerrada (concluída, cancelada, arquivada) termina, o ticket decide (falha, terminada) e a
 * autônoma ainda roda; a interativa espera o Auditor, na conversa ou no gate do plano. Por que espera é a Pendência.
 */
export function estadoEDesdeDaSessao(c: SessaoDoTicket, viva: Situacao | undefined): [EstadoDaSessao, Instante] {
  const { ag, ticket, sessao } = c;
  const [dialogo] = viva?.dialogos ?? [];
  if (dialogo) return ["aguardando_humano", dialogo.em];
  const ultima = execucaoDaSessao(c);
  if (ultima.fim == null && viva?.ocupado !== false) return ["rodando", viva?.desde ?? ultima.inicio];
  // Sem fim, só o pi ocioso chega aqui, e ele tem `desde`.
  const parada = viva?.desde ?? String(ultima.fim);
  if (CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)) return ["terminada", parada];
  if (ticket.estado === "falhou") return ["aguardando_humano", parada];
  if (ticket.estado === "concluido") return ["terminada", parada];
  if (sessao.modo === "autonomo") return ["rodando", parada];
  return ["aguardando_humano", parada];
}

/**
 * A sessão parada no diálogo (com a pergunta) ou na conversa, que `pendenciasDoProcesso` pede. A do ticket que falhou e a
 * do gate do plano não são: a Pendência delas é o ticket bloqueado e o gate.
 */
export function trabalhoVivoDaSessao(
  { ag, ticket }: SessaoDoTicket,
  viva: Situacao | undefined,
  [estado, desde]: [EstadoDaSessao, Instante],
): TrabalhoVivo | undefined {
  const [dialogo] = viva?.dialogos ?? [];
  const esperaOGate = ticket.estado === "falhou" || ag.demanda.estado === "gate_planejamento";
  if (estado !== "aguardando_humano" || (!dialogo && esperaOGate)) return undefined;
  return {
    ticket: Endereco.doTicket(ag.demanda.id, ticket.ticket_id),
    ...(typeof dialogo?.title === "string" && { pergunta: dialogo.title }),
    desde,
  };
}

/** A Pendência que segura a sessão parada: a do ticket dela (diálogo, conversa ou bloqueio) ou, no plano, o gate. */
export function pendenciaDaSessao(
  c: SessaoDoTicket,
  viva: Situacao | undefined,
  estadoEDesde: [EstadoDaSessao, Instante],
  relogio: Relogio,
): PendenciaDoChat | undefined {
  if (estadoEDesde[0] !== "aguardando_humano") return undefined;
  const vivo = trabalhoVivoDaSessao(c, viva, estadoEDesde);
  // O despacho parado não segura sessão nenhuma: só as Pendências do Processo.
  const pendencias = pendenciasDoProcesso(c.ag, vivo ? [vivo] : [], c.ag.pull_requests, relogio.agora());
  const daSessao =
    pendencias.find((p) => p.item.ticket_id === c.ticket.ticket_id) ?? pendencias.find((p) => p.tipo === "gate_humano");
  return pendenciaDoChat(encontrado(daSessao, `a sessão ${c.sessao.id} espera sem Pendência`, "confira o banco"));
}
