// Agregado puro da demanda SDLC (comparacao-sdlc-implementacao.md §7.2 e §7.4): convive com o agregado legado de issue.
import { z } from "zod";
import { Evidencia, TipoAtor, TipoEvidencia, TipoIssue } from "./agregado.ts";
import { branchDemanda, branchRodada, CaminhoTicket, CriterioId, DemandaId } from "./demanda.ts";
import { ProgressoEncerramento } from "./encerramento_demanda.ts";
import {
  Effort,
  EtapaTicket,
  FaseDemanda,
  FaseRodada,
  Id,
  Instante,
  Markdown,
  Modelo,
  Motivo,
  Slug,
  StatusTicket,
  Titulo,
} from "./primitivos.ts";

export const TicketDemanda = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  etapa: EtapaTicket,
  status: StatusTicket,
  status_alterado_em: Instante,
  // Só os tickets criados pelo plano os têm (§7.2); os de demanda e planejamento nascem sem eles.
  rodada_id: Id.optional(),
  titulo: Titulo.optional(),
  descricao: Markdown.optional(),
  modelo_provedor: Modelo.shape.provedor.optional(),
  modelo_nome: Modelo.shape.modelo.optional(),
  effort: Effort.optional(),
  // Instrução do Auditor ao reabrir um ticket falho; a sessão que o retomar a lê (§4.2).
  instrucao: Markdown.optional(),
});

export const RodadaDemanda = z.object({
  demanda_id: DemandaId,
  rodada_id: Id,
  titulo: Titulo,
  fase: FaseRodada,
  e2e: z.boolean(),
  branch: z.string(),
});
export const DependenciaRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, depende_rodada_id: Id });
export const CriterioCitadoRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, criterio_id: CriterioId });
export const DependenciaTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, depende_ticket_id: Id });
export const CaminhoDoTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, caminho: CaminhoTicket });

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

/** Os tipos legados mais `custos_realizados` e `plano` (do ticket de planejamento), que só a demanda SDLC conhece (§4.1). */
export const TipoEvidenciaAgregado = z.enum([...TipoEvidencia.options, "custos_realizados", "plano"]);

/** Dono opcional: nulo e omitido viram `undefined`, a única representação interna (CA-11). */
export const IdDono = Id.nullish().transform((v) => v ?? undefined);

/** Evidência de qualquer dono: `rodada_id` e `ticket_id` nulos indicam a própria demanda; `dados` segue opaco (F3 valida). */
export const EvidenciaDemanda = z
  .object({
    demanda_id: DemandaId,
    rodada_id: IdDono,
    ticket_id: IdDono,
    tipo: TipoEvidenciaAgregado,
    dados: Evidencia.shape.dados,
    em: Instante,
  })
  .refine((e) => e.rodada_id === undefined || e.ticket_id === undefined, {
    message: "rodada_id e ticket_id não podem estar preenchidos juntos (use só um dono)",
  });

/** Identidade da ferramenta ou sessão: a mesma regra no registro e em toda operação autorizada por autoria. */
export const IdentidadeOrigem = z.string().trim().min(1).max(200);

export const Demanda = z
  .object({
    id: DemandaId,
    projeto: Slug,
    titulo: Titulo,
    tipo: TipoIssue,
    descricao: Markdown,
    fase: FaseDemanda,
    fase_alterada_em: Instante,
    origem_ferramenta: IdentidadeOrigem,
    origem_sessao: IdentidadeOrigem,
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
    // Estado materializado pela aprovação do planejamento; o `Plano` em si só existe como evidência.
    rodadas: z.array(RodadaDemanda).default([]),
    dependencias_rodada: z.array(DependenciaRodada).default([]),
    criterios_citados: z.array(CriterioCitadoRodada).default([]),
    dependencias_ticket: z.array(DependenciaTicket).default([]),
    caminhos_ticket: z.array(CaminhoDoTicket).default([]),
    encerramento: ProgressoEncerramento.optional(),
  })
  .superRefine((ag, ctx) => {
    const erro = (message: string) => {
      ctx.addIssue({ code: "custom", message });
    };
    const id = ag.demanda.id;
    const rodadas = new Set<number>();
    for (const r of ag.rodadas) {
      if (r.demanda_id !== id) erro(`a rodada ${String(r.rodada_id)} é de outra demanda (${r.demanda_id})`);
      if (rodadas.has(r.rodada_id)) erro(`a rodada ${String(r.rodada_id)} se repete`);
      if (r.branch !== branchRodada(r.demanda_id, r.rodada_id))
        erro(`a branch da rodada ${String(r.rodada_id)} é ${branchRodada(r.demanda_id, r.rodada_id)}`);
      rodadas.add(r.rodada_id);
    }
    const rodadaDe = new Map<number, number | undefined>();
    for (const t of ag.tickets) {
      if (t.demanda_id !== id) erro(`o ticket ${String(t.ticket_id)} é de outra demanda (${t.demanda_id})`);
      if (rodadaDe.has(t.ticket_id)) erro(`o ticket ${String(t.ticket_id)} se repete`);
      if (t.rodada_id !== undefined && !rodadas.has(t.rodada_id))
        erro(`o ticket ${String(t.ticket_id)} cita a rodada ${String(t.rodada_id)}, que não existe`);
      if ((t.modelo_provedor === undefined) !== (t.modelo_nome === undefined))
        erro(`o ticket ${String(t.ticket_id)} precisa de modelo_provedor e modelo_nome juntos`);
      rodadaDe.set(t.ticket_id, t.rodada_id);
    }
    const tickets = new Set(rodadaDe.keys());
    for (const l of [
      ...ag.dependencias_rodada,
      ...ag.criterios_citados,
      ...ag.dependencias_ticket,
      ...ag.caminhos_ticket,
    ]) {
      if (l.demanda_id !== id) erro(`um vínculo é de outra demanda (${l.demanda_id})`);
    }
    for (const d of ag.dependencias_rodada) {
      if (d.rodada_id === d.depende_rodada_id) erro(`a rodada ${String(d.rodada_id)} não pode depender de si mesma`);
      if (!rodadas.has(d.rodada_id) || !rodadas.has(d.depende_rodada_id))
        erro(`a dependência da rodada ${String(d.rodada_id)} cita rodada que não existe`);
    }
    for (const c of ag.criterios_citados) {
      if (!rodadas.has(c.rodada_id)) erro(`o ${c.criterio_id} cita a rodada ${String(c.rodada_id)}, que não existe`);
    }
    for (const c of ag.caminhos_ticket) {
      if (!tickets.has(c.ticket_id))
        erro(`o caminho ${c.caminho} cita o ticket ${String(c.ticket_id)}, que não existe`);
    }
    for (const d of ag.dependencias_ticket) {
      const nome = `a dependência do ticket ${String(d.ticket_id)} no ${String(d.depende_ticket_id)}`;
      const rodada = rodadaDe.get(d.ticket_id);
      if (d.ticket_id === d.depende_ticket_id) erro(`o ticket ${String(d.ticket_id)} não pode depender de si mesmo`);
      else if (!tickets.has(d.ticket_id) || !tickets.has(d.depende_ticket_id))
        erro(`${nome} cita ticket que não existe`);
      else if (rodada === undefined || rodada !== rodadaDe.get(d.depende_ticket_id))
        erro(`${nome} exige a mesma rodada`);
    }
    const enc = ag.encerramento;
    if (enc !== undefined) {
      if (!["encerramento", "concluida", "cancelada", "arquivada"].includes(ag.demanda.fase))
        erro("o progresso do encerramento só existe nas fases encerramento, concluida, cancelada e arquivada");
      if (enc.demanda_id !== id) erro(`o progresso do encerramento é de outra demanda (${enc.demanda_id})`);
      const conflito = enc.conflito_pendente?.ticket_id;
      if (
        conflito !== undefined &&
        !ag.tickets.some((t) => t.ticket_id === conflito && t.etapa === "resolver_conflito")
      )
        erro(`o conflito pendente cita o ticket ${String(conflito)}, que não é um resolver_conflito existente`);
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

export type RodadaDemanda = z.infer<typeof RodadaDemanda>;
export type TicketDemanda = z.infer<typeof TicketDemanda>;
export type DecisaoDemanda = z.infer<typeof DecisaoDemanda>;
export type EvidenciaDemanda = z.infer<typeof EvidenciaDemanda>;
export type Demanda = z.infer<typeof Demanda>;
export type AgregadoDemanda = z.infer<typeof AgregadoDemanda>;
