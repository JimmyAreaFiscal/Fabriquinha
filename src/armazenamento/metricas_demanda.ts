// Leituras de só leitura para as métricas do SDLC por demandas (comparacao-sdlc-implementacao.md §8).
import type { DatabaseSync } from "node:sqlite";
import type { Recorte as RecorteDaMetrica } from "../nucleo/metrica.ts";
import { CorrecaoDoPlano, lerPlanoGravado, Plano } from "../nucleo/plano.ts";
import type { LinhaDeUso } from "../nucleo/uso.ts";

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

interface ExecucaoDoTicket extends DonoDaLinha {
  falha: boolean;
}

interface TicketDaDemanda extends DonoDaLinha {
  /** As Tentativas reprovadas do ticket: as vezes em que o agente teve de corrigir a entrega. */
  exigenciasDeAlteracao: number;
}

interface DecisaoDoTicket extends DonoDaLinha {
  reprovada: boolean;
}

const DONO = "t.etapa AS etapa, t.rodada_id AS rodada_id";
const rodadaDe = (l: Record<string, unknown>) => (l.rodada_id === null ? null : Number(l.rodada_id));
const NO_TICKET = "JOIN ticket_demanda t ON t.demanda_id = s.demanda_id AND t.ticket_id = s.ticket_id";

export const execucoesDaDemanda = (banco: DatabaseSync, demandaId: string): ExecucaoDoTicket[] =>
  banco
    .prepare(
      `SELECT ${DONO}, e.falha FROM processo_do_trabalho e
       JOIN trabalho_agentico s ON s.id = e.trabalho_id ${NO_TICKET}
       WHERE s.demanda_id = ?`,
    )
    .all(demandaId)
    .map((l) => ({ etapa: l.etapa as string, rodadaId: rodadaDe(l), falha: l.falha === 1 }));

export const ticketsDaDemanda = (banco: DatabaseSync, demandaId: string): TicketDaDemanda[] =>
  banco
    .prepare(
      `SELECT ${DONO}, (SELECT COUNT(*) FROM tentativa x WHERE x.demanda_id = t.demanda_id AND x.ticket_id = t.ticket_id
                         AND x.resultado_tipo = 'reprovacao') AS exigencias
       FROM ticket_demanda t WHERE t.demanda_id = ? ORDER BY t.ticket_id`,
    )
    .all(demandaId)
    .map((l) => ({ etapa: l.etapa as string, rodadaId: rodadaDe(l), exigenciasDeAlteracao: Number(l.exigencias) }));

export const decisoesDaDemanda = (banco: DatabaseSync, demandaId: string): DecisaoDoTicket[] =>
  banco
    .prepare(
      `SELECT ${DONO}, d.resultado FROM decisao_ticket d
       JOIN ticket_demanda t ON t.demanda_id = d.demanda_id AND t.ticket_id = d.ticket_id
       WHERE d.demanda_id = ?`,
    )
    .all(demandaId)
    .map((l) => ({ etapa: l.etapa as string, rodadaId: rodadaDe(l), reprovada: l.resultado === "reprovado" }));

export const rodadasDaDemanda = (banco: DatabaseSync, demandaId: string): number[] =>
  banco
    .prepare("SELECT rodada_id FROM rodada WHERE demanda_id = ? ORDER BY rodada_id")
    .all(demandaId)
    .map((l) => Number(l.rodada_id));

interface LinhaExterna {
  ferramenta: string;
  sessao: string;
  /** Sempre `null`: o Uso declarado é da demanda, não de uma rodada. */
  rodadaId: number | null;
  /** `null` = desconhecido. */
  custo: number | null;
}

/** Linhas do Uso declarado das sessões externas cuja dona é a demanda. */
export const linhasExternasDaDemanda = (banco: DatabaseSync, demandaId: string): LinhaExterna[] =>
  banco
    .prepare(
      `SELECT u.ferramenta, u.sessao, json_extract(l.value, '$.custo') AS custo
       FROM uso_declarado u, json_each(u.linhas) l
       WHERE u.demanda_id = ?
       ORDER BY u.rowid, l.key`,
    )
    .all(demandaId)
    .map((l) => ({
      ferramenta: l.ferramenta as string,
      sessao: l.sessao as string,
      rodadaId: null,
      custo: typeof l.custo === "number" ? l.custo : null,
    }));

// ——— Métricas por mês e projeto (a página Métricas): linhas cruas do período, agrupadas em src/aplicacao/periodo_demanda.ts ———

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

type Fato = "demandasRegistradas" | "demandasConcluidas" | "ticketsCriados" | "ticketsConcluidos";

/**
 * Quando cada fato aconteceu. A demanda e o ticket novos não gravam `criado_em` nem `concluido_em` (só o backfill grava),
 * então caem na primeira evidência da demanda e na última mudança de status.
 * shortcut: ticket novo conta como criado quando mudou de status pela última vez, gravar `criado_em` no domínio se isso incomodar.
 */
export const fatosNoPeriodo = (banco: DatabaseSync, recorte: Recorte): { fato: Fato; em: string }[] =>
  banco
    .prepare(
      `WITH fatos (fato, em, demanda) AS (
         SELECT 'demandasRegistradas', COALESCE(h.criada_em, (SELECT MIN(em) FROM evidencia_demanda WHERE demanda_id = d.id),
           d.estado_alterado_em), d.id FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id
         UNION ALL SELECT 'demandasConcluidas', COALESCE(h.concluida_em, d.estado_alterado_em), d.id
           FROM demanda d LEFT JOIN demanda_historico h ON h.demanda_id = d.id WHERE d.estado = 'concluida'
         UNION ALL SELECT 'ticketsCriados', COALESCE(t.criado_em, t.estado_alterado_em), t.demanda_id FROM ticket_demanda t
         UNION ALL SELECT 'ticketsConcluidos', COALESCE(t.concluido_em, t.estado_alterado_em), t.demanda_id
           FROM ticket_demanda t WHERE t.estado = 'concluido'
       )
       SELECT f.fato, f.em FROM fatos f JOIN demanda d ON d.id = f.demanda
       WHERE f.em >= $inicio AND f.em < $fim AND ${NO_RECORTE}`,
    )
    .all(parametros(recorte))
    .map((l) => ({ fato: l.fato as Fato, em: l.em as string }));

interface PrNoPeriodo {
  em: string;
  mergeado: boolean;
}

/**
 * Um PR por rodada, no mês do primeiro `pr_aberto` dela (o do ticket, nas rodadas novas, ou o da própria rodada, nas migradas).
 * Mergeado quando a rodada tem `encerrar_rodada` aprovado: por coorte, nunca passa dos abertos.
 */
export const prsNoPeriodo = (banco: DatabaseSync, recorte: Recorte): PrNoPeriodo[] =>
  banco
    .prepare(
      `SELECT p.em, p.mergeado FROM (
         SELECT e.demanda_id, MIN(e.em) AS em, EXISTS (
           SELECT 1 FROM decisao_ticket x JOIN ticket_demanda te ON te.demanda_id = x.demanda_id AND te.ticket_id = x.ticket_id
           WHERE x.demanda_id = e.demanda_id AND te.rodada_id = COALESCE(e.rodada_id, t.rodada_id)
             AND te.etapa = 'encerrar_rodada' AND x.resultado != 'reprovado') AS mergeado
         FROM evidencia_demanda e LEFT JOIN ticket_demanda t ON t.demanda_id = e.demanda_id AND t.ticket_id = e.ticket_id
         WHERE e.tipo = 'pr_aberto' GROUP BY e.demanda_id, COALESCE(e.rodada_id, t.rodada_id)
       ) p JOIN demanda d ON d.id = p.demanda_id
       WHERE p.em >= $inicio AND p.em < $fim AND ${NO_RECORTE}`,
    )
    .all(parametros(recorte))
    .map((l) => ({ em: l.em as string, mergeado: l.mergeado === 1 }));

interface DecisaoNoPeriodo extends DonoDaLinha {
  demanda: string;
  em: string;
  reprovada: boolean;
  nota: number | null;
}

export const decisoesNoPeriodo = (banco: DatabaseSync, recorte: Recorte): DecisaoNoPeriodo[] =>
  banco
    .prepare(
      `SELECT ${DONO}, x.demanda_id, x.em, x.resultado, x.nota FROM decisao_ticket x
       JOIN ticket_demanda t ON t.demanda_id = x.demanda_id AND t.ticket_id = x.ticket_id
       JOIN demanda d ON d.id = x.demanda_id
       WHERE x.em >= $inicio AND x.em < $fim AND ${NO_RECORTE}`,
    )
    .all(parametros(recorte))
    .map((l) => ({
      etapa: l.etapa as string,
      rodadaId: rodadaDe(l),
      demanda: l.demanda_id as string,
      em: l.em as string,
      reprovada: l.resultado === "reprovado",
      nota: l.nota === null ? null : Number(l.nota),
    }));

interface CommitsPosterioresNoPeriodo {
  em: string;
  adicionadas: number;
  alteradas: number;
  porHumanos: number;
}

/** M4 (comparacao-sdlc §8): por commit de ticket do período, as linhas que ele adicionou e as que outro ticket ou uma pessoa alterou depois. */
export const commitsPosterioresNoPeriodo = (banco: DatabaseSync, recorte: Recorte): CommitsPosterioresNoPeriodo[] =>
  banco
    .prepare(
      `SELECT c.em,
         (SELECT COALESCE(SUM(a.adicionadas), 0) FROM arquivo_commit_demanda a WHERE a.sha = c.sha) AS adicionadas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM commit_humano_posterior r
           WHERE r.demanda_id = c.demanda_id AND r.ticket_origem_id = c.ticket_id) AS alteradas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM commit_humano_posterior r
           WHERE r.demanda_id = c.demanda_id AND r.ticket_origem_id = c.ticket_id AND r.ticket_id IS NULL) AS por_humanos
       FROM commit_ticket_demanda c JOIN demanda d ON d.id = c.demanda_id
       WHERE c.em >= $inicio AND c.em < $fim AND ${NO_RECORTE}`,
    )
    .all(parametros(recorte))
    .map((l) => ({
      em: l.em as string,
      adicionadas: Number(l.adicionadas),
      alteradas: Number(l.alteradas),
      porHumanos: Number(l.por_humanos),
    }));

// ——— Métricas por recorte (período, Projeto ou Demanda): linhas cruas, agrupadas por Etapa em src/aplicacao/metricas/ ———

const parametrosDoRecorte = (r: RecorteDaMetrica) => ({
  inicio: r.inicio ?? null,
  fim: r.fim ?? null,
  projeto: r.projeto ?? null,
  demanda: r.demandaId ?? null,
});

/** As restrições do recorte, com `d` a demanda; `instante` é a coluna (ou expressão) que o período limita. */
const noRecorteDe = (instante: string) =>
  `($inicio IS NULL OR ${instante} >= $inicio) AND ($fim IS NULL OR ${instante} < $fim)
   AND ($projeto IS NULL OR d.projeto = $projeto) AND ($demanda IS NULL OR d.id = $demanda)`;

interface ExecucaoDoRecorte {
  etapa: string;
  falha: boolean;
  /** 0 enquanto não terminou; um relógio que volta não deixa negativa. */
  duracaoMs: number;
}

/** Cada execução vale uma vez, no instante em que começou: a retomada de uma sessão é uma execução nova. */
export const execucoesDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): ExecucaoDoRecorte[] =>
  banco
    .prepare(
      `SELECT t.etapa, e.falha,
         MAX(0, ROUND((julianday(COALESCE(e.fim, e.inicio)) - julianday(e.inicio)) * 86400000)) AS duracao_ms
       FROM processo_do_trabalho e JOIN trabalho_agentico s ON s.id = e.trabalho_id ${NO_TICKET}
         JOIN demanda d ON d.id = s.demanda_id
       WHERE ${noRecorteDe("e.inicio")}`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({ etapa: l.etapa as string, falha: l.falha === 1, duracaoMs: Number(l.duracao_ms) }));

/** Uma linha por execução e modelo: cada linha de `uso_modelo_execucao` vale uma vez, retomada não a repete. */
export const usoDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): UsoDaExecucao[] =>
  banco
    .prepare(
      `SELECT ${DONO}, u.execucao_id, u.modelo_provedor, u.modelo_nome, u.tokens_entrada, u.tokens_saida,
         u.tokens_cache_leitura, u.tokens_cache_escrita, u.custo
       FROM uso_modelo_execucao u JOIN processo_do_trabalho e ON e.id = u.execucao_id
         JOIN trabalho_agentico s ON s.id = e.trabalho_id ${NO_TICKET} JOIN demanda d ON d.id = s.demanda_id
       WHERE ${noRecorteDe("e.inicio")} ORDER BY u.rowid`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({
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
  banco
    .prepare(
      `SELECT u.linhas FROM uso_declarado u JOIN demanda d ON d.id = u.demanda_id
         LEFT JOIN demanda_historico h ON h.demanda_id = d.id
       WHERE ${noRecorteDe("COALESCE(h.criada_em, (SELECT MIN(e.em) FROM evidencia_demanda e WHERE e.demanda_id = d.id), d.estado_alterado_em)")}
       ORDER BY u.rowid`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({ linhas: JSON.parse(l.linhas as string) as LinhaDeUso[] }));

interface DecisaoDoRecorte {
  etapa: string;
  reprovada: boolean;
  nota: number | null;
}

export const decisoesDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): DecisaoDoRecorte[] =>
  banco
    .prepare(
      `SELECT t.etapa, x.resultado, x.nota FROM decisao_ticket x
         JOIN ticket_demanda t ON t.demanda_id = x.demanda_id AND t.ticket_id = x.ticket_id
         JOIN demanda d ON d.id = x.demanda_id
       WHERE ${noRecorteDe("x.em")}`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({
      etapa: l.etapa as string,
      reprovada: l.resultado === "reprovado",
      nota: l.nota === null ? null : Number(l.nota),
    }));

/** A etapa do ticket de cada Tentativa reprovada: as vezes em que o agente teve de corrigir a entrega. */
export const etapasDasTentativasReprovadasDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): string[] =>
  banco
    .prepare(
      `SELECT t.etapa FROM tentativa x
         JOIN ticket_demanda t ON t.demanda_id = x.demanda_id AND t.ticket_id = x.ticket_id
         JOIN demanda d ON d.id = x.demanda_id
       WHERE x.resultado_tipo = 'reprovacao' AND ${noRecorteDe("x.inicio")}`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => l.etapa as string);

interface CommitDoRecorte extends DonoDaLinha {
  adicionadas: number;
  /** As linhas do commit que uma pessoa alterou depois, na base. */
  alteradasPorHumanos: number;
}

/** Por commit de ticket do recorte, as linhas que ele adicionou e as que uma pessoa alterou depois. */
export const commitsDoRecorte = (banco: DatabaseSync, recorte: RecorteDaMetrica): CommitDoRecorte[] =>
  banco
    .prepare(
      `SELECT ${DONO},
         (SELECT COALESCE(SUM(a.adicionadas), 0) FROM arquivo_commit_demanda a WHERE a.sha = c.sha) AS adicionadas,
         (SELECT COALESCE(SUM(r.linhas), 0) FROM commit_humano_posterior r
           WHERE r.demanda_id = c.demanda_id AND r.ticket_origem_id = c.ticket_id AND r.ticket_id IS NULL) AS por_humanos
       FROM commit_ticket_demanda c
         JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
         JOIN demanda d ON d.id = c.demanda_id
       WHERE ${noRecorteDe("c.em")}`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({
      etapa: l.etapa as string,
      rodadaId: rodadaDe(l),
      adicionadas: Number(l.adicionadas),
      alteradasPorHumanos: Number(l.por_humanos),
    }));

/** As rodadas cujo último commit de ticket cai no recorte. */
export const rodadasComCommitNoRecorte = (
  banco: DatabaseSync,
  recorte: RecorteDaMetrica,
): { demandaId: string; rodadaId: number }[] =>
  banco
    .prepare(
      `SELECT t.demanda_id, t.rodada_id FROM commit_ticket_demanda c
         JOIN ticket_demanda t ON t.demanda_id = c.demanda_id AND t.ticket_id = c.ticket_id
         JOIN demanda d ON d.id = c.demanda_id
       WHERE t.rodada_id IS NOT NULL
       GROUP BY d.id, d.projeto, t.rodada_id
       HAVING ${noRecorteDe("MAX(c.em)")}
       ORDER BY t.demanda_id, t.rodada_id`,
    )
    .all(parametrosDoRecorte(recorte))
    .map((l) => ({ demandaId: l.demanda_id as string, rodadaId: Number(l.rodada_id) }));
