// Evidências do encerramento final da demanda e texto do PR final (comparacao-sdlc-implementacao.md §5, CA-14 e CA-15).
// Só endereços públicos (D09): `I-206`, `I-206.R2`, `I-206.T3`.
import { z } from "zod";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../dominio/demanda.ts";
import type { ExecucaoSessao, Sessao, UsoModeloExecucao } from "../dominio/sessoes.ts";
import { lista, neutro } from "./pr.ts";
import { produtividadeDaRodada } from "./produtividade_rodada.ts";

const Custo = z.strictObject({
  valor: z.number().nonnegative(),
  // `incompleto`: o valor é só um piso, há consumo sem custo medido.
  situacao: z.enum(["conhecido", "incompleto"]),
});
const Texto = z.string().min(1);

export const ArvorePRsCriteriosCustos = z.strictObject({
  demanda: Texto,
  base: Texto.nullable(),
  pr_final: z.strictObject({ numero: z.number().int().positive(), url: Texto }).nullable(),
  sha_integracao: Texto.nullable(),
  rodadas: z.array(
    z.strictObject({
      rodada: Texto,
      titulo: Texto,
      pr: z.strictObject({ id: Texto, url: Texto }).nullable(),
      criterios: z.array(Texto),
      tickets: z.array(z.strictObject({ ticket: Texto, etapa: Texto, custo: Custo })),
    }),
  ),
  // Tickets que não são de rodada (demanda, planejamento, encerramento).
  tickets_sem_rodada: z.array(z.strictObject({ ticket: Texto, etapa: Texto, custo: Custo })),
  // Dois totais que nunca se somam: o interno vem das execuções da Fabriquinha, o externo de `custos_realizados`.
  custos: z.strictObject({
    internos: Custo,
    externos: z.strictObject({
      sessoes: z.array(z.strictObject({ ferramenta: Texto, sessao: Texto, custo: Custo })),
      total: Custo,
    }),
  }),
});
export type ArvorePRsCriteriosCustos = z.infer<typeof ArvorePRsCriteriosCustos>;

const ItemLimpeza = z.strictObject({
  tipo: z.enum(["worktree", "branch_local", "branch_remota"]),
  alvo: Texto,
});
export const DemonstracaoLimpeza = z.strictObject({
  removidas: z.array(ItemLimpeza),
  sobras: z.array(ItemLimpeza),
  // Regra `nada_sobrou`.
  aprovada: z.boolean(),
});
export type DemonstracaoLimpeza = z.infer<typeof DemonstracaoLimpeza>;

const situacao = (incompleto: boolean) => (incompleto ? ("incompleto" as const) : ("conhecido" as const));

interface CustoExterno {
  sessoes: { ferramenta: string; sessao: string; linhas: { custo: number | null }[] }[];
}

/** O PR do último `encerrar_rodada` da rodada que publicou um (o ticket de maior id pode ainda não ter publicado). */
function prDaRodada(ag: AgregadoDemanda, rodada: number): { id: string; url: string } | null {
  const ids = ag.tickets.filter((t) => t.rodada_id === rodada && t.etapa === "encerrar_rodada").map((t) => t.ticket_id);
  const pr = ag.evidencias.findLast((e) => e.tipo === "pr_aberto" && ids.some((id) => id === e.ticket_id));
  return pr ? { id: (pr.dados as { id: string }).id, url: (pr.dados as { url: string }).url } : null;
}

export function montarArvorePRs(
  ag: AgregadoDemanda,
  sessoes: readonly Sessao[],
  execucoes: readonly ExecucaoSessao[],
  usos: readonly UsoModeloExecucao[],
): ArvorePRsCriteriosCustos {
  const relatorio = produtividadeDaRodada(sessoes, execucoes, usos, ag.tickets);
  // Ticket conduzido sem agente (sem sessão) não consumiu nada: custo zero conhecido, não incompleto.
  const comSessao = new Set(
    sessoes
      .filter((s) => s.demanda_id === ag.demanda.id)
      .map((s) => formatarTicketRef({ demanda_id: s.demanda_id, ticket_id: s.ticket_id })),
  );
  const internos = {
    tickets: relatorio.tickets.map((t) => ({ ...t, custoIncompleto: t.custoIncompleto && comSessao.has(t.ticket) })),
    total: { custo: relatorio.total.custo, custoIncompleto: false },
  };
  internos.total.custoIncompleto = internos.tickets.some((t) => t.custoIncompleto);
  const rodadaDe = new Map(ag.tickets.map((t) => [formatarTicketRef(t), t.rodada_id]));
  const doRodada = (rodada: number | undefined) =>
    internos.tickets
      .filter((t) => rodadaDe.get(t.ticket) === rodada)
      .map((t) => ({
        ticket: t.ticket,
        etapa: t.etapa,
        custo: { valor: t.custo, situacao: situacao(t.custoIncompleto) },
      }));
  const externos = ag.evidencias
    .filter((e) => e.tipo === "custos_realizados")
    .flatMap((e) => (e.dados as unknown as CustoExterno).sessoes)
    .map(({ ferramenta, sessao, linhas }) => ({
      ferramenta,
      sessao,
      custo: {
        valor: linhas.reduce((n, l) => n + (l.custo ?? 0), 0),
        // Linha sem custo (null) é desconhecida, nunca zero.
        situacao: situacao(linhas.some((l) => l.custo === null)),
      },
    }));
  return ArvorePRsCriteriosCustos.parse({
    demanda: ag.demanda.id,
    base: ag.encerramento?.base ?? null,
    pr_final: ag.encerramento?.pr ?? null,
    sha_integracao: ag.encerramento?.integracao?.sha ?? null,
    rodadas: ag.rodadas.map((r) => ({
      rodada: formatarRodadaRef(r),
      titulo: r.titulo,
      pr: prDaRodada(ag, r.rodada_id),
      criterios: ag.criterios_citados.filter((c) => c.rodada_id === r.rodada_id).map((c) => c.criterio_id),
      tickets: doRodada(r.rodada_id),
    })),
    tickets_sem_rodada: doRodada(undefined),
    custos: {
      internos: { valor: internos.total.custo, situacao: situacao(internos.total.custoIncompleto) },
      externos: {
        sessoes: externos,
        total: {
          valor: externos.reduce((n, s) => n + s.custo.valor, 0),
          situacao: situacao(externos.some((s) => s.custo.situacao === "incompleto")),
        },
      },
    },
  });
}

/** As pendências `tipo:alvo` da limpeza, separadas em removidas e sobras. */
export function montarDemonstracaoLimpeza(
  removidos: readonly string[],
  sobras: readonly string[],
): DemonstracaoLimpeza {
  const item = (texto: string) => {
    const i = texto.indexOf(":");
    return { tipo: texto.slice(0, i), alvo: texto.slice(i + 1) };
  };
  return DemonstracaoLimpeza.parse({
    removidas: removidos.map(item),
    sobras: sobras.map(item),
    aprovada: sobras.length === 0,
  });
}

/** `<feat|fix>: <titulo> [I-206]`. */
export const tituloDoPRFinal = (ag: AgregadoDemanda): string =>
  `${ag.demanda.tipo === "funcionalidade" ? "feat" : "fix"}: ${ag.demanda.titulo} [${ag.demanda.id}]`;

/** A marca invisível que reconhece o PR final depois de uma queda. */
export const marcaDoPRFinal = (demanda: string): string => `<!-- fabriquinha ${demanda} -->`;

export function corpoDoPRFinal(ag: AgregadoDemanda): string {
  const rodadas = ag.rodadas.map((r) => {
    const pr = prDaRodada(ag, r.rodada_id);
    return `${formatarRodadaRef(r)}: ${neutro(r.titulo)}${pr ? ` (${pr.url})` : ""}`;
  });
  return `${marcaDoPRFinal(ag.demanda.id)}\n\n## ${neutro(ag.demanda.titulo)} (${ag.demanda.id})\n\n## PRs das rodadas\n\n${lista(rodadas, "Nenhuma.")}\n`;
}
