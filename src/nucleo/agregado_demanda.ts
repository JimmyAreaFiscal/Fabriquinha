// Agregado puro da demanda SDLC (comparacao-sdlc-implementacao.md §7.2 e §7.4).
import { z } from "zod";
import { Ator, AtorExterno } from "./ator.ts";
import { ConfiguracaoAgente } from "./configuracao_agente.ts";
import { branchDemanda, branchRodada, CaminhoTicket, CriterioId, DemandaId } from "./demanda.ts";
import { ProgressoEncerramento } from "./encerramento_demanda.ts";
import {
  EtapaTicket,
  FaseDemanda,
  FaseRodada,
  Id,
  Instante,
  Markdown,
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
  // Quem criou o ticket; o `externo` não se grava (o banco guarda só o tipo e o trabalho).
  criado_por: Ator,
  // Só os tickets criados pelo plano os têm (§7.2); os de demanda e planejamento nascem sem eles.
  rodada_id: Id.optional(),
  titulo: Titulo.optional(),
  descricao: Markdown.optional(),
  configuracao_agente: ConfiguracaoAgente.optional(),
  // Instrução do Auditor ao reabrir um ticket falho; a sessão que o retomar a lê (§4.2).
  instrucao: Markdown.optional(),
  // Reprovações técnicas devolvidas ao agente (D05, no máximo 2) e o porquê de o ticket ter falhado.
  devolucoes: z.number().int().min(0).max(2).default(0),
  motivo_falha: Markdown.optional(),
  // Retomadas seguidas da Fabriquinha depois de falha de infraestrutura; a devolução e a reabertura zeram. Ausente é 0.
  retomadas_automaticas: z.number().int().min(0).optional(),
});

export const RodadaDemanda = z.object({
  demanda_id: DemandaId,
  rodada_id: Id,
  titulo: Titulo,
  fase: FaseRodada,
  e2e: z.boolean(),
  branch: z.string(),
});
const DependenciaRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, depende_rodada_id: Id });
const CriterioCitadoRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, criterio_id: CriterioId });
const DependenciaTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, depende_ticket_id: Id });
const CaminhoDoTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, caminho: CaminhoTicket });

export const DecisaoDemanda = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  decisao_id: Id,
  resultado: z.enum(["aprovado", "recusado"]),
  nota: z.number().int().min(1).max(5).optional(),
  motivo: Motivo.optional(),
  por: Ator,
  em: Instante,
});

/**
 * Os tipos do catálogo do agente, `custos_realizados` e `plano` (§4.1) e os quatro tipos de etapa novos. A lista é
 * literal: importar `evidencia_etapa.ts` ou `nucleo/schemas.ts` violaria o domínio; o teste garante que é a união
 * de `TipoEvidencia` com `TipoEvidenciaEtapa`.
 */
export const TipoEvidenciaAgregado = z.enum([
  "comportamento",
  "criterios_aceite",
  "desenho_solucao",
  "prototipo",
  "relatorio_complexidade",
  "relatorio_impactos_arquitetura",
  "execucao_testes",
  "matriz_fitness",
  "relatorio_sonar",
  "arquivos_alterados",
  "explicacao_fitness",
  "comprovacao_criterios",
  "mensagem_pr",
  "aula_codigo",
  "video_demonstracao",
  "relatorio_produtividade",
  "pr_aberto",
  "custos_realizados",
  "plano",
  "testes_estresse",
  "analise_seguranca",
  "arvore_prs_criterios_custos",
  "demonstracao_limpeza",
]);

/** Dono opcional: nulo e omitido viram `undefined`, a única representação interna (CA-11). */
export const IdDono = Id.nullish().transform((v) => v ?? undefined);

/** Evidência de qualquer dono: `rodada_id` e `ticket_id` nulos indicam a própria demanda; `dados` segue opaco (F3 valida). */
export const EvidenciaDemanda = z
  .object({
    demanda_id: DemandaId,
    rodada_id: IdDono,
    ticket_id: IdDono,
    tipo: TipoEvidenciaAgregado,
    dados: z.record(z.string(), z.json()),
    autor: Ator,
    em: Instante,
  })
  .refine((e) => e.rodada_id === undefined || e.ticket_id === undefined, {
    message: "rodada_id e ticket_id não podem estar preenchidos juntos (use só um dono)",
  });

export const TipoDemanda = z.enum(["funcionalidade", "problema"]);

export const Demanda = z
  .object({
    id: DemandaId,
    projeto: Slug,
    titulo: Titulo,
    tipo: TipoDemanda,
    descricao: Markdown,
    fase: FaseDemanda,
    fase_alterada_em: Instante,
    criada_por: AtorExterno,
    enviada: z.boolean(),
    branch: z.string(),
  })
  .refine((d) => d.branch === branchDemanda(d.id), {
    message: "a branch da demanda é fabriquinha/{id}",
    path: ["branch"],
  });

type DonoEvidencia = "demanda" | "rodada" | "ticket";

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
      if (t.motivo_falha !== undefined && t.status !== "falhou" && t.status !== "fechado")
        erro(`o ticket ${String(t.ticket_id)} só tem motivo_falha quando falhou ou fechado`);
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
export type TipoDemanda = z.infer<typeof TipoDemanda>;
export type AgregadoDemanda = z.infer<typeof AgregadoDemanda>;
