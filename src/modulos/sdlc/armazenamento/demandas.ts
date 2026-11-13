// Repositório do agregado da demanda SDLC (comparacao-sdlc §7.2 e §7.4): carrega e grava só a diferença.
// Não revalida ao gravar: o domínio valida a transição e o banco é a segunda barreira. As tabelas dos itens de
// Planejamento (rodadas, tickets, vínculos e versões do Plano) passam pela API dele, e as do estado do desenvolvimento
// (Tentativas, Decisões e encerramento), pela do Processo.
import type { DatabaseSync, StatementSync } from "node:sqlite";
import { AgregadoDemanda } from "../nucleo/demanda/agregado_demanda.ts";
import { CICLO_DA_DEMANDA } from "../nucleo/ciclo_de_vida/ciclos.ts";
import { encontrado, ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import type { EstadoDemanda } from "../nucleo/ciclo_de_vida/ciclos.ts";
import { escrever, novoId } from "../../compartilhado/armazenamento/banco.ts";
import { instrucaoPreparada } from "../../../shared/armazenamento/banco.ts";
import { lerEmSnapshot } from "../../compartilhado/armazenamento/snapshot.ts";
import {
  apagarLinhasQueSumiram,
  gravarLinhasNovasEMudadas,
  semNulos,
  type TabelaDoAgregado,
} from "../../../shared/armazenamento/diferenca_do_agregado.ts";
import {
  apagarEstadoQueSumiu,
  apagarItensQueSumiram,
  carregarEstadoDoProcesso,
  carregarItensDoPlanejamento,
  gravarEstadoNovoEMudado,
  gravarEvidenciasNovasEAlteradas,
  gravarItensNovosEMudados,
  gravarRetiradaDasEvidencias,
  lerEvidenciasDaDemanda,
} from "../../ciclo_de_vida/publico.ts";

const bit = (b: boolean) => Number(b);

/** A linha única da demanda: a mãe de todas as tabelas do agregado. */
const TABELA_DA_DEMANDA: TabelaDoAgregado<AgregadoDemanda> = {
  nome: "demanda",
  chave: ["id"],
  linhas: ({ demanda: { criada_por, ...demanda } }) => [
    {
      ...demanda,
      criada_por_ferramenta: criada_por.ferramenta,
      criada_por_sessao: criada_por.sessao,
      enviada: bit(demanda.enviada),
    },
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
  apagarLinhasQueSumiram(banco, [TABELA_DA_DEMANDA], antes, depois);
  gravarLinhasNovasEMudadas(banco, [TABELA_DA_DEMANDA], antes, depois);
  gravarItensNovosEMudados(banco, antes, depois);
  gravarLinhasNovasEMudadas(banco, TABELAS_QUE_DEPENDEM_DOS_ITENS, antes, depois);
  gravarEstadoNovoEMudado(banco, antes, depois);
  gravarEvidenciasNovasEAlteradas(banco, antes?.evidencias ?? [], depois.evidencias);
}

function carregar(
  banco: DatabaseSync,
  id: string,
  preparar: (sql: string) => StatementSync = (sql) => banco.prepare(sql),
): AgregadoDemanda | undefined {
  const demanda = preparar("SELECT * FROM demanda WHERE id = ?").get(id);
  if (!demanda) return undefined;
  return AgregadoDemanda.parse({
    demanda: {
      ...demanda,
      criada_por: { tipo: "externo", ferramenta: demanda.criada_por_ferramenta, sessao: demanda.criada_por_sessao },
      enviada: demanda.enviada === 1,
    },
    ...carregarItensDoPlanejamento(preparar, id),
    ...carregarEstadoDoProcesso(preparar, id),
    pull_requests: preparar("SELECT * FROM pull_request WHERE demanda_id = ? ORDER BY rowid").all(id).map(semNulos),
    evidencias: lerEvidenciasDaDemanda(id, preparar),
  });
}

const existente = (banco: DatabaseSync, id: string): AgregadoDemanda =>
  encontrado(carregar(banco, id), `a demanda ${id} não existe`, "confira o id da demanda");

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
  return lerEmSnapshot(banco, () =>
    ids.map((id) => encontrado(carregar(banco, id, preparar), `a demanda ${id} não existe`, "confira o id da demanda")),
  );
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
    const ids = banco.prepare(`SELECT id FROM demanda ${filtro} ORDER BY rowid`).all();
    return carregarDemandas(
      banco,
      ids.map((l) => String(l.id)),
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
      `SELECT id, estado, estado_alterado_em FROM demanda
        WHERE $ids IS NULL OR id IN (SELECT value FROM json_each($ids))`,
    )
      .all({ ids: ids === undefined ? null : JSON.stringify(ids) })
      .map((linha) => [
        String(linha.id),
        { estado: String(linha.estado), estadoAlteradoEm: String(linha.estado_alterado_em) },
      ]),
  );

/** As demandas do projeto, das mais novas para as mais antigas, só com o id e o estado. */
export const situacaoDasDemandas = (banco: DatabaseSync, projeto: string): { id: string; estado: EstadoDemanda }[] =>
  banco.prepare("SELECT id, estado FROM demanda WHERE projeto = ? ORDER BY rowid DESC").all(projeto) as {
    id: string;
    estado: EstadoDemanda;
  }[];

/**
 * Demanda nova: a persistência só aloca o ID da sequência `issue` (D09); `montar` monta o agregado com ele. Erro em
 * `montar`, no ID devolvido ou na gravação desfaz a transação, sequência incluída.
 */
export const criarDemandaNova = (banco: DatabaseSync, montar: (id: string) => AgregadoDemanda): AgregadoDemanda =>
  escrever(banco, () => {
    const id = `I-${String(novoId(banco, "demanda"))}`;
    const agregado = montar(id);
    if (agregado.demanda.id !== id) {
      throw new ErroDeRegra(
        `o agregado montado tem o ID ${agregado.demanda.id}, mas a sequência alocou ${id}`,
        `monte a demanda com o id recebido (${id})`,
      );
    }
    return gravarDemandaNova(banco, agregado);
  });

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

/** A execução do agente com o trabalho, o ticket e o projeto dela; `fim` é nulo enquanto a execução está aberta. */
interface EscopoDoProcessoNoBanco {
  readonly fim: string | null;
  readonly sessao: string;
  readonly demanda_id: string;
  readonly ticket_id: number;
  readonly projeto: string;
}

/** O escopo de `execucao`, aberta ou terminada, ou `undefined` se ela não está em `processo_do_trabalho`. */
export function carregarEscopoDoProcesso(banco: DatabaseSync, execucao: string): EscopoDoProcessoNoBanco | undefined {
  const linha = banco
    .prepare(
      `SELECT e.fim, s.id AS sessao, s.demanda_id, s.ticket_id, d.projeto
         FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id JOIN demanda d ON d.id = s.demanda_id
        WHERE e.id = ?`,
    )
    .get(execucao);
  return (
    linha && {
      fim: linha.fim === null ? null : String(linha.fim),
      sessao: String(linha.sessao),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
      projeto: String(linha.projeto),
    }
  );
}

/** O achado de avaliação que originou a demanda (a avaliação o liga à demanda que ele virou), ou `undefined`. */
export const achadoDaDemanda = (banco: DatabaseSync, demandaId: string) =>
  banco.prepare("SELECT avaliacao_id, achado_id, titulo FROM achado_avaliacao WHERE demanda_id = ?").get(demandaId) as
    { avaliacao_id: string; achado_id: number; titulo: string } | undefined;
