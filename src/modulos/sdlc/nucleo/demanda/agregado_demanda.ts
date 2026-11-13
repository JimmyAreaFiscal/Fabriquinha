// Agregado puro da demanda SDLC (comparacao-sdlc-implementacao.md §7.2 e §7.4).
import { z } from "zod";
import { Ator, AtorExterno } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { CICLO_DA_DEMANDA, EstadoDemanda, EstadoRodada } from "../ciclo_de_vida/ciclos.ts";
import { ConfiguracaoAgente } from "../../../compartilhado/nucleo/configuracao_agente.ts";
import {
  branchDemanda,
  branchRodada,
  CaminhoPrevisto,
  CriterioId,
  DemandaId,
} from "../../../compartilhado/nucleo/vocabulario_do_sdlc/identidades.ts";
import { ProgressoEncerramento } from "../transicoes/encerramento_demanda.ts";
import { PullRequest, prDoEscopo } from "../../../repositorio/nucleo/espaco_de_trabalho.ts";
import { donoDe, EvidenciaDemanda } from "../../../ciclo_de_vida/publico.ts";
import { GrafoDeDependencias } from "../item_de_trabalho/item_de_trabalho.ts";
import { OrigemDaVersao } from "./plano.ts";
import {
  EstadoTicket,
  Id,
  Instante,
  Markdown,
  Motivo,
  Slug,
  Titulo,
} from "../../../compartilhado/nucleo/primitivos.ts";
import { EtapaTicket, NomeGate, etapaDoPapel } from "../../../etapas/catalogo.ts";
import { Tentativa } from "../tentativa.ts";

export const TicketDemanda = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  etapa: EtapaTicket,
  estado: EstadoTicket,
  estado_alterado_em: Instante,
  // Quem criou o ticket; o `externo` não se grava (o banco guarda só o tipo e o trabalho).
  criado_por: Ator.refine((ator): boolean => ator.tipo !== "externo", {
    message: "o ticket não é criado por um ator externo",
  }),
  // Só os tickets criados pelo plano os têm (§7.2); os de demanda e planejamento nascem sem eles.
  rodada_id: Id.optional(),
  titulo: Titulo.optional(),
  descricao: Markdown.optional(),
  configuracao_agente: ConfiguracaoAgente.optional(),
  // Instrução do Auditor ao reabrir um ticket falho; a sessão que o retomar a lê (§4.2).
  instrucao: Markdown.optional(),
});

/** A Decisão sabe de qual gate é; mora aqui, e não em `gate.ts`, porque o agregado a contém e `gate.ts` o transforma. */
export const Decisao = z.object({
  demanda_id: DemandaId,
  ticket_id: Id,
  decisao_id: Id,
  gate: NomeGate,
  resultado: z.enum(["aprovado", "reprovado"]),
  nota: z.number().int().min(1).max(5).optional(),
  motivo: Motivo.optional(),
  por: Ator,
  em: Instante,
});
export type Decisao = z.infer<typeof Decisao>;

export const RodadaDemanda = z.object({
  demanda_id: DemandaId,
  rodada_id: Id,
  titulo: Titulo,
  estado: EstadoRodada,
  estado_alterado_em: Instante,
  e2e: z.boolean(),
  branch: z.string(),
});
/** O PR do Espaço da rodada ou, sem `rodada_id`, o PR final do Espaço da demanda. */
const PullRequestDoEspaco = PullRequest.extend({ rodada_id: Id.optional(), atualizado_em: Instante });
const DependenciaRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, depende_rodada_id: Id });
const CriterioCitadoRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, criterio_id: CriterioId });
const DependenciaTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, depende_ticket_id: Id });
const CaminhoDoTicket = z.object({ demanda_id: DemandaId, ticket_id: Id, caminho: CaminhoPrevisto });
const ArquivoPrevistoRodada = z.object({ demanda_id: DemandaId, rodada_id: Id, caminho: CaminhoPrevisto });
const ArquivoPrevistoDemanda = z.object({ demanda_id: DemandaId, caminho: CaminhoPrevisto });

/** Uma versão do Plano: 1 é o plano aprovado; as seguintes são correções, com o `dados` de cada uma (`plano.ts`). */
const VersaoPlano = z.object({
  demanda_id: DemandaId,
  numero: Id,
  origem: OrigemDaVersao,
  autor: Ator,
  // A rodada que a correção atinge; ausente na aprovação e nas rodadas corretivas novas.
  rodada_id: Id.optional(),
  criada_em: Instante,
  dados: z.record(z.string(), z.json()),
});

export const TipoDemanda = z.enum(["funcionalidade", "problema"]);

export const Demanda = z
  .object({
    id: DemandaId,
    projeto: Slug,
    titulo: Titulo,
    tipo: TipoDemanda,
    descricao: Markdown,
    estado: EstadoDemanda,
    estado_alterado_em: Instante,
    criada_por: AtorExterno,
    enviada: z.boolean(),
    branch: z.string(),
  })
  .refine((d) => d.branch === branchDemanda(d.id), {
    message: "a branch da demanda é fabriquinha/{id}",
    path: ["branch"],
  });

// provisório: remover no ticket 22 (a Evidência registrada mudou para src/modulos/ciclo_de_vida/evidencias/)
export { donoDe, EvidenciaDemanda };

/** O PR do Espaço da demanda: o PR final do encerramento. */
export const prDaDemanda = (ag: Pick<AgregadoDemanda, "pull_requests">): PullRequestDoEspaco | undefined =>
  prDoEscopo(ag.pull_requests, undefined);

/** O PR do Espaço da rodada troca o anterior da mesma rodada e mantém os demais. */
export const comPrDaRodada = (
  ag: Pick<AgregadoDemanda, "pull_requests">,
  rodada_id: number,
  pr: Omit<PullRequestDoEspaco, "rodada_id">,
): PullRequestDoEspaco[] => [...ag.pull_requests.filter((p) => p.rodada_id !== rodada_id), { ...pr, rodada_id }];

const chave = (...partes: (string | number | undefined)[]): string => partes.map(String).join("/");

export const AgregadoDemanda = z
  .object({
    demanda: Demanda,
    tickets: z.array(TicketDemanda),
    decisoes: z.array(Decisao),
    evidencias: z.array(EvidenciaDemanda),
    // Estado materializado pela aprovação do planejamento e pelas correções (`materializar`, em `plano.ts`).
    rodadas: z.array(RodadaDemanda).default([]),
    dependencias_rodada: z.array(DependenciaRodada).default([]),
    criterios_citados: z.array(CriterioCitadoRodada).default([]),
    dependencias_ticket: z.array(DependenciaTicket).default([]),
    caminhos_ticket: z.array(CaminhoDoTicket).default([]),
    // Os arquivos previstos dos outros dois níveis (CONCEITOS.md §10), com Ticket ⊆ Rodada ⊆ Demanda.
    arquivos_previstos_rodada: z.array(ArquivoPrevistoRodada).default([]),
    arquivos_previstos_demanda: z.array(ArquivoPrevistoDemanda).default([]),
    versoes_plano: z.array(VersaoPlano).default([]),
    // As execuções das etapas, na ordem; os limites e a retomada derivam delas (D05).
    tentativas: z.array(Tentativa).default([]),
    encerramento: ProgressoEncerramento.optional(),
    pull_requests: z.array(PullRequestDoEspaco).default([]),
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
      rodadaDe.set(t.ticket_id, t.rodada_id);
    }
    const tickets = new Set(rodadaDe.keys());
    for (const t of ag.tentativas) {
      if (t.ticket.demanda_id !== id || !tickets.has(Number(t.ticket.ticket_id)))
        erro(`a Tentativa ${String(t.numero)} cita o ticket ${t.ticket.toString()}, que não existe na demanda ${id}`);
    }
    for (const l of [
      ...ag.dependencias_rodada,
      ...ag.criterios_citados,
      ...ag.dependencias_ticket,
      ...ag.caminhos_ticket,
      ...ag.arquivos_previstos_rodada,
      ...ag.arquivos_previstos_demanda,
      ...ag.versoes_plano,
    ]) {
      if (l.demanda_id !== id) erro(`um vínculo é de outra demanda (${l.demanda_id})`);
    }
    for (const d of ag.dependencias_rodada) {
      if (d.rodada_id === d.depende_rodada_id) erro(`a rodada ${String(d.rodada_id)} não pode depender de si mesma`);
      if (!rodadas.has(d.rodada_id) || !rodadas.has(d.depende_rodada_id))
        erro(`a dependência da rodada ${String(d.rodada_id)} cita rodada que não existe`);
    }
    const cicloDeRodadas = GrafoDeDependencias.dasRodadas(ag).descreverCiclo();
    if (cicloDeRodadas) erro(cicloDeRodadas);
    for (const c of ag.criterios_citados) {
      if (!rodadas.has(c.rodada_id)) erro(`o ${c.criterio_id} cita a rodada ${String(c.rodada_id)}, que não existe`);
    }
    for (const c of ag.caminhos_ticket) {
      if (!tickets.has(c.ticket_id))
        erro(`o caminho ${c.caminho} cita o ticket ${String(c.ticket_id)}, que não existe`);
    }
    for (const a of ag.arquivos_previstos_rodada) {
      if (!rodadas.has(a.rodada_id))
        erro(`o arquivo previsto ${a.caminho} cita a rodada ${String(a.rodada_id)}, que não existe`);
    }
    for (const v of ag.versoes_plano) {
      if (v.rodada_id !== undefined && !rodadas.has(v.rodada_id))
        erro(`a versão ${String(v.numero)} do plano cita a rodada ${String(v.rodada_id)}, que não existe`);
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
    const cicloDeTickets = GrafoDeDependencias.dosTickets(ag).descreverCiclo();
    if (cicloDeTickets) erro(cicloDeTickets);
    const rodadasComPr = new Set<number | undefined>();
    for (const pr of ag.pull_requests) {
      if (pr.rodada_id !== undefined && !rodadas.has(pr.rodada_id))
        erro(`o PR ${String(pr.numero)} cita a rodada ${String(pr.rodada_id)}, que não existe`);
      if (rodadasComPr.has(pr.rodada_id)) erro(`há mais de um PR para o mesmo Espaço (${String(pr.rodada_id ?? id)})`);
      rodadasComPr.add(pr.rodada_id);
    }
    const enc = ag.encerramento;
    if (enc !== undefined) {
      if (enc.integracao !== undefined && prDaDemanda(ag) === undefined) erro("a integração exige o PR final");
      const integradora = etapaDoPapel("integra_a_demanda");
      if (ag.demanda.estado !== integradora && !CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado))
        erro(`o progresso do encerramento só existe nos estados ${integradora}, concluida, cancelada e arquivada`);
      if (enc.demanda_id !== id) erro(`o progresso do encerramento é de outra demanda (${enc.demanda_id})`);
      const conflito = enc.conflito_pendente?.ticket_id;
      const resolucaoDoConflito = etapaDoPapel("resolve_o_conflito_da_integracao");
      if (
        conflito !== undefined &&
        !ag.tickets.some((t) => t.ticket_id === conflito && t.etapa === resolucaoDoConflito)
      )
        erro(`o conflito pendente cita o ticket ${String(conflito)}, que não é um ${resolucaoDoConflito} existente`);
    }
    const decisoes = new Set<string>();
    for (const d of ag.decisoes) {
      const k = chave(d.demanda_id, d.ticket_id, d.decisao_id);
      if (d.demanda_id !== id) erro(`a decisão ${k} é de outra demanda`);
      if (!tickets.has(d.ticket_id)) erro(`a decisão ${k} cita o ticket ${String(d.ticket_id)}, que não existe`);
      if (decisoes.has(k)) erro(`a decisão ${k} se repete`);
      decisoes.add(k);
      if (d.resultado === "reprovado" && d.motivo === undefined) erro(`a decisão ${k} reprovada exige motivo`);
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

export type PullRequestDoEspaco = z.infer<typeof PullRequestDoEspaco>;
export type RodadaDemanda = z.infer<typeof RodadaDemanda>;
export type TicketDemanda = z.infer<typeof TicketDemanda>;
export type Demanda = z.infer<typeof Demanda>;
export type TipoDemanda = z.infer<typeof TipoDemanda>;
export type AgregadoDemanda = z.infer<typeof AgregadoDemanda>;
