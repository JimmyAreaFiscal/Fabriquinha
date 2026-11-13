// A consulta do Início: numa leitura só (um snapshot), o mês corrente de todos os projetos, o que aguarda o Auditor, as
// sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e arquivadas ficam fora. Fora do
// Início, o menu conta o que aguarda pela consulta leve de quantidade_de_pendencias.ts, com as mesmas Pendências.
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../modulos/demandas/publico.ts";
import { mesDoInstante, type Relogio } from "../../../shared/nucleo/relogio.ts";
import {
  type ResumoDaDemanda,
  CICLO_DO_TICKET,
  type EstadoDemanda,
  estadoDaRodadaNaEtapa,
  formatarRodadaRef,
  formatarTicketRef,
  listarResumosDasDemandas,
  PRIMEIRA_ETAPA_DA_RODADA,
  type TicketDemanda,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import type { ModoTrabalho } from "../../../modulos/sessoes/publico.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import type { CartaoDoBoard, ColunaDoBoard, DadosDoInicio } from "../../contrato/inicio.ts";
import { sessoesDasDemandas, ticketsComPiAtivo } from "../sessoes/historico_demanda.ts";
import { lerPedidosDasMetricas } from "../demandas/pedidos_das_metricas.ts";
import { metricasDosMeses } from "../metricas/metricas_do_periodo.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/predecessoras.ts";
import { pendenciasDasDemandas, situacoesDoBanco, type SituacaoDaSessao } from "../demandas/pendencias.ts";

type TicketDoCartao = NonNullable<CartaoDoBoard["ticket"]>;

/** O que o board precisa saber de fora da demanda para desenhar os tickets dos cartões. */
interface ApoioDosTickets {
  modoDe: (ref: string) => ModoTrabalho | undefined;
  comPiAtivo: ReadonlySet<string>;
}

function ticketDoCartao(t: TicketDemanda, { modoDe, comPiAtivo }: ApoioDosTickets): TicketDoCartao {
  const ref = formatarTicketRef(t);
  const modo = modoDe(ref);
  return {
    ref,
    etapa: t.etapa,
    estado: t.estado,
    ...(modo && { modo }),
    ...(comPiAtivo.has(ref) && { pi_ativo: true }),
  };
}

/** O ticket em curso de uma lista e quantos outros ainda não terminaram. */
function ticketEmCurso(tickets: readonly TicketDemanda[], apoio: ApoioDosTickets) {
  const abertos = tickets.filter((t) => !CICLO_DO_TICKET.ehTerminal(t.estado));
  const [ticket] = abertos.toSorted((a, b) => Number(a.estado === "aberto") - Number(b.estado === "aberto"));
  return {
    ...(ticket && { ticket: ticketDoCartao(ticket, apoio) }),
    outros: Math.max(abertos.length - 1, 0),
  };
}

/**
 * A coluna da demanda que tem nome diferente do estado: a execução sem rodada aberta (antes da primeira ou depois da
 * última, até a revisão abrir), que fica no Desenvolvimento.
 */
const COLUNA_DO_ESTADO: Partial<Record<EstadoDemanda, ColunaDoBoard>> = {
  // O cast vale porque a primeira Etapa da rodada é estado de rodada em andamento, e todo estado desses é coluna.
  em_execucao: estadoDaRodadaNaEtapa(PRIMEIRA_ETAPA_DA_RODADA) as ColunaDoBoard,
};

/** Os cartões da demanda: um por rodada que não concluiu, na execução; senão, um só, o da demanda. */
function cartoesDaDemanda(ag: ResumoDaDemanda, bloqueios: string[], apoio: ApoioDosTickets): CartaoDoBoard[] {
  const { id: demanda, projeto, titulo, estado } = ag.demanda;
  const identificacao = { demanda, projeto, titulo, bloqueios };
  const abertas = ag.rodadas.filter((r) => r.estado !== "concluida");
  if (estado === "em_execucao" && abertas.length > 0) {
    return abertas.map((r) => ({
      coluna: r.estado as ColunaDoBoard,
      ref: formatarRodadaRef(r),
      ...identificacao,
      ...ticketEmCurso(
        ag.tickets.filter((t) => t.rodada_id === r.rodada_id),
        apoio,
      ),
    }));
  }
  const coluna = COLUNA_DO_ESTADO[estado] ?? (estado as ColunaDoBoard);
  const globais = ag.tickets.filter((t) => t.rodada_id === undefined);
  return [{ coluna, ref: demanda, ...identificacao, ...ticketEmCurso(globais, apoio) }];
}

/** O Início, lido num snapshot só; o mês corrente e as Pendências saem do instante do `relogio`. */
export function consultarInicio(
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): DadosDoInicio {
  return lerEmSnapshot(banco, () => {
    const agora = relogio.agora();
    const mes = mesDoInstante(agora);
    // Um mês pedido, um mês devolvido.
    const [doMes] = metricasDosMeses(
      { banco, pedidos: lerPedidosDasMetricas(banco, gestaoDeDemandas) },
      { de: mes, ate: mes },
    ) as [DadosDoInicio["mes"]];
    const demandas = listarResumosDasDemandas(banco, { soNaoTerminadas: true });
    // Só as sessões das demandas em andamento, lidas em lote: calcular o estado de todas as do banco custa segundos. Ficam
    // na ordem das demandas, e as de cada demanda, da que está assim há mais tempo para a mais recente.
    const sessoesDaDemanda = Map.groupBy(sessoesDasDemandas(banco, demandas, { escopo: "ativas" }), (s) => s.demanda);
    const sessoes = demandas.flatMap((ag) => sessoesDaDemanda.get(ag.demanda.id) ?? []);
    const modos = new Map(sessoes.map((s) => [s.ticket, s.modo]));
    const apoio: ApoioDosTickets = { modoDe: (ref) => modos.get(ref), comPiAtivo: ticketsComPiAtivo(banco) };
    const predecessoras = predecessorasDasDemandas(
      banco,
      gestaoDeDemandas,
      demandas.map((ag) => ag.demanda.id),
    );
    const tituloDoTicket = new Map(
      demandas.flatMap((ag) => ag.tickets.map((t) => [formatarTicketRef(t), t.titulo] as const)),
    );
    return {
      mes: doMes,
      aguarda: pendenciasDasDemandas(banco, gestaoDeDemandas, demandas, sessoes, situacaoDa, agora),
      rodando: sessoes
        .filter((s) => s.estado === "rodando")
        .map((s) => {
          const fazendo = situacaoDa(s.sessao)?.atividade ?? tituloDoTicket.get(s.ticket);
          return { ...s, ...(fazendo !== undefined && { fazendo }) };
        }),
      quantidadeEmAndamento: demandas.length,
      board: demandas.flatMap((ag) => {
        const bloqueios = bloqueiosDaDemanda(predecessorasDe(predecessoras, ag.demanda.id));
        return cartoesDaDemanda(
          ag,
          bloqueios.map((p) => p.demanda_id),
          apoio,
        );
      }),
    };
  });
}
