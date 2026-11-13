// Seção 12 de comparacao-sdlc-implementacao.md, CA-SDLC-20 e 24 (uso e métricas): sessão retomada com dois modelos e custo
// desconhecido, e o relatório da demanda com rodadas, revisões e custos externos. O cenário é montado pelos serviços e
// pelo agendador, com banco e git reais numa raiz temporária e o pi falso; o uso por modelo, que o pi falso aqui não emite (`uso: null`), entra
// pelo repositório de sessões, o mesmo que o serviço grava.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  retomarSessao,
  registrarUso,
  carregarSessoesDoContexto,
  comSessoesDoContexto,
} from "../src/modulos/sessoes/publico.ts";
import {
  metricasDosMeses,
  produtividadeDaRodada,
  usoDaDemanda,
  type EtapaTicket,
  carregarDemanda,
} from "../src/modulos/ciclo_de_vida/publico.ts";
import { metricasDasEtapas } from "../src/modulos/ciclo_de_vida/metricas_de_qualidade/aplicacao/registro_das_metricas.ts";
import type { MetricaDeUso } from "../src/modulos/ciclo_de_vida/metricas_de_qualidade/aplicacao/metricas/metrica_de_uso.ts";
import type { ValorDe } from "../src/modulos/ciclo_de_vida/metricas_de_qualidade/aplicacao/calculo_de_metrica.ts";
import { mesDoInstante } from "../src/shared/nucleo/relogio.ts";
import {
  abrirPortao,
  agente,
  agora,
  atual,
  demandaEmExecucao,
  despacho,
  pi,
  decidirComoRevisor,
  despacharComAgente,
  ticketDe,
} from "./apoio-execucao.ts";
import { ciclo, criarCenario, declararUso, demanda, gravarLimiteParalelismo } from "./apoio.ts";
import { origemDe } from "../apoio-testes/banco_de_metricas.ts";

interface Ref {
  demanda_id: string;
  ticket_id: number;
}
/** Grava o uso de uma execução já existente do ticket: [modelo, entrada, custo (undefined = desconhecido)]. */
const usar = (
  c: Parameters<typeof comSessoesDoContexto>[0],
  ref: Ref,
  execucao_id: string,
  usos: [string, number, number?][],
) =>
  comSessoesDoContexto(c, ref, (estado) => ({
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
  pi.roteirizar([{ agente, uso: null }]);
  await ciclo(c, despacho());

  // A primeira tentativa foi do agendador; a retomada é uma execução nova na mesma sessão.
  const { sessoes, execucoes } = carregarSessoesDoContexto(c.banco, ref);
  assert.equal(sessoes.length, 1);
  const [sessao] = sessoes;
  const [primeira] = execucoes;
  assert.ok(sessao && primeira);
  comSessoesDoContexto(c.banco, ref, (estado) => ({
    ...estado,
    execucoes: retomarSessao(estado.sessoes, estado.execucoes, {
      id: "retomada",
      trabalho_id: sessao.id,
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

  const depois = carregarSessoesDoContexto(c.banco, ref);
  assert.deepEqual(depois.sessoes, [sessao], "uma só sessão, com a mesma conversa");
  assert.deepEqual(
    depois.execucoes.map((e) => e.id),
    [primeira.id, "retomada"],
  );
  assert.equal(depois.usos.length, 3);
  const { total } = produtividadeDaRodada(
    depois.sessoes,
    depois.execucoes,
    depois.usos,
    carregarDemanda(c.banco, id).tickets.filter((t) => t.ticket_id === ref.ticket_id),
  );
  assert.deepEqual([total.tokensEntrada, total.custo, total.custoIncompleto], [60, 3, true]);

  const demandaTotal = usoDaDemanda(origemDe(c.banco), id);
  assert.deepEqual(
    demandaTotal.modelos.map((m) => [m.modelo, m.tokens_entrada, m.custo]),
    [
      ["p/a", 30, 3],
      ["p/b", 30, null],
    ],
  );
  assert.deepEqual(demandaTotal.custo, { conhecido: 3, trabalhosSemCusto: 1 });

  // A página Métricas lê o mesmo: as mesmas execuções (a retomada não duplica o uso) e o custo desconhecido sinalizado.
  const meses = metricasDosMeses(origemDe(c.banco), {
    de: mesDoInstante(primeira.inicio),
    ate: mesDoInstante(new Date().toISOString()),
  });
  assert.equal(
    meses.reduce((n, mes) => n + mes.total.execucoes, 0),
    demandaTotal.execucoes,
  );
  assert.deepEqual(
    meses.flatMap((mes) => mes.total.modelos).map((m) => [m.modelo, m.tokens_entrada, m.custo]),
    demandaTotal.modelos.map((m) => [m.modelo, m.tokens_entrada, m.custo]),
  );
  assert.ok(meses.some((mes) => mes.total.custo.trabalhosSemCusto > 0));
});

test("CA-SDLC-24: relatório da demanda com rodadas, revisão reprovada e custo externo fica no escopo dela e não aciona gate", async (t) => {
  const c = criarCenario(t);
  gravarLimiteParalelismo(c.banco, 4);
  const id = await demandaEmExecucao(c, [{ tickets: 1 }, { tickets: 1 }]);
  const [r1, r2] = [ticketDe(c, id, 1), ticketDe(c, id, 2)];
  abrirPortao();
  pi.roteirizar([{ agente, uso: null }]);
  await ciclo(c, despacho());

  // Rodada 1: revisão reprovada (devolução com correção); rodada 2: aprovada.
  const correcao = {
    demanda_id: id,
    ticket_id: 1,
    rodada_id: 1,
    titulo: "Corrigir",
    descricao: "d",
    arquivos_previstos: [],
  };
  await despacharComAgente(c, despacho(), async () => {
    await decidirComoRevisor(c, id, { resultado: "reprovado", motivo: "falta o caso X", correcoes: [correcao] }, 1);
    await decidirComoRevisor(c, id, { resultado: "aprovado" }, 2);
  });

  const execucaoDe = (ref: Ref) => carregarSessoesDoContexto(c.banco, ref).execucoes[0]?.id ?? "";
  usar(c.banco, r1, execucaoDe(r1), [["a", 10, 1]]);
  usar(c.banco, r2, execucaoDe(r2), [
    ["a", 20],
    ["b", 5, 4],
  ]);

  // Custo externo da demanda (IA que a registrou): uma sessão com custo conhecido e outra sem.
  declararUso(c, id, "ext-1", 6.5);
  declararUso(c, id, "ext-2");

  // Demanda vizinha de controle, com custo enorme: não pode aparecer no relatório da primeira.
  const vizinha = await demandaEmExecucao(c, [{ tickets: 1 }]);
  const refVizinha = ticketDe(c, vizinha, 1);
  comSessoesDoContexto(c.banco, refVizinha, (estado) => ({
    ...estado,
    sessoes: [{ ...refVizinha, id: "s-vizinha", modo: "autonomo", conversa_referencia: "conv" }],
    execucoes: [{ id: "e-vizinha", trabalho_id: "s-vizinha", inicio: agora(), fim: agora(), falha: true }],
  }));
  usar(c.banco, refVizinha, "e-vizinha", [["a", 999, 1_000_000]]);

  const antes = demanda(c, id);
  const usoDaEtapa = (etapa: EtapaTicket) =>
    metricasDasEtapas(origemDe(c.banco), { demandaId: id })
      .get(etapa)
      ?.find((m) => m.definicao.tipo === "uso")?.valor as ValorDe<MetricaDeUso>;
  const total = usoDaDemanda(origemDe(c.banco), id);

  assert.deepEqual(usoDaEtapa("implementar").custo, { conhecido: 5, trabalhosSemCusto: 1 });
  assert.deepEqual(
    metricasDasEtapas(origemDe(c.banco), { demandaId: id })
      .get("revisar_rodada")
      ?.map((m) => [m.definicao.tipo, m.valor]),
    [
      ["uso", usoDaEtapa("revisar_rodada")],
      ["exigencias_de_alteracao", { reprovacoes: 1 }],
      ["bugs_nos_arquivos_revisados", { alteradasPorHumanos: 0 }],
    ],
  );
  assert.deepEqual(total.custo, { conhecido: 11.5, trabalhosSemCusto: 2 });
  // A única falha é o planejamento interrompido da própria demanda; a execução falha da vizinha não entra.
  assert.deepEqual([total.falhas, usoDaEtapa("planejar").falhas], [1, 1]);
  assert.deepEqual(
    total.modelos.map((x) => [x.modelo, x.tokens_entrada]),
    [
      ["p/a", 30],
      ["p/b", 5],
      ["x/m", 2],
    ],
  );
  // O Uso declarado entra no total da demanda, mas só na Etapa de quem o declara; `custoExterno` continua à parte.
  assert.deepEqual(usoDaEtapa("entender_e_desenhar").custoExterno, {
    conhecido: 6.5,
    trabalhosSemCusto: 1,
    sessoes: 2,
  });
  assert.equal(usoDaEtapa("implementar").custoExterno.sessoes, 0);

  // Uso declarado depois: é da demanda, então soma no total externo e não no custo interno de nenhuma outra Etapa.
  declararUso(c, id, "ext-r2", 7);
  assert.deepEqual(
    usoDaEtapa("implementar").custo,
    { conhecido: 5, trabalhosSemCusto: 1 },
    "o externo não entra no custo interno",
  );
  assert.deepEqual(usoDaEtapa("entender_e_desenhar").custoExterno, {
    conhecido: 13.5,
    trabalhosSemCusto: 1,
    sessoes: 3,
  });
  assert.equal(atual(c, id, "implementar", 1).titulo, "Corrigir");

  // Métrica só lê: nenhuma estado, status ou decisão mudou, apesar do custo da vizinha.
  const depois = demanda(c, id);
  assert.deepEqual(
    [depois.demanda.estado, depois.rodadas.map((r) => r.estado), depois.tickets.map((x) => x.estado), depois.decisoes],
    [antes.demanda.estado, antes.rodadas.map((r) => r.estado), antes.tickets.map((x) => x.estado), antes.decisoes],
  );
  assert.equal(usoDaDemanda(origemDe(c.banco), vizinha).custo.conhecido, 1_000_000);
});
