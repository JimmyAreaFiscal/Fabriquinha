// I-278 CA-4: a consulta sem ferramentas (`pi -p`) mede o Uso. O do resumo do PR conta para a Rodada e o do Auditor
// automático, para o ticket que perguntou. O cenário é montado pelos serviços e pelo agendador, com banco e git reais
// numa raiz temporária, o pi e o `gh` falsos; o pi falso da consulta grava no `--session-dir` o uso que o pi real gravaria.
import assert from "node:assert/strict";
import { test } from "node:test";
import { despacharDemandas } from "../src/aplicacao/despacho_demanda.ts";
import { produtividadeDaRodada } from "../src/aplicacao/evidencias/produtividade_rodada.ts";
import { carregarTrabalhosDaDemanda, carregarTrabalhosDoTicket } from "../src/armazenamento/trabalho_agentico.ts";
import type { PassoPi } from "../apoio-testes/pi_falso.ts";
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
} from "./apoio-execucao.ts";
import { base, ciclo, criarCenario, demanda, esperar } from "./apoio.ts";
import { ghFalso } from "./falsos.ts";

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

  const { execucoes, usos } = carregarTrabalhosDoTicket(c.banco, ticket);
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
  const fins = despacharDemandas(c.banco, c.config, despachoComEsperaCurta());
  await esperar(() => pisAteAgora() === fins.length, "o pi do encerramento receber o prompt");
  comoAgente(c, id, encerramento.ticket_id, [
    ["mensagem_pr", MENSAGEM_PR],
    ["aula_codigo", { resumo: "aula" }],
  ]);
  abrirPortao();
  await Promise.all(fins);

  const { sessoes, execucoes, usos } = carregarTrabalhosDaDemanda(c.banco, id);
  const daRodada = demanda(c, id).tickets.filter((x) => x.rodada_id === 1);
  const { total } = produtividadeDaRodada(sessoes, execucoes, usos, daRodada);
  assert.equal(total.tokensEntrada, 7000);
  assert.equal(total.tokensSaida, 300);
  assert.equal(total.custo, 0.5);
  assert.equal(total.custoIncompleto, true, "os tickets da rodada sem Uso medido seguem sem custo");
  // Os outros pis do cenário não emitem Uso: o da consulta é o único, e está no ticket `encerrar_rodada` da rodada.
  assert.deepEqual(carregarTrabalhosDoTicket(c.banco, encerramento).usos, usos);
  assert.equal(usos.length, 1);
});
