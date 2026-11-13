import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA, Endereco } from "../../../etapas/publico.ts";
import { AgregadoDemanda } from "../agregado/agregado_demanda.ts";
import { concluirTicketImplementar } from "./conclusao_ticket.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const TRES_VERIFICACOES = ["execucao_testes", "matriz_fitness", "relatorio_sonar"];
const montar = (
  status: string,
  estado = "em_execucao",
  etapa = "implementar",
  reprovacoes = 0,
  tiposComEvidencia = TRES_VERIFICACOES,
) =>
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
    evidencias: tiposComEvidencia.map((tipo) => ({
      demanda_id: "I-1",
      ticket_id: 2,
      tipo,
      dados: {},
      autor: FABRIQUINHA,
      em: t0,
    })),
    tentativas: Array.from({ length: reprovacoes }, (_, indice) => ({
      ticket: Endereco.doTicket("I-1", 2),
      numero: indice + 1,
      inicio: t0,
      fim: t0,
      resultado: { tipo: "reprovacao", motivo: "corrija" },
    })),
    tickets: [
      {
        demanda_id: "I-1",
        ticket_id: 2,
        rodada_id: undefined,
        etapa,
        estado: status,
        estado_alterado_em: t0,
        criado_por: FABRIQUINHA,
      },
    ],
  });
const concluirImplementacao = (ag: AgregadoDemanda, ator = FABRIQUINHA) =>
  concluirTicketImplementar(ag, { ticket_id: 2 }, ator, { agora: t1 });

test("CA-8: pendências citadas pelo tipo; ticket segue em_execucao", () => {
  const ag = montar("em_execucao", "em_execucao", "implementar", 0, ["execucao_testes", "relatorio_sonar"]);
  assert.throws(
    () => concluirImplementacao(ag),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.includes("I-1.T2") &&
      e.message.includes("matriz_fitness (ausente)") &&
      !e.message.includes("relatorio_sonar") &&
      !/\bT-2\b/.test(e.message),
  );
  assert.deepEqual(
    ag.tickets.map((t) => t.estado),
    ["em_execucao"],
  );
});

test("CA-9: sem pendências conclui com sucesso e preserva as reprovações anteriores", () => {
  const novo = concluirImplementacao(montar("em_execucao", "em_execucao", "implementar", 1));
  assert.deepEqual(
    novo.tickets.map((t) => [t.estado, t.estado_alterado_em]),
    [["concluido", t1]],
  );
  assert.deepEqual(
    novo.tentativas.map((tentativa) => tentativa.resultado),
    [{ tipo: "reprovacao", motivo: "corrija" }, { tipo: "sucesso" }],
  );
  assert.equal(novo.tentativas.at(-1)?.fim, t1);
});

test("CA-10: o agente não conclui", () => {
  const ag = montar("em_execucao");
  assert.throws(() => concluirImplementacao(ag, AUDITOR), ErroDeEscopo);
  assert.deepEqual(
    ag.tickets.map((t) => t.estado),
    ["em_execucao"],
  );
});

test("CA-11: ticket aberto é rejeitado citando o estado atual", () => {
  assert.throws(() => concluirImplementacao(montar("aberto")), /o estado atual é aberto/);
});

test("etapa diferente de implementar é rejeitada", () => {
  assert.throws(
    () => concluirImplementacao(montar("em_execucao", "planejar", "planejar")),
    (e) => e instanceof ErroDeRegra && e.message.includes("I-1.T2 é da etapa planejar"),
  );
});

test("demanda encerrada é rejeitada", () => {
  assert.throws(() => concluirImplementacao(montar("em_execucao", "concluida")), ErroDeRegra);
});
