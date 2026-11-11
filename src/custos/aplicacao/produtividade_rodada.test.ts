import assert from "node:assert/strict";
import { test } from "node:test";
import type { TicketDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import type {
  ProcessoDoTrabalho,
  TrabalhoGerenciado,
  UsoModeloExecucao,
} from "../../execucao/nucleo/trabalho_agentico.ts";
import { produtividadeDaRodada } from "./produtividade_rodada.ts";

const ticket = (ticket_id: number, etapa: TicketDemanda["etapa"]): TicketDemanda => ({
  demanda_id: "I-206",
  ticket_id,
  etapa,
  estado: "concluido",
  estado_alterado_em: "2026-01-01T10:00:00Z",
  criado_por: { tipo: "fabriquinha" },
  rodada_id: 2,
});
const sessao = (ticket_id: number): TrabalhoGerenciado => ({
  id: `s${String(ticket_id)}`,
  demanda_id: "I-206",
  ticket_id,
  modo: "autonomo",
  conversa_referencia: "c",
});
const exec = (ticket_id: number): ProcessoDoTrabalho => ({
  id: `e${String(ticket_id)}`,
  trabalho_id: `s${String(ticket_id)}`,
  inicio: "2026-01-01T10:00:00Z",
  falha: false,
});
const uso = (ticket_id: number, custo?: number): UsoModeloExecucao => ({
  execucao_id: `e${String(ticket_id)}`,
  modelo_provedor: "p",
  modelo_nome: "m",
  tokens_entrada: 10,
  tokens_saida: 5,
  tokens_cache_leitura: 2,
  tokens_cache_escrita: 1,
  ...(custo === undefined ? {} : { custo }),
});

test("soma os custos conhecidos por ticket e no total", () => {
  const r = produtividadeDaRodada(
    [sessao(3), sessao(4)],
    [exec(3), exec(4)],
    [uso(3, 1.5), uso(4, 0.5)],
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
    [sessao(3), sessao(4), sessao(5)],
    [exec(3), exec(4)],
    [uso(3, 1), uso(4)],
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

test("a mesma chave repetida conta uma vez, o custo ausente de um modelo deixa o ticket incompleto e uso sem execução é ignorado", () => {
  const usoDe = (execucao_id: string, modelo_nome: string, tokens_entrada: number, custo?: number) => ({
    ...uso(3, custo),
    execucao_id,
    modelo_nome,
    tokens_entrada,
  });
  const r = produtividadeDaRodada(
    [sessao(3)],
    [exec(3), { ...exec(3), id: "e3b" }],
    [
      usoDe("e3", "a", 10, 1),
      usoDe("e3", "a", 10, 1),
      usoDe("e3b", "a", 20, 2),
      usoDe("e3b", "b", 30),
      usoDe("x", "a", 5000, 9),
    ],
    [ticket(3, "implementar")],
  );
  assert.deepEqual(
    [r.total.tokensEntrada, r.total.custo, r.total.custoIncompleto, r.total.execucoes],
    [60, 3, true, 2],
  );
});
