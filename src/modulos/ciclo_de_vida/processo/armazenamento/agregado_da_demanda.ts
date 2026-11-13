// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença.
// Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira. O estado da demanda fica em
// `processo_demanda`; o conteúdo do pedido vem de Demandas, como dado, e o Processo não o grava. As tabelas dos itens de
// Planejamento (rodadas, tickets, vínculos e versões do Plano) passam pela API dele, e as Evidências, pela delas.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { AgregadoDemanda } from "../nucleo/agregado/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, EstadoDemanda } from "../nucleo/ciclos/ciclos.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { escrever, instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import { pedidosRecebidosEmLote, type PedidoRecebido } from "./pedidos_recebidos.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import {
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  semNulos,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/diferenca_do_agregado.ts";
import {
  apagarEstadoDoProcessoDasDemandas,
  apagarEstadoQueSumiu,
  carregarEstadoDoProcesso,
  gravarEstadoNovoEMudado,
} from "./estado_do_processo.ts";
import {
  apagarItensDasDemandas,
  apagarItensQueSumiram,
  carregarItensDoPlanejamento,
  gravarItensNovosEMudados,
} from "../../planejamento/publico.ts";
import {
  anexosCitadosPorEvidencia,
  anexosDasDemandasEmLote,
  apagarEvidenciasDasDemandas,
  gravarEvidenciasNovasEAlteradas,
  gravarRetiradaDasEvidencias,
  lerEvidenciasDaDemanda,
} from "../../evidencias/publico.ts";

/** O estado da demanda no Processo, uma linha por demanda, filha da linha do pedido. */
const TABELA_DO_ESTADO_DA_DEMANDA: TabelaDoAgregado<AgregadoDemanda> = {
  nome: "processo_demanda",
  chave: ["demanda_id"],
  linhas: ({ demanda: { id, estado, estado_alterado_em, branch } }) => [
    { demanda_id: id, estado, estado_alterado_em, branch },
  ],
};

/**
 * As tabelas do agregado que dependem dos itens de Planejamento, dos pais para os filhos: insere e atualiza nessa ordem
 * e apaga na inversa, porque as FKs são RESTRICT. As do Processo, filhas dos tickets e do PR final, e as evidências,
 * filhas da rodada e do ticket, são dos armazenamentos deles: saem antes e entram depois destas.
 */
const TABELAS_QUE_DEPENDEM_DOS_ITENS: readonly TabelaDoAgregado<AgregadoDemanda>[] = [
  {
    nome: "pull_request",
    chave: ["demanda_id", "rodada_id"],
    linhas: (ag) =>
      ag.pull_requests.map((pr) => ({ ...pr, demanda_id: ag.demanda.id, rodada_id: pr.rodada_id ?? null })),
  },
];

/**
 * Grava só a diferença entre `antes` e `depois`: insere o novo, atualiza o que mudou, apaga o que sumiu. Os itens de
 * Planejamento ficam no meio: dependem só da demanda, e as demais tabelas dependem deles.
 */
function gravarDiferenca(banco: DatabaseSync, antes: AgregadoDemanda | undefined, depois: AgregadoDemanda): void {
  gravarRetiradaDasEvidencias(banco, antes?.evidencias ?? [], depois.evidencias);
  apagarEstadoQueSumiu(banco, antes, depois);
  apagarLinhasQueSumiram(banco, TABELAS_QUE_DEPENDEM_DOS_ITENS, antes, depois);
  apagarItensQueSumiram(banco, antes, depois);
  apagarLinhasQueSumiram(banco, [TABELA_DO_ESTADO_DA_DEMANDA], antes, depois);
  gravarLinhasNovasEMudadas(banco, [TABELA_DO_ESTADO_DA_DEMANDA], antes, depois);
  gravarItensNovosEMudados(banco, antes, depois);
  gravarLinhasNovasEMudadas(banco, TABELAS_QUE_DEPENDEM_DOS_ITENS, antes, depois);
  gravarEstadoNovoEMudado(banco, antes, depois);
  gravarEvidenciasNovasEAlteradas(banco, antes?.evidencias ?? [], depois.evidencias);
}

function carregar(
  banco: DatabaseSync,
  id: string,
  pedidos: ReadonlyMap<string, PedidoRecebido>,
  preparar: (sql: string) => StatementSync = (sql) => banco.prepare(sql),
): AgregadoDemanda | undefined {
  const estado = preparar("SELECT estado, estado_alterado_em, branch FROM processo_demanda WHERE demanda_id = ?").get(
    id,
  );
  const pedido = pedidos.get(id);
  if (!estado || !pedido) return undefined;
  return AgregadoDemanda.parse({
    demanda: { ...pedido, ...estado },
    ...carregarItensDoPlanejamento(preparar, id),
    ...carregarEstadoDoProcesso(preparar, id),
    pull_requests: preparar("SELECT * FROM pull_request WHERE demanda_id = ? ORDER BY rowid").all(id).map(semNulos),
    evidencias: lerEvidenciasDaDemanda(id, preparar),
  });
}

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda =>
  encontrado(
    carregar(banco, id, pedidosRecebidosEmLote(banco, [id])),
    `a demanda ${id} não existe`,
    "confira o id da demanda",
  );

/** O agregado da demanda, lido num snapshot só; demanda inexistente dá `ErroDeInexistente`. */
export function carregarDemanda(banco: DatabaseSync, id: string): AgregadoDemanda {
  return lerEmSnapshot(banco, () => existente(banco, id));
}

/**
 * Os agregados de `ids`, na ordem pedida, lidos num snapshot só e com cada SQL preparado uma vez, não uma por demanda;
 * demanda inexistente dá `ErroDeInexistente`.
 * @testes o teste exercita direto; a produção a usa só dentro do módulo (a consulta que a usa vem em seguida)
 */
export function carregarDemandas(banco: DatabaseSync, ids: readonly string[]): AgregadoDemanda[] {
  const preparados = new Map<string, StatementSync>();
  const preparar = (sql: string) => {
    const preparado = preparados.get(sql) ?? banco.prepare(sql);
    preparados.set(sql, preparado);
    return preparado;
  };
  return lerEmSnapshot(banco, () => {
    const pedidos = pedidosRecebidosEmLote(banco, ids);
    return ids.map((id) =>
      encontrado(carregar(banco, id, pedidos, preparar), `a demanda ${id} não existe`, "confira o id da demanda"),
    );
  });
}

/**
 * As demandas em ordem de criação; as arquivadas só com `arquivadas: true` (o board não as mostra) e, com
 * `soNaoTerminadas`, só as que não terminaram (o Início).
 */
export function listarDemandas(
  banco: DatabaseSync,
  { arquivadas = false, soNaoTerminadas = false }: { arquivadas?: boolean; soNaoTerminadas?: boolean } = {},
): AgregadoDemanda[] {
  return lerEmSnapshot(banco, () => {
    const filtro = soNaoTerminadas
      ? `WHERE NOT ${CICLO_DA_DEMANDA.sqlDosTerminais("estado")}`
      : arquivadas
        ? ""
        : "WHERE estado <> 'arquivada'";
    const ids = banco.prepare(`SELECT demanda_id FROM processo_demanda ${filtro} ORDER BY rowid`).all();
    return carregarDemandas(
      banco,
      ids.map((l) => String(l.demanda_id)),
    );
  });
}

/** O andamento de cada demanda de `ids`, ou de todas sem `ids`: o estado do processo e o instante da última mudança. */
export const andamentoDasDemandasEmLote = (
  banco: DatabaseSync,
  ids?: readonly string[],
): Map<string, { estado: string; estadoAlteradoEm: string }> =>
  new Map(
    instrucaoPreparada(
      banco,
      `SELECT demanda_id, estado, estado_alterado_em FROM processo_demanda
        WHERE $ids IS NULL OR demanda_id IN (SELECT value FROM json_each($ids))`,
    )
      .all({ ids: ids === undefined ? null : JSON.stringify(ids) })
      .map((linha) => [
        String(linha.demanda_id),
        { estado: String(linha.estado), estadoAlteradoEm: String(linha.estado_alterado_em) },
      ]),
  );

/** As demandas `ids`, na ordem pedida, só com o id e o estado; a que não tem processo não entra. */
export const situacaoDasDemandas = (
  banco: DatabaseSync,
  ids: readonly string[],
): { id: string; estado: EstadoDemanda }[] => {
  const estados = new Map(
    banco
      .prepare("SELECT demanda_id, estado FROM processo_demanda WHERE demanda_id IN (SELECT value FROM json_each(?))")
      .all(JSON.stringify(ids))
      .map((linha) => [String(linha.demanda_id), EstadoDemanda.parse(linha.estado)]),
  );
  return ids.flatMap((id) => {
    const estado = estados.get(id);
    return estado === undefined ? [] : [{ id, estado }];
  });
};

/** Os ids das demandas cujo processo está num dos `estados`, na ordem de criação. */
export const demandasNosEstados = (banco: DatabaseSync, estados: readonly EstadoDemanda[]): string[] =>
  banco
    .prepare("SELECT demanda_id FROM processo_demanda WHERE estado IN (SELECT value FROM json_each(?)) ORDER BY rowid")
    .all(JSON.stringify(estados))
    .map((linha) => String(linha.demanda_id));

/** Grava o agregado novo, com o ID que o pedido já alocou; o erro na gravação desfaz a transação. */
export const gravarDemandaNova = (banco: DatabaseSync, agregado: AgregadoDemanda): AgregadoDemanda =>
  escrever(banco, () => {
    gravarDiferenca(banco, undefined, agregado);
    return agregado;
  });

/**
 * Carrega a demanda, aplica a transição do domínio e grava a diferença numa transação só. `aposGravar` roda ainda
 * dentro dela, depois da diferença (é como anexos e sessões externas entram junto da evidência).
 */
export const comDemanda = (
  banco: DatabaseSync,
  id: string,
  transicao: (agregado: AgregadoDemanda) => AgregadoDemanda,
  aposGravar?: (depois: AgregadoDemanda) => void,
): AgregadoDemanda =>
  escrever(banco, () => {
    const antes = existente(banco, id);
    const depois = transicao(antes);
    gravarDiferenca(banco, antes, depois);
    aposGravar?.(depois);
    return depois;
  });

/**
 * Na remoção do projeto: o desenvolvimento das `demandas` inteiro, na ordem das chaves estrangeiras (o estado do Processo,
 * as Evidências, os PRs, os itens de Planejamento e, por último, o estado de cada demanda). Devolve, dos anexos das
 * evidências apagadas, os que nenhuma outra evidência cita.
 */
export function apagarDesenvolvimentoDasDemandas(banco: DatabaseSync, demandaIds: readonly string[]): string[] {
  const anexos = anexosDasDemandasEmLote(banco, demandaIds);
  const dasDemandas = JSON.stringify(demandaIds);
  apagarEstadoDoProcessoDasDemandas(banco, demandaIds);
  apagarEvidenciasDasDemandas(banco, demandaIds);
  banco.prepare("DELETE FROM pull_request WHERE demanda_id IN (SELECT value FROM json_each(?))").run(dasDemandas);
  apagarItensDasDemandas(banco, demandaIds);
  banco.prepare("DELETE FROM processo_demanda WHERE demanda_id IN (SELECT value FROM json_each(?))").run(dasDemandas);
  const citados = anexosCitadosPorEvidencia(banco, anexos);
  return anexos.filter((sha256) => !citados.has(sha256));
}
