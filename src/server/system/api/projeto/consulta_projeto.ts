// A consulta da página do projeto: as demandas com as rodadas e os tickets, montadas no contrato da API
// (contrato/) a partir de um snapshot só, com as leituras em lote, sem uma consulta por demanda.
import type { DatabaseSync } from "node:sqlite";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import {
  type CatalogoDoCicloDeVida,
  type CicloDeVida,
  Endereco,
  EstadoDemanda,
  type ResumoDaDemanda,
} from "../../../../modulos/ciclo_de_vida/publico.ts";
import { prDoEspaco } from "../../../../modulos/repositorio/publico.ts";
import type { GestaoDeDemandas, Projeto } from "../../../../modulos/demandas/publico.ts";
import type { DemandaDoProjeto, FiltroDoProjeto, ListaDoProjeto } from "../contrato/projeto.ts";
import { sessaoDeCadaTicketDasDemandas, sessoesDasDemandas, ticketsComPiAtivo } from "../sessoes/historico_demanda.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "../demandas/leituras/predecessoras.ts";
import { pendenciasDasDemandas, situacoesDoBanco, type SituacaoDaSessao } from "../demandas/leituras/pendencias.ts";

export const ORIENTACAO_PROJETO_INEXISTENTE = "escolha um projeto cadastrado na Configuração";

/** Os ids das demandas do projeto, das mais novas para as mais antigas. */
export const idsDasDemandasDoProjeto = (gestaoDeDemandas: GestaoDeDemandas, projeto: string): string[] =>
  gestaoDeDemandas
    .pedidos({ projeto })
    .map(({ id }) => id)
    .reverse();

/**
 * O estado que a linha do tempo marca: o da demanda em andamento; o da Etapa mais adiantada dos tickets na cancelada,
 * que não guarda onde parou; e `concluida` (tudo feito) na concluída e na arquivada.
 * ponytail: a cancelada num gate aparece no estado do ticket, o de antes; um histórico de estados a acertaria.
 */
/** @testes função pura da consulta, testada sem banco */
export function estadoNaLinhaDoTempo(
  { demanda: cicloDaDemanda }: CatalogoDoCicloDeVida,
  { demanda, tickets }: ResumoDaDemanda,
): EstadoDemanda {
  if (cicloDaDemanda.satisfazDependencia(demanda.estado)) return "concluida";
  if (cicloDaDemanda.estaEmAndamento(demanda.estado)) return demanda.estado;
  return tickets
    .map((t) => cicloDaDemanda.estadoDaEtapa(t.etapa))
    .reduce<EstadoDemanda>(
      (maisAdiantado, estado) =>
        EstadoDemanda.options.indexOf(estado) > EstadoDemanda.options.indexOf(maisAdiantado) ? estado : maisAdiantado,
      cicloDaDemanda.primeiroEstado,
    );
}

/** O que as leituras em lote trazem para montar a linha de uma demanda. */
interface LeiturasDoProjeto {
  cicloDeVida: CicloDeVida;
  etapas: Projeto["etapas"];
  predecessoras: ReturnType<typeof predecessorasDasDemandas>;
  sessoes: ReturnType<typeof sessaoDeCadaTicketDasDemandas>;
  comPiAtivo: ReadonlySet<string>;
  pendencias: ReturnType<typeof pendenciasDasDemandas>;
}

function demandaDoProjeto(ag: ResumoDaDemanda, leituras: LeiturasDoProjeto): DemandaDoProjeto {
  const { id } = ag.demanda;
  const catalogo = leituras.cicloDeVida.etapas();
  const rodada = (rodada_id: number) => Endereco.daRodada(id, rodada_id).toString();
  // Com mais de uma sessão no ticket, vale a mais recente, como na página da demanda.
  const sessoes = encontrado(leituras.sessoes.get(id), `a demanda ${id} não foi lida`, "recarregue");
  return {
    id,
    titulo: ag.demanda.titulo,
    tipo: ag.demanda.tipo,
    estado: ag.demanda.estado,
    terminal: catalogo.demanda.ehTerminal(ag.demanda.estado),
    satisfazDependencia: catalogo.demanda.satisfazDependencia(ag.demanda.estado),
    estadoNaLinhaDoTempo: estadoNaLinhaDoTempo(catalogo, ag),
    estadoAlteradoEm: ag.demanda.estado_alterado_em,
    bloqueadaPor: bloqueiosDaDemanda(leituras.cicloDeVida.etapas(), predecessorasDe(leituras.predecessoras, id)).map(
      (p) => p.demanda_id,
    ),
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
      const { modelo } = catalogo.configuracaoDoAgente({
        ticket: t.configuracao_agente,
        etapaDoProjeto: leituras.etapas.find((e) => e.etapa === t.etapa)?.configuracao_agente,
        padrao: {},
      });
      const sessao = sessoes.get(t.ticket_id);
      const ticketRef = Endereco.doTicket(id, t.ticket_id).toString();
      return {
        ref: ticketRef,
        etapa: t.etapa,
        estado: t.estado,
        terminal: catalogo.ticket.ehTerminal(t.estado),
        satisfazDependencia: catalogo.ticket.satisfazDependencia(t.estado),
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
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  nome: string,
  filtro: FiltroDoProjeto,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): ListaDoProjeto {
  const projeto = gestaoDeDemandas.projeto(nome, ORIENTACAO_PROJETO_INEXISTENTE);
  return lerEmSnapshot(banco, () => {
    const doProjeto = idsDasDemandasDoProjeto(gestaoDeDemandas, nome);
    const todas = [...cicloDeVida.estados(doProjeto)].map(([id, { estado }]) => ({ id, estado }));
    const { demanda: cicloDaDemanda } = cicloDeVida.etapas();
    const quantas = (estado: EstadoDemanda) => todas.filter((d) => d.estado === estado).length;
    const mostrarDoEstado: Partial<Record<EstadoDemanda, boolean>> = {
      concluida: filtro.concluidas,
      arquivada: filtro.arquivadas,
      cancelada: filtro.canceladas,
    };
    const ids = todas.filter((d) => mostrarDoEstado[d.estado] ?? true).map((d) => d.id);
    const resumos = cicloDeVida.andamentos({ demandas: ids });
    const naoTerminadas = resumos.filter((ag) => !cicloDaDemanda.ehTerminal(ag.demanda.estado));
    const leituras: LeiturasDoProjeto = {
      cicloDeVida,
      etapas: projeto.etapas,
      predecessoras: predecessorasDasDemandas(cicloDeVida, gestaoDeDemandas, ids),
      sessoes: sessaoDeCadaTicketDasDemandas(banco, ids),
      comPiAtivo: ticketsComPiAtivo(banco),
      // A demanda encerrada não espera ninguém.
      pendencias: pendenciasDasDemandas(
        cicloDeVida,
        gestaoDeDemandas,
        naoTerminadas,
        sessoesDasDemandas(banco, cicloDeVida, naoTerminadas, { escopo: "ativas" }),
        situacaoDa,
        relogio.agora(),
      ),
    };
    return {
      demandas: resumos.map((ag) => demandaDoProjeto(ag, leituras)),
      contagem: {
        andamento: todas.filter((d) => cicloDaDemanda.estaEmAndamento(d.estado)).length,
        concluidas: quantas("concluida"),
        arquivadas: quantas("arquivada"),
        canceladas: quantas("cancelada"),
      },
    };
  });
}
