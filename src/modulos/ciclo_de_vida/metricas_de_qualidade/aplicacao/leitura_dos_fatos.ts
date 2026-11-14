// A aquisição dos fatos das Métricas (MELHORIAS §11, regras 12 a 14): cada leitura pede ao dono do fato, pela API do
// subdomínio ou pela fachada do domínio, em lote, e junta em memória o que antes um SQL juntava. Nenhuma fala SQL: as
// Métricas não têm tabela, e os pedidos chegam como dado de quem pede (o Ciclo de Vida não importa Demandas). A leitura
// que mais de uma Métrica pede é feita uma vez por escopo: as Métricas do mesmo pedido recebem o mesmo escopo.
import type { DatabaseSync } from "node:sqlite";
import { encontrado, ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import type { RepositorioDoProjeto } from "../../../repositorio/publico.ts";
import { primeiraEvidenciaDasDemandas } from "../../evidencias/publico.ts";
import { type ResumoDoTicket, ticketsDasDemandas } from "../../planejamento/publico.ts";
import { decisoesEmLote } from "../../processo/publico.ts";
import type { PedidoDasMetricas, Recorte } from "../nucleo/metrica.ts";

/** De onde as Métricas leem: o banco, pelos donos de cada fato, o Repositório e os pedidos de todas as demandas, como dado. */
export interface OrigemDosFatos {
  banco: DatabaseSync;
  repositorio: Pick<RepositorioDoProjeto, "metricas">;
  pedidos: readonly PedidoDasMetricas[];
}

/** O recorte resolvido: o período e os pedidos das demandas que ele alcança, pelo projeto e pela demanda. */
export interface EscopoDosFatos {
  banco: DatabaseSync;
  repositorio: Pick<RepositorioDoProjeto, "metricas">;
  periodo: Pick<Recorte, "inicio" | "fim">;
  pedidos: readonly PedidoDasMetricas[];
  demandas: readonly string[];
}

/** O recorte de uma Demanda que não existe falha: zero seria um total que ninguém registrou. */
export function escopoDoRecorte({ banco, repositorio, pedidos }: OrigemDosFatos, recorte: Recorte): EscopoDosFatos {
  const { inicio, fim, projeto, demandaId } = recorte;
  if (demandaId !== undefined && !pedidos.some((pedido) => pedido.id === demandaId))
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o id da demanda");
  const doRecorte = pedidos.filter(
    (pedido) =>
      (projeto === undefined || projeto === null || pedido.projeto === projeto) &&
      (demandaId === undefined || pedido.id === demandaId),
  );
  return {
    banco,
    repositorio,
    periodo: { inicio, fim },
    pedidos: doRecorte,
    demandas: doRecorte.map((pedido) => pedido.id),
  };
}

/** A leitura feita uma vez por escopo: a segunda Métrica que a pede recebe o que a primeira leu. */
function lidaUmaVezPorEscopo<Lido>(ler: (escopo: EscopoDosFatos) => Lido): (escopo: EscopoDosFatos) => Lido {
  const lidasPorEscopo = new WeakMap<EscopoDosFatos, Lido>();
  return (escopo) => {
    if (!lidasPorEscopo.has(escopo)) lidasPorEscopo.set(escopo, ler(escopo));
    return lidasPorEscopo.get(escopo) as Lido;
  };
}

/** Os tickets das demandas do escopo, lidos em lote de Planejamento. */
export const ticketsDoEscopo = lidaUmaVezPorEscopo((escopo) => ticketsDasDemandas(escopo.banco, escopo.demandas));

/** O instante da primeira evidência de cada demanda do escopo que tem alguma. */
export const primeiraEvidenciaDoEscopo = lidaUmaVezPorEscopo((escopo) =>
  primeiraEvidenciaDasDemandas(escopo.banco, escopo.demandas),
);

/**
 * O ticket de cada fato, entre os das demandas do escopo. O ticket existe: sessão, Decisão, Tentativa e commit têm chave
 * estrangeira para ele.
 */
export const ticketsCitados = lidaUmaVezPorEscopo(
  (escopo): ((demandaId: string, ticketId: number) => ResumoDoTicket) => {
    const porChave = new Map(
      ticketsDoEscopo(escopo).map((ticket) => [`${ticket.demanda_id}\0${String(ticket.ticket_id)}`, ticket]),
    );
    return (demandaId, ticketId) =>
      encontrado(
        porChave.get(`${demandaId}\0${String(ticketId)}`),
        `o ticket ${String(ticketId)} de ${demandaId} não existe`,
        "confira a chave estrangeira do fato para o ticket",
      );
  },
);

/** As Decisões tomadas no recorte, com a Etapa do ticket decidido. */
export const lerDecisoesDoRecorte = lidaUmaVezPorEscopo((escopo) => {
  const decisoes = decisoesEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
  const ticketDe = ticketsCitados(escopo);
  return decisoes.map((decisao) => ({
    demanda_id: decisao.demanda_id,
    em: decisao.em,
    etapa: ticketDe(decisao.demanda_id, decisao.ticket_id).etapa,
    reprovada: decisao.resultado === "reprovado",
    nota: decisao.nota,
  }));
});

/**
 * Os commits de ticket das demandas do escopo, de qualquer período, com os arquivos, lidos do Repositório: a conformidade
 * compara a rodada inteira.
 */
export const lerCommitsDoEscopo = lidaUmaVezPorEscopo(
  (escopo) => escopo.repositorio.metricas({ demandas: escopo.demandas, periodo: {} }).commits,
);
