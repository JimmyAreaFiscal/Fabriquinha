// Gates (F1 §5): C25 enviarParaAprovacao, do agente do registro e do desenho; C10 decidirRegistro, C15 decidirDesenho e
// C16 decidirPR, do Auditor; e C14 registrarDecisaoRevisao, do agente revisor.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  type Decisao,
  exigirAuditor,
  exigirExecucaoEmAndamento,
  exigirRegistroExterno,
  rotuloIssue,
  type Ticket,
} from "./agregado.ts";
import { exigirTicketCriado } from "./conclusao.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { exigirEvidencias } from "./evidencia.ts";
import { exigirSemExecucao, marcarConcluido, novoTicket, rotuloTicket, ticketDe, trocarTicket } from "./execucao.ts";
import { Id, Motivo } from "./primitivos.ts";

const APROVADA = { aprovado: z.literal(true), motivo: Motivo.optional() };
const REPROVADA = { aprovado: z.literal(false), motivo: Motivo };
const EntradaDecisao = z.discriminatedUnion("aprovado", [z.strictObject(APROVADA), z.strictObject(REPROVADA)]);

/** O agregado com a decisão sobre o resultado de `ticket` acrescentada: do agente na revisão, do Auditor nos demais. */
function comDecisao(
  ag: Agregado,
  ticket: Ticket,
  gate: Decisao["gate"],
  { aprovado, motivo, nota }: Pick<Decisao, "aprovado" | "motivo" | "nota">,
  ctx: Contexto,
): Agregado {
  const decisao: Decisao = {
    id: ctx.novoId("decisao"),
    issue: ag.issue.id,
    ticket: ticket.id,
    gate,
    aprovado,
    ...(motivo !== undefined && { motivo }),
    ...(nota !== undefined && { nota }),
    por: gate === "revisao" ? "agente" : "auditor",
    em: ctx.agora,
  };
  return { ...ag, decisoes: [...ag.decisoes, decisao] };
}

/** O registro precisa de título e tipo para ir à aprovação e para sair dela (C25, C10). */
function exigirTituloETipo(ag: Agregado, ticket: Ticket): void {
  const i = rotuloIssue(ag);
  if (ag.issue.titulo === null || ag.issue.tipo === null) {
    throw new ErroDeRegra(
      `a ${i} não pode sair do registro sem título e tipo`,
      `o agente de ${rotuloTicket(ticket)} os preenche com fabriquinha issue editar ${i}`,
    );
  }
}

/** A fase em que cada etapa enviada fica esperando o Auditor (C25). */
const FASE_DO_ENVIO = { registro: "registro", desenho: "aprovacao_desenho" } as const;

/**
 * C25: o agente do registro ou do desenho envia o resultado à aprovação do Auditor, depois de confirmá-lo com ele na
 * conversa; a IA externa envia o registro que ela registrou. Exige o que o gate exige; o desenho vai à fase
 * `aprovacao_desenho`, e o ticket segue em execução até o Auditor decidir (C10, C15).
 */
export function enviarParaAprovacao(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  const { ticket: id } = z.strictObject({ ticket: Id }).parse(entrada);
  const t = `T-${String(id)}`;
  const acao = `enviar ${t} à aprovação`;
  if (ator.tipo === "externo") {
    if (exigirRegistroExterno(ag, acao).id !== id) {
      throw new ErroDeEscopo(`a IA externa não pode ${acao}`, "ela envia só o ticket de registro da issue");
    }
  } else if (ator.tipo !== "agente" || ator.ticket !== id) {
    throw new ErroDeEscopo(`só o agente de ${t} pode enviá-lo à aprovação`, "cada agente envia só o próprio ticket");
  } else {
    exigirExecucaoEmAndamento(ag, ator, acao);
  }
  const ticket = ticketDe(ag, id);
  if (ticket.etapa !== "registro" && ticket.etapa !== "desenho") {
    throw new ErroDeRegra(`${t} é de ${ticket.etapa}`, "só o registro e o desenho vão à aprovação do Auditor");
  }
  if (ticket.enviadoEm !== undefined) {
    throw new ErroDeRegra(
      `${t} já foi enviado e espera a decisão do Auditor`,
      ticket.origem === "externo"
        ? `se ele devolver, leia o motivo com fabriquinha necessidade ver ${rotuloIssue(ag)}`
        : "termine a sua resposta; se ele devolver, o motivo chega nesta conversa",
    );
  }
  if (ticket.etapa === "registro") exigirTituloETipo(ag, ticket);
  exigirEvidencias(ag, ticket, "ir à aprovação");
  if (ticket.etapa === "desenho") exigirTicketCriado(ag, ticket, "ir à aprovação");
  const enviado = trocarTicket(ag, { ...ticket, enviadoEm: ctx.agora });
  return { ...enviado, issue: { ...ag.issue, fase: FASE_DO_ENVIO[ticket.etapa] } };
}

/** O ticket enviado (C25) que espera a decisão do gate, sem execução em andamento: o F4 para o pi ocioso antes. */
function enviado(ag: Agregado, etapa: "registro" | "desenho"): Ticket {
  const ticket = ag.tickets.find((t) => t.etapa === etapa && t.status === "em_execucao");
  if (ticket?.enviadoEm === undefined) {
    throw new ErroDeRegra(
      `o ${etapa} da ${rotuloIssue(ag)} ainda não foi enviado à aprovação`,
      "o agente envia com fabriquinha ticket enviar quando você confirmar o resultado na conversa",
    );
  }
  exigirSemExecucao(ag, ticket, "passar pelo gate");
  return ticket;
}

/** Devolvido no gate: o ticket volta à conversa, sem o envio. */
function devolvido(ag: Agregado, ticket: Ticket): Agregado {
  const { enviadoEm: _devolvido, ...resto } = ticket;
  return trocarTicket(ag, resto);
}

/**
 * C10: grava a decisão sobre o registro enviado (C25). Aprovado conclui o ticket de registro e leva a issue a
 * `desenho` com um ticket de desenho novo; reprovado devolve o ticket à conversa, e o F4 retoma a sessão com o motivo.
 */
export function decidirRegistro(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate de registro");
  const decisao = EntradaDecisao.parse(entrada);
  if (ag.issue.fase !== "registro") {
    throw new ErroDeRegra(
      `a ${rotuloIssue(ag)} está na fase ${ag.issue.fase}, não no registro`,
      "o gate de registro já foi decidido",
    );
  }
  const ticket = enviado(ag, "registro");
  if (decisao.aprovado) {
    exigirTituloETipo(ag, ticket);
    exigirEvidencias(ag, ticket);
  }

  const decidido = comDecisao(ag, ticket, "registro", decisao, ctx);
  if (!decisao.aprovado) return devolvido(decidido, ticket);
  return {
    ...decidido,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [...marcarConcluido(ag, ticket, ctx.agora).tickets, novoTicket(ag, ctx, "desenho", "Desenhar a solução")],
  };
}

/**
 * C15: grava a decisão sobre o desenho enviado (C25). Aprovado conclui o ticket de desenho e leva a issue a
 * `desenvolvimento` com os tickets propostos; reprovado volta a issue a `desenho` com o mesmo ticket e os mesmos
 * tickets propostos, e o F4 retoma a sessão com o motivo.
 */
export function decidirDesenho(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate de desenho");
  const decisao = EntradaDecisao.parse(entrada);
  const i = rotuloIssue(ag);
  if (ag.issue.fase !== "aprovacao_desenho") {
    throw new ErroDeRegra(
      `a ${i} está na fase ${ag.issue.fase}, não na aprovação do desenho`,
      "o gate de desenho abre quando o agente envia o desenho",
    );
  }
  const desenho = enviado(ag, "desenho");
  if (decisao.aprovado && !ag.tickets.some((t) => t.etapa === "desenvolvimento" && t.status === "aberto")) {
    throw new ErroDeRegra(
      `a ${i} não pode ir ao desenvolvimento sem ticket de desenvolvimento aberto`,
      "crie um ticket ou reprove o desenho",
    );
  }

  const decidido = comDecisao(ag, desenho, "desenho", decisao, ctx);
  if (decisao.aprovado) {
    return { ...marcarConcluido(decidido, desenho, ctx.agora), issue: { ...ag.issue, fase: "desenvolvimento" } };
  }
  return { ...devolvido(decidido, desenho), issue: { ...ag.issue, fase: "desenho" } };
}

const EntradaRevisao = z.discriminatedUnion("aprovado", [
  z.strictObject({ ticket: Id, ...APROVADA }),
  z.strictObject({ ticket: Id, ...REPROVADA }),
]);

/** C14: o agente da revisão grava a decisão sobre o próprio ticket; outra na mesma execução substitui a anterior. */
export function registrarDecisaoRevisao(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  const { ticket: id, ...decisao } = EntradaRevisao.parse(entrada);
  const acao = `registrar a decisão de revisão de T-${String(id)}`;
  if (ator.tipo !== "agente" || ator.ticket !== id) {
    throw new ErroDeEscopo(
      `só o agente de T-${String(id)} pode registrar a decisão de revisão dele`,
      "cada revisão é decidida pelo próprio agente revisor",
    );
  }
  exigirExecucaoEmAndamento(ag, ator, acao);
  const ticket = ticketDe(ag, id);
  if (ticket.etapa !== "revisao" || ticket.status !== "em_execucao") {
    throw new ErroDeRegra(
      `${rotuloTicket(ticket)} é de ${ticket.etapa} e está ${ticket.status}, não é uma revisão em execução`,
      "só a revisão registra a decisão de revisão",
    );
  }
  const semAnterior = { ...ag, decisoes: ag.decisoes.filter((d) => d.gate !== "revisao" || d.ticket !== id) };
  return comDecisao(semAnterior, ticket, "revisao", decisao, ctx);
}

/** C16: encerrar a issue pede só a nota; pedir mudanças, só o motivo (F1 §3.7). */
export const EntradaPR = z.discriminatedUnion("aprovado", [
  z.strictObject({ aprovado: z.literal(true), nota: z.number().int().min(1).max(5) }),
  z.strictObject({ aprovado: z.literal(false), motivo: Motivo }),
]);

/**
 * C16: grava a decisão sobre o último encerramento, com o PR que o F5 acabou de ler (`ctx.estadoPR`). Aprovado
 * ("encerrar a issue") exige o PR mergeado e conclui a issue; reprovado ("pedir mudanças") exige o PR não mergeado e
 * leva a issue a `ajuste_pr`, com um ticket `sessao` que traz o motivo na descrição.
 */
export function decidirPR(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate do PR");
  const decisao = EntradaPR.parse(entrada);
  const i = rotuloIssue(ag);
  if (ag.issue.fase !== "aprovacao_pr") {
    throw new ErroDeRegra(
      `a ${i} está na fase ${ag.issue.fase}, não na aprovação do PR`,
      "o gate do PR abre quando o encerramento publica o PR",
    );
  }
  const encerramento = ag.tickets.findLast((t) => t.etapa === "encerramento" && t.status === "concluido");
  if (!encerramento) throw new ErroDeRegra(`a ${i} não tem ticket de encerramento concluído`, "confira o banco");
  const pr = ctx.estadoPR;
  if (pr === undefined) {
    throw new ErroDeRegra(`o estado do PR da ${i} não foi lido`, "leia o PR na plataforma logo antes de decidir");
  }
  if (decisao.aprovado && pr !== "mergeado") {
    throw new ErroDeRegra(
      `a ${i} não pode ser encerrada: o PR está ${pr}, não mergeado`,
      "faça o merge na plataforma, com merge commit, e encerre de novo",
    );
  }
  if (!decisao.aprovado && pr === "mergeado") {
    throw new ErroDeRegra(`a ${i} não pode pedir mudanças: o PR já foi mergeado`, "encerre a issue com a nota");
  }

  const decidido = comDecisao(ag, encerramento, "pr", decisao, ctx);
  if (decisao.aprovado) return { ...decidido, issue: { ...ag.issue, fase: "concluida", concluidaEm: ctx.agora } };
  return {
    ...decidido,
    issue: { ...ag.issue, fase: "ajuste_pr" },
    tickets: [...ag.tickets, novoTicket(ag, ctx, "sessao", "Ajustar o PR", decisao.motivo)],
  };
}
