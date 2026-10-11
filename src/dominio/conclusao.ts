// C7 concluirTicket (F1 §5, §5.1): as pré-condições comuns a toda etapa, mais a regra e a transição de cada uma.
import { z } from "zod";
import { type Agregado, type Ator, type Contexto, exigirFabriquinha, rotuloIssue, type Ticket } from "./agregado.ts";
import { ErroDeRegra } from "./erros.ts";
import { exigirEvidencias } from "./evidencia.ts";
import { exigirSemExecucao, marcarConcluido, rotuloTicket, ticketDe } from "./execucao.ts";
import { type Etapa, Id } from "./primitivos.ts";

/** Regra adicional e transição de uma etapa (F1 §5.1); recebe o agregado com o ticket já `concluido`. */
type Regra = (ag: Agregado, ticket: Ticket, ctx: Contexto) => Agregado;

const criouTicket = (ag: Agregado, ticket: Ticket): boolean =>
  ag.tickets.some((t) => t.etapa === "desenvolvimento" && t.origemTicket === ticket.id);

// ponytail: desenvolvimento, revisão, encerramento e sessão entram aqui nos tickets 15, 16, 20 e 21.
const REGRAS: Partial<Record<Exclude<Etapa, "registro">, Regra>> = {
  desenho: (ag, ticket) => {
    if (!criouTicket(ag, ticket)) {
      const t = rotuloTicket(ticket);
      throw new ErroDeRegra(
        `${t} não pode concluir: o desenho não criou ticket de desenvolvimento`,
        `o agente de ${t} cria com fabriquinha ticket criar ${rotuloIssue(ag)} --titulo <título>`,
      );
    }
    return { ...ag, issue: { ...ag.issue, fase: "aprovacao_desenho" } };
  },
};

const EntradaConclusao = z.object({ ticket: Id });

/** C7: ticket `concluido` e a transição da etapa, se o ticket já terminou de executar e tem as evidências. */
export function concluirTicket(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirFabriquinha(ator, "concluir um ticket");
  const { ticket: id } = EntradaConclusao.parse(entrada);
  const ticket = ticketDe(ag, id);
  const t = rotuloTicket(ticket);
  if (ticket.etapa === "registro") {
    throw new ErroDeRegra(
      `${t} é de registro e não conclui por concluirTicket`,
      "o Auditor o conclui no gate de registro",
    );
  }
  const regra = REGRAS[ticket.etapa];
  if (!regra) {
    throw new ErroDeRegra(
      `${t} é da etapa ${ticket.etapa}, que ainda não conclui`,
      "aguarde a versão que a implementa",
    );
  }
  if (ticket.status !== "em_execucao") {
    throw new ErroDeRegra(`${t} tem status ${ticket.status}, não em_execucao`, "só se conclui ticket em execução");
  }
  exigirSemExecucao(ag, ticket, "concluir");
  exigirEvidencias(ag, ticket);
  const depois = marcarConcluido(ag, ticket, ctx.agora);
  return regra(depois, ticketDe(depois, id), ctx);
}
