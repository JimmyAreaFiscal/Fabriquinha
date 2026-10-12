// Rota das sessões (F7 §4.2; F4 §5.3) chamada como o servidor a chama, contra um banco de verdade: as ativas como o
// F4 as lista e as terminadas do Histórico com o título da issue, o resultado e o custo.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { ABORTADA } from "../../execucao/gerente.ts";
import { abrir } from "../../persistencia/banco.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";
import type { SessaoDoHistorico } from "./historico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-historico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const T0 = "2026-10-11T12:00:00.000Z";
const S1 = "11111111-1111-4111-8111-111111111111";
const S2 = "22222222-2222-4222-8222-222222222222";
const S3 = "33333333-3333-4333-8333-333333333333";
const S4 = "44444444-4444-4444-8444-444444444444";
const S5 = "55555555-5555-4555-8555-555555555555";

/**
 * I-1 da loja no desenvolvimento: T-1 de desenho concluído em duas execuções (S1, a última com sucesso, e uma
 * consulta S2 que o Auditor abortou) e T-2 aberto, ativo (S3). I-2 do site, com T-3 de registro concluído e a
 * execução que falhou com o pi abortando sozinho, sem o Auditor (S4), e uma consulta que caiu (S5). Custos em `uso`.
 */
let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness) VALUES
      ('loja', '/r/loja', 'main', 'github', '["t"]', 'loja', '[{"nome":"f","comando":"c","descricao":"d"}]'),
      ('site', '/r/site', 'main', 'github', '["t"]', 'site', '[{"nome":"f","comando":"c","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES
      (1, 'loja', 'Timeout no checkout', 'problema', 'desenvolvimento', '${T0}'),
      (2, 'site', 'Modo escuro', 'funcionalidade', 'desenho', '${T0}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'desenho', 'Desenhar', 'concluido', 'fabriquinha', '${T0}', '2026-10-11T12:30:00.000Z'),
      (2, 1, 'desenvolvimento', 'Buscar cupons', 'aberto', 'fabriquinha', '${T0}', NULL),
      (3, 2, 'registro', 'Registrar', 'concluido', 'fabriquinha', '${T0}', '2026-10-11T13:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em) VALUES
      (1, 1, 'autonomo', '${S1}', 'falha', 'tempo limite', '${T0}', '2026-10-11T12:10:00.000Z'),
      (2, 1, 'autonomo', '${S1}', 'sucesso', NULL, '2026-10-11T12:20:00.000Z', '2026-10-11T12:30:00.000Z'),
      (3, 1, 'consulta', '${S2}', 'falha', '${ABORTADA}', '2026-10-11T14:00:00.000Z', '2026-10-11T14:05:00.000Z'),
      (4, 2, 'interativo', '${S3}', 'sucesso', NULL, '${T0}', '2026-10-11T12:01:00.000Z'),
      (5, 3, 'interativo', '${S4}', 'falha', 'o agente parou com stopReason aborted', '${T0}', '2026-10-11T13:00:00.000Z'),
      (6, 3, 'consulta', '${S5}', 'sucesso', NULL, '2026-10-11T15:00:00.000Z', '2026-10-11T15:01:00.000Z');
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo) VALUES
      (1, 'anthropic', 'claude-opus-5-5', 1, 1, 1, 0, 0, 0.5),
      (2, 'anthropic', 'claude-opus-5-5', 1, 1, 1, 0, 0, 0.25),
      (2, 'anthropic', 'claude-sonnet-5-5', 1, 1, 1, 0, 0, 0.125);
  `);
});

/** Chama `GET /api/sessoes` como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function sessoes(query: string): Promise<unknown> {
  const rota = ROTAS.find((r) => r.metodo === "GET" && casar(r.caminho, "/api/sessoes"));
  assert.ok(rota);
  try {
    return await rota.tratar({
      banco,
      agendador: { proximaBusca: () => new Date(), executarAgora: () => Promise.resolve() },
      params: {},
      query: new URLSearchParams(query),
      corpo: undefined,
      cabecalhos: {},
      resposta: undefined as unknown as ServerResponse,
    });
  } catch (erro) {
    return traduzir(erro);
  }
}

const resumo = (lista: unknown) =>
  (lista as SessaoDoHistorico[]).map(({ sessao, titulo, resultado, custo, desde }) => [
    sessao,
    titulo,
    resultado,
    custo,
    desde,
  ]);

test("histórico: as terminadas com o título da issue, o resultado da última execução e o custo das execuções", async () => {
  assert.deepEqual(resumo(await sessoes("escopo=historico")), [
    [S1, "Timeout no checkout", "concluida", 0.875, "2026-10-11T12:30:00.000Z"],
    [S4, "Modo escuro", "falha", 0, "2026-10-11T13:00:00.000Z"],
    [S2, "Timeout no checkout", "abortada", 0, "2026-10-11T14:05:00.000Z"],
    [S5, "Modo escuro", "concluida", 0, "2026-10-11T15:01:00.000Z"],
  ]);
  assert.deepEqual(resumo(await sessoes("escopo=historico&projeto=site&etapa=registro")), [
    [S4, "Modo escuro", "falha", 0, "2026-10-11T13:00:00.000Z"],
    [S5, "Modo escuro", "concluida", 0, "2026-10-11T15:01:00.000Z"],
  ]);
  assert.deepEqual(
    resumo(await sessoes("escopo=historico&issue=1")).map(([s]) => s),
    [S1, S2],
  );
});

test("ativas: as sessões como o F4 as calcula, sem o que só o histórico mostra", async () => {
  const ativas = (await sessoes("escopo=ativas")) as Record<string, unknown>[];
  assert.deepEqual(
    ativas.map((s) => [s.sessao, s.motivo, "resultado" in s]),
    [[S3, "conversa", false]],
  );
});

test("filtro inválido dá 422", async () => {
  for (const query of ["escopo=todas", "escopo=historico&issue=I-1", "escopo=historico&etapa=teste"]) {
    assert.equal(((await sessoes(query)) as [number])[0], 422, query);
  }
});
