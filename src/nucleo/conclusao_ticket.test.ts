import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "./ator.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { concluirTicketImplementar } from "./conclusao_ticket.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import type { EvidenciaEtapa } from "./evidencia_etapa.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const montar = (status: string, estado = "em_execucao", etapa = "implementar", devolucoes = 0) =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [
      {
        demanda_id: "I-1",
        ticket_id: 2,
        rodada_id: undefined,
        etapa,
        estado: status,
        estado_alterado_em: t0,
        devolucoes,
        criado_por: FABRIQUINHA,
      },
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
const concluirImplementacao = (ag: AgregadoDemanda, ator = FABRIQUINHA, evidencias = aprovadas) =>
  concluirTicketImplementar(ag, { ticket_id: 2 }, ator, { agora: t1 }, evidencias);

test("CA-8: pendências citadas pelo tipo; ticket segue em_execucao", () => {
  const ag = montar("em_execucao");
  assert.throws(
    () => concluirImplementacao(ag, FABRIQUINHA, [ev("execucao_testes", true), ev("relatorio_sonar", false)]),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.includes("I-1.T2") &&
      e.message.includes("matriz_fitness (ausente)") &&
      e.message.includes("relatorio_sonar (reprovado)") &&
      !/\bT-2\b/.test(e.message),
  );
  assert.deepEqual(
    ag.tickets.map((t) => t.estado),
    ["em_execucao"],
  );
});

test("CA-9: sem pendências conclui e zera as devoluções", () => {
  const novo = concluirImplementacao(montar("em_execucao", "em_execucao", "implementar", 1));
  assert.deepEqual(
    novo.tickets.map((t) => [t.estado, t.devolucoes, t.estado_alterado_em]),
    [["concluido", 0, t1]],
  );
});

test("CA-10: o agente não conclui", () => {
  const ag = montar("em_execucao");
  assert.throws(() => concluirImplementacao(ag, AUDITOR), ErroDeEscopo);
  assert.deepEqual(
    ag.tickets.map((t) => t.estado),
    ["em_execucao"],
  );
});

test("CA-11: ticket aberto é recusado citando o estado atual", () => {
  assert.throws(() => concluirImplementacao(montar("aberto")), /o estado atual é aberto/);
});

test("etapa diferente de implementar é recusada", () => {
  assert.throws(
    () => concluirImplementacao(montar("em_execucao", "planejar", "planejar")),
    (e) => e instanceof ErroDeRegra && e.message.includes("I-1.T2 é da etapa planejar"),
  );
});

test("demanda encerrada é recusada", () => {
  assert.throws(() => concluirImplementacao(montar("em_execucao", "concluida")), ErroDeRegra);
});
