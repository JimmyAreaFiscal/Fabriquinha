import assert from "node:assert/strict";
import { test } from "node:test";
import { type LinhaDeUso, Uso } from "../../../sessoes/publico.ts";
import type { EtapaTicket } from "../../etapas/publico.ts";
import { produtividadeDaRodada, type UsoDasExecucoes } from "./produtividade_rodada.ts";

const ticket = (ticket_id: number, etapa: EtapaTicket) => ({ demanda_id: "I-206", ticket_id, etapa });
const execucao = (id: string, ticket_id: number) => ({
  id,
  sessao: `s${String(ticket_id)}`,
  demanda_id: "I-206",
  ticket_id,
  inicio: "2026-01-01T10:00:00Z",
  falha: false,
  duracaoMs: 0,
});
const linha = (tokens_entrada: number, custo: number | null, modelo = "p/m"): LinhaDeUso => ({
  modelo,
  tokens_entrada,
  tokens_saida: 5,
  tokens_cache_leitura: 2,
  tokens_cache_escrita: 1,
  custo,
  chamadas: 0,
});
/** O Uso das execuções como `metricas` de Sessões o devolve: o de cada execução que tem algum. */
const usoDas = (execucoes: ReturnType<typeof execucao>[], usos: [string, LinhaDeUso[]][]): UsoDasExecucoes => ({
  execucoes,
  usoPorExecucao: new Map(usos.map(([id, linhas]) => [id, Uso.de(linhas, 1)])),
});

test("soma os custos conhecidos por ticket e no total", () => {
  const r = produtividadeDaRodada(
    usoDas(
      [execucao("e3", 3), execucao("e4", 4)],
      [
        ["e3", [linha(10, 1.5)]],
        ["e4", [linha(10, 0.5)]],
      ],
    ),
    [ticket(3, "implementar"), ticket(4, "revisar_rodada")],
  );
  assert.deepEqual(
    r.tickets.map((t) => [t.ticket, t.etapa, t.custo, t.custoIncompleto]),
    [
      ["I-206.T3", "implementar", 1.5, false],
      ["I-206.T4", "revisar_rodada", 0.5, false],
    ],
  );
  assert.equal(r.total.custo, 2);
  assert.equal(r.total.tokensEntrada, 20);
  assert.equal(r.total.execucoes, 2);
  assert.equal(r.total.custoIncompleto, false);
});

test("ticket sem custo medido é incompleto e o total é piso, nunca zero somado", () => {
  const r = produtividadeDaRodada(
    usoDas(
      [execucao("e3", 3), execucao("e4", 4)],
      [
        ["e3", [linha(10, 1)]],
        ["e4", [linha(10, null)]],
      ],
    ),
    [ticket(3, "implementar"), ticket(4, "implementar"), ticket(5, "implementar")],
  );
  assert.deepEqual(
    r.tickets.map((t) => t.custoIncompleto),
    [false, true, true],
  );
  assert.equal(r.tickets[2]?.execucoes, 0);
  assert.equal(r.total.custo, 1);
  assert.equal(r.total.custoIncompleto, true);
});

test("as execuções retomadas do ticket se somam, o custo ausente de um modelo deixa o ticket incompleto e o Uso de outra demanda fica de fora", () => {
  const r = produtividadeDaRodada(
    usoDas(
      [execucao("e3", 3), execucao("e3b", 3), { ...execucao("x", 3), demanda_id: "I-9" }],
      [
        ["e3", [linha(10, 1, "p/a")]],
        ["e3b", [linha(20, 2, "p/a"), linha(30, null, "p/b")]],
        ["x", [linha(5000, 9)]],
      ],
    ),
    [ticket(3, "implementar")],
  );
  assert.deepEqual(
    [r.total.tokensEntrada, r.total.custo, r.total.custoIncompleto, r.total.execucoes],
    [60, 3, true, 2],
  );
});
