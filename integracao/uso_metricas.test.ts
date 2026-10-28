// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-20 e 24 (uso e métricas): sessão retomada com dois modelos e custo
// desconhecido, e o relatório da demanda com rodadas, revisões e custos externos. O cenário é montado pelos serviços e
// pelo agendador, com banco e git reais numa raiz temporária e o pi falso; o uso por modelo, que o pi falso não emite, entra
// pelo repositório de sessões, o mesmo que o serviço grava.
import assert from "node:assert/strict";
import { test } from "node:test";
import { retomarSessao, registrarUso, totalDoTicket } from "../src/dominio/sessoes.ts";
import { submeterEvidencia } from "../src/execucao/gestao_demandas.ts";
import { alterarLimiteParalelismo } from "../src/persistencia/servico.ts";
import { carregarSessoesDoTicket, comSessoesDoTicket } from "../src/persistencia/sessoes.ts";
import { metricasDaDemanda } from "../src/metricas/demanda.ts";
import {
  abrirPortao,
  agente,
  agora,
  atual,
  demandaEmExecucao,
  despacho,
  pi,
  revisar,
  ticketDe,
} from "./apoio-execucao.ts";
import { AUTOR, ciclo, criarCenario, CTX, demanda } from "./apoio.ts";

interface Ref {
  demanda_id: string;
  ticket_id: number;
}
/** Grava o uso de uma execução já existente do ticket: [modelo, entrada, custo (undefined = desconhecido)]. */
const usar = (
  c: Parameters<typeof comSessoesDoTicket>[0],
  ref: Ref,
  execucao_id: string,
  usos: [string, number, number?][],
) =>
  comSessoesDoTicket(c, ref, (estado) => ({
    ...estado,
    usos: usos.reduce(
      (acc, [modelo_nome, tokens_entrada, custo]) =>
        registrarUso(acc, {
          execucao_id,
          modelo_provedor: "p",
          modelo_nome,
          tokens_entrada,
          tokens_saida: 1,
          tokens_cache_leitura: 0,
          tokens_cache_escrita: 0,
          custo,
        }),
      estado.usos,
    ),
  }));

test("CA-SDLC-20: sessão retomada com dois modelos reutiliza a conversa, soma cada tentativa uma vez e mantém o custo desconhecido", async (t) => {
  const c = criarCenario(t);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const ref = ticketDe(c, id, 1);
  abrirPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, despacho());

  // A primeira tentativa foi do agendador; a retomada é uma execução nova na mesma sessão.
  const { sessoes, execucoes } = carregarSessoesDoTicket(c.banco, ref);
  assert.equal(sessoes.length, 1);
  const [sessao] = sessoes;
  const [primeira] = execucoes;
  assert.ok(sessao && primeira);
  comSessoesDoTicket(c.banco, ref, (estado) => ({
    ...estado,
    execucoes: retomarSessao(estado.sessoes, estado.execucoes, {
      id: "retomada",
      sessao_id: sessao.id,
      inicio: agora(),
      fim: agora(),
      falha: false,
    }),
  }));
  usar(c.banco, ref, primeira.id, [["a", 10, 1]]);
  usar(c.banco, ref, "retomada", [
    ["a", 20, 2],
    ["b", 30],
    ["a", 20, 2],
  ]); // o último repete o registro: não soma de novo

  const depois = carregarSessoesDoTicket(c.banco, ref);
  assert.deepEqual(depois.sessoes, [sessao], "uma só sessão, com a mesma conversa");
  assert.deepEqual(
    depois.execucoes.map((e) => e.id),
    [primeira.id, "retomada"],
  );
  assert.equal(depois.usos.length, 3);
  const total = totalDoTicket(depois.sessoes, depois.execucoes, depois.usos, ref);
  assert.deepEqual([total.tokens_entrada, total.custo_conhecido, total.custo_incompleto], [60, 3, true]);

  const { total: demandaTotal } = metricasDaDemanda(c.banco, id);
  assert.deepEqual(
    demandaTotal.modelos.map((m) => [m.modelo, m.entrada, m.custo]),
    [
      ["a", 30, 3],
      ["b", 30, null],
    ],
  );
  assert.deepEqual(demandaTotal.custo, { conhecido: 3, incompleto: true });
});

test("CA-SDLC-24: relatório da demanda com rodadas, revisão reprovada e custo externo fica no escopo dela e não aciona gate", async (t) => {
  const c = criarCenario(t);
  alterarLimiteParalelismo(c.banco, 4);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }, { tickets: 1 }]);
  const [r1, r2] = [ticketDe(c, id, 1), ticketDe(c, id, 2)];
  abrirPortao();
  pi.roteirizar([{ modo: "ok", agente }]);
  await ciclo(c, despacho());

  // Rodada 1: revisão reprovada (devolução com correção); rodada 2: aprovada.
  const correcao = { demanda_id: id, ticket_id: 1, rodada_id: 1, titulo: "Corrigir", descricao: "d", caminhos: [] };
  await revisar(c, id, { aprovado: false, exigencias: "falta o caso X", correcoes: [correcao] }, 1);
  await revisar(c, id, { aprovado: true }, 2);

  const execucaoDe = (ref: Ref) => carregarSessoesDoTicket(c.banco, ref).execucoes[0]?.id ?? "";
  usar(c.banco, r1, execucaoDe(r1), [["a", 10, 1]]);
  usar(c.banco, r2, execucaoDe(r2), [
    ["a", 20],
    ["b", 5, 4],
  ]);

  // Custo externo da demanda (IA que a registrou): uma sessão com custo conhecido e outra sem.
  submeterEvidencia(
    c.banco,
    id,
    {
      tipo: "custos_realizados",
      dados: {
        sessoes: [
          {
            ferramenta: "claude",
            sessao: "ext-1",
            linhas: [
              {
                provedor: "x",
                modelo: "m",
                tokens_entrada: 1,
                tokens_saida: 1,
                tokens_cache_leitura: 0,
                tokens_cache_escrita: 0,
                custo: 6.5,
              },
            ],
          },
          {
            ferramenta: "claude",
            sessao: "ext-2",
            linhas: [
              {
                provedor: "x",
                modelo: "m",
                tokens_entrada: 1,
                tokens_saida: 1,
                tokens_cache_leitura: 0,
                tokens_cache_escrita: 0,
              },
            ],
          },
        ],
      },
    },
    AUTOR,
    CTX,
  );

  // Demanda vizinha de controle, com custo enorme: não pode aparecer no relatório da primeira.
  const vizinha = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const refVizinha = ticketDe(c, vizinha, 1);
  comSessoesDoTicket(c.banco, refVizinha, (estado) => ({
    ...estado,
    sessoes: [{ ...refVizinha, id: "s-vizinha", modo: "autonomo", conversa_referencia: "conv" }],
    execucoes: [{ id: "e-vizinha", sessao_id: "s-vizinha", inicio: agora(), fim: agora(), falha: true }],
  }));
  usar(c.banco, refVizinha, "e-vizinha", [["a", 999, 1_000_000]]);

  const antes = demanda(c, id);
  const m = metricasDaDemanda(c.banco, id);

  assert.deepEqual(
    m.rodadas.map((r) => [r.rodadaId, r.reprovacoes, r.custo]),
    [
      [1, 1, { conhecido: 1, incompleto: false }],
      [2, 0, { conhecido: 4, incompleto: true }],
    ],
  );
  assert.deepEqual(m.total.custo, { conhecido: 5, incompleto: true });
  // A única falha é o planejamento interrompido da própria demanda (sem rodada); a execução falha da vizinha não entra.
  assert.deepEqual([m.total.falhas, m.semRodada.falhas, ...m.rodadas.map((r) => r.falhas)], [1, 1, 0, 0]);
  assert.deepEqual(
    m.total.modelos.map((x) => [x.modelo, x.entrada]),
    [
      ["a", 30],
      ["b", 5],
    ],
  );
  // O custo externo é um total à parte: não entra no interno de nenhuma rodada nem do total.
  assert.deepEqual(m.custoExterno, { conhecido: 6.5, incompleto: true, sessoes: 2 });
  assert.equal(atual(c, id, "implementar", 1).titulo, "Corrigir");

  // Métrica só lê: nenhuma fase, status ou decisão mudou, apesar do custo da vizinha.
  const depois = demanda(c, id);
  assert.deepEqual(
    [depois.demanda.fase, depois.rodadas.map((r) => r.fase), depois.tickets.map((x) => x.status), depois.decisoes],
    [antes.demanda.fase, antes.rodadas.map((r) => r.fase), antes.tickets.map((x) => x.status), antes.decisoes],
  );
  assert.equal(metricasDaDemanda(c.banco, vizinha).total.custo.conhecido, 1_000_000);
});

// Pendente: o serviço `submeterEvidencia` descarta o `rodada_id` da entrada (o custo vira da demanda e substitui o anterior)
// e `linhasExternasDaDemanda` só lê custos sem rodada. Hoje o custo externo de rodada não tem caminho na aplicação.
test(
  "CA-SDLC-24: custo externo de rodada aparece na própria rodada do relatório, sem entrar no custo interno",
  {
    skip: "custo externo de rodada some: submeterEvidencia descarta rodada_id e metricasDaDemanda só lê custos da demanda (correção a propor em issue)",
  },
  async (t) => {
    const c = criarCenario(t);
    const id = await demandaEmExecucao(c, [{ tickets: 1 }, { tickets: 1 }]);
    const linha = {
      provedor: "x",
      modelo: "m",
      tokens_entrada: 1,
      tokens_saida: 1,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
      custo: 7,
    };
    const entrada = {
      tipo: "custos_realizados",
      rodada_id: 2,
      dados: { sessoes: [{ ferramenta: "claude", sessao: "ext-r2", linhas: [linha] }] },
    } as Parameters<typeof submeterEvidencia>[2];
    submeterEvidencia(c.banco, id, entrada, AUTOR, CTX);

    const m = metricasDaDemanda(c.banco, id);
    const r2 = m.rodadas.find((r) => r.rodadaId === 2) as { custo: unknown; custoExterno?: unknown };
    assert.deepEqual(r2.custoExterno, { conhecido: 7, incompleto: false, sessoes: 1 });
    assert.deepEqual(r2.custo, { conhecido: 0, incompleto: false }, "o externo não entra no custo interno");
    assert.equal(m.custoExterno.conhecido, 7, "e também não some do total externo");
  },
);
