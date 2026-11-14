// Banco em memória, migrado, com duas lojas de demandas e dois meses de execuções, decisões e commits, para os testes das Métricas.
import { DatabaseSync } from "node:sqlite";
import type { Recorte } from "../../src/modulos/ciclo_de_vida/metricas_de_qualidade/nucleo/metrica.ts";
import type { OrigemDasMetricas } from "../../src/server/consultas/metricas/metrica_de_uso.ts";
import { lerPedidosDasMetricas } from "../../src/server/consultas/demandas/pedidos_das_metricas.ts";
import { intervalo } from "../../src/shared/nucleo/periodo.ts";
import { montarRepositorio } from "../../src/modulos/repositorio/publico.ts";
import {
  migrarBancoDaFabriquinha,
  montarCicloDeVidaDoBanco,
  montarDemandasDoBanco,
} from "../../src/server/composicao/banco_da_fabriquinha.ts";

/** O dia 15 do mês ao meio-dia, no fuso do serviço, como o banco grava: em UTC. */
export const em = (mes: string) => new Date(`${mes}-15T12:00:00`).toISOString();
export const sha = (n: number) => String(n).repeat(40);

/** O recorte de período do mês `AAAA-MM` inteiro. */
export const doMes = (mes: string): Recorte => {
  const { inicio, fim } = intervalo(mes);
  return { inicio, fim };
};

/** De onde as Métricas leem neste banco: ele, o Repositório dele e os pedidos de todas as demandas, lidos agora. */
export const origemDe = (banco: DatabaseSync): OrigemDasMetricas => {
  const cicloDeVida = montarCicloDeVidaDoBanco(banco);
  return {
    banco,
    cicloDeVida,
    repositorio: montarRepositorio({ banco }),
    pedidos: lerPedidosDasMetricas(banco, cicloDeVida, montarDemandasDoBanco(banco)),
  };
};

export function bancoMigrado(): DatabaseSync {
  const banco = new DatabaseSync(":memory:");
  banco.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(banco);
  return banco;
}

/**
 * loja: I-1 (rodadas 1 e 2; tickets 1 implementar r1, 2 encerrar_rodada r1, 3 implementar r2) e I-2 sem execução;
 * site: I-3 com o ticket 1 implementar. Sessões s1 (ticket 1 de I-1, retomada em duas execuções), s2 (ticket 3 de I-1).
 * Fevereiro: x1 e x2 (s1), a Decisão reprovada do ticket 1, as aprovadas do ticket 2 (notas 4 e 5), o PR e o commit do
 * ticket 1 (30 linhas), que uma pessoa alterou em 5. Março: x3 (s2, em andamento) e x4 (s3) e o commit do ticket 3.
 */
export function bancoDoPeriodo(): DatabaseSync {
  const b = bancoMigrado();
  for (const nome of ["loja", "site"])
    b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('${nome}', '/repo/${nome}', 'main', 'github', '${nome}')`);
  const demanda = (id: string, projeto: string, estado: string, alterada: string) => {
    b.exec(
      `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('${id}', '${projeto}', 'Título ${id}', 'problema', 'd', '${estado}', '${alterada}', 'f', 's', 1, 'b-${id}');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda)`,
    );
  };
  demanda("I-1", "loja", "em_execucao", em("2026-03"));
  demanda("I-2", "loja", "concluida", em("2026-03"));
  demanda("I-3", "site", "em_execucao", em("2026-03"));
  b.exec(
    `INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('e0', 'I-1', 'comportamento', '{}', '${em("2026-01")}')`,
  );
  for (const r of [1, 2])
    b.exec(
      `INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b${String(r)}')`,
    );
  const ticket = (d: string, n: number, etapa: string, rodada: string, status: string, quando: string) => {
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('${d}', ${String(n)}, '${etapa}', '${status}', '${quando}', ${rodada})`);
  };
  ticket("I-1", 1, "implementar", "1", "concluido", em("2026-02"));
  ticket("I-1", 2, "encerrar_rodada", "1", "concluido", em("2026-02"));
  ticket("I-1", 3, "implementar", "2", "aberto", em("2026-03"));
  ticket("I-3", 1, "implementar", "NULL", "concluido", em("2026-03"));
  const sessao = (id: string, d: string, t: number) => {
    b.exec(`INSERT INTO trabalho_agentico VALUES ('${id}', '${d}', ${String(t)}, 'autonomo', 'conv')`);
  };
  sessao("s1", "I-1", 1);
  sessao("s2", "I-1", 3);
  sessao("s3", "I-3", 1);
  const execucao = (id: string, s: string, mes: string, falha: number, fim: string | null) =>
    b
      .prepare("INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)")
      .run(id, s, em(mes), fim, falha);
  execucao("x1", "s1", "2026-02", 1, `${em("2026-02").slice(0, 14)}01:00.000Z`);
  execucao("x2", "s1", "2026-02", 0, `${em("2026-02").slice(0, 14)}02:00.000Z`);
  execucao("x3", "s2", "2026-03", 0, null);
  execucao("x4", "s3", "2026-03", 0, `${em("2026-03").slice(0, 14)}00:30.000Z`);
  const uso = (x: string, modelo: string, entrada: number, custo: number | null) =>
    b
      .prepare(
        "INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo) VALUES (?, 'p', ?, ?, 1, 2, 3, ?)",
      )
      .run(x, modelo, entrada, custo);
  uso("x1", "a", 10, 1);
  uso("x2", "a", 20, 2); // a retomada soma uma vez, ao lado da primeira execução
  uso("x2", "b", 5, null); // custo desconhecido: nunca vira zero
  uso("x3", "a", 100, 4);
  uso("x4", "a", 1000, 8);
  const decisao = (n: number, id: number, resultado: string, nota: number | null, mes: string) =>
    b
      .prepare(
        "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES ('I-1', ?, ?, 'gate_pr', ?, ?, NULL, 'auditor', ?)",
      )
      .run(n, id, resultado, nota, em(mes));
  decisao(1, 1, "reprovado", null, "2026-02");
  decisao(2, 1, "aprovado", 4, "2026-02");
  decisao(2, 2, "aprovado", 5, "2026-02");
  b.prepare(
    "INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em) VALUES ('e1', 'I-1', 2, 'pr_aberto', '{}', ?)",
  ).run(em("2026-02"));
  // O ticket 3 reescreve 10 das 30 linhas do ticket 1; uma pessoa, 5.
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-1', 1, 'm', ?)").run(sha(1), em("2026-02"));
  b.prepare("INSERT INTO commit_ticket_demanda VALUES (?, 'I-1', 3, 'm', ?)").run(sha(2), em("2026-03"));
  b.prepare("INSERT INTO arquivo_commit_demanda VALUES (?, 'a.ts', NULL, 'M', 30, 0)").run(sha(1));
  b.prepare("INSERT INTO commit_humano_posterior VALUES (?, 'I-1', 3, NULL, 1, 10, 'I-1')").run(sha(2));
  b.prepare("INSERT INTO commit_humano_posterior VALUES (?, 'I-1', NULL, 'ana', 1, 5, NULL)").run(sha(3));
  return b;
}

const T = "'2026-01-01T00:00:00.000Z'";

/**
 * Demanda I-1, rodadas 1 e 2. Tickets: 1 planejar (sem rodada), 2 implementar (r1, 1 Tentativa reprovada),
 * 3 encerrar_rodada (r1), 4 implementar (r2), 5 encerrar_rodada (r2). Tudo em 01/01/2026.
 */
export function bancoDaDemanda(): DatabaseSync {
  const b = bancoMigrado();
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k')`);
  b.exec(
    `INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda)`,
  );
  for (const r of [1, 2])
    b.exec(
      `INSERT INTO rodada VALUES ('I-1', ${String(r)}, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'b${String(r)}')`,
    );
  for (const [n, etapa, rodada] of [
    [1, "planejar", "NULL"],
    [2, "implementar", "1"],
    [3, "encerrar_rodada", "1"],
    [4, "implementar", "2"],
    [5, "encerrar_rodada", "2"],
  ] as const)
    b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('I-1', ${String(n)}, '${etapa}', 'concluido', ${T}, ${rodada})`);
  b.exec(`INSERT INTO tentativa (demanda_id, ticket_id, numero, inicio, fim, resultado_tipo, motivo)
    VALUES ('I-1', 2, 1, ${T}, ${T}, 'reprovacao', 'corrija o teste')`);
  return b;
}

/** Uma sessão do ticket com uma execução; `usos` são [modelo, entrada, saída, cache leitura, cache escrita, custo]. */
export const gravarExecucao = (
  b: DatabaseSync,
  ticket: number,
  id: string,
  falha: 0 | 1,
  usos: [string, number, number, number, number, number | null][] = [],
) => {
  b.prepare("INSERT OR IGNORE INTO trabalho_agentico VALUES (?, 'I-1', ?, 'autonomo', 'conv')").run(
    `s${String(ticket)}`,
    ticket,
  );
  b.prepare("INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES (?, ?, ?, ?, ?)").run(
    id,
    `s${String(ticket)}`,
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:01:00.000Z",
    falha,
  );
  for (const [modelo, e, s, cl, ce, custo] of usos)
    b.prepare(
      "INSERT INTO uso_modelo_execucao (execucao_id, modelo_provedor, modelo_nome, tokens_entrada, tokens_saida, tokens_cache_leitura, tokens_cache_escrita, custo) VALUES (?, 'anthropic', ?, ?, ?, ?, ?, ?)",
    ).run(id, modelo, e, s, cl, ce, custo);
};

export const gravarDecisao = (b: DatabaseSync, ticket: number, id: number, resultado: string, nota: number | null) =>
  b
    .prepare(
      "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES ('I-1', ?, ?, 'gate_pr', ?, ?, NULL, 'auditor', ?)",
    )
    .run(ticket, id, resultado, nota, "2026-01-01T00:00:00.000Z");

export const gravarUsoDeclarado = (b: DatabaseSync, sessao: string, demanda: string, linhas: unknown[]) =>
  b
    .prepare("INSERT INTO uso_declarado (ferramenta, sessao, demanda_id, linhas) VALUES ('codex', ?, ?, ?)")
    .run(sessao, demanda, JSON.stringify(linhas));

export const linhaDeUsoDeclarado = (custo: number | null) => ({
  modelo: "openai/x",
  tokens_entrada: 1,
  tokens_saida: 1,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  custo,
  chamadas: 0,
});

export const gravarTicket = (
  b: DatabaseSync,
  demanda: string,
  ticket: number,
  etapa: string,
  rodada: number | null,
) => {
  b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
    VALUES ('${demanda}', ${String(ticket)}, '${etapa}', 'concluido', ${T}, ${rodada === null ? "NULL" : String(rodada)})`);
};

/** A Decisão de um Gate de qualquer demanda, no instante `instante`. */
export const gravarDecisaoEm = (
  b: DatabaseSync,
  [demanda, ticket, id]: [string, number, number],
  [gate, resultado, nota]: [string, string, number | null],
  instante: string,
) =>
  b
    .prepare(
      "INSERT INTO decisao_ticket (demanda_id, ticket_id, decisao_id, gate, resultado, nota, motivo, por_tipo, em) VALUES (?, ?, ?, ?, ?, ?, NULL, 'auditor', ?)",
    )
    .run(demanda, ticket, id, gate, resultado, nota, instante);
