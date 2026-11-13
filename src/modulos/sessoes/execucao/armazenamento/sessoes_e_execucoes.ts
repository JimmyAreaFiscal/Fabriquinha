// As sessões (`trabalho_agentico`) e as execuções delas (`processo_do_trabalho`). As funções puras de
// nucleo/sessao.ts operam sobre o que foi lido; a gravação é por upsert do que foi carregado, nunca apaga.
import { createHash } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { z } from "zod";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import type { ConfiguracaoDoModelo } from "../../modelos/publico.ts";
import { type ContextoDaSessao, Execucao, type IdDaExecucao, type IdDaSessao, Sessao } from "../nucleo/sessao.ts";

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

/** As execuções do filtro, para o Uso em lote: das sessões, do contexto e com início no período `[inicio, fim)`. */
export function execucoesDoFiltro(
  banco: DatabaseSync,
  filtro: {
    sessoes?: readonly IdDaSessao[];
    contexto?: { demanda_id: string; ticket_id?: number };
    periodo?: { inicio: string; fim: string };
  },
): IdDaExecucao[] {
  return banco
    .prepare(
      `SELECT e.id FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id
        WHERE ($sessoes IS NULL OR s.id IN (SELECT value FROM json_each($sessoes)))
          AND ($demanda_id IS NULL OR s.demanda_id = $demanda_id)
          AND ($ticket_id IS NULL OR s.ticket_id = $ticket_id)
          AND ($inicio IS NULL OR e.inicio >= $inicio) AND ($fim IS NULL OR e.inicio < $fim)
        ORDER BY e.rowid`,
    )
    .all({
      sessoes: filtro.sessoes === undefined ? null : JSON.stringify(filtro.sessoes),
      demanda_id: filtro.contexto?.demanda_id ?? null,
      ticket_id: filtro.contexto?.ticket_id ?? null,
      inicio: filtro.periodo?.inicio ?? null,
      fim: filtro.periodo?.fim ?? null,
    })
    .map(({ id }) => String(id));
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
type ResumoDaSessao = Sessao & { execucoes: Execucao[] };

/**
 * O resumo da sessão, lido só do banco (regra 8: sem carregar a conversa), ou `undefined` se o id não é de uma sessão.
 * @testes o consumidor de produção é a visão do chat, que o ticket 21 passa a montar pela fachada
 */
export function resumoDaSessao(banco: DatabaseSync, sessao: IdDaSessao): ResumoDaSessao | undefined {
  const registro = banco.prepare("SELECT * FROM trabalho_agentico WHERE id = ?").get(sessao);
  if (!registro) return undefined;
  const execucoes = banco
    .prepare("SELECT * FROM processo_do_trabalho WHERE trabalho_id = ? ORDER BY rowid")
    .all(sessao);
  return { ...Sessao.parse(registro), execucoes: z.array(Execucao).parse(execucoes.map(execucaoDaLinha)) };
}

/** As sessões do contexto da demanda, cada uma com o contexto dela. */
export const sessoesDaDemanda = (banco: DatabaseSync, demandaId: string): (ContextoDaSessao & { id: IdDaSessao })[] =>
  banco
    .prepare("SELECT id, demanda_id, ticket_id FROM trabalho_agentico WHERE demanda_id = ?")
    .all(demandaId)
    .map((l) => ({ ...l }) as unknown as ContextoDaSessao & { id: string });

/** O id da sessão de cada ticket de cada demanda de `ids`; com mais de uma no ticket, vale a mais recente. */
export function sessaoDeCadaTicketDasDemandas(
  banco: DatabaseSync,
  ids: readonly string[],
): Map<string, Map<number, IdDaSessao>> {
  const linhas = banco
    .prepare(
      "SELECT demanda_id, ticket_id, id FROM trabalho_agentico WHERE demanda_id IN (SELECT value FROM json_each(?)) ORDER BY rowid",
    )
    .all(JSON.stringify(ids));
  // shortcut: filtra as linhas por demanda (ids × linhas), agrupar num passe só se passar de milhares de sessões.
  return new Map(
    ids.map((id) => [
      id,
      new Map(linhas.filter((l) => l.demanda_id === id).map((l) => [Number(l.ticket_id), String(l.id)])),
    ]),
  );
}
