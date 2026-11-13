// Leituras de só leitura para as métricas do SDLC por demandas (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync, StatementSync } from "node:sqlite";
import type { Recorte as RecorteDaMetrica } from "../nucleo/metrica.ts";
import { CorrecaoDoPlano, lerPlanoGravado, Plano } from "../../sdlc/nucleo/demanda/plano.ts";
import type { LinhaDeUso } from "../../sessoes/publico.ts";

export const demandaExiste = (banco: DatabaseSync, demandaId: string): boolean =>
  banco.prepare("SELECT 1 FROM demanda WHERE id = ?").get(demandaId) !== undefined;

/**
 * O Plano montado das versões gravadas (o original é a da aprovação do planejamento, as outras são as correções);
 * `undefined` sem plano aprovado, como na demanda antiga sem evidência `plano` que recebeu correção depois.
 */
export function planoDaDemanda(banco: DatabaseSync, demandaId: string): Plano | undefined {
  const [original, ...correcoes] = banco
    .prepare("SELECT origem, dados FROM versao_plano WHERE demanda_id = ? ORDER BY numero")
    .all(demandaId)
    .map((l) => ({ origem: l.origem, dados: JSON.parse(l.dados as string) as unknown }));
  if (original?.origem !== "aprovacao_do_planejamento") return undefined;
  return new Plano(
    lerPlanoGravado(original.dados),
    correcoes.map((c) => CorrecaoDoPlano.parse(c.dados)),
  );
}

export interface ArquivoDaRodada {
  caminho: string;
  caminhoAnterior: string | null;
}

/** Arquivos dos commits dos tickets da rodada (inclusive corretivos). */
export function arquivosDaRodada(banco: DatabaseSync, demandaId: string, rodadaId: number): ArquivoDaRodada[] {
  return banco
    .prepare(
      `SELECT a.caminho, a.caminho_anterior FROM arquivo_commit_demanda a
       JOIN commit_ticket_demanda c ON c.sha = a.sha
       JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
       WHERE c.demanda_id = ? AND t.rodada_id = ? ORDER BY a.rowid`,
    )
    .all(demandaId, rodadaId)
    .map((l) => ({ caminho: l.caminho as string, caminhoAnterior: l.caminho_anterior as string | null }));
}

/** Dono de uma linha de métrica: a etapa do ticket e a rodada dele (`null` em ticket de demanda). */
export interface DonoDaLinha {
  etapa: string;
  rodadaId: number | null;
}

export interface UsoDaExecucao extends DonoDaLinha {
  execucao: string;
  provedor: string;
  modelo: string;
  entrada: number;
  saida: number;
  cacheLeitura: number;
  cacheEscrita: number;
  /** `null` = custo desconhecido, nunca 0. */
  custo: number | null;
}

const DONO = "t.etapa AS etapa, t.rodada_id AS rodada_id";
const rodadaDe = (l: Record<string, unknown>) => (l.rodada_id === null ? null : Number(l.rodada_id));
const NO_TICKET = "JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id";

// ——— Níveis do mês (a página Métricas): linhas cruas do período, agrupadas em src/modulos/metricas/aplicacao/metricas_do_periodo.ts ———

/** O período `[inicio, fim)` de instantes UTC e o projeto (`null` = todos). */
interface Recorte {
  inicio: string;
  fim: string;
  projeto: string | null;
}

const NO_RECORTE = "($projeto IS NULL OR d.projeto = $projeto)";
const parametros = (r: Recorte) => ({ inicio: r.inicio, fim: r.fim, projeto: r.projeto });

export interface ExecucaoNoPeriodo {
  execucao: string;
  sessao: string;
  ticket: number;
  /** `null` = ticket de demanda, sem rodada. */
  rodada: number | null;
  demanda: string;
  projeto: string;
  titulo: string;
  estado: string;
  etapa: string;
  inicio: string;
  falha: boolean;
  /** 0 enquanto não terminou; um relógio que volta não deixa negativa. */
  duracaoMs: number;
}

/** Cada execução vale uma vez, no mês em que começou: a retomada de uma sessão é uma execução nova. */
export const execucoesNoPeriodo = (banco: DatabaseSync, recorte: Recorte): ExecucaoNoPeriodo[] =>
  banco
    .prepare(
      `SELECT e.id, e.trabalho_id, s.ticket_id, t.rodada_id, d.id AS demanda, d.projeto, d.titulo, d.estado, t.etapa,
         e.inicio, e.falha,
         MAX(0, ROUND((julianday(COALESCE(e.fim, e.inicio)) - julianday(e.inicio)) * 86400000)) AS duracao_ms
       FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id
         JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id
         JOIN demanda d ON d.id = s.demanda_id
       WHERE e.inicio >= $inicio AND e.inicio < $fim AND ${NO_RECORTE} ORDER BY e.inicio, e.id`,
    )
    .all(parametros(recorte))
    .map((l) => ({
      execucao: l.id as string,
      sessao: l.trabalho_id as string,
      ticket: Number(l.ticket_id),
      rodada: rodadaDe(l),
      demanda: l.demanda as string,
      projeto: l.projeto as string,
      titulo: l.titulo as string,
      estado: l.estado as string,
      etapa: l.etapa as string,
      inicio: l.inicio as string,
      falha: l.falha === 1,
      duracaoMs: Number(l.duracao_ms),
    }));

export type UsoNoPeriodo = Omit<UsoDaExecucao, keyof DonoDaLinha>;

export const usoNoPeriodo = (banco: DatabaseSync, recorte: Recorte): UsoNoPeriodo[] =>
  banco
    .prepare(
      `SELECT u.execucao_id, u.modelo_provedor, u.modelo_nome, u.tokens_entrada, u.tokens_saida,
         u.tokens_cache_leitura, u.tokens_cache_escrita, u.custo
       FROM uso_modelo_execucao u JOIN processo_do_trabalho e ON e.id = u.execucao_id
         JOIN trabalho_agentico s ON s.id = e.trabalho_id JOIN demanda d ON d.id = s.demanda_id
       WHERE e.inicio >= $inicio AND e.inicio < $fim AND ${NO_RECORTE} ORDER BY u.rowid`,
    )
    .all(parametros(recorte))
    .map((l) => ({
      execucao: l.execucao_id as string,
      provedor: l.modelo_provedor as string,
      modelo: l.modelo_nome as string,
      entrada: Number(l.tokens_entrada),
      saida: Number(l.tokens_saida),
      cacheLeitura: Number(l.tokens_cache_leitura),
      cacheEscrita: Number(l.tokens_cache_escrita),
      custo: l.custo === null ? null : Number(l.custo),
    }));

// ——— Métricas por recorte (período, Projeto ou Demanda): linhas cruas, agrupadas em src/modulos/metricas/aplicacao/metricas/ ———

/**
 * As restrições do recorte em SQL, com `d` a demanda e `instante` a coluna (ou expressão) que o período limita, e os
 * parâmetros delas. Só entra o que o recorte restringe: um `$x IS NULL OR` impediria o SQLite de partir da demanda ou do
 * período pelo índice.
 */
function restricoesDoRecorte(recorte: RecorteDaMetrica, instante: string) {
  const clausulas: string[] = [];
  const parametros: Record<string, string> = {};
  const restringir = (clausula: string, nome: string, valor: string | null | undefined) => {
    if (valor === undefined || valor === null) return;
    clausulas.push(clausula);
    parametros[nome] = valor;
  };
  restringir(`${instante} >= $inicio`, "inicio", recorte.inicio);
  restringir(`${instante} < $fim`, "fim", recorte.fim);
  restringir("d.projeto = $projeto", "projeto", recorte.projeto);
  restringir("d.id = $demanda", "demanda", recorte.demandaId);
  return { condicao: clausulas.length > 0 ? clausulas.join(" AND ") : "1", parametros };
}

const instrucoesPreparadas = new WeakMap<DatabaseSync, Map<string, StatementSync>>();

/** A instrução do `sql` neste banco, preparada uma vez: a tela de Métricas lê o mesmo SQL de cada mês e de cada demanda. */
function preparar(banco: DatabaseSync, sql: string): StatementSync {
  const doBanco = instrucoesPreparadas.get(banco) ?? new Map<string, StatementSync>();
  instrucoesPreparadas.set(banco, doBanco);
  const preparada = doBanco.get(sql) ?? banco.prepare(sql);
  doBanco.set(sql, preparada);
  return preparada;
}

/** Lê as linhas do recorte: `sql` recebe as restrições (`onde`), com o período no `instante`. */
function lerDoRecorte(banco: DatabaseSync, recorte: RecorteDaMetrica, instante: string, sql: (onde: string) => string) {
  const { condicao, parametros } = restricoesDoRecorte(recorte, instante);
  return preparar(banco, sql(condicao)).all(parametros);
}

type FatoDoSdlc = "demandasRegistradas" | "demandasConcluidas" | "ticketsCriados" | "ticketsConcluidos";

/**
 * Os fatos do recorte, no instante em que cada um aconteceu. A demanda e o ticket novos não gravam `criado_em` nem
 * `concluido_em` (só o backfill grava), então caem na primeira evidência da demanda e na última mudança de status.
 * shortcut: ticket novo conta como criado quando mudou de status pela última vez, gravar `criado_em` no domínio se isso incomodar.
 */
export const fatosDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): FatoDoSdlc[] =>
  lerDoRecorte(
    banco,
    recorte,
    "f.em",
    (onde) => `WITH fatos (fato, em, demanda) AS (
         SELECT 'demandasRegistradas', COALESCE(h.criada_em, (SELECT MIN(em) FROM evidencia_demanda WHERE demanda_id = d.id),
           d.estado_alterado_em), d.id FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id
         UNION ALL SELECT 'demandasConcluidas', COALESCE(h.concluida_em, d.estado_alterado_em), d.id
           FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id WHERE d.estado = 'concluida'
         UNION ALL SELECT 'ticketsCriados', COALESCE(t.criado_em, t.estado_alterado_em), t.demanda_id FROM ticket_demanda t
         UNION ALL SELECT 'ticketsConcluidos', COALESCE(t.concluido_em, t.estado_alterado_em), t.demanda_id
           FROM ticket_demanda t WHERE t.estado = 'concluido'
       )
       SELECT f.fato FROM fatos f JOIN demanda d ON d.id = f.demanda
       WHERE ${onde}`,
  ).map((l) => l.fato as FatoDoSdlc);

/**
 * Um PR por rodada, no instante do primeiro `pr_aberto` dela (o do ticket, nas rodadas novas, ou o da própria rodada, nas
 * migradas). Mergeado quando a rodada tem a Etapa que publica o PR (`etapaQuePublicaOPr`) aprovada: por coorte, nunca
 * passa dos abertos.
 */
export function prsDoRecorte(
  banco: DatabaseSync,
  recorte: RecorteDaMetrica,
  etapaQuePublicaOPr: string,
): { mergeado: boolean }[] {
  const { condicao, parametros } = restricoesDoRecorte(recorte, "p.em");
  return preparar(
    banco,
    `SELECT p.mergeado FROM (
         SELECT e.demanda_id, MIN(e.em) AS em, EXISTS (
           SELECT 1 FROM decisao_ticket x JOIN ticket_demanda te ON te.demanda_id = x.demanda_id AND te.ticket_id = x.ticket_id
           WHERE x.demanda_id = e.demanda_id AND te.rodada_id = COALESCE(e.rodada_id, t.rodada_id)
             AND te.etapa = $etapaQuePublicaOPr AND x.resultado != 'reprovado') AS mergeado
         FROM evidencia_demanda e LEFT JOIN ticket_demanda t ON t.demanda_id = e.demanda_id AND t.ticket_id = e.ticket_id
         WHERE e.tipo = 'pr_aberto' GROUP BY e.demanda_id, COALESCE(e.rodada_id, t.rodada_id)
       ) p JOIN demanda d ON d.id = p.demanda_id
       WHERE ${condicao}`,
  )
    .all({ ...parametros, etapaQuePublicaOPr })
    .map((l) => ({ mergeado: l.mergeado === 1 }));
}

interface ExecucaoDoRecorte {
  etapa: string;
  falha: boolean;
  /** 0 enquanto não terminou; um relógio que volta não deixa negativa. */
  duracaoMs: number;
}

/** Cada execução vale uma vez, no instante em que começou: a retomada de uma sessão é uma execução nova. */
export const execucoesDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): ExecucaoDoRecorte[] =>
  lerDoRecorte(
    banco,
    recorte,
    "e.inicio",
    (onde) => `SELECT t.etapa, e.falha,
         MAX(0, ROUND((julianday(COALESCE(e.fim, e.inicio)) - julianday(e.inicio)) * 86400000)) AS duracao_ms
       FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id ${NO_TICKET}
         JOIN demanda d ON d.id = s.demanda_id
       WHERE ${onde}`,
  ).map((l) => ({ etapa: l.etapa as string, falha: l.falha === 1, duracaoMs: Number(l.duracao_ms) }));

/** Uma linha por execução e modelo: cada linha de `uso_modelo_execucao` vale uma vez, retomada não a repete. */
export const usoDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): UsoDaExecucao[] =>
  lerDoRecorte(
    banco,
    recorte,
    "e.inicio",
    (onde) => `SELECT ${DONO}, u.execucao_id, u.modelo_provedor, u.modelo_nome, u.tokens_entrada, u.tokens_saida,
         u.tokens_cache_leitura, u.tokens_cache_escrita, u.custo
       FROM uso_modelo_execucao u JOIN processo_do_trabalho e ON e.id = u.execucao_id
         JOIN trabalho_agentico s ON s.id = e.trabalho_id ${NO_TICKET} JOIN demanda d ON d.id = s.demanda_id
       WHERE ${onde} ORDER BY u.rowid`,
  ).map((l) => ({
    etapa: l.etapa as string,
    rodadaId: rodadaDe(l),
    execucao: l.execucao_id as string,
    provedor: l.modelo_provedor as string,
    modelo: l.modelo_nome as string,
    entrada: Number(l.tokens_entrada),
    saida: Number(l.tokens_saida),
    cacheLeitura: Number(l.tokens_cache_leitura),
    cacheEscrita: Number(l.tokens_cache_escrita),
    custo: l.custo === null ? null : Number(l.custo),
  }));

/**
 * O Uso declarado das sessões cuja dona é a demanda; a sessão externa não grava data própria, então o período é o do
 * registro da demanda.
 * shortcut: o instante é o do registro da demanda; gravar a data da declaração em `uso_declarado` se isso distorcer a série.
 */
export const usoDeclaradoDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): { linhas: LinhaDeUso[] }[] =>
  lerDoRecorte(
    banco,
    recorte,
    "COALESCE(h.criada_em, p.primeira, d.estado_alterado_em)",
    (onde) => `SELECT u.linhas FROM uso_declarado u JOIN demanda d ON d.id = u.demanda_id
         LEFT JOIN demanda_historico h ON h.demanda_id = d.id
         LEFT JOIN (SELECT demanda_id, MIN(em) AS primeira FROM evidencia_demanda GROUP BY demanda_id) p ON p.demanda_id = d.id
       WHERE ${onde}
       ORDER BY u.rowid`,
  ).map((l) => ({ linhas: JSON.parse(l.linhas as string) as LinhaDeUso[] }));

interface DecisaoDoRecorte {
  etapa: string;
  reprovada: boolean;
  nota: number | null;
}

export const decisoesDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): DecisaoDoRecorte[] =>
  lerDoRecorte(
    banco,
    recorte,
    "x.em",
    (onde) => `SELECT t.etapa, x.resultado, x.nota FROM decisao_ticket x
         JOIN ticket_demanda t ON t.demanda_id = x.demanda_id AND t.ticket_id = x.ticket_id
         JOIN demanda d ON d.id = x.demanda_id
       WHERE ${onde}`,
  ).map((l) => ({
    etapa: l.etapa as string,
    reprovada: l.resultado === "reprovado",
    nota: l.nota === null ? null : Number(l.nota),
  }));

/** A rodada do ticket de cada Tentativa reprovada (`null` fora de rodada): as vezes em que o agente teve de corrigir a entrega. */
export const rodadasDasTentativasReprovadasDoRecorte = (
  banco: DatabaseSync,
  recorte: RecorteDaMetrica,
): (number | null)[] =>
  lerDoRecorte(
    banco,
    recorte,
    "x.inicio",
    (onde) => `SELECT t.rodada_id FROM tentativa x
         JOIN ticket_demanda t ON t.demanda_id = x.demanda_id AND t.ticket_id = x.ticket_id
         JOIN demanda d ON d.id = x.demanda_id
       WHERE x.resultado_tipo = 'reprovacao' AND ${onde}`,
  ).map(rodadaDe);

interface CommitDoRecorte extends DonoDaLinha {
  adicionadas: number;
  /** As linhas do commit que uma pessoa alterou depois, na base. */
  alteradasPorHumanos: number;
}

/** Por commit de ticket do recorte, as linhas que ele adicionou e as que uma pessoa alterou depois. */
export const commitsDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): CommitDoRecorte[] =>
  lerDoRecorte(
    banco,
    recorte,
    "c.em",
    (onde) => `SELECT ${DONO},
         (SELECT COALESCE(SUM(a.adicionadas), 0) FROM arquivo_commit_demanda a WHERE a.sha = c.sha) AS adicionadas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM commit_humano_posterior r
           WHERE r.demanda_id = c.demanda_id AND r.ticket_origem_id = c.ticket_id AND r.ticket_id IS NULL) AS por_humanos
       FROM commit_ticket_demanda c
         JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
         JOIN demanda d ON d.id = c.demanda_id
       WHERE ${onde}`,
  ).map((l) => ({
    etapa: l.etapa as string,
    rodadaId: rodadaDe(l),
    adicionadas: Number(l.adicionadas),
    alteradasPorHumanos: Number(l.por_humanos),
  }));

/** As rodadas cujo último commit de ticket cai no recorte: o escopo restringe as linhas e o período, o último commit. */
export function rodadasComCommitNoRecorte(
  banco: DatabaseSync,
  recorte: RecorteDaMetrica,
): { demandaId: string; rodadaId: number }[] {
  const { inicio, fim, ...doEscopo } = recorte;
  const escopo = restricoesDoRecorte(doEscopo, "");
  const periodo = restricoesDoRecorte({ inicio, fim }, "MAX(c.em)");
  return preparar(
    banco,
    `SELECT t.demanda_id, t.rodada_id FROM commit_ticket_demanda c
         JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
         JOIN demanda d ON d.id = c.demanda_id
       WHERE t.rodada_id IS NOT NULL AND ${escopo.condicao}
       GROUP BY d.id, d.projeto, t.rodada_id
       HAVING ${periodo.condicao}
       ORDER BY t.demanda_id, t.rodada_id`,
  )
    .all({ ...escopo.parametros, ...periodo.parametros })
    .map((l) => ({ demandaId: l.demanda_id as string, rodadaId: Number(l.rodada_id) }));
}
