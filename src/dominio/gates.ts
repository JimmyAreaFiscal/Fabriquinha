// Gates (F1 §5): C10 decidirRegistro, C15 decidirDesenho e C16 decidirPR, do Auditor, e C14 registrarDecisaoRevisao,
// do agente revisor.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  type Decisao,
  exigirAuditor,
  exigirExecucaoEmAndamento,
  rotuloIssue,
  type Ticket,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { exigirEvidencias } from "./evidencia.ts";
import { exigirSemExecucao, marcarConcluido, novoTicket, rotuloTicket, ticketDe } from "./execucao.ts";
import { Id, Motivo } from "./primitivos.ts";

const EntradaDecisao = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), motivo: Motivo.optional() }),
  z.object({ aprovado: z.literal(false), motivo: Motivo }),
]);

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

/**
 * C10: grava a decisão. Aprovado conclui o ticket de registro e leva a issue a `desenho` com um ticket de desenho
 * novo; reprovado não muda mais nada, e o F4 retoma a sessão com o motivo.
 */
export function decidirRegistro(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate de registro");
  const decisao = EntradaDecisao.parse(entrada);
  const i = rotuloIssue(ag);
  if (ag.issue.fase !== "registro") {
    throw new ErroDeRegra(
      `a ${i} está na fase ${ag.issue.fase}, não no registro`,
      "o gate de registro já foi decidido",
    );
  }
  const ticket = ag.tickets.find((t) => t.etapa === "registro" && t.status !== "concluido");
  if (!ticket) throw new ErroDeRegra(`a ${i} não tem ticket de registro aberto`, "registre a issue de novo");
  exigirSemExecucao(ag, ticket, "passar pelo gate");

  if (decisao.aprovado) {
    if (ag.issue.titulo === null || ag.issue.tipo === null) {
      throw new ErroDeRegra(
        `a ${i} não pode sair do registro sem título e tipo`,
        `o agente de ${rotuloTicket(ticket)} os preenche com fabriquinha issue editar ${i}`,
      );
    }
    exigirEvidencias(ag, ticket);
  }

  const decidido = comDecisao(ag, ticket, "registro", decisao, ctx);
  if (!decisao.aprovado) return decidido;
  return {
    ...decidido,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [...marcarConcluido(ag, ticket, ctx.agora).tickets, novoTicket(ag, ctx, "desenho", "Desenhar a solução")],
  };
}

/**
 * C15: grava a decisão sobre o último desenho concluído. Aprovado leva a issue a `desenvolvimento` com os tickets
 * propostos; reprovado os descarta e volta a `desenho` com um ticket novo que traz o motivo na descrição.
 */
export function decidirDesenho(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate de desenho");
  const decisao = EntradaDecisao.parse(entrada);
  const i = rotuloIssue(ag);
  if (ag.issue.fase !== "aprovacao_desenho") {
    throw new ErroDeRegra(
      `a ${i} está na fase ${ag.issue.fase}, não na aprovação do desenho`,
      "o gate de desenho abre quando o ticket de desenho conclui",
    );
  }
  const desenho = ag.tickets.findLast((t) => t.etapa === "desenho" && t.status === "concluido");
  if (!desenho) throw new ErroDeRegra(`a ${i} não tem ticket de desenho concluído`, "conclua o desenho antes");
  const proposto = (t: Ticket) => t.etapa === "desenvolvimento" && t.status === "aberto";
  if (decisao.aprovado && !ag.tickets.some(proposto)) {
    throw new ErroDeRegra(
      `a ${i} não pode ir ao desenvolvimento sem ticket de desenvolvimento aberto`,
      "crie um ticket ou reprove o desenho",
    );
  }

  const decidido = comDecisao(ag, desenho, "desenho", decisao, ctx);
  if (decisao.aprovado) return { ...decidido, issue: { ...ag.issue, fase: "desenvolvimento" } };
  return {
    ...decidido,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [
      ...ag.tickets.filter((t) => !proposto(t)),
      novoTicket(ag, ctx, "desenho", "Refazer o desenho", decisao.motivo),
    ],
  };
}

const EntradaRevisao = z.object({ ticket: Id }).and(EntradaDecisao);

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
