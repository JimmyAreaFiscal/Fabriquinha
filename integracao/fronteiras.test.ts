// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-18, 19 e 21 (fronteiras de validação): evidência com dois
// donos e substituição, plano inválido rejeitado antes de executar e configuração de projeto inválida. O cenário é
// montado pelos serviços, com banco e git reais numa raiz temporária; nenhum pi chega a ser iniciado.
import assert from "node:assert/strict";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ZodError } from "zod";
import { type Ator } from "../src/fluxo/nucleo/ator.ts";
import { HarnessPi } from "../src/execucao/infra/harness_pi.ts";
import * as gestao from "../src/demanda/aplicacao/gestao_demandas.ts";
import { buscarProjeto, gravarProjeto } from "../src/ambiente/armazenamento/projetos.ts";
import { Projeto } from "../src/ambiente/nucleo/projeto.ts";
import {
  AUTOR,
  base,
  criarCenario,
  demanda,
  demandaAprovada,
  ORIGENS_DOS_ANEXOS,
  proporPlanoDoAgente,
  registrarExterna,
} from "./apoio.ts";
import { instalarPiFalso } from "../apoio-testes/pi_falso.ts";

const pi = instalarPiFalso(base);
const harness = new HarnessPi();

/** O `planejar` da demanda aprovada é o ticket 2 (o 1 é o `demanda`). */
const PLANEJAR = 2;
const agente: Ator = { tipo: "agente", trabalho_id: "execucao-1" };

test("CA-SDLC-18: a nova evidência do mesmo tipo e dono substitui só a anterior", (t) => {
  const c = criarCenario(t);
  const id = registrarExterna(c);
  const submeterCriterio = (criterio: string) =>
    gestao.submeterEvidencia(
      c.banco,
      id,
      { tipo: "criterios_aceite", dados: { criterios: [{ id: criterio, dado: "d", quando: "q", entao: "e" }] } },
      AUTOR,
      ORIGENS_DOS_ANEXOS,
    );

  submeterCriterio("CA-1");
  submeterCriterio("CA-2");
  assert.deepEqual(
    demanda(c, id).evidencias.map((e) => [e.tipo, (e.dados.criterios as { id: string }[]).map((x) => x.id)]),
    [["criterios_aceite", ["CA-2"]]],
  );
});

test("CA-SDLC-19: plano com CA-n inexistente ou com dependência entre rodadas é rejeitado antes de executar", async (t) => {
  const c = criarCenario(t);
  pi.roteirizar();
  const id = await demandaAprovada(c);
  const plano = (criterio: string, dependeDoTicket1 = false) => ({
    demanda_id: id,
    criterios: [criterio],
    rodadas: [1, 2].map((rodada_id) => ({
      demanda_id: id,
      rodada_id,
      titulo: `Rodada ${String(rodada_id)}`,
      e2e: false,
      criterios: [criterio],
    })),
    tickets: [1, 2].map((ticket_id) => ({
      demanda_id: id,
      ticket_id,
      rodada_id: ticket_id,
      titulo: `Ticket ${String(ticket_id)}`,
      descricao: "d",
      depende: dependeDoTicket1 && ticket_id === 2 ? [{ demanda_id: id, ticket_id: 1 }] : [],
    })),
  });
  const antes = demanda(c, id);

  assert.throws(() => {
    proporPlanoDoAgente(c.banco, id, plano("CA-9"), agente);
  }, /CA-9.*não tem/);
  assert.throws(() => {
    proporPlanoDoAgente(c.banco, id, plano("CA-1", true), agente);
  }, /de outra rodada/);

  const depois = demanda(c, id);
  assert.equal(
    depois.evidencias.some((e) => e.tipo === "plano"),
    false,
  );
  assert.equal(depois.demanda.estado, "planejar");
  assert.deepEqual(depois.decisoes, antes.decisoes);
  assert.deepEqual(depois.rodadas, []);
  assert.equal(depois.tickets.find((x) => x.ticket_id === PLANEJAR)?.estado, "aberto");
  assert.equal(pi.prompts().length, 0);
});

test("CA-SDLC-21: configuração de projeto inválida é rejeitada na fronteira, sem gravar nem ler fora do escopo", (t) => {
  const c = criarCenario(t);
  const tabelas = () =>
    [
      "projeto",
      "configuracao_etapa_projeto",
      "comando_preparacao_projeto",
      "fitness_function_projeto",
      "linguagem_projeto",
      "configuracao_e2e",
      "glob_e2e",
    ].map((n) => c.banco.prepare(`SELECT * FROM ${n} ORDER BY rowid`).all());
  const valida = {
    nome: c.projeto,
    branch_base: "main",
    chave_sonarqube: "chave-loja",
    raiz_git: c.repo,
    hospedagem: "github",
    verificacoes: {
      preparacao: ["true"],
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  };
  const e2e = (codigo_falha: number, glob = "e2e/**") => ({
    e2e: [{ caminho_linguagem: ".", comando_build: "b", comando_execucao: "e", codigo_falha }],
    globs: [{ caminho_linguagem: ".", glob }],
  });
  // Arquivo isca fora do escopo (ao lado do repositório): um glob com `..` poderia alcançá-lo.
  const isca = join(c.dir, "isca.txt");
  writeFileSync(isca, "segredo");
  const iscaAntes = statSync(isca);

  gravarProjeto(
    c.banco,
    Projeto.parse({
      ...valida,
      etapas: [
        {
          etapa: "implementar",
          configuracao_agente: { modelo: { provedor: "anthropic", nome: "m-1" }, effort: "high" },
        },
      ],
    }),
  );
  const antes = tabelas();
  assert.throws(() => {
    gravarProjeto(c.banco, Projeto.parse({ ...valida, raiz_git: "repos/loja" }));
  }, ZodError);
  assert.deepEqual(tabelas(), antes, "raiz relativa: nada gravado");
  // As etapas são do cadastro do projeto, que as grava sozinhas.
  for (const [nome, etapa] of [
    ["modelo incompleto", { configuracao_agente: { modelo: { provedor: "anthropic" } } }],
    ["effort inválido", { configuracao_agente: { effort: "altissimo" } }],
  ] as const) {
    assert.throws(
      () => {
        gravarProjeto(c.banco, Projeto.parse({ ...valida, etapas: [{ etapa: "implementar", ...etapa }] }));
      },
      Error,
      nome,
    );
    assert.deepEqual(tabelas(), antes, `${nome}: nada gravado`);
  }
  const invalidas: [string, object][] = [
    ["preparação vazia", { preparacao: [""] }],
    ["E2E abaixo de 1", e2e(0)],
    ["E2E acima de 255", e2e(256)],
    ["glob com ..", e2e(1, "../isca.txt")],
    ["glob absoluto", e2e(1, isca)],
    ["caminho de linguagem inválido", { linguagens: [{ caminho: "../fora", linguagem: "ts", comando_teste: "true" }] }],
  ];
  for (const [nome, mudanca] of invalidas) {
    assert.throws(
      () => {
        gravarProjeto(
          c.banco,
          Projeto.parse({
            ...valida,
            verificacoes: { ...valida.verificacoes, ...mudanca },
          }),
        );
      },
      Error,
      nome,
    );
    assert.deepEqual(tabelas(), antes, `${nome}: nada gravado`);
  }
  assert.equal(readFileSync(isca, "utf8"), "segredo");
  assert.equal(statSync(isca).mtimeMs, iscaAntes.mtimeMs);

  // O par de modelo gravado chega inteiro ao pi.
  const etapaGravada = buscarProjeto(c.banco, c.projeto)?.etapas[0];
  const args = harness.argumentos({
    raiz: c.raiz,
    sessaoPi: "s-1",
    skills: [],
    modelo: etapaGravada?.configuracao_agente?.modelo,
    effort: etapaGravada?.configuracao_agente?.effort,
    confianca: true,
    modo: "autonomo",
  });
  assert.deepEqual(args.slice(6, 10), ["--provider", "anthropic", "--model", "m-1"]);
});
