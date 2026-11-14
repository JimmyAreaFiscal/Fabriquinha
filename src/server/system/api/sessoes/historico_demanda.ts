// Sessões dos tickets da demanda para o Histórico, a navegação e as Pendências (comparacao-sdlc-implementacao.md §9.1):
// as sessões e as execuções, de Sessões, e as demandas, do Ciclo de Vida, lidas em lote, com o estado que o chat calcula;
// as sessões migradas pelo backfill entram como as novas.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  type CicloDeVida,
  Endereco,
  type EtapaTicket,
  type ResumoDaDemanda,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import {
  type Execucao,
  type IdDaSessao,
  montarSessoesDeAgente,
  type ResumoDaSessao,
} from "../../../../modulos/sessoes/publico.ts";
import type { GestaoDeDemandas } from "../../../../modulos/demandas/publico.ts";
import type { Resultado, SessaoDeDemanda } from "../contrato/sessoes/historico.ts";
import { montarCabecalhoDaSessao } from "./consulta_chat.ts";

export type { Resultado, SessaoDeDemanda };

interface FiltroSessoesDemanda {
  escopo: "ativas" | "historico";
  projeto?: string;
  demanda?: string;
  etapa?: EtapaTicket;
}

/** As sessões dos `resumos` que casam com o filtro, cada uma com o resumo da demanda dela em `resumoDaDemanda`. */
function sessoesDosResumos(
  cicloDeVida: CicloDeVida,
  resumos: readonly ResumoDaSessao[],
  resumoDaDemanda: ReadonlyMap<string, ResumoDaDemanda>,
  filtro: FiltroSessoesDemanda,
): SessaoDeDemanda[] {
  return resumos
    .map((resumo) =>
      cicloDeVida.sessaoDoTicket(
        encontrado(resumoDaDemanda.get(resumo.demanda_id), `a demanda ${resumo.demanda_id} não foi lida`, "recarregue"),
        resumo,
        relogioDoSistema,
      ),
    )
    .filter(
      ({ ag, ticket }) =>
        (filtro.projeto === undefined || ag.demanda.projeto === filtro.projeto) &&
        (filtro.etapa === undefined || ticket.etapa === filtro.etapa),
    )
    .map((sessaoDoTicket): SessaoDeDemanda => {
      const { sessao, execucoes, ...resto } = montarCabecalhoDaSessao(sessaoDoTicket);
      // O cabeçalho já recusa a sessão sem execução.
      const [primeira, ultima] = [execucoes[0], execucoes.at(-1)] as [Execucao, Execucao];
      return {
        sessao: sessao.sessao,
        projeto: sessao.projeto,
        demanda: resto.demanda,
        titulo: sessaoDoTicket.ag.demanda.titulo,
        ...(resto.rodada && { rodada: resto.rodada }),
        ticket: resto.ticket,
        etapa: resto.etapa,
        modo: sessao.modo,
        ...(sessao.modelo && { modelo: sessao.modelo }),
        estado: sessao.estado,
        ...(sessao.pendencia && { pendencia: sessao.pendencia }),
        desde: sessao.desde,
        inicio: primeira.inicio,
        ...(ultima.fim && { fim: ultima.fim }),
        resultado: ultima.fim && ultima.falha ? "falha" : "concluida",
      };
    })
    .filter((s) => (s.estado === "terminada") === (filtro.escopo === "historico"))
    .toSorted((a, b) => a.desde.localeCompare(b.desde));
}

/**
 * As sessões das `demandas` no escopo (terminadas no `historico`, as demais em `ativas`), da que está assim há
 * mais tempo para a mais recente, numa leitura das sessões em lote.
 * ponytail: calcula o estado de cada sessão pelo mesmo caminho do chat; filtrar o histórico no SQL quando pesar.
 */
export function sessoesDasDemandas(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  demandas: readonly ResumoDaDemanda[],
  filtro: FiltroSessoesDemanda,
): SessaoDeDemanda[] {
  const resumoDaDemanda = new Map(demandas.map((ag) => [ag.demanda.id, ag]));
  const resumos = montarSessoesDeAgente({ banco }).listar({ demandas: [...resumoDaDemanda.keys()] });
  return sessoesDosResumos(cicloDeVida, resumos, resumoDaDemanda, filtro);
}

/**
 * As sessões do filtro, das demandas que têm sessão (só as da demanda ou do projeto pedido, se houver), com as demandas
 * lidas em lote.
 */
export function sessoesDeDemanda(
  banco: DatabaseSync,
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  filtro: FiltroSessoesDemanda,
): SessaoDeDemanda[] {
  const demandasDoFiltro =
    filtro.demanda !== undefined
      ? [filtro.demanda]
      : filtro.projeto !== undefined
        ? gestaoDeDemandas.pedidos({ projeto: filtro.projeto }).map(({ id }) => id)
        : undefined;
  const resumos = montarSessoesDeAgente({ banco }).listar(
    demandasDoFiltro === undefined ? {} : { demandas: demandasDoFiltro },
  );
  const resumosDasDemandasLidas = cicloDeVida.andamentos({
    demandas: [...new Set(resumos.map((resumo) => resumo.demanda_id))],
  });
  return sessoesDosResumos(
    cicloDeVida,
    resumos,
    new Map(resumosDasDemandasLidas.map((ag) => [ag.demanda.id, ag])),
    filtro,
  );
}

/**
 * Os tickets (`I-n.Tm`) com o pi no ar: execução aberta e com o grupo do pi gravado. A execução abre antes da preparação
 * da worktree e o grupo só é gravado quando o pi sobe; a coleta de evidências roda depois que ela fecha.
 */
export const ticketsComPiAtivo = (banco: DatabaseSync): Set<string> =>
  new Set(
    montarSessoesDeAgente({ banco })
      .listar({ abertas: true })
      .filter(({ execucoes }) => execucoes.some((e) => e.fim == null && e.grupo_processo !== undefined))
      .map(({ demanda_id, ticket_id }) => Endereco.doTicket(demanda_id, ticket_id).toString()),
  );

/** O id da sessão de cada ticket de cada demanda de `ids`; com mais de uma no ticket, vale a mais recente. */
export function sessaoDeCadaTicketDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, Map<number, IdDaSessao>> {
  const porDemanda = Map.groupBy(montarSessoesDeAgente({ banco }).listar({ demandas: ids }), (s) => s.demanda_id);
  return new Map(ids.map((id) => [id, new Map((porDemanda.get(id) ?? []).map((s) => [s.ticket_id, s.id]))]));
}
