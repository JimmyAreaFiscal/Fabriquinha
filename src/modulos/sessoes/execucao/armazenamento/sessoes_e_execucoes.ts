// As sessões (`trabalho_agentico`) e as execuções delas (`processo_do_trabalho`). As funções puras de
// nucleo/sessao.ts operam sobre o que foi lido; a gravação é por upsert do que foi carregado, nunca apaga.
import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { ConfiguracaoDoModelo } from "../../modelos/publico.ts";
import { type ContextoDaSessao, Execucao, type IdDaExecucao, type IdDaSessao, Sessao } from "../nucleo/sessao.ts";
import { instrucaoPreparada } from "../../../../shared/armazenamento/banco.ts";
import { apagarUsoDasExecucoes, apagarUsoDeclaradoDasDemandas } from "../../metricas_de_execucao/publico.ts";

/** O contexto de uma leitura: o ticket, ou a demanda inteira com `ticket_id` nulo. */
export interface ContextoDaLeitura {
  demanda_id: string;
  ticket_id: number | null;
}

export interface SessoesEExecucoes {
  sessoes: Sessao[];
  execucoes: Execucao[];
}

type Linha = Record<string, SQLInputValue>;

/** No banco o ausente é NULL; no domínio, campo opcional sem a chave. */
const semNulos = (linha: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(linha).filter(([, valor]) => valor !== null));

/** As colunas planas `modelo_provedor`, `modelo_nome` e `effort` da execução; o ausente é NULL. */
const colunasDaConfiguracao = (configuracao: ConfiguracaoDoModelo | undefined) => ({
  modelo_provedor: configuracao?.modelo?.provedor ?? null,
  modelo_nome: configuracao?.modelo?.nome ?? null,
  effort: configuracao?.effort ?? null,
});

/** A linha lida sem as três colunas e com `configuracao_agente`, que só existe se alguma tinha valor. */
function linhaComConfiguracao({ modelo_provedor: provedor, modelo_nome: nome, effort, ...resto }: Linha) {
  const configuracao = {
    ...(provedor !== null && { modelo: { provedor, nome } }),
    ...(effort !== null && { effort }),
  };
  return { ...resto, ...(Object.keys(configuracao).length > 0 && { configuracao_agente: configuracao }) };
}

/** A linha de `processo_do_trabalho` como a Execução a lê. */
const execucaoDaLinha = (linha: Linha) => ({
  ...semNulos(linhaComConfiguracao(linha)),
  fim: linha.fim, // fim NULL segue como null: é execução aberta
  falha: linha.falha === 1,
});

const DO_CONTEXTO = "demanda_id = $demanda_id AND ($ticket_id IS NULL OR ticket_id = $ticket_id)";

/** As sessões do contexto e as execuções delas, na ordem em que foram criadas. */
export function lerSessoesEExecucoes(banco: DatabaseSync, contexto: ContextoDaLeitura): SessoesEExecucoes {
  // Só os dois campos: quem chama pode passar um contexto com mais (a etapa do ticket).
  const filtro = { demanda_id: contexto.demanda_id, ticket_id: contexto.ticket_id };
  const ler = (sql: string) => banco.prepare(sql).all(filtro);
  return {
    sessoes: z.array(Sessao).parse(ler(`SELECT * FROM trabalho_agentico WHERE ${DO_CONTEXTO} ORDER BY rowid`)),
    execucoes: z
      .array(Execucao)
      .parse(
        ler(
          `SELECT * FROM processo_do_trabalho WHERE trabalho_id IN (SELECT id FROM trabalho_agentico WHERE ${DO_CONTEXTO}) ORDER BY rowid`,
        ).map(execucaoDaLinha),
      ),
  };
}

/** Linha já carregada (chave em `existentes`) é atualizada; linha nova é INSERT simples, então id de outro contexto falha por PK. */
function gravarPorId(
  banco: DatabaseSync,
  tabela: string,
  linhas: (Linha & { id: string })[],
  existentes: ReadonlySet<string>,
): void {
  for (const linha of linhas) {
    const colunas = Object.keys(linha);
    const insert = `INSERT INTO ${tabela} (${colunas.join(", ")}) VALUES (${colunas.map((c) => "$" + c).join(", ")})`;
    const sets = colunas.filter((c) => c !== "id").map((c) => `${c} = excluded.${c}`);
    banco
      .prepare(existentes.has(linha.id) ? `${insert} ON CONFLICT (id) DO UPDATE SET ${sets.join(", ")}` : insert)
      .run(linha);
  }
}

/** Grava `depois` sobre o que foi lido em `antes`; quem chama roda dentro da unidade de trabalho. */
export function gravarSessoesEExecucoes(
  banco: DatabaseSync,
  antes: SessoesEExecucoes,
  depois: SessoesEExecucoes,
): void {
  const ids = (linhas: readonly { id: string }[]) => new Set(linhas.map(({ id }) => id));
  gravarPorId(banco, "trabalho_agentico", depois.sessoes, ids(antes.sessoes));
  gravarPorId(
    banco,
    "processo_do_trabalho",
    depois.execucoes.map(({ configuracao_agente, ...execucao }) => ({
      ...execucao,
      fim: execucao.fim ?? null,
      falha: Number(execucao.falha),
      grupo_processo: execucao.grupo_processo ?? null,
      ...colunasDaConfiguracao(configuracao_agente),
    })),
    ids(antes.execucoes),
  );
}

/** O que escolhe as execuções em lote; os filtros se somam, e o período `[inicio, fim)` é o do início da execução. */
export interface FiltroDasExecucoes {
  sessoes?: readonly IdDaSessao[];
  contexto?: { demanda_id: string; ticket_id?: number };
  /** Os contextos de várias demandas de uma vez (as Métricas pedem as de um projeto ou de todos). */
  demandas?: readonly string[];
  periodo?: { inicio?: string; fim?: string };
}

/**
 * O FROM e o WHERE do filtro e os parâmetros deles. Só entra a restrição do filtro presente: um `$x IS NULL OR` impediria
 * o SQLite de partir da sessão, da demanda ou do período pelo índice.
 */
function sqlDoFiltro(filtro: FiltroDasExecucoes): { sql: string; parametros: Record<string, SQLInputValue> } {
  const condicoes: string[] = [];
  const parametros: Record<string, SQLInputValue> = {};
  const restringir = (condicao: string, nome: string, valor: SQLInputValue | undefined) => {
    if (valor === undefined) return;
    condicoes.push(condicao);
    parametros[nome] = valor;
  };
  const emJson = (lista: readonly string[] | undefined) => (lista === undefined ? undefined : JSON.stringify(lista));
  restringir("s.id IN (SELECT value FROM json_each($sessoes))", "sessoes", emJson(filtro.sessoes));
  restringir("s.demanda_id IN (SELECT value FROM json_each($demandas))", "demandas", emJson(filtro.demandas));
  restringir("s.demanda_id = $demanda_id", "demanda_id", filtro.contexto?.demanda_id);
  restringir("s.ticket_id = $ticket_id", "ticket_id", filtro.contexto?.ticket_id);
  restringir("e.inicio >= $inicio", "inicio", filtro.periodo?.inicio);
  restringir("e.inicio < $fim", "fim", filtro.periodo?.fim);
  const onde = condicoes.length > 0 ? condicoes.join(" AND ") : "1";
  return {
    sql: `FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE ${onde}`,
    parametros,
  };
}

/** As execuções do filtro, para o Uso em lote, na ordem em que foram criadas. */
export function execucoesDoFiltro(banco: DatabaseSync, filtro: FiltroDasExecucoes): IdDaExecucao[] {
  const { sql, parametros } = sqlDoFiltro(filtro);
  return instrucaoPreparada(banco, `SELECT e.id ${sql} ORDER BY e.rowid`)
    .all(parametros)
    .map(({ id }) => String(id));
}

/** Uma execução lida em lote, com o contexto da sessão dela e quanto durou. */
interface ExecucaoDoLote extends ContextoDaSessao {
  id: IdDaExecucao;
  sessao: IdDaSessao;
  inicio: string;
  falha: boolean;
  /** 0 enquanto não terminou; um relógio que volta não deixa negativa. */
  duracaoMs: number;
}

/** As execuções do filtro com o contexto e a duração, sem ler conversa nem Uso, na ordem do início. */
export function execucoesEmLote(banco: DatabaseSync, filtro: FiltroDasExecucoes): ExecucaoDoLote[] {
  const { sql, parametros } = sqlDoFiltro(filtro);
  return instrucaoPreparada(
    banco,
    `SELECT e.id, e.trabalho_id, s.demanda_id, s.ticket_id, e.inicio, e.falha,
         MAX(0, ROUND((julianday(COALESCE(e.fim, e.inicio)) - julianday(e.inicio)) * 86400000)) AS duracao_ms
       ${sql} ORDER BY e.inicio, e.id`,
  )
    .all(parametros)
    .map((linha) => ({
      id: String(linha.id),
      sessao: String(linha.trabalho_id),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
      inicio: String(linha.inicio),
      falha: linha.falha === 1,
      duracaoMs: Number(linha.duracao_ms),
    }));
}

/** Uma execução sem fim, com o contexto da sessão dela, o grupo do harness e o Ambiente que a lançou. */
interface ExecucaoAberta extends ContextoDaSessao {
  id: IdDaExecucao;
  trabalho_id: IdDaSessao;
  grupo_processo: number | null;
  ambiente_id: string;
}

/** As execuções sem fim de qualquer contexto: no reinício do serviço, todas são de uma instância anterior. */
export const execucoesAbertas = (banco: DatabaseSync): ExecucaoAberta[] =>
  banco
    .prepare(
      `SELECT e.id, e.trabalho_id, s.demanda_id, s.ticket_id, e.grupo_processo, e.ambiente_id
         FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE e.fim IS NULL ORDER BY e.rowid`,
    )
    .all()
    .map((l) => ({ ...l }) as unknown as ExecucaoAberta);

/** O Ambiente que lançou a execução, para a recuperação da subida sinalizá-la pelo mesmo Ambiente depois de um reinício. */
export const gravarAmbienteDaExecucao = (banco: DatabaseSync, execucao: IdDaExecucao, ambienteId: string): void => {
  banco.prepare("UPDATE processo_do_trabalho SET ambiente_id = ? WHERE id = ?").run(ambienteId, execucao);
};

/** O contexto da sessão da execução, ou `undefined` se a execução não existe. */
export const contextoDaExecucao = (banco: DatabaseSync, execucao: IdDaExecucao): ContextoDaSessao | undefined =>
  banco
    .prepare(
      "SELECT s.demanda_id, s.ticket_id FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE e.id = ?",
    )
    .get(execucao) as ContextoDaSessao | undefined;

/** A execução com a sessão e o ticket dela; `fim` é nulo enquanto ela está aberta, e a inexistente dá `undefined`. */
export function escopoDaExecucao(
  banco: DatabaseSync,
  execucao: IdDaExecucao,
): (ContextoDaSessao & { fim: string | null; sessao: string }) | undefined {
  const linha = banco
    .prepare(
      `SELECT e.fim, s.id AS sessao, s.demanda_id, s.ticket_id
         FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id WHERE e.id = ?`,
    )
    .get(execucao);
  return (
    linha && {
      fim: linha.fim === null ? null : String(linha.fim),
      sessao: String(linha.sessao),
      demanda_id: String(linha.demanda_id),
      ticket_id: Number(linha.ticket_id),
    }
  );
}

const hashDoToken = (token: string): string => createHash("sha256").update(token).digest("hex");

/** Grava só o hash do token da execução aberta; execução inexistente ou já encerrada não recebe token. */
export function gravarTokenDaExecucao(banco: DatabaseSync, execucao: IdDaExecucao, token: string): void {
  const { changes } = banco
    .prepare("UPDATE processo_do_trabalho SET hash_do_token = ? WHERE id = ? AND fim IS NULL")
    .run(hashDoToken(token), execucao);
  if (changes === 0) throw new ErroDeRegra(`processo ${execucao} não existe ou já terminou, e não recebe token`);
}

/** A execução dona do token, ou `undefined` se o token é desconhecido ou a execução já terminou (`fim` preenchido). */
export const execucaoVivaDoToken = (banco: DatabaseSync, token: string): IdDaExecucao | undefined =>
  (
    banco
      .prepare("SELECT id FROM processo_do_trabalho WHERE hash_do_token = ? AND fim IS NULL")
      .get(hashDoToken(token)) as { id: string } | undefined
  )?.id;

/** O contexto da sessão; `undefined` se o id não é de uma sessão. */
export const contextoDaSessao = (banco: DatabaseSync, sessao: IdDaSessao): ContextoDaSessao | undefined =>
  banco.prepare("SELECT demanda_id, ticket_id FROM trabalho_agentico WHERE id = ?").get(sessao) as
    ContextoDaSessao | undefined;

/** A sessão sem a conversa: o registro e as execuções dela. */
export type ResumoDaSessao = Sessao & { execucoes: Execucao[] };

/** Quais sessões ler: as de `sessoes`, as das `demandas`, só as que têm execução aberta; os filtros se somam, e sem nenhum vêm todas. */
export interface FiltroDeSessoes {
  sessoes?: readonly IdDaSessao[];
  demandas?: readonly string[];
  abertas?: true;
}

/**
 * O resumo de cada sessão do filtro, na ordem em que foram criadas, sem carregar a conversa (regra 8): numa leitura das
 * sessões e outra das execuções, sem uma por sessão. Só os filtros pedidos entram no SQL.
 */
export function resumosDasSessoesEmLote(banco: DatabaseSync, filtro: FiltroDeSessoes = {}): ResumoDaSessao[] {
  const condicoes = [
    ...(filtro.sessoes === undefined ? [] : ["id IN (SELECT value FROM json_each($sessoes))"]),
    ...(filtro.demandas === undefined ? [] : ["demanda_id IN (SELECT value FROM json_each($demandas))"]),
    ...(filtro.abertas === undefined ? [] : ["id IN (SELECT trabalho_id FROM processo_do_trabalho WHERE fim IS NULL)"]),
  ];
  const parametros = {
    ...(filtro.sessoes !== undefined && { sessoes: JSON.stringify(filtro.sessoes) }),
    ...(filtro.demandas !== undefined && { demandas: JSON.stringify(filtro.demandas) }),
  };
  const DO_FILTRO = condicoes.length === 0 ? "1" : condicoes.join(" AND ");
  const sessoes = z
    .array(Sessao)
    .parse(
      instrucaoPreparada(banco, `SELECT * FROM trabalho_agentico WHERE ${DO_FILTRO} ORDER BY rowid`).all(parametros),
    );
  const execucoes = instrucaoPreparada(
    banco,
    `SELECT * FROM processo_do_trabalho
        WHERE trabalho_id IN (SELECT id FROM trabalho_agentico WHERE ${DO_FILTRO}) ORDER BY rowid`,
  ).all(parametros);
  const execucoesDaSessao = Map.groupBy(z.array(Execucao).parse(execucoes.map(execucaoDaLinha)), (e) => e.trabalho_id);
  return sessoes.map((sessao) => ({ ...sessao, execucoes: execucoesDaSessao.get(sessao.id) ?? [] }));
}

/**
 * Na remoção do projeto: as sessões das `demandas`, as execuções delas e o Uso medido e declarado, na ordem das chaves
 * estrangeiras. Devolve o que sobra para apagar no disco: as execuções e as conversas das sessões.
 */
export function apagarSessoesDasDemandas(
  banco: DatabaseSync,
  demandas: readonly string[],
): { execucoes: string[]; sessoes: string[] } {
  const dasDemandas = JSON.stringify(demandas);
  const sessoesDasDemandas = "SELECT id FROM trabalho_agentico WHERE demanda_id IN (SELECT value FROM json_each(?))";
  const execucoes = banco
    .prepare(`SELECT id FROM processo_do_trabalho WHERE trabalho_id IN (${sessoesDasDemandas})`)
    .all(dasDemandas)
    .map((linha) => String(linha.id));
  const sessoes = banco
    .prepare(`SELECT conversa_referencia FROM trabalho_agentico WHERE id IN (${sessoesDasDemandas})`)
    .all(dasDemandas)
    .map((linha) => String(linha.conversa_referencia));
  apagarUsoDasExecucoes(banco, execucoes);
  banco.prepare(`DELETE FROM processo_do_trabalho WHERE trabalho_id IN (${sessoesDasDemandas})`).run(dasDemandas);
  banco.prepare("DELETE FROM trabalho_agentico WHERE demanda_id IN (SELECT value FROM json_each(?))").run(dasDemandas);
  apagarUsoDeclaradoDasDemandas(banco, demandas);
  return { execucoes, sessoes };
}
