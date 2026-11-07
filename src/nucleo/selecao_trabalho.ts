// Seleção determinística de trabalho da demanda SDLC (comparacao-sdlc-implementacao.md §4.1): o agente não escolhe.
import type { AgregadoDemanda, TicketDemanda } from "./agregado_demanda.ts";
import { etapaDoEstado } from "./ciclos.ts";
import { Endereco, estaOcupado, GrafoDeDependencias } from "./item_de_trabalho.ts";
import type { EstadoRodada } from "./primitivos.ts";
import { podeTentarEncerramento } from "./transicoes_encerramento.ts";

// O gate e a sessão esperam por gente: o agendador não despacha o ticket deles.
const ESTADOS_QUE_ESPERAM_GENTE: readonly EstadoRodada[] = ["gate_pr", "ajustar_resultado"];

const menorAberto = (ag: AgregadoDemanda, etapa: TicketDemanda["etapa"] | undefined): TicketDemanda[] =>
  ag.tickets
    .filter((t) => t.etapa === etapa && t.estado === "aberto")
    .sort((a, b) => a.ticket_id - b.ticket_id)
    .slice(0, 1);

/** Fora de `em_execucao`, o `aberto` de menor id da etapa do estado; em `em_execucao`, um ticket por rodada livre (a etapa do estado da rodada). */
export function selecionarTrabalho(ag: AgregadoDemanda, predecessorasSatisfeitas: boolean): TicketDemanda[] {
  const { estado } = ag.demanda;
  switch (estado) {
    case "planejar":
      return predecessorasSatisfeitas ? menorAberto(ag, etapaDoEstado(estado)) : [];
    case "revisar_demanda":
      return ag.rodadas.every((r) => r.estado === "concluida") ? menorAberto(ag, etapaDoEstado(estado)) : [];
    case "encerrar_demanda":
      return [
        ...(podeTentarEncerramento(ag) ? menorAberto(ag, etapaDoEstado(estado)) : []),
        ...menorAberto(ag, "resolver_conflito"),
      ];
    case "em_execucao":
      return selecionarExecucao(ag);
    default:
      return [];
  }
}

function selecionarExecucao(ag: AgregadoDemanda): TicketDemanda[] {
  const estadoPorTicket = new Map(ag.tickets.map((t) => [t.ticket_id, t.estado]));
  const dependenciasDasRodadas = GrafoDeDependencias.dasRodadas(ag);
  const dependenciasDosTickets = GrafoDeDependencias.dosTickets(ag);
  if (estaOcupado(ag, Endereco.daDemanda(ag.demanda.id))) return [];
  const concluida = new Set(ag.rodadas.filter((r) => r.estado === "concluida").map((r) => r.rodada_id));
  const escolhidos: TicketDemanda[] = [];
  for (const rodada of ag.rodadas) {
    const etapa = ESTADOS_QUE_ESPERAM_GENTE.includes(rodada.estado) ? undefined : etapaDoEstado(rodada.estado);
    const daRodada = ag.tickets.filter((t) => t.rodada_id === rodada.rodada_id);
    const livre =
      dependenciasDasRodadas.pendentes(rodada.rodada_id, (dependencia) => concluida.has(dependencia)).length === 0 &&
      !estaOcupado(ag, Endereco.daRodada(ag.demanda.id, rodada.rodada_id));
    const pronto = daRodada
      .filter(
        (t) =>
          t.etapa === etapa &&
          t.estado === "aberto" &&
          dependenciasDosTickets.pendentes(
            t.ticket_id,
            (dependencia) => estadoPorTicket.get(dependencia) === "concluido",
          ).length === 0,
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
  { limite, vagasOcupadas }: { limite: number; vagasOcupadas: number },
): TicketDemanda[] {
  return demandas
    .flatMap((d) => selecionarTrabalho(d.agregado, d.predecessoras_satisfeitas))
    .sort((a, b) => {
      const [na, pa] = numeroDaDemanda(a.demanda_id);
      const [nb, pb] = numeroDaDemanda(b.demanda_id);
      return na - nb || pa.localeCompare(pb) || (a.rodada_id ?? 0) - (b.rodada_id ?? 0) || a.ticket_id - b.ticket_id;
    })
    .slice(0, Math.max(0, limite - vagasOcupadas));
}
