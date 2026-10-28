// Backfill das issues encerradas para o modelo de demandas (comparacao-sdlc-implementacao.md §2.2, §10): só lê o legado
// e grava `demanda`, rodada 1, tickets, decisões, commits, retrabalho e dependências, tudo numa transação.
import type { DatabaseSync } from "node:sqlite";
import { ErroDeRegra } from "../dominio/erros.ts";
import { escrever } from "./banco.ts";

/** As tabelas do modelo novo que o backfill preenche ou preencherá, mais as de histórico da migração 31. */
const TABELAS = [
  "demanda",
  "rodada",
  "ticket_demanda",
  "decisao_ticket",
  "evidencia_demanda",
  "arquivo_evidencia",
  "sessao",
  "execucao_sessao",
  "uso_modelo_execucao",
  "commit_ticket_demanda",
  "arquivo_commit_demanda",
  "retrabalho_demanda",
  "dependencia_demanda",
  "demanda_historico",
  "decisao_ticket_historico",
  "evidencia_historico",
  "uso_modelo_historico",
] as const;

export interface Relatorio {
  antes: Record<string, number>;
  depois: Record<string, number>;
  naoMigradas: { issue: string; motivo: string }[];
  dependenciasPendentes: { de: string; para: string }[];
}

const contar = (banco: DatabaseSync): Record<string, number> =>
  Object.fromEntries(
    TABELAS.map((t) => [t, (banco.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n]),
  );

/** Erro de qualquer origem (FK, CHECK) sai citando a demanda, para o Auditor saber qual issue travou. */
function citando<T>(id: string, trabalho: () => T): T {
  try {
    return trabalho();
  } catch (e) {
    if (e instanceof ErroDeRegra) throw e;
    throw new ErroDeRegra(`${id} não pôde ser migrada: ${(e as Error).message}`, "corrija o legado da issue");
  }
}

interface Issue {
  id: number;
  fase: string;
  cancelada_em: string | null;
}

function migrarIssue(banco: DatabaseSync, { id: n, cancelada_em }: Issue): void {
  const id = `I-${String(n)}`;
  const invalido = banco
    .prepare(
      "SELECT id, status, devolucoes FROM ticket WHERE issue = ? AND (status IN ('aberto','em_execucao') OR devolucoes > 2)",
    )
    .get(n) as { id: number; status: string; devolucoes: number | null } | undefined;
  if (invalido)
    throw new ErroDeRegra(
      `${id}: o ticket ${String(invalido.id)} está ${invalido.status} com ${String(invalido.devolucoes ?? 0)} devolução(ões)`,
      "feche o ticket (e no máximo 2 devoluções) antes de migrar",
    );
  const comRodada = cancelada_em === null;
  if (comRodada && !banco.prepare("SELECT 1 FROM ticket WHERE issue = ? AND etapa = 'desenvolvimento'").get(n))
    throw new ErroDeRegra(`${id} não tem ticket de desenvolvimento`, "sem ele não há o que agrupar na rodada 1");

  banco
    .prepare(
      `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, fase, fase_alterada_em, origem_ferramenta, origem_sessao, enviada, branch)
       SELECT $id, projeto, COALESCE(titulo, 'Registro cancelado ' || $id), COALESCE(tipo, 'funcionalidade'), descricao,
              CASE WHEN cancelada_em IS NOT NULL THEN 'cancelada' WHEN arquivada_em IS NOT NULL THEN 'arquivada' ELSE 'concluida' END,
              COALESCE(cancelada_em, arquivada_em, concluida_em), 'legado', 'backfill', 1, 'fabriquinha/' || $id
       FROM issue WHERE id = $n`,
    )
    .run({ id, n });
  banco
    .prepare(
      `INSERT INTO demanda_historico (demanda_id, criada_em, concluida_em, cancelada_em, arquivada_em)
       SELECT $id, criada_em, concluida_em, cancelada_em, arquivada_em FROM issue WHERE id = $n`,
    )
    .run({ id, n });
  if (comRodada)
    banco
      .prepare(
        "INSERT INTO rodada (demanda_id, rodada_id, titulo, fase, e2e, branch) VALUES (?, 1, 'Histórico migrado', 'concluida', 0, ?)",
      )
      .run(id, `fabriquinha/${id}-1`);
  banco
    .prepare(
      `INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id, titulo, descricao,
                                   modelo_provedor, modelo_nome, instrucao, devolucoes, motivo_falha,
                                   criado_em, concluido_em, enviado_em, origem, origem_ticket_id)
       SELECT $id, id,
              CASE etapa WHEN 'registro' THEN 'demanda' WHEN 'desenho' THEN 'planejar' WHEN 'desenvolvimento' THEN 'implementar'
                         WHEN 'revisao' THEN 'revisar_rodada' WHEN 'encerramento' THEN 'encerrar_rodada' ELSE 'sessao_em_aberto' END,
              status, COALESCE(concluido_em, enviado_em, criado_em),
              CASE WHEN etapa = 'desenvolvimento' AND $rodada THEN 1 END, titulo, descricao,
              modelo_provedor, modelo_nome, instrucao, COALESCE(devolucoes, 0), erro,
              criado_em, concluido_em, enviado_em, origem, origem_ticket
       FROM ticket WHERE issue = $n ORDER BY id`,
    )
    .run({ id, n, rodada: Number(comRodada) });
  banco
    .prepare(
      `INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, resultado, nota, motivo, por, em)
       SELECT $id, ticket, id, CASE aprovado WHEN 1 THEN 'aprovado' ELSE 'recusado' END, nota, motivo, por, em
       FROM decisao WHERE issue = $n ORDER BY id`,
    )
    .run({ id, n });
  banco
    .prepare(
      `INSERT INTO decisao_ticket_historico (demanda_id, ticket_id, decisao_id, gate)
       SELECT $id, ticket, id, gate FROM decisao WHERE issue = $n ORDER BY id`,
    )
    .run({ id, n });
  banco
    .prepare(
      `INSERT INTO commit_ticket_demanda (sha, demanda_id, ticket_id, mensagem, em)
       SELECT c.sha, $id, c.ticket, c.mensagem, c.em FROM commit_ticket c JOIN ticket t ON t.id = c.ticket
       WHERE t.issue = $n ORDER BY c.rowid`,
    )
    .run({ id, n });
  banco
    .prepare(
      `INSERT INTO arquivo_commit_demanda (sha, caminho, caminho_anterior, status, adicionadas, removidas)
       SELECT a.sha, a.caminho, a.caminho_anterior, a.status, a.adicionadas, a.removidas
       FROM arquivo_commit a JOIN commit_ticket c ON c.sha = a.sha JOIN ticket t ON t.id = c.ticket
       WHERE t.issue = ? ORDER BY a.rowid`,
    )
    .run(n);
}

/**
 * Migra as issues encerradas (concluídas, canceladas, arquivadas) para demandas `I-{n}`. Idempotente por issue: a que
 * já tem demanda é pulada. Um erro desfaz tudo. Não toca nas tabelas legadas.
 */
export function backfillDemandas(banco: DatabaseSync): Relatorio {
  return escrever(banco, () => {
    const antes = contar(banco);
    const naoMigradas: Relatorio["naoMigradas"] = [];
    const novas: number[] = [];
    const issues = banco.prepare("SELECT id, fase, cancelada_em FROM issue ORDER BY id").all() as unknown as Issue[];
    for (const issue of issues) {
      const id = `I-${String(issue.id)}`;
      if (issue.fase !== "concluida" && issue.cancelada_em === null) {
        naoMigradas.push({ issue: id, motivo: "em andamento" });
      } else if (!banco.prepare("SELECT 1 FROM demanda WHERE id = ?").get(id)) {
        citando(id, () => {
          migrarIssue(banco, issue);
        });
        novas.push(issue.id);
      }
    }
    // O alterador pode estar em outra issue: o retrabalho só entra depois de todos os tickets.
    const retrabalho = banco.prepare(
      `INSERT INTO retrabalho_demanda (commit_alterador, demanda_id, ticket_id, autor, ticket_origem_id, linhas, alterador_demanda_id)
       SELECT r.commit_alterador, 'I-' || o.issue, r.ticket, r.autor, r.ticket_origem, r.linhas,
              CASE WHEN r.ticket IS NOT NULL THEN 'I-' || a.issue END
       FROM retrabalho r JOIN ticket o ON o.id = r.ticket_origem LEFT JOIN ticket a ON a.id = r.ticket
       WHERE o.issue = ? ORDER BY r.rowid`,
    );
    for (const n of novas) citando(`I-${String(n)}`, () => retrabalho.run(n));

    const dependenciasPendentes: Relatorio["dependenciasPendentes"] = [];
    const existe = banco.prepare("SELECT 1 FROM demanda WHERE id = ?");
    const cria = banco.prepare(
      "INSERT OR IGNORE INTO dependencia_demanda (demanda_id, depende_demanda_id) VALUES (?, ?)",
    );
    for (const d of banco.prepare("SELECT issue, dep FROM issue_dep ORDER BY issue, dep").all()) {
      const de = `I-${String(d.issue)}`;
      const para = `I-${String(d.dep)}`;
      if (existe.get(de) && existe.get(para)) cria.run(de, para);
      else dependenciasPendentes.push({ de, para });
    }
    return { antes, depois: contar(banco), naoMigradas, dependenciasPendentes };
  });
}
