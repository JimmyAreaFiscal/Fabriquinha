// A aquisição dos fatos das Métricas (MELHORIAS §11, regras 12 a 14): cada leitura pede ao dono do fato, pela API do
// subdomínio ou pela fachada do domínio, em lote, e junta em memória o que antes um SQL juntava. Nenhuma fala SQL: as
// Métricas não têm tabela, e os pedidos chegam como dado de quem pede (o Ciclo de Vida não importa Demandas).
import type { DatabaseSync } from "node:sqlite";
import { encontrado, ErroDeInexistente } from "../../../../shared/nucleo/erros.ts";
import { alteracoesDosCommitsEmLote } from "../../../repositorio/publico.ts";
import { execucoesEmLote, lerUsoDeclaradoEmLote, type LinhaDeUso } from "../../../sessoes/publico.ts";
import { primeiraEvidenciaDasDemandas } from "../../evidencias/publico.ts";
import { type ResumoDoTicket, ticketsDasDemandas } from "../../planejamento/publico.ts";
import { decisoesEmLote } from "../../processo/publico.ts";
import { noPeriodo, type PedidoDasMetricas, type Recorte, registroDoPedido } from "../nucleo/metrica.ts";

/** De onde as Métricas leem: o banco, pelos donos de cada fato, e os pedidos de todas as demandas, como dado. */
export interface OrigemDosFatos {
  banco: DatabaseSync;
  pedidos: readonly PedidoDasMetricas[];
}

/** O recorte resolvido: o período e os pedidos das demandas que ele alcança, pelo projeto e pela demanda. */
export interface EscopoDosFatos {
  banco: DatabaseSync;
  periodo: Pick<Recorte, "inicio" | "fim">;
  pedidos: readonly PedidoDasMetricas[];
  demandas: readonly string[];
}

/** O recorte de uma Demanda que não existe falha: zero seria um total que ninguém registrou. */
export function escopoDoRecorte({ banco, pedidos }: OrigemDosFatos, recorte: Recorte): EscopoDosFatos {
  const { inicio, fim, projeto, demandaId } = recorte;
  if (demandaId !== undefined && !pedidos.some((pedido) => pedido.id === demandaId))
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o id da demanda");
  const doRecorte = pedidos.filter(
    (pedido) =>
      (projeto === undefined || projeto === null || pedido.projeto === projeto) &&
      (demandaId === undefined || pedido.id === demandaId),
  );
  return { banco, periodo: { inicio, fim }, pedidos: doRecorte, demandas: doRecorte.map((pedido) => pedido.id) };
}

/** O dono de uma linha de métrica: a Etapa do ticket e a rodada dele (`null` em ticket de demanda). */
interface DonoDaLinha {
  etapa: string;
  rodadaId: number | null;
}

/**
 * O ticket de cada fato, lido em lote de Planejamento só para as demandas que os fatos citam. O ticket existe: sessão,
 * Decisão, Tentativa e commit têm chave estrangeira para ele.
 */
export function ticketsCitados(
  banco: DatabaseSync,
  fatos: readonly { demanda_id: string }[],
): (demandaId: string, ticketId: number) => ResumoDoTicket {
  const tickets = ticketsDasDemandas(banco, [...new Set(fatos.map((fato) => fato.demanda_id))]);
  const porChave = new Map(tickets.map((ticket) => [`${ticket.demanda_id}\0${String(ticket.ticket_id)}`, ticket]));
  return (demandaId, ticketId) =>
    encontrado(
      porChave.get(`${demandaId}\0${String(ticketId)}`),
      `o ticket ${String(ticketId)} de ${demandaId} não existe`,
      "confira a chave estrangeira do fato para o ticket",
    );
}

const donoDe = (ticket: ResumoDoTicket): DonoDaLinha => ({ etapa: ticket.etapa, rodadaId: ticket.rodada_id });

/** Cada execução vale uma vez, no instante em que começou: a retomada de uma sessão é uma execução nova. */
export function lerExecucoesDoRecorte(escopo: EscopoDosFatos) {
  const execucoes = execucoesEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
  const ticketDe = ticketsCitados(escopo.banco, execucoes);
  return execucoes.map((execucao) => ({ ...execucao, ...donoDe(ticketDe(execucao.demanda_id, execucao.ticket_id)) }));
}

/**
 * O Uso declarado das sessões cuja dona é uma demanda do recorte, no instante do registro dela: a sessão externa não
 * grava data própria.
 * shortcut: o instante é o do registro da demanda; gravar a data da declaração em `uso_declarado` se isso distorcer a série.
 */
export function lerUsoDeclaradoDoRecorte(
  escopo: EscopoDosFatos,
): { demanda: string; em: string; linhas: LinhaDeUso[] }[] {
  const declarados = lerUsoDeclaradoEmLote(escopo.banco, escopo.demandas);
  const primeiraEvidencia = primeiraEvidenciaDasDemandas(escopo.banco, escopo.demandas);
  const registro = new Map(
    escopo.pedidos.map((pedido) => [pedido.id, registroDoPedido(pedido, primeiraEvidencia.get(pedido.id))]),
  );
  return declarados
    .map(({ demanda_id, linhas }) => ({
      demanda: demanda_id,
      em: encontrado(
        registro.get(demanda_id),
        `a demanda ${demanda_id} não está entre os pedidos`,
        "passe os pedidos de todas as demandas do recorte",
      ),
      linhas,
    }))
    .filter((declarado) => noPeriodo(declarado.em, escopo.periodo));
}

/** As Decisões tomadas no recorte, com a Etapa do ticket decidido. */
export function lerDecisoesDoRecorte(escopo: EscopoDosFatos) {
  const decisoes = decisoesEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
  const ticketDe = ticketsCitados(escopo.banco, decisoes);
  return decisoes.map((decisao) => ({
    etapa: ticketDe(decisao.demanda_id, decisao.ticket_id).etapa,
    reprovada: decisao.resultado === "reprovado",
    nota: decisao.nota,
  }));
}

/** Por commit de ticket feito no recorte, a Etapa e a rodada dele, as linhas que ele adicionou e as que uma pessoa alterou depois. */
export function lerCommitsDoRecorte(escopo: EscopoDosFatos) {
  const commits = alteracoesDosCommitsEmLote(escopo.banco, { demandas: escopo.demandas, periodo: escopo.periodo });
  const ticketDe = ticketsCitados(escopo.banco, commits);
  return commits.map((commit) => ({
    ...donoDe(ticketDe(commit.demanda_id, commit.ticket_id)),
    adicionadas: commit.linhasAdicionadas,
    alteradasPorHumanos: commit.linhasAlteradasPorHumanos,
  }));
}
