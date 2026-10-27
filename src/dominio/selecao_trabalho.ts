// Seleção determinística de trabalho da demanda SDLC (comparacao-sdlc-implementacao.md §4.1): o agente não escolhe.
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import type { FaseRodada } from "./primitivos.ts";
import { podeTentarEncerramento } from "./transicoes_encerramento.ts";

const ETAPA_DA_RODADA: Partial<Record<FaseRodada, TicketDemanda["etapa"]>> = {
  desenvolvimento: "implementar",
  revisao: "revisar_rodada",
  encerramento: "encerrar_rodada",
};

const menorAberto = (ag: AgregadoDemanda, etapa: TicketDemanda["etapa"]): TicketDemanda[] =>
  ag.tickets
    .filter((t) => t.etapa === etapa && t.status === "aberto")
    .sort((a, b) => a.ticket_id - b.ticket_id)
    .slice(0, 1);

/** Fora de `execucao`, o `aberto` de menor id da etapa da fase; em `execucao`, um ticket por rodada livre (a etapa da fase da rodada). */
export function selecionarTrabalho(ag: AgregadoDemanda, predecessorasSatisfeitas: boolean): TicketDemanda[] {
  switch (ag.demanda.fase) {
    case "planejamento":
      return predecessorasSatisfeitas ? menorAberto(ag, "planejar") : [];
    case "revisao_demanda":
      return ag.rodadas.every((r) => r.fase === "concluida") ? menorAberto(ag, "revisar_demanda") : [];
    case "encerramento":
      return [
        ...(podeTentarEncerramento(ag) ? menorAberto(ag, "encerrar_demanda") : []),
        ...menorAberto(ag, "resolver_conflito"),
      ];
    case "execucao":
      return selecionarExecucao(ag);
    default:
      return [];
  }
}

function selecionarExecucao(ag: AgregadoDemanda): TicketDemanda[] {
  const status = new Map(ag.tickets.map((t) => [t.ticket_id, t.status]));
  const ocupado = (t: TicketDemanda) => t.status === "falhou" || t.status === "em_execucao";
  if (ag.tickets.some((t) => t.rodada_id === undefined && ocupado(t))) return [];
  const concluida = new Set(ag.rodadas.filter((r) => r.fase === "concluida").map((r) => r.rodada_id));
  const escolhidos: TicketDemanda[] = [];
  for (const rodada of ag.rodadas) {
    const etapa = ETAPA_DA_RODADA[rodada.fase];
    const daRodada = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id);
    const livre =
      ag.dependencias_rodada
        .filter((d) => d.rodada_id === rodada.rodada_id)
        .every((d) => concluida.has(d.depende_rodada_id)) && !daRodada.some(ocupado);
    const pronto = daRodada
      .filter(
        (t) =>
          t.etapa === etapa &&
          t.status === "aberto" &&
          ag.dependencias_ticket
            .filter((d) => d.ticket_id === t.ticket_id)
            .every((d) => status.get(d.depende_ticket_id) === "concluido"),
      )
      .sort((a, b) => a.ticket_id - b.ticket_id)[0];
    if (livre && pronto !== undefined) escolhidos.push(pronto);
  }
  return escolhidos;
}

const numeroDaDemanda = (id: string): [number, string] => {
  const i = id.lastIndexOf("-");
  return [Number(id.slice(i + 1)), id.slice(0, i)];
};

/** Junta os elegíveis das demandas e devolve no máximo as vagas livres, por demanda (número, prefixo), rodada e ticket. */
export function selecionarTrabalhoGlobal(
  demandas: { agregado: AgregadoDemanda; predecessoras_satisfeitas: boolean }[],
  { limite, emAndamento }: { limite: number; emAndamento: number },
): TicketDemanda[] {
  return demandas
    .flatMap((d) => selecionarTrabalho(d.agregado, d.predecessoras_satisfeitas))
    .sort((a, b) => {
      const [na, pa] = numeroDaDemanda(a.demanda_id);
      const [nb, pb] = numeroDaDemanda(b.demanda_id);
      return na - nb || pa.localeCompare(pb) || (a.rodada_id ?? 0) - (b.rodada_id ?? 0) || a.ticket_id - b.ticket_id;
    })
    .slice(0, Math.max(0, limite - emAndamento));
}
