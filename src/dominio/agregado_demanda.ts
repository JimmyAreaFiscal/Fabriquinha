// Agregado puro da demanda SDLC (comparacao-sdlc-implementacao.md §7.2 e §7.4): convive com o agregado legado de issue.
import { z } from "zod";
import { Evidencia, TipoAtor, TipoIssue } from "./agregado.ts";
import { branchDemanda, DemandaId } from "./demanda.ts";
import { EtapaTicket, FaseDemanda, Id, Instante, Markdown, Motivo, Slug, StatusTicket, Titulo } from "./primitivos.ts";

export const TicketDemanda = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  etapa: EtapaTicket,
  status: StatusTicket,
  status_alterado_em: Instante,
});

export const DecisaoDemanda = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  decisao_id: Id,
  resultado: z.enum(["aprovado", "recusado"]),
  nota: z.number().int().min(1).max(5).optional(),
  motivo: Motivo.optional(),
  por: TipoAtor.extract(["auditor", "agente"]),
  em: Instante,
});

/** Evidência de qualquer dono: `rodada_id` e `ticket_id` nulos indicam a própria demanda; `dados` segue opaco (F3 valida). */
export const EvidenciaDemanda = z
  .object({
    demanda_id: DemandaId,
    rodada_id: Id.optional(),
    ticket_id: Id.optional(),
    tipo: Evidencia.shape.tipo,
    dados: Evidencia.shape.dados,
    em: Instante,
  })
  .refine((e) => e.rodada_id === undefined || e.ticket_id === undefined, {
    message: "rodada_id e ticket_id não podem estar preenchidos juntos (use só um dono)",
  });

export const Demanda = z
  .object({
    id: DemandaId,
    projeto: Slug,
    titulo: Titulo,
    tipo: TipoIssue,
    descricao: Markdown,
    fase: FaseDemanda,
    fase_alterada_em: Instante,
    origem_ferramenta: z.string().trim().min(1).max(200),
    origem_sessao: z.string().trim().min(1).max(200),
    enviada: z.boolean(),
    branch: z.string(),
  })
  .refine((d) => d.branch === branchDemanda(d.id), {
    message: "a branch da demanda é fabriquinha/{id}",
    path: ["branch"],
  });

export const DonoEvidencia = z.enum(["demanda", "rodada", "ticket"]);
export type DonoEvidencia = z.infer<typeof DonoEvidencia>;

/** Quem é dono da evidência: a rodada, o ticket ou, com ambos nulos, a própria demanda (CA-11). */
export const donoDe = (e: Pick<EvidenciaDemanda, "rodada_id" | "ticket_id">): DonoEvidencia =>
  e.rodada_id !== undefined ? "rodada" : e.ticket_id !== undefined ? "ticket" : "demanda";

const chave = (...partes: (string | number | undefined)[]): string => partes.map(String).join("/");

export const AgregadoDemanda = z
  .object({
    demanda: Demanda,
    tickets: z.array(TicketDemanda),
    decisoes: z.array(DecisaoDemanda),
    evidencias: z.array(EvidenciaDemanda),
  })
  .superRefine((ag, ctx) => {
    const erro = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    const id = ag.demanda.id;
    const tickets = new Set<number>();
    for (const t of ag.tickets) {
      if (t.demanda_id !== id) erro(`o ticket ${String(t.ticket_id)} é de outra demanda (${t.demanda_id})`);
      if (tickets.has(t.ticket_id)) erro(`o ticket ${String(t.ticket_id)} se repete`);
      tickets.add(t.ticket_id);
    }
    const decisoes = new Set<string>();
    for (const d of ag.decisoes) {
      const k = chave(d.demanda_id, d.ticket_id, d.decisao_id);
      if (d.demanda_id !== id) erro(`a decisão ${k} é de outra demanda`);
      if (!tickets.has(d.ticket_id)) erro(`a decisão ${k} cita o ticket ${String(d.ticket_id)}, que não existe`);
      if (decisoes.has(k)) erro(`a decisão ${k} se repete`);
      decisoes.add(k);
      if (d.resultado === "recusado" && d.motivo === undefined) erro(`a decisão ${k} recusada exige motivo`);
    }
    const evidencias = new Set<string>();
    for (const e of ag.evidencias) {
      const k = chave(e.tipo, e.rodada_id, e.ticket_id);
      if (e.demanda_id !== id) erro(`a evidência ${e.tipo} é de outra demanda (${e.demanda_id})`);
      if (e.ticket_id !== undefined && !tickets.has(e.ticket_id))
        erro(`a evidência ${e.tipo} cita o ticket ${String(e.ticket_id)}, que não existe`);
      if (evidencias.has(k)) erro(`há mais de uma evidência ativa ${e.tipo} para o mesmo dono (${donoDe(e)})`);
      evidencias.add(k);
    }
  });

export type TicketDemanda = z.infer<typeof TicketDemanda>;
export type DecisaoDemanda = z.infer<typeof DecisaoDemanda>;
export type EvidenciaDemanda = z.infer<typeof EvidenciaDemanda>;
export type Demanda = z.infer<typeof Demanda>;
export type AgregadoDemanda = z.infer<typeof AgregadoDemanda>;
