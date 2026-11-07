// Rotas da página do projeto (F7 §4.2): as demandas do projeto com as rodadas e os tickets, o arquivamento das
// concluídas e o heatmap do projeto.
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import type { AgregadoDemanda, TipoDemanda } from "../../../nucleo/agregado_demanda.ts";
import { AUDITOR } from "../../../nucleo/ator.ts";
import { satisfazDependencia } from "../../../nucleo/cancelamento_demanda.ts";
import { resolverConfiguracaoAgente } from "../../../nucleo/configuracao_agente.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../../nucleo/demanda.ts";
import { encontrado } from "../../../nucleo/erros.ts";
import type { EtapaTicket, EstadoDemanda, EstadoRodada, EstadoTicket } from "../../../nucleo/primitivos.ts";
import { arquivar } from "../../../aplicacao/gestao_demandas.ts";
import { configuracaoProjeto } from "../../../armazenamento/configuracao_projeto.ts";
import { carregarDemanda } from "../../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../../armazenamento/dependencias_demanda.ts";
import { projeto } from "../../../armazenamento/projetos.ts";
import { ticketsComPiAtivo } from "../../../armazenamento/sessoes.ts";
import { heatmapDo } from "../../../infra/repositorio/heatmap.ts";
import type { Rota } from "../rotas.ts";

/** Uma linha da página do projeto: a demanda, as rodadas com o PR e os tickets com o modelo efetivo e a sessão. */
export interface DemandaDoProjeto {
  id: string;
  titulo: string;
  tipo: TipoDemanda;
  estado: EstadoDemanda;
  estadoAlteradoEm: string;
  /** As predecessoras ainda em andamento: a cancelada já cancelou esta junto, e não bloqueia mais nada. */
  bloqueadaPor: string[];
  rodadas: { ref: string; titulo: string; estado: EstadoRodada; pr?: { id: string; url: string } }[];
  tickets: {
    ref: string;
    etapa: EtapaTicket;
    estado: EstadoTicket;
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

const Filtro = z.object({
  concluidas: z.stringbool().default(false),
  arquivadas: z.stringbool().default(false),
  canceladas: z.stringbool().default(false),
});

const projetoExistente = (banco: DatabaseSync, nome: string) =>
  encontrado(projeto(banco, nome), `o projeto ${nome} não existe`, "escolha um projeto cadastrado na Configuração");

/** O PR da rodada: o da última evidência `pr_aberto` do ticket `encerrar_rodada` dela, em qualquer estado. */
function prDaRodada(ag: AgregadoDemanda, rodada_id: number): { id: string; url: string } | undefined {
  const ticket = ag.tickets.findLast((t) => t.rodada_id === rodada_id && t.etapa === "encerrar_rodada");
  const pr = ag.evidencias.findLast((e) => e.ticket_id === ticket?.ticket_id && e.tipo === "pr_aberto")?.dados as
    { id: string; url: string } | undefined;
  return pr && { id: pr.id, url: pr.url };
}

function demandaDoProjeto(banco: DatabaseSync, id: string): DemandaDoProjeto {
  const ag = carregarDemanda(banco, id);
  const etapas = configuracaoProjeto(banco, ag.demanda.projeto)?.etapas ?? [];
  // Com mais de uma sessão no ticket, vale a mais recente, como na página da demanda.
  const sessoes = new Map(
    (
      banco.prepare("SELECT ticket_id, id FROM sessao WHERE demanda_id = ? ORDER BY rowid").all(id) as {
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
    estadoAlteradoEm: ag.demanda.estado_alterado_em,
    bloqueadaPor: predecessorasDaDemanda(banco, id)
      .filter((p) => !satisfazDependencia(p.estado) && p.estado !== "cancelada")
      .map((p) => p.demanda_id),
    rodadas: ag.rodadas.map((r) => {
      const pr = prDaRodada(ag, r.rodada_id);
      return { ref: rodada(r.rodada_id), titulo: r.titulo, estado: r.estado, ...(pr && { pr }) };
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
  projetoExistente(banco, nome);
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
      andamento: todas.length - contagem.concluidas - contagem.arquivadas - contagem.canceladas,
      ...contagem,
    },
  };
}

/** Arquivar concluídas: cada demanda concluída do projeto, uma transação por demanda, como o Arquivar da demanda. */
function arquivarConcluidas(banco: DatabaseSync, nome: string): { arquivadas: number } {
  projetoExistente(banco, nome);
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
    tratar: ({ banco, params }) => heatmapDo(projetoExistente(banco, String(params.nome))),
  },
];
