// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença.
// Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira. O estado da demanda fica em
// `processo_demanda`; o conteúdo do pedido vem de Demandas, como dado, e o Processo não o grava. As tabelas dos itens de
// Planejamento (rodadas, tickets, vínculos e versões do Plano) passam pela API dele, e as Evidências, pela delas.
import type { DatabaseSync } from "node:sqlite";
import { AgregadoDemanda, ResumoDaDemanda } from "../nucleo/agregado/agregado_demanda.ts";
import { CICLO_DA_DEMANDA, EstadoDemanda } from "../nucleo/ciclos/ciclos.ts";
import { encontrado } from "../../../../shared/nucleo/erros.ts";
import { escrever, instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import { pedidosRecebidosEmLote, type PedidoRecebido } from "./pedidos_recebidos.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";
import {
  linhasDeUmAgregado,
  type LinhasDoAgregado,
  linhasDosAgregadosEmLote,
} from "../../../../shared/armazenamento/linhas/linhas_do_agregado.ts";
import {
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  type TabelaDoAgregado,
} from "../../../../shared/armazenamento/linhas/diferenca_do_agregado.ts";
import {
  apagarEstadoDoProcessoDasDemandas,
  apagarEstadoQueSumiu,
  carregarEstadoDoProcesso,
  gravarEstadoNovoEMudado,
} from "./estado_do_processo.ts";
import {
  apagarPullRequestsDasDemandas,
  apagarPullRequestsQueSumiram,
  gravarPullRequestsNovosEMudados,
  lerPullRequestsDaDemanda,
} from "./pull_requests.ts";
import {
  apagarItensDasDemandas,
  apagarItensQueSumiram,
  carregarItensDoPlanejamento,
  carregarResumoDosItensDoPlanejamento,
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

/** Os PRs do agregado como o Repositório os grava, pela fachada dele: filhos das rodadas, pais do estado do Processo. */
const pullRequestsDe = ({ demanda, pull_requests }: AgregadoDemanda) => ({ demanda_id: demanda.id, pull_requests });

/**
 * Grava só a diferença entre `antes` e `depois`: insere o novo, atualiza o que mudou, apaga o que sumiu, na ordem das FKs
 * (RESTRICT): os itens de Planejamento ficam no meio, porque dependem só da demanda e os PRs dependem deles; o estado do
 * Processo, filho dos tickets e do PR final, e as Evidências, filhas da rodada e do ticket, saem antes e entram depois.
 */
function gravarDiferenca(banco: DatabaseSync, antes: AgregadoDemanda | undefined, depois: AgregadoDemanda): void {
  gravarRetiradaDasEvidencias(banco, antes?.evidencias ?? [], depois.evidencias);
  apagarEstadoQueSumiu(banco, antes, depois);
  apagarPullRequestsQueSumiram(banco, antes && pullRequestsDe(antes), pullRequestsDe(depois));
  apagarItensQueSumiram(banco, antes, depois);
  apagarLinhasQueSumiram(banco, [TABELA_DO_ESTADO_DA_DEMANDA], antes, depois);
  gravarLinhasNovasEMudadas(banco, [TABELA_DO_ESTADO_DA_DEMANDA], antes, depois);
  gravarItensNovosEMudados(banco, antes, depois);
  gravarPullRequestsNovosEMudados(banco, antes && pullRequestsDe(antes), pullRequestsDe(depois));
  gravarEstadoNovoEMudado(banco, antes, depois);
  gravarEvidenciasNovasEAlteradas(banco, antes?.evidencias ?? [], depois.evidencias);
}

/** O estado da demanda no Processo e o pedido que ela recebeu de Demandas; sem um dos dois, a demanda não existe. */
function demandaLida(linhasDaDemanda: LinhasDoAgregado, pedido: PedidoRecebido | undefined) {
  const [estado] = linhasDaDemanda("processo_demanda");
  if (!estado || !pedido) return undefined;
  const { estado: estadoDaDemanda, estado_alterado_em, branch } = estado;
  return { ...pedido, estado: estadoDaDemanda, estado_alterado_em, branch };
}

const naoExiste = (id: string) => [`a demanda ${id} não existe`, "confira o id da demanda"] as const;

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda => {
  const linhasDaDemanda = linhasDeUmAgregado(banco, "demanda_id", id);
  const demanda = encontrado(
    demandaLida(linhasDaDemanda, pedidosRecebidosEmLote(banco, [id]).get(id)),
    ...naoExiste(id),
  );
  return AgregadoDemanda.parse({
    demanda,
    ...carregarItensDoPlanejamento(linhasDaDemanda),
    ...carregarEstadoDoProcesso(linhasDaDemanda, id),
    pull_requests: lerPullRequestsDaDemanda(linhasDaDemanda),
    evidencias: lerEvidenciasDaDemanda(linhasDaDemanda),
  });
};

/** O agregado da demanda, lido num snapshot só; demanda inexistente dá `ErroDeInexistente`. */
export function carregarDemanda(banco: DatabaseSync, id: string): AgregadoDemanda {
  return lerEmSnapshot(banco, () => existente(banco, id));
}

/**
 * Os resumos das demandas `ids`, na ordem pedida, para as listagens: lidos num snapshot só e em lote, com uma execução
 * SQL por tabela, qualquer que seja o número de demandas; demanda inexistente dá `ErroDeInexistente`.
 */
export function resumosDasDemandas(banco: DatabaseSync, ids: readonly string[]): ResumoDaDemanda[] {
  return lerEmSnapshot(banco, () => {
    const pedidos = pedidosRecebidosEmLote(banco, ids);
    const linhasDe = linhasDosAgregadosEmLote(banco, "demanda_id", ids);
    return ids.map((id) => {
      const linhasDaDemanda = linhasDe(id);
      return ResumoDaDemanda.parse({
        demanda: encontrado(demandaLida(linhasDaDemanda, pedidos.get(id)), ...naoExiste(id)),
        ...carregarResumoDosItensDoPlanejamento(linhasDaDemanda),
        ...carregarEstadoDoProcesso(linhasDaDemanda, id),
        pull_requests: lerPullRequestsDaDemanda(linhasDaDemanda),
      });
    });
  });
}

/**
 * Os resumos das demandas em ordem de criação; as arquivadas só com `arquivadas: true` (o board não as mostra) e, com
 * `soNaoTerminadas`, só as que não terminaram (o Início).
 */
export function listarResumosDasDemandas(
  banco: DatabaseSync,
  { arquivadas = false, soNaoTerminadas = false }: { arquivadas?: boolean; soNaoTerminadas?: boolean } = {},
): ResumoDaDemanda[] {
  return lerEmSnapshot(banco, () => {
    const filtro = soNaoTerminadas
      ? `WHERE NOT ${CICLO_DA_DEMANDA.sqlDosTerminais("estado")}`
      : arquivadas
        ? ""
        : "WHERE estado <> 'arquivada'";
    const ids = banco.prepare(`SELECT demanda_id FROM processo_demanda ${filtro} ORDER BY rowid`).all();
    return resumosDasDemandas(
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
  apagarPullRequestsDasDemandas(banco, demandaIds);
  apagarItensDasDemandas(banco, demandaIds);
  banco.prepare("DELETE FROM processo_demanda WHERE demanda_id IN (SELECT value FROM json_each(?))").run(dasDemandas);
  const citados = anexosCitadosPorEvidencia(banco, anexos);
  return anexos.filter((sha256) => !citados.has(sha256));
}
