// A consulta da página do projeto: as demandas com as rodadas e os tickets, montadas no contrato da API
// (contrato/) a partir de um snapshot só, com as leituras em lote, sem uma consulta por demanda.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../shared/nucleo/erros.ts";
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import {
  type ResumoDaDemanda,
  resumosDasDemandas,
  CICLO_DA_DEMANDA,
  CICLO_DO_TICKET,
  EstadoDemanda,
  estadoDaDemandaNaEtapa,
  etapaDoEstado,
  type EtapaTicket,
  formatarRodadaRef,
  formatarTicketRef,
  PRIMEIRA_ETAPA_DA_DEMANDA,
  resolverConfiguracaoAgente,
  situacaoDasDemandas,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import { prDoEspaco } from "../../../modulos/repositorio/publico.ts";
import { sessaoDeCadaTicketDasDemandas } from "../../../modulos/sessoes/publico.ts";
import { pedidosDoProjeto, type Projeto, projetoExistente } from "../../../modulos/demandas/publico.ts";
import type { DemandaDoProjeto, FiltroDoProjeto, ListaDoProjeto } from "../../contrato/projeto.ts";
import { sessoesDasDemandas, ticketsComPiAtivo } from "../sessoes/historico_demanda.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/predecessoras.ts";
import { pendenciasDasDemandas, situacaoDoCondutor, type SituacaoDaSessao } from "../demandas/pendencias.ts";

export const ORIENTACAO_PROJETO_INEXISTENTE = "escolha um projeto cadastrado na Configuração";

/** O estado da demanda em que o trabalho da Etapa acontece; as Etapas das rodadas e do conflito acontecem em `em_execucao`. */
const estadoDaEtapa = (etapa: EtapaTicket): EstadoDemanda =>
  EstadoDemanda.options.find((estado) => etapaDoEstado(estado) === etapa) ?? "em_execucao";

/**
 * O estado que a linha do tempo marca: o da demanda em andamento; o da Etapa mais adiantada dos tickets na cancelada,
 * que não guarda onde parou; e `concluida` (tudo feito) na concluída e na arquivada.
 * ponytail: a cancelada num gate aparece no estado do ticket, o de antes; um histórico de estados a acertaria.
 */
/** @testes função pura da consulta, testada sem banco */
export function estadoNaLinhaDoTempo({ demanda, tickets }: ResumoDaDemanda): EstadoDemanda {
  if (CICLO_DA_DEMANDA.satisfazDependencia(demanda.estado)) return "concluida";
  if (CICLO_DA_DEMANDA.estaEmAndamento(demanda.estado)) return demanda.estado;
  return tickets
    .map((t) => estadoDaEtapa(t.etapa))
    .reduce<EstadoDemanda>(
      (maisAdiantado, estado) =>
        EstadoDemanda.options.indexOf(estado) > EstadoDemanda.options.indexOf(maisAdiantado) ? estado : maisAdiantado,
      estadoDaDemandaNaEtapa(PRIMEIRA_ETAPA_DA_DEMANDA),
    );
}

/** O que as leituras em lote trazem para montar a linha de uma demanda. */
interface LeiturasDoProjeto {
  etapas: Projeto["etapas"];
  predecessoras: ReturnType<typeof predecessorasDasDemandas>;
  sessoes: ReturnType<typeof sessaoDeCadaTicketDasDemandas>;
  comPiAtivo: ReadonlySet<string>;
  pendencias: ReturnType<typeof pendenciasDasDemandas>;
}

function demandaDoProjeto(ag: ResumoDaDemanda, leituras: LeiturasDoProjeto): DemandaDoProjeto {
  const { id } = ag.demanda;
  const rodada = (rodada_id: number) => formatarRodadaRef({ demanda_id: id, rodada_id });
  // Com mais de uma sessão no ticket, vale a mais recente, como na página da demanda.
  const sessoes = encontrado(leituras.sessoes.get(id), `a demanda ${id} não foi lida`, "recarregue");
  return {
    id,
    titulo: ag.demanda.titulo,
    tipo: ag.demanda.tipo,
    estado: ag.demanda.estado,
    terminal: CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado),
    satisfazDependencia: CICLO_DA_DEMANDA.satisfazDependencia(ag.demanda.estado),
    estadoNaLinhaDoTempo: estadoNaLinhaDoTempo(ag),
    estadoAlteradoEm: ag.demanda.estado_alterado_em,
    bloqueadaPor: bloqueiosDaDemanda(predecessorasDe(leituras.predecessoras, id)).map((p) => p.demanda_id),
    pendencias: leituras.pendencias.filter((p) => p.demanda === id),
    rodadas: ag.rodadas.map((r) => {
      const pr = prDoEspaco(ag, r.rodada_id);
      return {
        ref: rodada(r.rodada_id),
        titulo: r.titulo,
        estado: r.estado,
        ...(pr && { pr: { id: String(pr.numero), url: pr.url } }),
      };
    }),
    tickets: ag.tickets.map((t) => {
      // O modelo do ticket, senão o da Etapa no projeto (D07).
      const { modelo } = resolverConfiguracaoAgente({
        ticket: t.configuracao_agente,
        etapaDoProjeto: leituras.etapas.find((e) => e.etapa === t.etapa)?.configuracao_agente,
        padrao: {},
      });
      const sessao = sessoes.get(t.ticket_id);
      const ticketRef = formatarTicketRef({ demanda_id: id, ticket_id: t.ticket_id });
      return {
        ref: ticketRef,
        etapa: t.etapa,
        estado: t.estado,
        terminal: CICLO_DO_TICKET.ehTerminal(t.estado),
        satisfazDependencia: CICLO_DO_TICKET.satisfazDependencia(t.estado),
        estadoAlteradoEm: t.estado_alterado_em,
        ...(t.rodada_id !== undefined && { rodada: rodada(t.rodada_id) }),
        ...(t.titulo !== undefined && { titulo: t.titulo }),
        ...(modelo && { modelo: `${modelo.provedor} / ${modelo.nome}` }),
        ...(sessao !== undefined && { sessao }),
        ...(leituras.comPiAtivo.has(ticketRef) && { pi_ativo: true as const }),
      };
    }),
  };
}

/**
 * As demandas do projeto `nome`: as em andamento sempre; as concluídas, as arquivadas e as canceladas só quando pedidas.
 * Lida num snapshot só: o número de SQL preparados não cresce com o número de demandas.
 */
export function consultarProjeto(
  banco: DatabaseSync,
  nome: string,
  filtro: FiltroDoProjeto,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacaoDoCondutor,
): ListaDoProjeto {
  const projeto = projetoExistente(banco, nome, ORIENTACAO_PROJETO_INEXISTENTE);
  return lerEmSnapshot(banco, () => {
    const todas = situacaoDasDemandas(banco, pedidosDoProjeto(banco, nome));
    const quantas = (estado: EstadoDemanda) => todas.filter((d) => d.estado === estado).length;
    const mostrarDoEstado: Partial<Record<EstadoDemanda, boolean>> = {
      concluida: filtro.concluidas,
      arquivada: filtro.arquivadas,
      cancelada: filtro.canceladas,
    };
    const ids = todas.filter((d) => mostrarDoEstado[d.estado] ?? true).map((d) => d.id);
    const resumos = resumosDasDemandas(banco, ids);
    const naoTerminadas = resumos.filter((ag) => !CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado));
    const leituras: LeiturasDoProjeto = {
      etapas: projeto.etapas,
      predecessoras: predecessorasDasDemandas(banco, ids),
      sessoes: sessaoDeCadaTicketDasDemandas(banco, ids),
      comPiAtivo: ticketsComPiAtivo(banco),
      // A demanda encerrada não espera ninguém.
      pendencias: pendenciasDasDemandas(
        banco,
        naoTerminadas,
        sessoesDasDemandas(banco, naoTerminadas, { escopo: "ativas" }),
        situacaoDa,
        relogio.agora(),
      ),
    };
    return {
      demandas: resumos.map((ag) => demandaDoProjeto(ag, leituras)),
      contagem: {
        andamento: todas.filter((d) => CICLO_DA_DEMANDA.estaEmAndamento(d.estado)).length,
        concluidas: quantas("concluida"),
        arquivadas: quantas("arquivada"),
        canceladas: quantas("cancelada"),
      },
    };
  });
}
