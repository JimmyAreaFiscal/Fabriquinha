// Tickets de desenvolvimento propostos (F1 §5): C11 adicionar, C12 editar e C13 remover.
import { z } from "zod";
import {
  type Agregado,
  type Ator,
  type Contexto,
  exigirAuditorOuAgente,
  rotuloIssue,
  type Ticket,
} from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { rotuloTicket, ticketDe } from "./execucao.ts";
import { Id, Markdown, Modelo, Titulo } from "./primitivos.ts";

/** C11: o agente de desenho, revisão ou sessão da issue, ou o Auditor só no gate de desenho. */
function exigirQuemPropoe(ag: Agregado, ator: Ator, acao: string): void {
  exigirAuditorOuAgente(ag, ator, ["desenho", "revisao", "sessao"], acao);
  if (ator.tipo === "auditor" && ag.issue.fase !== "aprovacao_desenho") {
    throw new ErroDeRegra(
      `o Auditor não pode ${acao} na fase ${ag.issue.fase}`,
      "o Auditor só ajusta os tickets propostos no gate de desenho",
    );
  }
}

/** C12 e C13: ticket de desenvolvimento ainda aberto; o agente só mexe nos que a sua execução criou. */
function exigirProposto(ag: Agregado, ator: Ator, id: Id, acao: string): Ticket {
  exigirQuemPropoe(ag, ator, acao);
  const ticket = ticketDe(ag, id);
  const t = rotuloTicket(ticket);
  if (ticket.etapa !== "desenvolvimento" || ticket.status !== "aberto") {
    throw new ErroDeRegra(
      `${t} não é um ticket de desenvolvimento aberto`,
      "só se ajusta ticket de desenvolvimento que ainda não executou",
    );
  }
  if (ator.tipo === "agente" && ticket.origemTicket !== ator.ticket) {
    throw new ErroDeEscopo(
      `o agente de T-${String(ator.ticket)} não pode ${acao}: ${t} não foi criado pela execução dele`,
      "cada agente ajusta só os tickets que criou",
    );
  }
  return ticket;
}

const EntradaNovo = z.strictObject({ titulo: Titulo, descricao: Markdown.default(""), modelo: Modelo.optional() });

/** C11: ticket de desenvolvimento aberto; `origemTicket` é o ticket do agente que o criou. */
export function adicionarTicketDesenvolvimento(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirQuemPropoe(ag, ator, `criar ticket na ${rotuloIssue(ag)}`);
  const { titulo, descricao, modelo } = EntradaNovo.parse(entrada);
  // O modelo é custo por execução, então só o Auditor o escolhe (F1 §3.5).
  if (modelo && ator.tipo !== "auditor") {
    throw new ErroDeEscopo("o agente não pode escolher o modelo do ticket", "crie sem modelo; o Auditor o escolhe");
  }
  const novo: Ticket = {
    id: ctx.novoId("ticket"),
    issue: ag.issue.id,
    etapa: "desenvolvimento",
    titulo,
    descricao,
    status: "aberto",
    origem: ator.tipo,
    ...(ator.tipo === "agente" && { origemTicket: ator.ticket }),
    ...(modelo && { modelo }),
    criadoEm: ctx.agora,
  };
  return { ...ag, tickets: [...ag.tickets, novo] };
}

const EntradaEdicao = z.strictObject({ ticket: Id, titulo: Titulo.optional(), descricao: Markdown.optional() });

/** C12: muda só os campos informados. */
export function editarTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  const { ticket: id, ...campos } = EntradaEdicao.parse(entrada);
  const ticket = exigirProposto(ag, ator, id, `editar T-${String(id)}`);
  // Campo ausente ou `undefined` (ex.: opção não passada no CLI) mantém o valor atual, como no C2.
  const definidos = Object.entries(campos).filter((par: [string, unknown]) => par[1] !== undefined);
  const editado = { ...ticket, ...Object.fromEntries(definidos) };
  return { ...ag, tickets: ag.tickets.map((t) => (t.id === id ? editado : t)) };
}

const EntradaRemocao = z.object({ ticket: Id });

/** C13: apaga o ticket, que ainda não tem histórico (F2 §4). */
export function removerTicket(ag: Agregado, entrada: unknown, ator: Ator): Agregado {
  const { ticket: id } = EntradaRemocao.parse(entrada);
  exigirProposto(ag, ator, id, `remover T-${String(id)}`);
  return { ...ag, tickets: ag.tickets.filter((t) => t.id !== id) };
}
