// As consultas das telas das demandas: o board e a página de uma demanda, montados no contrato da API (entrega/contrato)
// a partir de um snapshot só, com as leituras em lote, sem uma consulta por ticket ou por dependente.
import type { DatabaseSync } from "node:sqlite";
import { type AgregadoDemanda, prDaDemanda } from "../../nucleo/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, CICLO_DO_TICKET } from "../../../fluxo/nucleo/ciclo_de_vida/ciclos.ts";
import { predecessorasPendentes } from "../../nucleo/item_de_trabalho/dependencia_demanda.ts";
import { formatarRodadaRef, formatarTicketRef } from "../../nucleo/demanda.ts";
import { Despacho, prontosParaExecutarAgora } from "../../../execucao/nucleo/despacho.ts";
import { encontrado } from "../../../compartilhado/nucleo/erros.ts";
import { prDoEspaco } from "../../../repositorio/nucleo/espaco_de_trabalho.ts";
import { ticketAtualDaEtapa } from "../../nucleo/item_de_trabalho/item_de_trabalho.ts";
import { EtapaTicket } from "../../../compartilhado/nucleo/primitivos.ts";
import type { Relogio } from "../../../compartilhado/nucleo/relogio.ts";
import { motivoDaFalhaDoTicket } from "../../../execucao/nucleo/tentativa.ts";
import { achadoDaDemanda } from "../../../qualidade/armazenamento/avaliacoes.ts";
import { carregarDemandas, listarDemandas } from "../../armazenamento/demandas.ts";
import {
  dependentesNaoConcluidasDaDemanda,
  predecessorasDasDemandas,
} from "../../armazenamento/dependencias_demanda.ts";
import { lerAnexo } from "../../../qualidade/armazenamento/evidencia_demanda.ts";
import { lerEmSnapshot } from "../../../compartilhado/armazenamento/snapshot.ts";
import { sessaoDeCadaTicketDaDemanda, ticketsComPiAtivo } from "../../../execucao/armazenamento/trabalho_agentico.ts";
import type { BoardDeDemandas, PaginaDaDemanda } from "../../../entrega/contrato/demanda.ts";
import { usoDaDemanda } from "../../../custos/aplicacao/metricas/metricas_do_periodo.ts";
import { bloqueiosDaDemanda } from "./bloqueios.ts";
import { pendenciasDeUmaDemanda, situacaoDoCondutor, type SituacaoDaSessao } from "./pendencias.ts";
import { visaoDaDemanda } from "./visao_da_demanda.ts";

const ref = (demanda_id: string) => ({
  rodada: (rodada_id: number) => formatarRodadaRef({ demanda_id, rodada_id }),
  ticket: (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id }),
});

/** O PR da rodada que espera decisão ou ajustes: o `espaco.pr` dela, só nos estados de gate. */
function prDoGateDaRodada(ag: AgregadoDemanda, rodada_id: number): { id: string; url: string } | undefined {
  const rodada = ag.rodadas.find((r) => r.rodada_id === rodada_id);
  if (rodada?.estado !== "gate_pr" && rodada?.estado !== "ajustar_resultado") return undefined;
  const pr = prDoEspaco(ag, rodada_id);
  return pr && { id: String(pr.numero), url: pr.url };
}

/** Os tickets `em_execucao` da demanda, com a rodada quando têm e `pi_ativo` quando é o pi que roda. */
const emExecucao = (ag: AgregadoDemanda, comPiAtivo: ReadonlySet<string>): BoardDeDemandas["trabalho"] =>
  ag.tickets
    .filter((t) => t.estado === "em_execucao")
    .map((t) => {
      const ticketRef = ref(ag.demanda.id).ticket(t.ticket_id);
      return {
        ref: ticketRef,
        etapa: t.etapa,
        ...(t.rodada_id !== undefined && { rodada: ref(ag.demanda.id).rodada(t.rodada_id) }),
        ...(comPiAtivo.has(ticketRef) && { pi_ativo: true as const }),
      };
    });

/** O board: as demandas fora das arquivadas e, no total, o trabalho global ativo. */
export function consultarBoardDeDemandas(
  banco: DatabaseSync,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacaoDoCondutor,
): BoardDeDemandas {
  return lerEmSnapshot(banco, () => {
    const todas = listarDemandas(banco);
    const comPiAtivo = ticketsComPiAtivo(banco);
    const predecessoras = predecessorasDasDemandas(
      banco,
      todas.map((ag) => ag.demanda.id),
    );
    const agora = relogio.agora();
    return {
      demandas: todas.map((ag) => {
        const { id, projeto, titulo, estado } = ag.demanda;
        return {
          id,
          projeto,
          titulo,
          estado,
          terminal: CICLO_DA_DEMANDA.ehTerminal(estado),
          rodadas: ag.rodadas.map((r) => {
            const pr = prDoGateDaRodada(ag, r.rodada_id);
            return { ref: ref(id).rodada(r.rodada_id), estado: r.estado, ...(pr && { pr }) };
          }),
          bloqueios: bloqueiosDaDemanda(
            encontrado(predecessoras.get(id), `a demanda ${id} não foi lida`, "recarregue"),
          ),
          pendencias: pendenciasDeUmaDemanda(banco, ag, situacaoDa, agora),
        };
      }),
      trabalho: todas.flatMap((ag) => emExecucao(ag, comPiAtivo)),
    };
  });
}

/** A classe do anexo pelo mime, para a tela escolher como mostrar. */
const classeDoMime = (mime: string): "imagem" | "video" | "html" | "texto" | "outro" => {
  if (mime.startsWith("image/")) return "imagem";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("text/html")) return "html";
  return mime.startsWith("text/") || mime === "application/json" ? "texto" : "outro";
};

/** Os passos do encerramento final: feito o que o progresso já registra. */
const passosDoEncerramento = (ag: AgregadoDemanda): PaginaDaDemanda["encerramento"] => {
  const e = ag.encerramento;
  const pr = prDaDemanda(ag);
  return {
    passos: [
      { passo: "verificacao", feito: e?.sha_verificado !== undefined },
      { passo: "pr", feito: pr !== undefined },
      { passo: "integracao", feito: e?.integracao !== undefined },
    ],
    limpeza_pendente: e?.limpeza_pendente ?? [],
    ...(e?.falha && { falha: e.falha }),
    ...(e?.aguardando_merge_humano && pr && { aguardando_merge: { url: pr.url } }),
  };
};

/** A página da demanda `id`, lida num snapshot só; as dependentes que o cancelamento leva junto vêm de uma leitura em lote. */
export function consultarDemanda(
  banco: DatabaseSync,
  id: string,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacaoDoCondutor,
): PaginaDaDemanda {
  return lerEmSnapshot(banco, () => {
    const { agregado: ag, predecessoras, evidencias } = visaoDaDemanda(banco, id);
    const { demanda } = ag;
    const { ticket, rodada } = ref(id);
    const achado = achadoDaDemanda(banco, id);
    const sessoes = sessaoDeCadaTicketDaDemanda(banco, id);
    const comPiAtivo = ticketsComPiAtivo(banco);
    const { modelos, custo, textoDoCusto } = usoDaDemanda(banco, id);
    const elegiveis = new Set(
      prontosParaExecutarAgora(
        new Despacho().selecionar({
          demandas: [{ agregado: ag, predecessoras_pendentes: predecessorasPendentes(predecessoras) }],
          vivos: [], // só a retomada do planejamento depende do trabalho vivo, e ela não é do Auditor
        }),
      ).map((t) => t.ticket_id),
    );
    return {
      pendencias: pendenciasDeUmaDemanda(banco, ag, situacaoDa, relogio.agora()),
      ...(achado && { origem: { avaliacao: achado.avaliacao_id, achado: achado.achado_id, titulo: achado.titulo } }),
      demanda: {
        id,
        projeto: demanda.projeto,
        titulo: demanda.titulo,
        tipo: demanda.tipo,
        descricao: demanda.descricao,
        estado: demanda.estado,
        terminal: CICLO_DA_DEMANDA.ehTerminal(demanda.estado),
        arquivavel: CICLO_DA_DEMANDA.transicoes[demanda.estado].includes("arquivada"),
      },
      uso: { modelos, custo, textoDoCusto },
      rodadas: ag.rodadas.map((r) => {
        const pr = prDoGateDaRodada(ag, r.rodada_id);
        return {
          ref: rodada(r.rodada_id),
          titulo: r.titulo,
          estado: r.estado,
          ...(pr && { pr }),
          ticket_atual_por_etapa: Object.fromEntries(
            EtapaTicket.options.flatMap((etapa) => {
              const atual = ticketAtualDaEtapa(ag, etapa, r.rodada_id);
              return atual ? [[etapa, ticket(atual.ticket_id)]] : [];
            }),
          ),
        };
      }),
      tickets: ag.tickets.map((t) => {
        const motivo = motivoDaFalhaDoTicket(ag.tentativas, t);
        return {
          ref: ticket(t.ticket_id),
          etapa: t.etapa,
          estado: t.estado,
          satisfaz_dependencia: CICLO_DO_TICKET.satisfazDependencia(t.estado),
          elegivel: elegiveis.has(t.ticket_id),
          ...(sessoes.has(t.ticket_id) && { sessao: sessoes.get(t.ticket_id) }),
          ...(comPiAtivo.has(ticket(t.ticket_id)) && { pi_ativo: true as const }),
          ...(t.rodada_id !== undefined && { rodada: rodada(t.rodada_id) }),
          ...(t.titulo !== undefined && { titulo: t.titulo }),
          ...(t.instrucao !== undefined && { instrucao: t.instrucao }),
          ...(motivo !== undefined && { motivo }),
        };
      }),
      // A tela mostra `por` em texto: o tipo do Ator, como era antes do Ator único.
      decisoes: ag.decisoes.map(({ ticket_id, decisao_id: _, demanda_id: __, por, ...d }) => ({
        ticket: ticket(ticket_id),
        ...d,
        por: por.tipo,
      })),
      evidencias: evidencias.map(({ evidencia: e, anexos }) => ({
        tipo: e.tipo,
        ...(e.rodada_id !== undefined && { rodada: rodada(e.rodada_id) }),
        ...(e.ticket_id !== undefined && { ticket: ticket(e.ticket_id) }),
        em: e.em,
        dados: e.dados,
        anexos: anexos.map((a) => {
          const dono = new URLSearchParams({ tipo: a.tipo });
          if (a.rodada_id !== undefined) dono.set("rodada", String(a.rodada_id));
          if (a.ticket_id !== undefined) dono.set("ticket", String(a.ticket_id));
          return {
            nome: a.nome,
            classe: classeDoMime(a.mime),
            mime: a.mime,
            bytes: a.bytes,
            link: `/api/demandas/${id}/anexos/${a.sha256}?${dono.toString()}`,
          };
        }),
      })),
      encerramento: passosDoEncerramento(ag),
      dependencias: predecessoras,
      dependentes: carregarDemandas(banco, dependentesNaoConcluidasDaDemanda(banco, id)).map(({ demanda: d }) => ({
        demanda_id: d.id,
        titulo: d.titulo,
        estado: d.estado,
      })),
    };
  });
}

/** O anexo `sha256` da evidência com o conteúdo inteiro; só lê o que a evidência registra. */
export const consultarAnexoDaDemanda = lerAnexo;
