// A consulta do Início: numa leitura só (um snapshot), o mês corrente de todos os projetos, o que aguarda o Auditor, as
// sessões que rodam e o board, tudo das demandas em andamento. As concluídas, canceladas e arquivadas ficam fora. Fora do
// Início, o menu conta o que aguarda pela consulta leve de quantidade_de_pendencias.ts, com as mesmas Pendências.
import { montarRepositorio } from "../../../../modulos/repositorio/publico.ts";
import type { DatabaseSync } from "node:sqlite";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import { mesDoInstante, type Relogio } from "../../../../shared/nucleo/relogio.ts";
import {
  type CatalogoDoCicloDeVida,
  type CicloDeVida,
  Endereco,
  type ResumoDaDemanda,
  type TicketDemanda,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import type { ModoTrabalho } from "../../../../modulos/sessoes/publico.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import type { CartaoDoBoard, ColunaDoBoard, DadosDoInicio } from "../contrato/inicio.ts";
import { sessoesDasDemandas, ticketsComPiAtivo } from "../sessoes/historico_demanda.ts";
import { lerPedidosDasMetricas } from "../demandas/leituras/pedidos_das_metricas.ts";
import { metricasDosMeses } from "../metricas/metricas_do_periodo.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/leituras/predecessoras.ts";
import { pendenciasDasDemandas, situacoesDoBanco, type SituacaoDaSessao } from "../demandas/leituras/pendencias.ts";

type TicketDoCartao = NonNullable<CartaoDoBoard["ticket"]>;

/** O que o board precisa saber de fora da demanda para desenhar os tickets dos cartões. */
interface ApoioDosTickets {
  catalogo: CatalogoDoCicloDeVida;
  modoDe: (ref: string) => ModoTrabalho | undefined;
  comPiAtivo: ReadonlySet<string>;
}

/** O endereço público do ticket. */
const enderecoDoTicket = (t: TicketDemanda): string => Endereco.doTicket(t.demanda_id, t.ticket_id).toString();

function ticketDoCartao(t: TicketDemanda, { modoDe, comPiAtivo }: ApoioDosTickets): TicketDoCartao {
  const ref = enderecoDoTicket(t);
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
  const abertos = tickets.filter((t) => !apoio.catalogo.ticket.ehTerminal(t.estado));
  const [ticket] = abertos.toSorted((a, b) => Number(a.estado === "aberto") - Number(b.estado === "aberto"));
  return {
    ...(ticket && { ticket: ticketDoCartao(ticket, apoio) }),
    outros: Math.max(abertos.length - 1, 0),
  };
}

/** Os cartões da demanda: um por rodada que não concluiu, na execução; senão, um só, o da demanda. */
function cartoesDaDemanda(ag: ResumoDaDemanda, bloqueios: string[], apoio: ApoioDosTickets): CartaoDoBoard[] {
  const { id: demanda, projeto, titulo, estado } = ag.demanda;
  const identificacao = { demanda, projeto, titulo, bloqueios };
  const abertas = ag.rodadas.filter((r) => r.estado !== "concluida");
  if (estado === "em_execucao" && abertas.length > 0) {
    return abertas.map((r) => ({
      coluna: r.estado as ColunaDoBoard,
      ref: Endereco.daRodada(r.demanda_id, r.rodada_id).toString(),
      ...identificacao,
      ...ticketEmCurso(
        ag.tickets.filter((t) => t.rodada_id === r.rodada_id),
        apoio,
      ),
    }));
  }
  // A execução sem rodada aberta (antes da primeira ou depois da última, até a revisão abrir) fica no Desenvolvimento, a
  // coluna da primeira Etapa da rodada; o cast vale porque todo estado de rodada em andamento é coluna.
  const coluna = (estado === "em_execucao" ? apoio.catalogo.rodada.primeiroEstado : estado) as ColunaDoBoard;
  const globais = ag.tickets.filter((t) => t.rodada_id === undefined);
  return [{ coluna, ref: demanda, ...identificacao, ...ticketEmCurso(globais, apoio) }];
}

/** O Início, lido num snapshot só; o mês corrente e as Pendências saem do instante do `relogio`. */
export function consultarInicio(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): DadosDoInicio {
  return lerEmSnapshot(banco, () => {
    const agora = relogio.agora();
    const mes = mesDoInstante(agora);
    // Um mês pedido, um mês devolvido.
    const [doMes] = metricasDosMeses(
      {
        banco,
        cicloDeVida,
        repositorio: montarRepositorio({ banco }),
        pedidos: lerPedidosDasMetricas(banco, cicloDeVida, gestaoDeDemandas),
      },
      { de: mes, ate: mes },
    ) as [DadosDoInicio["mes"]];
    const demandas = cicloDeVida.andamentos({ soNaoTerminadas: true });
    // Só as sessões das demandas em andamento, lidas em lote: calcular o estado de todas as do banco custa segundos. Ficam
    // na ordem das demandas, e as de cada demanda, da que está assim há mais tempo para a mais recente.
    const sessoesDaDemanda = Map.groupBy(
      sessoesDasDemandas(banco, cicloDeVida, demandas, { escopo: "ativas" }),
      (s) => s.demanda,
    );
    const sessoes = demandas.flatMap((ag) => sessoesDaDemanda.get(ag.demanda.id) ?? []);
    const modos = new Map(sessoes.map((s) => [s.ticket, s.modo]));
    const apoio: ApoioDosTickets = {
      catalogo: cicloDeVida.etapas(),
      modoDe: (ref) => modos.get(ref),
      comPiAtivo: ticketsComPiAtivo(banco),
    };
    const predecessoras = predecessorasDasDemandas(
      cicloDeVida,
      gestaoDeDemandas,
      demandas.map((ag) => ag.demanda.id),
    );
    const tituloDoTicket = new Map(
      demandas.flatMap((ag) => ag.tickets.map((t) => [enderecoDoTicket(t), t.titulo] as const)),
    );
    return {
      mes: doMes,
      aguarda: pendenciasDasDemandas(cicloDeVida, gestaoDeDemandas, demandas, sessoes, situacaoDa, agora),
      rodando: sessoes
        .filter((s) => s.estado === "rodando")
        .map((s) => {
          const fazendo = situacaoDa(s.sessao)?.atividade ?? tituloDoTicket.get(s.ticket);
          return { ...s, ...(fazendo !== undefined && { fazendo }) };
        }),
      quantidadeEmAndamento: demandas.length,
      board: demandas.flatMap((ag) => {
        const bloqueios = bloqueiosDaDemanda(cicloDeVida.etapas(), predecessorasDe(predecessoras, ag.demanda.id));
        return cartoesDaDemanda(
          ag,
          bloqueios.map((p) => p.demanda_id),
          apoio,
        );
      }),
    };
  });
}
