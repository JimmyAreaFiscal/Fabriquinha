// I-278 CA-4: a consulta sem ferramentas (`pi -p`) mede o Uso, e o Uso sem custo informado é estimado pelo catálogo. O do resumo do PR conta para a Rodada e o do Auditor
// automático, para o ticket que perguntou. O cenário é montado pelos serviços e pelo agendador, com banco e git reais
// numa raiz temporária, o pi e o `gh` falsos; o pi falso da consulta grava no `--session-dir` o uso que o pi real gravaria.
import assert from "node:assert/strict";
import { test } from "node:test";
import { cicloDoDespacho, produtividadeDaRodada } from "../../src/modulos/ciclo_de_vida/publico.ts";
import { carregarSessoesDoContexto } from "../../src/modulos/sessoes/publico.ts";
import { gravarCatalogoDePrecos, HarnessPi } from "../../apoio-testes/sessoes_de_teste.ts";
import type { PassoPi } from "../../apoio-testes/falsos/pi_falso.ts";
import {
  abrirPortao,
  agente,
  agenteMudo,
  atual,
  comoAgente,
  demandaEmExecucao,
  despacho,
  despachoComEsperaCurta,
  fecharPortao,
  MENSAGEM_PR,
  pi,
  pisAteAgora,
  rodadaEmEncerramento,
  ticketDe,
} from "../apoio-execucao.ts";
import { base, ciclo, criarCenario, demanda, esperar } from "../apoio.ts";
import { ghFalso } from "../falsos.ts";
import { predecessorasPendentesPelasDependencias } from "../../src/server/fluxos/ciclo_do_servico/despacho_do_trabalho.ts";
import { montarDemandasDoBanco } from "../../src/server/composicao/banco_da_fabriquinha.ts";
import { modulosDoCicloDeTeste } from "../../apoio-testes/falsos/ambiente_falso.ts";

const gh = ghFalso(base);

const usoDaConsulta = { input: 7000, output: 300, custo: 0.5 };
const modeloDoPiFalso = { modelo_provedor: "anthropic", modelo_nome: "claude-opus-5-5" };

test("CA-4: o Uso da consulta do Auditor automático conta para o ticket que perguntou", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const ticket = ticketDe(c, id, 1);

  // O agente pergunta e espera; o Auditor automático (um `pi -p`) responde "Sim" e a consulta gasta o `usoDaConsulta`.
  const agenteQuePergunta: PassoPi[] = [
    {
      agente,
      uso: null,
      termina: "nunca",
      eventos: [
        {
          type: "tool_execution_start",
          toolCallId: "p1",
          toolName: "perguntar",
          args: { question: "Sigo com o caso X?", options: [{ label: "Sim" }, { label: "Não" }] },
        },
        {
          type: "extension_ui_request",
          id: "d1",
          method: "select",
          title: "Sigo com o caso X?",
          options: ["Sim", "Não"],
        },
      ],
    },
    {
      chamadaUnica: {
        saida: { decisao: "responder", resposta: "Sim", justificativa: "é o caso do ticket" },
        uso: usoDaConsulta,
      },
    },
  ];
  abrirPortao();
  pi.roteirizar(agenteQuePergunta);
  await ciclo(c, despacho());

  const { execucoes, usos } = carregarSessoesDoContexto(c.banco, ticket);
  assert.deepEqual(usos, [
    {
      execucao_id: execucoes.at(-1)?.id,
      ...modeloDoPiFalso,
      tokens_entrada: 7000,
      tokens_saida: 300,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
      custo: 0.5,
    },
  ]);
});

test("CA-4: o Uso da consulta do resumo do PR conta para a Rodada", async (t) => {
  gh.zerar();
  const c = criarCenario(t);
  const id = await rodadaEmEncerramento(c);
  // O corpo do PR passa do limite da hospedagem e vai ao resumo do pi.
  c.banco.prepare("UPDATE demanda SET descricao = ? WHERE id = ?").run(`longa${"x".repeat(75)} `.repeat(900), id);
  const encerramento = atual(c, id, "encerrar_rodada");

  // Como `encerrar`, mas com a consulta do resumo (o 2º passo) depois do agente que documenta.
  fecharPortao();
  pi.roteirizar([
    { agente: agenteMudo, uso: null },
    { chamadaUnica: { saida: "Resumo da demanda.", uso: usoDaConsulta } },
  ]);
  const fins = cicloDoDespacho(
    modulosDoCicloDeTeste(c.banco),
    c.config,
    despachoComEsperaCurta(),
    predecessorasPendentesPelasDependencias(montarDemandasDoBanco(c.banco)),
  );
  await esperar(() => pisAteAgora() === fins.length, "o pi do encerramento receber o prompt");
  comoAgente(c, id, encerramento.ticket_id, [
    ["mensagem_pr", MENSAGEM_PR],
    ["aula_codigo", { resumo: "aula" }],
  ]);
  abrirPortao();
  await Promise.all(fins);

  const { sessoes, execucoes, usos } = carregarSessoesDoContexto(c.banco, { demanda_id: id, ticket_id: null });
  const daRodada = demanda(c, id).tickets.filter((x) => x.rodada_id === 1);
  const { total } = produtividadeDaRodada(sessoes, execucoes, usos, daRodada);
  assert.equal(total.tokensEntrada, 7000);
  assert.equal(total.tokensSaida, 300);
  assert.equal(total.custo, 0.5);
  assert.equal(total.custoIncompleto, true, "os tickets da rodada sem Uso medido seguem sem custo");
  // Os outros pis do cenário não emitem Uso: o da consulta é o único, e está no ticket `encerrar_rodada` da rodada.
  assert.deepEqual(carregarSessoesDoContexto(c.banco, encerramento).usos, usos);
  assert.equal(usos.length, 1);
});

test("ticket 27: a execução cujo pi não informa o custo tem o custo estimado pelo preço que o catálogo do pi declara", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const ticket = ticketDe(c, id, 1);
  // Como a subida do serviço: o catálogo de preços vem do harness (o pi falso declara o opus a US$ 4 e 20 por milhão).
  gravarCatalogoDePrecos(c.banco, await new HarnessPi().precosDosModelos(), "2026-01-01T00:00:00.000Z");

  abrirPortao();
  pi.roteirizar([{ agente, custo: null, uso: { input: 1_000_000, output: 100_000 } }]);
  await ciclo(c, despacho());

  const { execucoes, usos } = carregarSessoesDoContexto(c.banco, ticket);
  const precoDoOpus = c.banco
    .prepare("SELECT id FROM preco_do_modelo WHERE modelo_nome = 'claude-opus-5-5' AND vigente_ate IS NULL")
    .get()?.id;
  assert.deepEqual(usos, [
    {
      execucao_id: execucoes.at(-1)?.id,
      ...modeloDoPiFalso,
      tokens_entrada: 1_000_000,
      tokens_saida: 100_000,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
      // 1M × 4 + 0,1M × 20, com a referência do preço usado.
      custo: 6,
      preco_id: precoDoOpus,
    },
  ]);
});
