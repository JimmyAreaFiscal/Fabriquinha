// Sessões dos tickets da demanda para o Histórico, a navegação e as Pendências (comparacao-sdlc-implementacao.md §9.1):
// as sessões e as execuções, de Sessões, e as demandas, do Ciclo de Vida, lidas em lote, com o estado que o chat calcula;
// as sessões migradas pelo backfill entram como as novas.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import { relogioDoSistema } from "../../../shared/nucleo/relogio.ts";
import {
  type AgregadoDemanda,
  carregarDemandas,
  type EtapaTicket,
  formatarTicketRef,
  situacaoDasDemandas,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import {
  execucoesAbertas,
  type Execucao,
  type ResumoDaSessao,
  resumosDasSessoesEmLote,
} from "../../../modulos/sessoes/publico.ts";
import type { Resultado, SessaoDeDemanda } from "../../contrato/sessoes/historico.ts";
import { montarCabecalhoDaSessao, sessaoDoTicketDoResumo } from "./chat.ts";

export type { Resultado, SessaoDeDemanda };

interface FiltroSessoesDemanda {
  escopo: "ativas" | "historico";
  projeto?: string;
  demanda?: string;
  etapa?: EtapaTicket;
}

/** As sessões dos `resumos` que casam com o filtro, cada uma com a demanda dela em `agregadoDaDemanda`. */
function sessoesDosResumos(
  resumos: readonly ResumoDaSessao[],
  agregadoDaDemanda: ReadonlyMap<string, AgregadoDemanda>,
  filtro: FiltroSessoesDemanda,
): SessaoDeDemanda[] {
  return resumos
    .map((resumo) =>
      sessaoDoTicketDoResumo(
        encontrado(
          agregadoDaDemanda.get(resumo.demanda_id),
          `a demanda ${resumo.demanda_id} não foi lida`,
          "recarregue",
        ),
        resumo,
      ),
    )
    .filter(
      ({ ag, ticket }) =>
        (filtro.projeto === undefined || ag.demanda.projeto === filtro.projeto) &&
        (filtro.etapa === undefined || ticket.etapa === filtro.etapa),
    )
    .map((sessaoDoTicket): SessaoDeDemanda => {
      const { sessao, execucoes, ...resto } = montarCabecalhoDaSessao(sessaoDoTicket, relogioDoSistema);
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
 * As sessões das demandas de `agregados` no escopo (terminadas no `historico`, as demais em `ativas`), da que está assim há
 * mais tempo para a mais recente, numa leitura das sessões em lote.
 * ponytail: calcula o estado de cada sessão pelo mesmo caminho do chat; filtrar o histórico no SQL quando pesar.
 */
export function sessoesDasDemandas(
  banco: DatabaseSync,
  agregados: readonly AgregadoDemanda[],
  filtro: FiltroSessoesDemanda,
): SessaoDeDemanda[] {
  const agregadoDaDemanda = new Map(agregados.map((ag) => [ag.demanda.id, ag]));
  return sessoesDosResumos(resumosDasSessoesEmLote(banco, [...agregadoDaDemanda.keys()]), agregadoDaDemanda, filtro);
}

/**
 * As sessões do filtro, das demandas que têm sessão (só as da demanda ou do projeto pedido, se houver), com as demandas
 * lidas em lote.
 */
export function sessoesDeDemanda(banco: DatabaseSync, filtro: FiltroSessoesDemanda): SessaoDeDemanda[] {
  const demandasDoFiltro =
    filtro.demanda !== undefined
      ? [filtro.demanda]
      : filtro.projeto !== undefined
        ? situacaoDasDemandas(banco, filtro.projeto).map((d) => d.id)
        : undefined;
  const resumos = resumosDasSessoesEmLote(banco, demandasDoFiltro);
  const agregados = carregarDemandas(banco, [...new Set(resumos.map((resumo) => resumo.demanda_id))]);
  return sessoesDosResumos(resumos, new Map(agregados.map((ag) => [ag.demanda.id, ag])), filtro);
}

/**
 * Os tickets (`I-n.Tm`) com o pi no ar: execução aberta e com o grupo do pi gravado. A execução abre antes da preparação
 * da worktree e o grupo só é gravado quando o pi sobe; a coleta de evidências roda depois que ela fecha.
 */
export const ticketsComPiAtivo = (banco: DatabaseSync): Set<string> =>
  new Set(
    execucoesAbertas(banco)
      .filter((e) => e.grupo_processo !== null)
      .map(({ demanda_id, ticket_id }) => formatarTicketRef({ demanda_id, ticket_id })),
  );
