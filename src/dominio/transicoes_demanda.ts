// Transições da demanda SDLC (comparacao-sdlc-implementacao.md §3): registrar, editar, enviar e decidir.
// Funções puras (agregado, entrada, ator, contexto) → agregado; o agregado de entrada nunca é mutado.
import { z } from "zod";
import { type Ator, exigirAuditor, TipoIssue } from "./agregado.ts";
import { AgregadoDemanda, type DecisaoDemanda } from "./agregado_demanda.ts";
import { branchDemanda, DemandaId } from "./demanda.ts";
import { ErroDeRegra } from "./erros.ts";
import { AutorDemanda, exigirAutoria, pendentesDeEnvio } from "./evidencia_demanda.ts";
import { type Instante, Markdown, Motivo, Slug, Titulo } from "./primitivos.ts";

export interface ContextoDemanda {
  readonly agora: Instante;
}

const EntradaRegistro = z.strictObject({
  id: DemandaId,
  projeto: Slug,
  titulo: Titulo,
  tipo: TipoIssue,
  descricao: Markdown,
});
const EntradaEdicao = z
  .strictObject({ titulo: Titulo.optional(), tipo: TipoIssue.optional(), descricao: Markdown.optional() })
  .refine((e) => (e.titulo ?? e.tipo ?? e.descricao) !== undefined, "informe ao menos um campo para editar");
const EntradaDecisao = z.discriminatedUnion("aprovado", [
  z.strictObject({ aprovado: z.literal(true), nota: z.number().int().min(1).max(5).optional() }),
  z.strictObject({ aprovado: z.literal(false), motivo: Motivo, nota: z.number().int().min(1).max(5).optional() }),
]);

/** CA-1: cria a demanda em `registro` com a origem do autor e o ticket 1 da etapa `demanda`. */
export function registrarDemanda(entrada: unknown, autor: AutorDemanda, ctx: ContextoDemanda): AgregadoDemanda {
  const e = EntradaRegistro.parse(entrada);
  const { ferramenta, sessao } = AutorDemanda.parse(autor);
  return AgregadoDemanda.parse({
    demanda: {
      ...e,
      fase: "registro",
      fase_alterada_em: ctx.agora,
      origem_ferramenta: ferramenta,
      origem_sessao: sessao,
      enviada: false,
      branch: branchDemanda(e.id),
    },
    tickets: [
      { demanda_id: e.id, ticket_id: 1, etapa: "demanda", status: "em_execucao", status_alterado_em: ctx.agora },
    ],
    decisoes: [],
    evidencias: [],
  });
}

/** CA-6 e CA-7: edita título, tipo ou descrição só antes do envio e só pela ferramenta e sessão autoras. */
export function editarDemanda(ag: AgregadoDemanda, entrada: unknown, autor: AutorDemanda): AgregadoDemanda {
  const e = EntradaEdicao.parse(entrada);
  const { demanda } = ag;
  if (demanda.enviada) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} já foi enviada e o conteúdo está congelado`,
      "só custos, decisões e evidências de etapas posteriores entram depois do envio",
    );
  }
  exigirAutoria(demanda, autor, "editar");
  return AgregadoDemanda.parse({
    ...ag,
    demanda: {
      ...demanda,
      titulo: e.titulo ?? demanda.titulo,
      tipo: e.tipo ?? demanda.tipo,
      descricao: e.descricao ?? demanda.descricao,
    },
  });
}

/** CA-2 e CA-3: sem as obrigatórias recusa listando todas; completa, congela e vai a `aprovacao_demanda`. */
export function enviarDemanda(ag: AgregadoDemanda, autor: AutorDemanda, ctx: ContextoDemanda): AgregadoDemanda {
  const { demanda } = ag;
  if (demanda.enviada) {
    throw new ErroDeRegra(`a demanda ${demanda.id} já foi enviada`, "aguarde a decisão do Auditor");
  }
  exigirAutoria(demanda, autor, "enviar");
  const pendentes = pendentesDeEnvio(ag);
  if (pendentes.length > 0) {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} não pode ser enviada: faltam as evidências ${pendentes.join(", ")}`,
      "submeta cada uma e envie de novo",
    );
  }
  return { ...ag, demanda: { ...demanda, enviada: true, fase: "aprovacao_demanda", fase_alterada_em: ctx.agora } };
}

/**
 * CA-4 e CA-5: o Auditor aprova (vai a `planejamento`) ou recusa com motivo (vai a `cancelada`, sem desenho interno).
 * A decisão e o fechamento do ticket da demanda andam juntos.
 */
export function decidirDemanda(
  ag: AgregadoDemanda,
  entrada: unknown,
  ator: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda {
  exigirAuditor(ator, "decidir a demanda");
  const e = EntradaDecisao.parse(entrada);
  const { demanda } = ag;
  if (demanda.fase !== "aprovacao_demanda") {
    throw new ErroDeRegra(
      `a demanda ${demanda.id} está em ${demanda.fase} e não espera decisão`,
      "decida só na fase aprovacao_demanda, depois do envio",
    );
  }
  const ticket = ag.tickets.find((t) => t.etapa === "demanda");
  if (ticket === undefined) {
    throw new ErroDeRegra(`a demanda ${demanda.id} não tem ticket de etapa demanda`, "registre a demanda de novo");
  }
  const decisao: DecisaoDemanda = {
    demanda_id: demanda.id,
    ticket_id: ticket.ticket_id,
    decisao_id: ag.decisoes.length + 1,
    resultado: e.aprovado ? "aprovado" : "recusado",
    ...(!e.aprovado && { motivo: e.motivo }),
    ...(e.nota !== undefined && { nota: e.nota }),
    por: "auditor",
    em: ctx.agora,
  };
  return {
    demanda: { ...demanda, fase: e.aprovado ? "planejamento" : "cancelada", fase_alterada_em: ctx.agora },
    tickets: ag.tickets.map((t) =>
      t === ticket ? { ...t, status: e.aprovado ? "concluido" : "cancelado", status_alterado_em: ctx.agora } : t,
    ),
    decisoes: [...ag.decisoes, decisao],
    evidencias: ag.evidencias,
  };
}
