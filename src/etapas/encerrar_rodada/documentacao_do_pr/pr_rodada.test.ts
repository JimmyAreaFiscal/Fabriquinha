import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "../../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { marcaDoPRRodada, montarPRRodada, tituloDoPRRodada } from "./pr_rodada.ts";
import type { ProdutividadeRodada } from "../../../custos/aplicacao/produtividade_rodada.ts";

const em = "2026-01-01T10:00:00Z";
const ticket = (ticket_id: number, etapa: string, status = "concluido", titulo?: string) => ({
  demanda_id: "I-206",
  ticket_id,
  etapa,
  estado: status,
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
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
      estado: "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "x", sessao: "y" },
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
        estado: "encerrar_rodada",
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: "fabriquinha/I-206-2",
      },
    ],
    decisoes: [],
    evidencias: comMensagem
      ? [
          {
            demanda_id: "I-206",
            ticket_id: 7,
            tipo: "mensagem_pr",
            autor: { tipo: "agente", trabalho_id: "1" },
            dados: mensagem,
            em,
          },
        ]
      : [],
  });
const zero = { execucoes: 1, tokensEntrada: 1, tokensSaida: 1, tokensCacheLeitura: 0, tokensCacheEscrita: 0 };
/** O resumo que nunca deveria ser pedido: o corpo coube. */
const semResumo = () => Promise.reject(new Error("não devia resumir"));
const relatorio = (custoIncompleto: boolean): ProdutividadeRodada => ({
  tickets: [{ ticket: "I-206.T3", etapa: "implementar", custo: 1, custoIncompleto, ...zero }],
  total: { custo: 1, custoIncompleto, ...zero },
});

test("título e marca usam o endereço público", () => {
  assert.equal(tituloDoPRRodada(agregado(), 2, "X"), "feat: X [I-206.R2]");
  assert.equal(tituloDoPRRodada(agregado(true, "problema"), 2, "X"), "fix: X [I-206.R2]");
  assert.equal(marcaDoPRRodada("I-206", 7), "<!-- fabriquinha I-206.T7 -->");
});

test("o corpo cita só endereços públicos e lista os tickets concluídos", async () => {
  const r = await montarPRRodada(agregado(), 2, 7, relatorio(false), 65_536, semResumo);
  assert.equal(r.titulo, "feat: Encerrar a rodada [I-206.R2]");
  assert.equal(r.publicado, r.completo);
  assert.ok(r.completo.startsWith("<!-- fabriquinha I-206.T7 -->"));
  for (const t of ["I-206.R2", "I-206.T3", "I-206.T4", "## Reversão", "## Autoria e custo"])
    assert.ok(r.completo.includes(t), t);
  assert.ok(!r.completo.includes("T-"));
  assert.ok(!r.completo.includes("I-206.T7 ("), "o ticket em execução não está concluído");
  assert.ok(!r.completo.includes("(incompleto)"));
});

test("custo incompleto aparece marcado e reversão ausente é dita", async () => {
  const ag = agregado();
  const { reversao: _, ...dados } = mensagem;
  ag.evidencias = ag.evidencias.map((e) => ({ ...e, dados }));
  const r = await montarPRRodada(ag, 2, 7, relatorio(true), 65_536, semResumo);
  assert.ok(r.completo.includes("(incompleto)"));
  assert.ok(r.completo.includes("Não declarada."));
});

// O corpo sem as seções da demanda e gerais, com a remissão, para medir o limite dos casos abaixo.
const doPR = async () => {
  const r = await montarPRRodada(agregado(), 2, 7, relatorio(false), 1, () => Promise.resolve(undefined));
  return r.completo
    .split("\n\n## ")
    .filter((s) => !/^(Por quê|Tickets da rodada concluídos|Autoria e custo)\n/.test(s))
    .join("\n\n## ")
    .trimEnd();
};

test("no limite, as seções do mensagem_pr ficam inteiras e a demanda, os tickets e o custo vão resumidos", async () => {
  const pedidos: { texto: string; limite: number }[] = [];
  const limite = (await doPR()).length + 200;
  const r = await montarPRRodada(agregado(), 2, 7, relatorio(false), limite, (texto, l) => {
    pedidos.push({ texto, limite: l });
    return Promise.resolve("Encerrar a I-206 <já>, US$ 1.");
  });
  assert.ok(r.completo.length > limite);
  assert.ok(r.publicado.length <= limite);
  assert.equal(pedidos.length, 1);
  for (const t of ["## Por quê", "Descrição.", "## Tickets da rodada concluídos", "I-206.T3", "## Autoria e custo"])
    assert.ok(pedidos[0]?.texto.includes(t), t);
  assert.ok(!pedidos[0]?.texto.includes("## O que mudou"));
  assert.ok(
    r.publicado.startsWith(
      "<!-- fabriquinha I-206.T7 -->\n\n## Contexto (resumido)\n\nEncerrar a I-206 &lt;já>, US$ 1.",
    ),
  );
  for (const t of ["## O que mudou", "## Decisões não óbvias", "## Como revisar", "## Não verificado", "## Reversão"])
    assert.ok(r.publicado.includes(t), t);
  assert.ok(!r.publicado.includes("## Autoria e custo"));
  assert.ok(r.publicado.endsWith("… corpo completo em I-206.R2, evidência pr_aberto\n"));
});

test("sem resumo, ou com resumo maior que o espaço, o PR vai sem o contexto e com as seções do mensagem_pr", async () => {
  const limite = (await doPR()).length + 200;
  for (const resumo of [undefined, "x".repeat(500)]) {
    const r = await montarPRRodada(agregado(), 2, 7, relatorio(false), limite, () => Promise.resolve(resumo));
    assert.ok(r.publicado.length <= limite);
    assert.ok(!r.publicado.includes("## Contexto (resumido)"));
    assert.ok(!r.publicado.includes("## Por quê"));
    assert.ok(r.publicado.includes("## Reversão\n\nReverta o merge."));
  }
});

test("corta ao limite da hospedagem com remissão ao pr_aberto quando nem o mensagem_pr cabe", async () => {
  const r = await montarPRRodada(agregado(), 2, 7, relatorio(false), 300, () => Promise.resolve("curto"));
  assert.equal(r.publicado.length <= 300, true);
  assert.ok(r.publicado.endsWith("… corpo completo em I-206.R2, evidência pr_aberto\n"));
  assert.ok(r.completo.length > 300);
  assert.ok(r.publicado.includes("## O que mudou"));
});

test("sem mensagem_pr a montagem recusa", async () => {
  await assert.rejects(montarPRRodada(agregado(false), 2, 7, relatorio(false), 100, semResumo), ErroDeRegra);
});
