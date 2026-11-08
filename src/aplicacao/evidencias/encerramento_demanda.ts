// Evidências do encerramento final da demanda e texto do PR final (comparacao-sdlc-implementacao.md §5, CA-14 e CA-15).
// Só endereços públicos (D09): `I-206`, `I-206.R2`, `I-206.T3`.
import { type AgregadoDemanda, prDaDemanda } from "../../nucleo/agregado_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../nucleo/demanda.ts";
import { prDoEspaco } from "../../nucleo/espaco_de_trabalho.ts";
import { type ArvorePRsCriteriosCustos, DemonstracaoLimpeza } from "../../nucleo/schemas.ts";
import type { ProcessoDoTrabalho, TrabalhoGerenciado, UsoModeloExecucao } from "../../nucleo/trabalho_agentico.ts";
import { lista, neutro } from "./pr.ts";
import { produtividadeDaRodada } from "./produtividade_rodada.ts";

const situacao = (incompleto: boolean) => (incompleto ? ("incompleto" as const) : ("conhecido" as const));

interface CustoExterno {
  sessoes: { ferramenta: string; sessao: string; linhas: { custo: number | null }[] }[];
}

function idEUrlDoPrDaRodada(ag: AgregadoDemanda, rodada: number): { id: string; url: string } | null {
  const pr = prDoEspaco(ag, rodada);
  return pr ? { id: String(pr.numero), url: pr.url } : null;
}

export function montarArvorePRs(
  ag: AgregadoDemanda,
  sessoes: readonly TrabalhoGerenciado[],
  execucoes: readonly ProcessoDoTrabalho[],
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
  const prFinal = prDaDemanda(ag);
  // Sem parse: quem submete a evidência a valida pelo schema, e a recusa falha a Tentativa.
  return {
    demanda: ag.demanda.id,
    base: ag.encerramento?.base ?? null,
    pr_final: prFinal === undefined ? null : { numero: prFinal.numero, url: prFinal.url },
    sha_integracao: ag.encerramento?.integracao?.sha ?? null,
    rodadas: ag.rodadas.map((r) => ({
      rodada: formatarRodadaRef(r),
      titulo: r.titulo,
      pr: idEUrlDoPrDaRodada(ag, r.rodada_id),
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
  };
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
  });
}

/** `<feat|fix>: <titulo> [I-206]`. */
export const tituloDoPRFinal = (ag: AgregadoDemanda): string =>
  `${ag.demanda.tipo === "funcionalidade" ? "feat" : "fix"}: ${ag.demanda.titulo} [${ag.demanda.id}]`;

/** A marca invisível que reconhece o PR final depois de uma queda. */
export const marcaDoPRFinal = (demanda: string): string => `<!-- fabriquinha ${demanda} -->`;

export function corpoDoPRFinal(ag: AgregadoDemanda): string {
  const rodadas = ag.rodadas.map((r) => {
    const pr = idEUrlDoPrDaRodada(ag, r.rodada_id);
    return `${formatarRodadaRef(r)}: ${neutro(r.titulo)}${pr ? ` (${pr.url})` : ""}`;
  });
  return `${marcaDoPRFinal(ag.demanda.id)}\n\n## ${neutro(ag.demanda.titulo)} (${ag.demanda.id})\n\n## PRs das rodadas\n\n${lista(rodadas, "Nenhuma.")}\n`;
}
