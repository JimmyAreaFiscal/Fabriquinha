// Rota das sessões (F7 §4.2) chamada como o servidor a chama, contra um banco de verdade: as ativas e as terminadas do
// Histórico lidas das tabelas da demanda, as migradas pelo backfill inclusive.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";
import type { SessaoDeDemanda } from "./historico.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-historico-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const T0 = "2026-10-11T12:00:00.000Z";

/**
 * I-1 da loja, com a rodada R1: T1 de implementação concluído em duas execuções da sessão s1 (a primeira falhou) e T2
 * de planejamento aberto, com a sessão s2 rodando. I-2 do site: T1 de planejamento concluído, cuja sessão s3 termina
 * com falha, e a consulta s4 do mesmo ticket, que terminou bem.
 */
let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key) VALUES
      ('loja', '/r/loja', 'main', 'github', 'loja'),
      ('site', '/r/site', 'main', 'github', 'site');
    INSERT INTO demanda VALUES
      ('I-1', 'loja', 'Timeout no checkout', 'problema', 'd', 'execucao', '${T0}', 'f', 's', 1, 'fabriquinha/I-1'),
      ('I-2', 'site', 'Modo escuro', 'funcionalidade', 'd', 'planejamento', '${T0}', 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO rodada VALUES ('I-1', 1, 'Leitura', 'desenvolvimento', 0, 'fabriquinha/I-1-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, rodada_id) VALUES
      ('I-1', 1, 'implementar', 'concluido', '${T0}', 1),
      ('I-1', 2, 'planejar', 'em_execucao', '${T0}', NULL),
      ('I-2', 1, 'planejar', 'concluido', '${T0}', NULL);
    INSERT INTO sessao VALUES
      ('s1', 'I-1', 1, 'autonomo', 'c1'),
      ('s2', 'I-1', 2, 'interativo', 'c2'),
      ('s3', 'I-2', 1, 'autonomo', 'c3'),
      ('s4', 'I-2', 1, 'consulta', 'c4');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha, modelo_provedor, modelo_nome) VALUES
      ('x1', 's1', '${T0}', '2026-10-11T12:10:00.000Z', 1, NULL, NULL),
      ('x2', 's1', '2026-10-11T12:20:00.000Z', '2026-10-11T12:30:00.000Z', 0, 'anthropic', 'claude-opus-5-5'),
      ('x3', 's2', '2026-10-11T12:40:00.000Z', NULL, 0, NULL, NULL),
      ('x4', 's3', '${T0}', '2026-10-11T13:00:00.000Z', 1, NULL, NULL),
      ('x5', 's4', '2026-10-11T15:00:00.000Z', '2026-10-11T15:01:00.000Z', 0, NULL, NULL);
  `);
});

/** Chama `GET /api/sessoes` como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function sessoes(query: string): Promise<unknown> {
  const rota = ROTAS.find((r) => r.metodo === "GET" && casar(r.caminho, "/api/sessoes"));
  assert.ok(rota);
  try {
    return await rota.tratar({
      banco,
      agendador: { proximaBusca: () => new Date() },
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
  (lista as SessaoDeDemanda[]).map(({ sessao, titulo, ticket, resultado, desde }) => [
    sessao,
    titulo,
    ticket,
    resultado,
    desde,
  ]);

test("histórico: as terminadas com demanda, ticket, resultado da última execução e datas, da mais antiga para a mais recente", async () => {
  assert.deepEqual(resumo(await sessoes("escopo=historico")), [
    [`s1`, "Timeout no checkout", "I-1.T1", "concluida", "2026-10-11T12:30:00.000Z"],
    [`s3`, "Modo escuro", "I-2.T1", "falha", "2026-10-11T13:00:00.000Z"],
    [`s4`, "Modo escuro", "I-2.T1", "concluida", "2026-10-11T15:01:00.000Z"],
  ]);
  const [s1] = (await sessoes("escopo=historico&projeto=loja")) as SessaoDeDemanda[];
  assert.deepEqual(
    [s1?.demanda, s1?.rodada, s1?.etapa, s1?.modo, s1?.modelo, s1?.inicio, s1?.fim],
    [
      "I-1",
      "I-1.R1",
      "implementar",
      "autonomo",
      { provedor: "anthropic", modelo: "claude-opus-5-5" },
      T0,
      "2026-10-11T12:30:00.000Z",
    ],
  );
});

test("histórico: filtra por projeto, demanda e etapa", async () => {
  const ids = async (query: string) => resumo(await sessoes(query)).map(([s]) => s);
  assert.deepEqual(await ids("escopo=historico&projeto=site"), ["s3", "s4"]);
  assert.deepEqual(await ids("escopo=historico&demanda=I-1"), ["s1"]);
  assert.deepEqual(await ids("escopo=historico&etapa=planejar"), ["s3", "s4"]);
  assert.deepEqual(await ids("escopo=historico&projeto=loja&etapa=planejar"), []);
});

test("ativas: as sessões de demanda em andamento, sem as terminadas", async () => {
  const ativas = (await sessoes("escopo=ativas")) as SessaoDeDemanda[];
  assert.deepEqual(
    ativas.map((s) => [s.sessao, s.estado, s.ticket, s.etapa]),
    [["s2", "rodando", "I-1.T2", "planejar"]],
  );
});

test("ativas: o ticket que falhou aguarda o Auditor, com o motivo", async () => {
  banco.exec(
    "UPDATE ticket_demanda SET status = 'falhou', motivo_falha = 'testes falharam' WHERE demanda_id = 'I-1' AND ticket_id = 2",
  );
  banco.exec("UPDATE execucao_sessao SET fim = '2026-10-11T12:50:00.000Z', falha = 1 WHERE id = 'x3'");
  const [s2] = (await sessoes("escopo=ativas")) as SessaoDeDemanda[];
  assert.deepEqual([s2?.sessao, s2?.estado, s2?.motivo, s2?.resultado], ["s2", "aguardando_humano", "falha", "falha"]);
});

test("filtro inválido dá 422", async () => {
  for (const query of ["escopo=todas", "escopo=historico&demanda=1", "escopo=historico&etapa=desenho"]) {
    assert.equal(((await sessoes(query)) as [number])[0], 422, query);
  }
});
