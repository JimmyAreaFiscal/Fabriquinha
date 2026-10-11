// Gates do Auditor (F1 §5): C10 decidirRegistro e C15 decidirDesenho.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  type Decisao,
  exigirAuditor,
  rotuloIssue,
  type Ticket,
} from "./agregado.ts";
import { ErroDeRegra } from "./erros.ts";
import { exigirEvidencias } from "./evidencia.ts";
import { exigirSemExecucao, marcarConcluido, rotuloTicket } from "./execucao.ts";
import { Motivo } from "./primitivos.ts";

const EntradaDecisao = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), motivo: Motivo.optional() }),
  z.object({ aprovado: z.literal(false), motivo: Motivo }),
]);
type EntradaDecisao = z.infer<typeof EntradaDecisao>;

/** O agregado com a decisão do Auditor sobre o resultado de `ticket` acrescentada. */
function comDecisao(
  ag: Agregado,
  ticket: Ticket,
  gate: Decisao["gate"],
  { aprovado, motivo }: EntradaDecisao,
  ctx: Contexto,
): Agregado {
  const decisao: Decisao = {
    id: ctx.novoId("decisao"),
    issue: ag.issue.id,
    ticket: ticket.id,
    gate,
    aprovado,
    ...(motivo !== undefined && { motivo }),
    por: "auditor",
    em: ctx.agora,
  };
  return { ...ag, decisoes: [...ag.decisoes, decisao] };
}

const ticketDeDesenho = (ag: Agregado, ctx: Contexto, titulo: string, descricao: string): Ticket => ({
  id: ctx.novoId("ticket"),
  issue: ag.issue.id,
  etapa: "desenho",
  titulo,
  descricao,
  status: "aberto",
  origem: "fabriquinha",
  criadoEm: ctx.agora,
});

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
    tickets: [...marcarConcluido(ag, ticket, ctx.agora).tickets, ticketDeDesenho(ag, ctx, "Desenhar a solução", "")],
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
    tickets: [...ag.tickets.filter((t) => !proposto(t)), ticketDeDesenho(ag, ctx, "Refazer o desenho", decisao.motivo)],
  };
}
