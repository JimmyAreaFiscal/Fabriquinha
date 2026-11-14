// A consulta da página de uma demanda, montada no contrato da API (contrato/) a partir de um snapshot só, com as leituras
// em lote, sem uma consulta por ticket ou por dependente. O board é de board_de_demandas.ts.
import { montarRepositorio } from "../../../../../modulos/repositorio/publico.ts";
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../../../../shared/nucleo/relogio.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { lerEmSnapshot } from "../../../../../shared/armazenamento/snapshot.ts";
import {
  type Andamento,
  type CicloDeVida,
  Endereco,
  type ResumoDaDemanda,
} from "../../../../../modulos/ciclo_de_vida/publico.ts";
import { usoDaDemanda } from "../../metricas/metricas_do_periodo.ts";
import { prDoEspaco } from "../../../../../modulos/repositorio/publico.ts";
import type { GestaoDeDemandas } from "../../../../../modulos/demandas/publico.ts";
import type { PaginaDaDemanda } from "../../contrato/demanda.ts";
import { sessaoDeCadaTicketDasDemandas, ticketsComPiAtivo } from "../../sessoes/historico_demanda.ts";
import { lerPedidosDasMetricas } from "./pedidos_das_metricas.ts";
import { pendenciasDeUmaDemanda, situacoesDoBanco, type SituacaoDaSessao } from "./pendencias.ts";
import { bloqueiosDaDemanda, predecessorasDasDemandas, predecessorasDe } from "./predecessoras.ts";

/** Os endereços públicos das rodadas e dos tickets da demanda. */
export const enderecosNaDemanda = (demanda_id: string) => ({
  rodada: (rodada_id: number) => Endereco.daRodada(demanda_id, rodada_id).toString(),
  ticket: (ticket_id: number) => Endereco.doTicket(demanda_id, ticket_id).toString(),
});

/** O PR da rodada que espera decisão ou ajustes: o `espaco.pr` dela, só nos estados em que o Gate do PR espera gente. */
export function prDoGateDaRodada(
  cicloDeVida: CicloDeVida,
  ag: ResumoDaDemanda,
  rodada_id: number,
): { id: string; url: string } | undefined {
  const estado = ag.rodadas.find((r) => r.rodada_id === rodada_id)?.estado;
  if (estado === undefined || cicloDeVida.etapas().rodada.gateQueEsperaGente(estado) === undefined) return undefined;
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
const passosDoEncerramento = ({ agregado, pr }: Andamento): PaginaDaDemanda["encerramento"] => {
  const e = agregado.encerramento;
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
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  relogio: Relogio,
  situacaoDa: SituacaoDaSessao = situacoesDoBanco(banco),
): PaginaDaDemanda {
  return lerEmSnapshot(banco, () => {
    const predecessoras = predecessorasDe(predecessorasDasDemandas(cicloDeVida, gestaoDeDemandas, [id]), id);
    const andamento = cicloDeVida.andamento(id, {
      predecessorasPendentes: bloqueiosDaDemanda(cicloDeVida.etapas(), predecessoras).map((p) => p.demanda_id),
    });
    const { agregado: ag } = andamento;
    const { demanda } = ag;
    const catalogo = cicloDeVida.etapas();
    const { ticket, rodada } = enderecosNaDemanda(id);
    const { origem: achado, dependentesPendentes } = gestaoDeDemandas.pedido(id);
    const sessoes = new Map(sessaoDeCadaTicketDasDemandas(banco, [id]).get(id));
    const comPiAtivo = ticketsComPiAtivo(banco);
    const { modelos, custo, textoDoCusto } = usoDaDemanda(
      {
        banco,
        cicloDeVida,
        repositorio: montarRepositorio({ banco }),
        pedidos: lerPedidosDasMetricas(banco, cicloDeVida, gestaoDeDemandas, [id]),
      },
      id,
    );
    return {
      pendencias: pendenciasDeUmaDemanda(banco, cicloDeVida, gestaoDeDemandas, ag, situacaoDa, relogio.agora()),
      ...(achado && { origem: { avaliacao: achado.avaliacao_id, achado: achado.achado_id, titulo: achado.titulo } }),
      demanda: {
        id,
        projeto: demanda.projeto,
        titulo: demanda.titulo,
        tipo: demanda.tipo,
        descricao: demanda.descricao,
        estado: demanda.estado,
        terminal: catalogo.demanda.ehTerminal(demanda.estado),
        arquivavel: catalogo.demanda.arquivavel(demanda.estado),
      },
      uso: { modelos, custo, textoDoCusto },
      rodadas: ag.rodadas.map((r) => {
        const pr = prDoGateDaRodada(cicloDeVida, ag, r.rodada_id);
        return {
          ref: rodada(r.rodada_id),
          titulo: r.titulo,
          estado: r.estado,
          ...(pr && { pr }),
          ticket_atual_por_etapa: Object.fromEntries(
            Object.entries(
              encontrado(
                andamento.ticketAtualPorRodada.get(r.rodada_id),
                `a rodada ${rodada(r.rodada_id)} não foi lida`,
                "recarregue",
              ),
            ).map(([etapa, atual]) => [etapa, ticket(atual)]),
          ),
        };
      }),
      tickets: ag.tickets.map((t) => {
        const motivo = andamento.motivoDaFalha.get(t.ticket_id);
        return {
          ref: ticket(t.ticket_id),
          etapa: t.etapa,
          estado: t.estado,
          satisfaz_dependencia: catalogo.ticket.satisfazDependencia(t.estado),
          elegivel: andamento.prontosParaExecutarAgora.has(t.ticket_id),
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
      evidencias: andamento.evidencias.map(({ evidencia: e, anexos }) => ({
        tipo: e.tipo,
        ...(e.rodada_id !== undefined && { rodada: rodada(e.rodada_id) }),
        ...(e.ticket_id !== undefined && { ticket: ticket(e.ticket_id) }),
        em: e.em,
        dados: e.dados,
        // Os anexos da evidência: os do mesmo tipo e do mesmo dono.
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
      encerramento: passosDoEncerramento(andamento),
      dependencias: predecessoras,
      dependentes: cicloDeVida.andamentos({ demandas: dependentesPendentes }).map(({ demanda: d }) => ({
        demanda_id: d.id,
        titulo: d.titulo,
        estado: d.estado,
      })),
    };
  });
}
