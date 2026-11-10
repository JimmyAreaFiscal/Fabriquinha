// Planos e arquivos previstos (CONCEITOS.md §10): o plano proposto pelo planejador e o leitor do que já está gravado.
import { z } from "zod";
import { ConfiguracaoAgente } from "./configuracao_agente.ts";
import { CaminhoPrevisto, CriterioId, DemandaId, RodadaRef, TicketIdentidade, TicketRef } from "./demanda.ts";
import { GrafoDeDependencias } from "./item_de_trabalho.ts";
import { Markdown, Titulo } from "./primitivos.ts";

const ArquivosPrevistos = CaminhoPrevisto.array().default([]);

const Rodada = RodadaRef.extend({
  titulo: Titulo,
  e2e: z.boolean(),
  criterios: z.array(CriterioId).default([]),
  depende: z.array(RodadaRef).default([]),
  arquivos_previstos: ArquivosPrevistos,
});
const Ticket = TicketIdentidade.extend({
  titulo: Titulo,
  descricao: Markdown,
  arquivos_previstos: ArquivosPrevistos,
  depende: z.array(TicketRef).default([]),
  configuracao_agente: ConfiguracaoAgente.optional(),
});

/**
 * Plano flat de uma demanda: `criterios` são os `CA-n` da demanda; cada rodada e ticket carrega o seu `demanda_id`.
 * Os arquivos previstos existem nos três níveis, com Ticket ⊆ Rodada ⊆ Demanda (CONCEITOS.md §10).
 */
const DadosDoPlano = z.object({
  demanda_id: DemandaId,
  criterios: z.array(CriterioId),
  arquivos_previstos: ArquivosPrevistos,
  rodadas: z.array(Rodada),
  tickets: z.array(Ticket),
});
type DadosDoPlano = z.infer<typeof DadosDoPlano>;

/** Estrutura do plano: identidades, vínculos e dependências coerentes. */
const exigirEstruturaDoPlano = (plano: DadosDoPlano, ctx: z.core.$RefinementCtx): void => {
  const erro = (message: string) => {
    ctx.addIssue({ code: "custom", message });
  };
  const { demanda_id: demanda } = plano;
  const rodadas = new Set<number>();
  for (const r of plano.rodadas) {
    if (r.demanda_id !== demanda) erro(`a rodada ${String(r.rodada_id)} é de outra demanda (${r.demanda_id})`);
    if (rodadas.has(r.rodada_id)) erro(`a rodada ${String(r.rodada_id)} se repete`);
    rodadas.add(r.rodada_id);
  }
  for (const r of plano.rodadas) {
    for (const c of r.criterios) {
      if (!plano.criterios.includes(c)) erro(`a rodada ${String(r.rodada_id)} cita o ${c}, que a demanda não tem`);
    }
    for (const d of r.depende) {
      if (d.demanda_id !== demanda)
        erro(`a rodada ${String(r.rodada_id)} depende de rodada de outra demanda (${d.demanda_id})`);
      else if (d.rodada_id === r.rodada_id) erro(`a rodada ${String(r.rodada_id)} não pode depender de si mesma`);
      else if (!rodadas.has(d.rodada_id))
        erro(`a rodada ${String(r.rodada_id)} depende da rodada ${String(d.rodada_id)}, que não existe`);
    }
  }
  const cicloDeRodadas = new GrafoDeDependencias(
    plano.rodadas.flatMap((r) => r.depende.map((d): [number, number] => [r.rodada_id, d.rodada_id])),
    "as rodadas",
  ).descreverCiclo();
  if (cicloDeRodadas) erro(cicloDeRodadas);

  const tickets = new Map<number, number | undefined>();
  for (const t of plano.tickets) {
    if (t.demanda_id !== demanda) erro(`o ticket ${String(t.ticket_id)} é de outra demanda (${t.demanda_id})`);
    if (tickets.has(t.ticket_id)) erro(`o ticket ${String(t.ticket_id)} se repete`);
    if (new Set(t.arquivos_previstos).size !== t.arquivos_previstos.length)
      erro(`o ticket ${String(t.ticket_id)} repete caminho`);
    if (t.rodada_id !== undefined && !rodadas.has(t.rodada_id))
      erro(`o ticket ${String(t.ticket_id)} está na rodada ${String(t.rodada_id)}, que não existe`);
    tickets.set(t.ticket_id, t.rodada_id);
  }
  for (const r of plano.rodadas) {
    if (!plano.tickets.some((t) => t.rodada_id === r.rodada_id))
      erro(`a rodada ${String(r.rodada_id)} não tem ticket de implementação`);
  }
  for (const t of plano.tickets) {
    for (const d of t.depende) {
      const alvo = tickets.get(d.ticket_id);
      const nome = `o ticket ${String(t.ticket_id)} depende do ${String(d.ticket_id)}`;
      if (d.demanda_id !== demanda) erro(`${nome}, de outra demanda (${d.demanda_id})`);
      else if (d.ticket_id === t.ticket_id) erro(`o ticket ${String(t.ticket_id)} não pode depender de si mesmo`);
      else if (!tickets.has(d.ticket_id)) erro(`${nome}, que não existe`);
      else if (t.rodada_id === undefined || alvo === undefined)
        erro(`${nome}: ticket sem rodada não participa de dependência`);
      else if (t.rodada_id !== alvo) erro(`${nome}, de outra rodada`);
    }
  }
  const cicloDeTickets = new GrafoDeDependencias(
    plano.tickets.flatMap((t) => t.depende.map((d): [number, number] => [t.ticket_id, d.ticket_id])),
    "os tickets",
  ).descreverCiclo();
  if (cicloDeTickets) erro(cicloDeTickets);
};

/** Ticket ⊆ Rodada ⊆ Demanda: o motivo cita o arquivo e o nível que não o prevê. */
const exigirInclusaoDosArquivos = (plano: DadosDoPlano, ctx: z.core.$RefinementCtx): void => {
  const erro = (message: string) => {
    ctx.addIssue({ code: "custom", message });
  };
  const rodadas = new Map(plano.rodadas.map((r) => [r.rodada_id, r.arquivos_previstos]));
  for (const t of plano.tickets) {
    const daRodada = t.rodada_id === undefined ? undefined : rodadas.get(t.rodada_id);
    if (daRodada === undefined) continue; // sem rodada, a estrutura já recusa
    for (const arquivo of t.arquivos_previstos.filter((a) => !daRodada.includes(a))) {
      erro(
        `o arquivo ${arquivo} do ticket ${String(t.ticket_id)} não está nos arquivos previstos da rodada ${String(t.rodada_id)}`,
      );
    }
  }
  for (const r of plano.rodadas) {
    for (const arquivo of r.arquivos_previstos.filter((a) => !plano.arquivos_previstos.includes(a))) {
      erro(
        `o arquivo ${arquivo} da rodada ${String(r.rodada_id)} não está nos arquivos previstos da demanda ${plano.demanda_id}`,
      );
    }
  }
};

export const PlanoProposto = DadosDoPlano.superRefine(exigirEstruturaDoPlano).superRefine(exigirInclusaoDosArquivos);
export type PlanoProposto = z.infer<typeof PlanoProposto>;

const unicos = (listas: string[][]): string[] => [...new Set(listas.flat())];

const PlanoGravado = z.looseObject({
  arquivos_previstos: z.array(z.string()).optional(),
  rodadas: z.array(z.looseObject({ rodada_id: z.number(), arquivos_previstos: z.array(z.string()).optional() })),
  tickets: z.array(
    z.looseObject({
      rodada_id: z.number().optional(),
      caminhos: z.array(z.string()).optional(),
      arquivos_previstos: z.array(z.string()).optional(),
    }),
  ),
});

/**
 * Completa o plano que omite arquivos previstos: o plano antigo traz `caminhos` no ticket e nada em Rodada e Demanda;
 * aqui `caminhos` vira `arquivos_previstos` e Rodada e Demanda levam a união dos de baixo, o que satisfaz a inclusão
 * por construção. O que não tem a forma de plano segue intacto, para o `PlanoProposto` recusar com o motivo.
 */
export function completarArquivosPrevistos(dados: unknown): unknown {
  const gravado = PlanoGravado.safeParse(dados);
  if (!gravado.success) return dados;
  const tickets = gravado.data.tickets.map(({ caminhos, ...ticket }) => ({
    ...ticket,
    arquivos_previstos: ticket.arquivos_previstos ?? caminhos ?? [],
  }));
  const rodadas = gravado.data.rodadas.map((rodada) => ({
    ...rodada,
    arquivos_previstos:
      rodada.arquivos_previstos ??
      unicos(tickets.filter((t) => t.rodada_id === rodada.rodada_id).map((t) => t.arquivos_previstos)),
  }));
  return {
    ...gravado.data,
    rodadas,
    tickets,
    arquivos_previstos:
      gravado.data.arquivos_previstos ??
      unicos([...rodadas.map((r) => r.arquivos_previstos), ...tickets.map((t) => t.arquivos_previstos)]),
  };
}

/** Lê um plano que já está gravado (evidência aceita). Só a submissão usa o `PlanoProposto` estrito. */
export const lerPlanoGravado = (dados: unknown): PlanoProposto =>
  PlanoProposto.parse(completarArquivosPrevistos(dados));
