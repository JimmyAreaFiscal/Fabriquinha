import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { marcaDoPRRodada, montarPRRodada, tituloDoPRRodada } from "./pr_rodada.ts";
import type { ProdutividadeRodada } from "./produtividade_rodada.ts";

const em = "2026-01-01T10:00:00Z";
const ticket = (ticket_id: number, etapa: string, status = "concluido", titulo?: string) => ({
  demanda_id: "I-206",
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  rodada_id: 2,
  ...(titulo === undefined ? {} : { titulo }),
});
const mensagem = {
  titulo: "Encerrar a rodada",
  oQueMudou: "Publica o PR.",
  decisoesNaoObvias: ["D04"],
  naoFeito: [],
  comoRevisar: ["Rode os testes."],
  naoVerificado: [],
  reversao: "Reverta o merge.",
};
const agregado = (comMensagem = true, tipo = "funcionalidade") =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-206",
      projeto: "p",
      titulo: "Encerrar",
      tipo,
      descricao: "Descrição.",
      fase: "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "x",
      origem_sessao: "y",
      enviada: true,
      branch: "fabriquinha/I-206",
    },
    tickets: [
      ticket(3, "implementar", "concluido", "Primeiro"),
      ticket(4, "implementar"),
      ticket(7, "encerrar_rodada", "em_execucao"),
    ],
    rodadas: [
      {
        demanda_id: "I-206",
        rodada_id: 2,
        titulo: "R",
        fase: "encerramento",
        e2e: false,
        branch: "fabriquinha/I-206-2",
      },
    ],
    decisoes: [],
    evidencias: comMensagem ? [{ demanda_id: "I-206", ticket_id: 7, tipo: "mensagem_pr", dados: mensagem, em }] : [],
  });
const zero = { execucoes: 1, tokensEntrada: 1, tokensSaida: 1, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
const relatorio = (custoIncompleto: boolean): ProdutividadeRodada => ({
  tickets: [{ ticket: "I-206.T3", etapa: "implementar", custo: 1, custoIncompleto, ...zero }],
  total: { custo: 1, custoIncompleto, ...zero },
});

test("título e marca usam o endereço público", () => {
  assert.equal(tituloDoPRRodada(agregado(), 2, "X"), "feat: X [I-206.R2]");
  assert.equal(tituloDoPRRodada(agregado(true, "problema"), 2, "X"), "fix: X [I-206.R2]");
  assert.equal(marcaDoPRRodada("I-206", 7), "<!-- fabriquinha I-206.T7 -->");
});

test("o corpo cita só endereços públicos e lista os tickets concluídos", () => {
  const r = montarPRRodada(agregado(), 2, 7, relatorio(false), 65_536);
  assert.equal(r.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(r.publicado, r.completo);
  assert.ok(r.completo.startsWith("<!-- fabriquinha I-206.T7 -->"));
  for (const t of ["I-206.R2", "I-206.T3", "I-206.T4", "## Reversão", "## Autoria e custo"])
    assert.ok(r.completo.includes(t), t);
  assert.ok(!r.completo.includes("T-"));
  assert.ok(!r.completo.includes("I-206.T7 ("), "o ticket em execução não está concluído");
  assert.ok(!r.completo.includes("(incompleto)"));
});

test("custo incompleto aparece marcado e reversão ausente é dita", () => {
  const ag = agregado();
  const { reversao: _, ...dados } = mensagem;
  ag.evidencias = ag.evidencias.map((e) => ({ ...e, dados }));
  const r = montarPRRodada(ag, 2, 7, relatorio(true), 65_536);
  assert.ok(r.completo.includes("(incompleto)"));
  assert.ok(r.completo.includes("Não declarada."));
});

test("corta ao limite da hospedagem com remissão ao pr_aberto", () => {
  const r = montarPRRodada(agregado(), 2, 7, relatorio(false), 300);
  assert.equal(r.publicado.length <= 300, true);
  assert.ok(r.publicado.endsWith("… corpo completo em I-206.R2, evidência pr_aberto\n"));
  assert.ok(r.completo.length > 300);
});

test("sem mensagem_pr a montagem recusa", () => {
  assert.throws(() => montarPRRodada(agregado(false), 2, 7, relatorio(false), 100), ErroDeRegra);
});
