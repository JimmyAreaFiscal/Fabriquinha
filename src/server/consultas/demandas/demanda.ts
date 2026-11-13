// A consulta da página de uma demanda, montada no contrato da API (contrato/) a partir de um snapshot só, com as leituras
// em lote, sem uma consulta por ticket ou por dependente. O board é de board_de_demandas.ts.
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../../shared/nucleo/relogio.ts";
import { lerEmSnapshot } from "../../../shared/armazenamento/snapshot.ts";
import {
  type AgregadoDemanda,
  anexosDaDemanda,
  carregarDemanda,
  carregarDemandas,
  CICLO_DA_DEMANDA,
  CICLO_DO_TICKET,
  Despacho,
  EtapaTicket,
  formatarRodadaRef,
  formatarTicketRef,
  gateQueEsperaGenteNaRodada,
  lerAnexo,
  motivoDaFalhaDoTicket,
  prDaDemanda,
  prontosParaExecutarAgora,
  ticketAtualDaEtapa,
  usoDaDemanda,
} from "../../../modulos/ciclo_de_vida/publico.ts";
import { prDoEspaco } from "../../../modulos/repositorio/publico.ts";
import { sessaoDeCadaTicketDasDemandas } from "../../../modulos/sessoes/publico.ts";
import { dependentesNaoConcluidosDoPedido, origemDoPedido } from "../../../modulos/demandas/publico.ts";
import type { PaginaDaDemanda } from "../../contrato/demanda.ts";
import { ticketsComPiAtivo } from "../sessoes/historico_demanda.ts";
import { lerPedidosDasMetricas } from "./pedidos_das_metricas.ts";
import { pendenciasDeUmaDemanda, situacaoDoCondutor, type SituacaoDaSessao } from "./pendencias.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "./predecessoras.ts";

/** Os endereços públicos das rodadas e dos tickets da demanda. */
export const enderecosNaDemanda = (demanda_id: string) => ({
  rodada: (rodada_id: number) => formatarRodadaRef({ demanda_id, rodada_id }),
  ticket: (ticket_id: number) => formatarTicketRef({ demanda_id, ticket_id }),
});

/** O PR da rodada que espera decisão ou ajustes: o `espaco.pr` dela, só nos estados em que o Gate do PR espera gente. */
export function prDoGateDaRodada(ag: AgregadoDemanda, rodada_id: number): { id: string; url: string } | undefined {
  const estado = ag.rodadas.find((r) => r.rodada_id === rodada_id)?.estado;
  if (estado === undefined || gateQueEsperaGenteNaRodada(estado) === undefined) return undefined;
  const pr = prDoEspaco(ag, rodada_id);
  return pr && { id: String(pr.numero), url: pr.url };
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
    const ag = carregarDemanda(banco, id);
    const { demanda } = ag;
    const predecessoras = predecessorasDe(predecessorasDasDemandas(banco, [id]), id);
    const anexosDasEvidencias = anexosDaDemanda(banco, id);
    const { ticket, rodada } = enderecosNaDemanda(id);
    const achado = origemDoPedido(banco, id);
    const sessoes = new Map(sessaoDeCadaTicketDasDemandas(banco, [id]).get(id));
    const comPiAtivo = ticketsComPiAtivo(banco);
    const { modelos, custo, textoDoCusto } = usoDaDemanda({ banco, pedidos: lerPedidosDasMetricas(banco, [id]) }, id);
    const elegiveis = new Set(
      prontosParaExecutarAgora(
        new Despacho().selecionar({
          demandas: [
            { agregado: ag, predecessoras_pendentes: bloqueiosDaDemanda(predecessoras).map((p) => p.demanda_id) },
          ],
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
      evidencias: ag.evidencias.map((e) => ({
        tipo: e.tipo,
        ...(e.rodada_id !== undefined && { rodada: rodada(e.rodada_id) }),
        ...(e.ticket_id !== undefined && { ticket: ticket(e.ticket_id) }),
        em: e.em,
        dados: e.dados,
        // Os anexos da evidência: os do mesmo tipo e do mesmo dono.
        anexos: anexosDasEvidencias
          .filter((a) => a.tipo === e.tipo && a.rodada_id === e.rodada_id && a.ticket_id === e.ticket_id)
          .map((a) => {
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
      dependentes: carregarDemandas(banco, dependentesNaoConcluidosDoPedido(banco, id)).map(({ demanda: d }) => ({
        demanda_id: d.id,
        titulo: d.titulo,
        estado: d.estado,
      })),
    };
  });
}

/** O anexo `sha256` da evidência com o conteúdo inteiro; só lê o que a evidência registra. */
export const consultarAnexoDaDemanda = lerAnexo;
