import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { concluirTicketImplementar } from "./conclusao_ticket.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { EvidenciaEtapa } from "./evidencia_etapa.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const montar = (status: string, fase = "execucao", etapa = "implementar", devolucoes = 0) =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: t0,
      origem_ferramenta: "f",
      origem_sessao: "s",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [
      { demanda_id: "I-1", ticket_id: 2, rodada_id: undefined, etapa, status, status_alterado_em: t0, devolucoes },
    ],
  });
const ev = (tipo: string, aprovada?: boolean) =>
  ({
    demanda_id: "I-1",
    rodada_id: undefined,
    ticket_id: 2,
    tipo,
    produtor: "fabriquinha",
    aprovada,
    dados: {},
  }) as EvidenciaEtapa;
const aprovadas = [ev("execucao_testes", true), ev("matriz_fitness", true), ev("relatorio_sonar", true)];
const concluir = (ag: AgregadoDemanda, ator = FABRIQUINHA, evidencias = aprovadas) =>
  concluirTicketImplementar(ag, { ticket_id: 2 }, ator, { agora: t1 }, evidencias);

test("CA-8: pendências citadas pelo tipo; ticket segue em_execucao", () => {
  const ag = montar("em_execucao");
  assert.throws(
    () => concluir(ag, FABRIQUINHA, [ev("execucao_testes", true), ev("relatorio_sonar", false)]),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.includes("I-1.T2") &&
      e.message.includes("matriz_fitness (ausente)") &&
      e.message.includes("relatorio_sonar (reprovado)") &&
      !/\bT-2\b/.test(e.message),
  );
  assert.deepEqual(
    ag.tickets.map((t) => t.status),
    ["em_execucao"],
  );
});

test("CA-9: sem pendências conclui e zera as devoluções", () => {
  const novo = concluir(montar("em_execucao", "execucao", "implementar", 1));
  assert.deepEqual(
    novo.tickets.map((t) => [t.status, t.devolucoes, t.status_alterado_em]),
    [["concluido", 0, t1]],
  );
});

test("CA-10: o agente não conclui", () => {
  const ag = montar("em_execucao");
  assert.throws(() => concluir(ag, AUDITOR), ErroDeEscopo);
  assert.deepEqual(
    ag.tickets.map((t) => t.status),
    ["em_execucao"],
  );
});

test("CA-11: ticket aberto é recusado citando o endereço público", () => {
  assert.throws(() => concluir(montar("aberto")), /I-1\.T2 está aberto/);
});

test("etapa diferente de implementar é recusada", () => {
  assert.throws(
    () => concluir(montar("em_execucao", "planejamento", "planejar")),
    (e) => e instanceof ErroDeRegra && e.message.includes("I-1.T2 é da etapa planejar"),
  );
});

test("demanda encerrada é recusada", () => {
  assert.throws(() => concluir(montar("em_execucao", "concluida")), ErroDeRegra);
});
