import assert from "node:assert/strict";
import { test } from "node:test";
import { CATALOGO_ETAPAS, catalogoDaEtapa, ItemCatalogoEtapa } from "./evidencia_etapa.ts";
import { EtapaTicket } from "./primitivos.ts";

const [E, A, F] = ["externo", "agente", "fabriquinha"];
const [TE, TF, TS] = ["todos_comandos_exit_zero", "todas_fitness_passam", "sem_issue_aberta_arquivos_alterados"];
// [etapa, tipo, produtor, obrigatória, dono, regra]
const TABELA = [
  ["entender_e_desenhar", "criterios_aceite", E, true, "demanda", null],
  ["entender_e_desenhar", "desenho_solucao", E, true, "demanda", null],
  ["entender_e_desenhar", "comportamento", E, false, "demanda", null],
  ["entender_e_desenhar", "prototipo", E, false, "demanda", null],
  ["entender_e_desenhar", "relatorio_complexidade", E, false, "demanda", null],
  ["entender_e_desenhar", "relatorio_impactos_arquitetura", E, false, "demanda", null],
  ["planejar", "plano", A, true, "ticket", null],
  ["implementar", "execucao_testes", F, true, "ticket", TE],
  ["implementar", "matriz_fitness", F, true, "ticket", TF],
  ["implementar", "relatorio_sonar", F, true, "ticket", TS],
  ["revisar_rodada", "arquivos_alterados", F, true, "ticket", null],
  ["revisar_rodada", "matriz_fitness", F, true, "ticket", TF],
  ["revisar_rodada", "explicacao_fitness", A, true, "ticket", null],
  ["revisar_rodada", "comprovacao_criterios", A, true, "ticket", "criterios_rodada_atendidos"],
  ["encerrar_rodada", "mensagem_pr", A, true, "ticket", null],
  ["encerrar_rodada", "aula_codigo", A, true, "ticket", null],
  ["encerrar_rodada", "relatorio_produtividade", F, true, "ticket", null],
  ["encerrar_rodada", "pr_aberto", F, true, "ticket", null],
  ["encerrar_rodada", "video_demonstracao", A, false, "ticket", null],
  ["revisar_demanda", "comprovacao_criterios", A, true, "ticket", "criterios_demanda_atendidos"],
  ["revisar_demanda", "testes_estresse", A, true, "ticket", null],
  ["revisar_demanda", "analise_seguranca", A, true, "ticket", null],
  ["encerrar_demanda", "arvore_prs_criterios_custos", F, true, "ticket", null],
  ["encerrar_demanda", "demonstracao_limpeza", F, true, "ticket", "nada_sobrou"],
  ["resolver_conflito", "execucao_testes", F, true, "ticket", TE],
  ["resolver_conflito", "matriz_fitness", F, true, "ticket", TF],
  ["resolver_conflito", "relatorio_sonar", F, true, "ticket", TS],
] as const;
const linha = (i: (typeof CATALOGO_ETAPAS)[number]) => [
  i.etapa,
  i.tipo,
  i.produtor,
  i.obrigatoria,
  i.dono,
  i.regraAprovacao,
];

test("catálogo bate com a tabela fixa: 27 itens, 22 tipos, 10 regras", () => {
  assert.deepEqual(
    CATALOGO_ETAPAS.map(linha),
    TABELA.map((l) => [...l]),
  );
  assert.equal(new Set(CATALOGO_ETAPAS.map((i) => i.tipo)).size, 22);
  assert.equal(CATALOGO_ETAPAS.filter((i) => i.regraAprovacao !== null).length, 10);
});

test("schema do item valida as etapas pelo enum EtapaTicket", () => {
  for (const item of CATALOGO_ETAPAS) {
    assert.deepEqual(ItemCatalogoEtapa.parse(item), item);
  }
  const item = CATALOGO_ETAPAS[0];
  for (const etapa of ["inexistente", undefined, null, 1]) {
    assert.equal(ItemCatalogoEtapa.safeParse({ ...item, etapa }).success, false);
  }
});

test("oito etapas têm itens e só ajustar_resultado é vazia", () => {
  for (const etapa of EtapaTicket.options) {
    assert.deepEqual(
      catalogoDaEtapa(etapa).map(linha),
      TABELA.filter((l) => l[0] === etapa).map((l) => [...l]),
    );
  }
  assert.deepEqual(catalogoDaEtapa("ajustar_resultado"), []);
});

test("resolver_conflito repete implementar, exceto a etapa (D06)", () => {
  assert.deepEqual(
    catalogoDaEtapa("resolver_conflito").map((i) => ({ ...i, etapa: "x" })),
    catalogoDaEtapa("implementar").map((i) => ({ ...i, etapa: "x" })),
  );
});
