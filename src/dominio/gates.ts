// Gates do Auditor (F1 §5): C10 decidirRegistro.
import { z } from "zod";
import { type Agregado, type Ator, type Contexto, type Decisao, exigirAuditor, rotuloIssue } from "./agregado.ts";
import { ErroDeRegra } from "./erros.ts";
import { CATALOGO } from "./evidencia.ts";
import { exigirSemExecucao, rotuloTicket } from "./execucao.ts";
import { Motivo } from "./primitivos.ts";

const EntradaDecisao = z.discriminatedUnion("aprovado", [
  z.object({ aprovado: z.literal(true), motivo: Motivo.optional() }),
  z.object({ aprovado: z.literal(false), motivo: Motivo }),
]);

/**
 * C10: grava a decisão. Aprovado conclui o ticket de registro e leva a issue a `desenho` com um ticket de desenho
 * novo; reprovado não muda mais nada, e o F4 retoma a sessão com o motivo.
 */
export function decidirRegistro(ag: Agregado, entrada: unknown, ator: Ator, ctx: Contexto): Agregado {
  exigirAuditor(ator, "decidir o gate de registro");
  const { aprovado, motivo } = EntradaDecisao.parse(entrada);
  const i = rotuloIssue(ag);
  if (ag.issue.fase !== "registro") {
    throw new ErroDeRegra(
      `a ${i} está na fase ${ag.issue.fase}, não no registro`,
      "o gate de registro já foi decidido",
    );
  }
  const ticket = ag.tickets.find((t) => t.etapa === "registro" && t.status !== "concluido");
  if (!ticket) throw new ErroDeRegra(`a ${i} não tem ticket de registro aberto`, "registre a issue de novo");
  const t = rotuloTicket(ticket);
  exigirSemExecucao(ag, ticket, "passar pelo gate");

  if (aprovado) {
    if (ag.issue.titulo === null || ag.issue.tipo === null) {
      throw new ErroDeRegra(
        `a ${i} não pode sair do registro sem título e tipo`,
        `o agente de ${t} os preenche com fabriquinha issue editar ${i}`,
      );
    }
    const faltam = CATALOGO.filter(
      (c) => c.etapa === "registro" && !ag.evidencias.some((e) => e.ticket === ticket.id && e.tipo === c.tipo),
    ).map((c) => c.tipo);
    if (faltam.length > 0) {
      const comandos = faltam.map((tipo) => "fabriquinha evidencia add " + tipo).join(" e ");
      throw new ErroDeRegra(
        `${t} não pode concluir: falta a evidência ${faltam.join(", ")}`,
        `o agente de ${t} submete com ${comandos}`,
      );
    }
  }

  const decisao: Decisao = {
    id: ctx.novoId("decisao"),
    issue: ag.issue.id,
    ticket: ticket.id,
    gate: "registro",
    aprovado,
    ...(motivo !== undefined && { motivo }),
    por: "auditor",
    em: ctx.agora,
  };
  const decidido = { ...ag, decisoes: [...ag.decisoes, decisao] };
  if (!aprovado) return decidido;
  return {
    ...decidido,
    issue: { ...ag.issue, fase: "desenho" },
    tickets: [
      ...ag.tickets.map((x) =>
        x.id === ticket.id ? { ...x, status: "concluido" as const, concluidoEm: ctx.agora } : x,
      ),
      {
        id: ctx.novoId("ticket"),
        issue: ag.issue.id,
        etapa: "desenho",
        titulo: "Desenhar a solução",
        descricao: "",
        status: "aberto",
        origem: "fabriquinha",
        criadoEm: ctx.agora,
      },
    ],
  };
}
