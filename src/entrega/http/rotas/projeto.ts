// Rotas da página do projeto (F7 §4.2): as demandas do projeto com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap do projeto.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgregadoDemanda, TipoDemanda } from "../../../nucleo/agregado_demanda.ts";
import { AUDITOR } from "../../../nucleo/ator.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET, etapaDoEstado } from "../../../nucleo/ciclos.ts";
import { resolverConfiguracaoAgente } from "../../../nucleo/configuracao_agente.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import { prDoEspaco } from "../../../nucleo/espaco_de_trabalho.ts";
import { EstadoDemanda, type EtapaTicket, type EstadoRodada, type EstadoTicket } from "../../../nucleo/primitivos.ts";
import { arquivar } from "../../../aplicacao/gestao_demandas.ts";
import { sessoesDeDemanda } from "../../../aplicacao/historico_demanda.ts";
import { buscarProjeto, projetoExistente } from "../../../aplicacao/projeto/cadastro.ts";
import { condutor } from "../../../aplicacao/trabalho/condutor.ts";
import { carregarDemanda } from "../../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../armazenamento/dependencias_demanda.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/trabalho_agentico.ts";
import { heatmapDo } from "../../../infra/repositorio/heatmap.ts";
import type { Rota } from "../rotas.ts";
import { type PendenciaDoInicio, pendenciasDasDemandas } from "./inicio.ts";

/** Uma linha da página do projeto: a demanda, as rodadas com o PR e os tickets com o modelo efetivo e a sessão. */
export interface DemandaDoProjeto {
  id: string;
  titulo: string;
  tipo: TipoDemanda;
  estado: EstadoDemanda;
  terminal: boolean;
  satisfazDependencia: boolean;
  /** O estado em que a linha do tempo marca a demanda; ver `estadoNaLinhaDoTempo`. */
  estadoNaLinhaDoTempo: EstadoDemanda;
  estadoAlteradoEm: string;
  /** As predecessoras ainda em andamento: a cancelada já cancelou esta junto, e não bloqueia mais nada. */
  bloqueadaPor: string[];
  /** O que a demanda tem parado esperando o Auditor; a demanda encerrada não tem. */
  pendencias: PendenciaDoInicio[];
  rodadas: { ref: string; titulo: string; estado: EstadoRodada; pr?: { id: string; url: string } }[];
  tickets: {
    ref: string;
    etapa: EtapaTicket;
    estado: EstadoTicket;
    terminal: boolean;
    satisfazDependencia: boolean;
    estadoAlteradoEm: string;
    rodada?: string;
    titulo?: string;
    /** `provedor / modelo` do ticket, senão o da etapa no projeto; sem ele, vale o padrão do pi. */
    modelo?: string;
    sessao?: string;
    /** Com execução de pi aberta: o `em_execucao` é o pi, não o sistema. */
    piAtivo?: true;
  }[];
}

/** `GET /api/projetos/:nome/demandas`: as demandas pedidas, das mais novas para as mais antigas, e a contagem de todas. */
export interface ListaDoProjeto {
  demandas: DemandaDoProjeto[];
  contagem: { andamento: number; concluidas: number; arquivadas: number; canceladas: number };
}

const ORIENTACAO_PROJETO_INEXISTENTE = "escolha um projeto cadastrado na Configuração";

const Filtro = z.object({
  concluidas: z.stringbool().default(false),
  arquivadas: z.stringbool().default(false),
  canceladas: z.stringbool().default(false),
});

/** O estado da demanda em que o trabalho da Etapa acontece; as Etapas das rodadas e do conflito acontecem em `em_execucao`. */
const estadoDaEtapa = (etapa: EtapaTicket): EstadoDemanda =>
  EstadoDemanda.options.find((estado) => etapaDoEstado(estado) === etapa) ?? "em_execucao";

/**
 * O estado que a linha do tempo marca: o da demanda em andamento; o da Etapa mais adiantada dos tickets na cancelada,
 * que não guarda onde parou; e `concluida` (tudo feito) na concluída e na arquivada.
 * ponytail: a cancelada num gate aparece no estado do ticket, o de antes; um histórico de estados a acertaria.
 */
/** @testes função pura da rota, testada sem banco */
export function estadoNaLinhaDoTempo({ demanda, tickets }: AgregadoDemanda): EstadoDemanda {
  if (CICLO_DA_DEMANDA.satisfazDependencia(demanda.estado)) return "concluida";
  if (CICLO_DA_DEMANDA.estaEmAndamento(demanda.estado)) return demanda.estado;
  return tickets
    .map((t) => estadoDaEtapa(t.etapa))
    .reduce<EstadoDemanda>(
      (maisAdiantado, estado) =>
        EstadoDemanda.options.indexOf(estado) > EstadoDemanda.options.indexOf(maisAdiantado) ? estado : maisAdiantado,
      "entender_e_desenhar",
    );
}

function demandaDoProjeto(banco: DatabaseSync, id: string): DemandaDoProjeto {
  const ag = carregarDemanda(banco, id);
  const etapas = buscarProjeto(banco, ag.demanda.projeto)?.etapas ?? [];
  // Com mais de uma sessão no ticket, vale a mais recente, como na página da demanda.
  const sessoes = new Map(
    (
      banco.prepare("SELECT ticket_id, id FROM trabalho_agentico WHERE demanda_id = ? ORDER BY rowid").all(id) as {
        ticket_id: number;
        id: string;
      }[]
    ).map((s) => [s.ticket_id, s.id]),
  );
  const rodada = (rodada_id: number) => formatarRodadaRef({ demanda_id: id, rodada_id });
  const comPiAtivo = ticketsComPiAtivo(banco);
  return {
    id,
    titulo: ag.demanda.titulo,
    tipo: ag.demanda.tipo,
    estado: ag.demanda.estado,
    terminal: CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado),
    satisfazDependencia: CICLO_DA_DEMANDA.satisfazDependencia(ag.demanda.estado),
    estadoNaLinhaDoTempo: estadoNaLinhaDoTempo(ag),
    estadoAlteradoEm: ag.demanda.estado_alterado_em,
    bloqueadaPor: predecessorasDaDemanda(banco, id)
      .filter((p) => CICLO_DA_DEMANDA.estaEmAndamento(p.estado))
      .map((p) => p.demanda_id),
    pendencias: CICLO_DA_DEMANDA.ehTerminal(ag.demanda.estado)
      ? []
      : pendenciasDasDemandas(
          banco,
          [ag],
          sessoesDeDemanda(banco, { escopo: "ativas", demanda: id }),
          condutor.situacao.bind(condutor),
          new Date(),
        ),
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
      const { modelo } = resolverConfiguracaoAgente({
        ticket: t.configuracao_agente,
        etapaDoProjeto: etapas.find((e) => e.etapa === t.etapa)?.configuracao_agente,
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
        ...(comPiAtivo.has(ticketRef) && { piAtivo: true as const }),
      };
    }),
  };
}

/** As demandas do projeto, das mais novas para as mais antigas, só com o id e o estado. */
const situacaoDasDemandas = (banco: DatabaseSync, nome: string) =>
  banco.prepare("SELECT id, estado FROM demanda WHERE projeto = ? ORDER BY rowid DESC").all(nome) as {
    id: string;
    estado: EstadoDemanda;
  }[];

/** As em andamento sempre; as concluídas, as arquivadas e as canceladas só quando pedidas. */
function lista(banco: DatabaseSync, nome: string, query: URLSearchParams): ListaDoProjeto {
  projetoExistente(banco, nome, ORIENTACAO_PROJETO_INEXISTENTE);
  const filtro = Filtro.parse(Object.fromEntries(query));
  const todas = situacaoDasDemandas(banco, nome);
  const quantas = (estado: EstadoDemanda) => todas.filter((d) => d.estado === estado).length;
  const mostrarDoEstado: Partial<Record<EstadoDemanda, boolean>> = {
    concluida: filtro.concluidas,
    arquivada: filtro.arquivadas,
    cancelada: filtro.canceladas,
  };
  const contagem = {
    concluidas: quantas("concluida"),
    arquivadas: quantas("arquivada"),
    canceladas: quantas("cancelada"),
  };
  return {
    // ponytail: um agregado por demanda mostrada, como o quadro das demandas; uma consulta só quando a página pesar.
    demandas: todas.filter((d) => mostrarDoEstado[d.estado] ?? true).map((d) => demandaDoProjeto(banco, d.id)),
    contagem: {
      andamento: todas.filter((d) => CICLO_DA_DEMANDA.estaEmAndamento(d.estado)).length,
      ...contagem,
    },
  };
}

/** Arquivar concluídas: cada demanda concluída do projeto, uma transação por demanda, como o Arquivar da demanda. */
function arquivarConcluidas(banco: DatabaseSync, nome: string): { arquivadas: number } {
  projetoExistente(banco, nome, ORIENTACAO_PROJETO_INEXISTENTE);
  const concluidas = situacaoDasDemandas(banco, nome).filter((d) => d.estado === "concluida");
  for (const { id } of concluidas) arquivar(banco, id, AUDITOR, { agora: new Date().toISOString() });
  return { arquivadas: concluidas.length };
}

export const ROTAS_DO_PROJETO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/demandas",
    tratar: ({ banco, params, query }) => lista(banco, String(params.nome), query),
  },
  {
    metodo: "POST",
    caminho: "/api/projetos/:nome/arquivar",
    tratar: ({ banco, params }) => arquivarConcluidas(banco, String(params.nome)),
  },
  {
    metodo: "GET",
    caminho: "/api/projetos/:nome/heatmap",
    tratar: ({ banco, params }) =>
      heatmapDo(projetoExistente(banco, String(params.nome), ORIENTACAO_PROJETO_INEXISTENTE)),
  },
];
