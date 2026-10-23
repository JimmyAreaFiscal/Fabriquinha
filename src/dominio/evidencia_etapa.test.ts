import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  CATALOGO_ETAPAS,
  catalogoDaEtapa,
  ItemCatalogoEtapa,
  pendenciasDoTicket,
  validarEvidenciaDaEtapa,
  type ContextoEvidenciaEtapa,
} from "./evidencia_etapa.ts";
import { EtapaTicket } from "./primitivos.ts";

const [E, A, F] = ["externo", "agente", "fabriquinha"];
const [TE, TF, TS] = ["todos_comandos_exit_zero", "todas_fitness_passam", "sem_issue_aberta_arquivos_alterados"];
// [etapa, tipo, produtor, obrigatória, dono, regra]
const TABELA = [
  ["demanda", "criterios_aceite", E, true, "demanda", null],
  ["demanda", "desenho_solucao", E, true, "demanda", null],
  ["demanda", "custos_realizados", E, true, "demanda", null],
  ["demanda", "comportamento", E, false, "demanda", null],
  ["demanda", "prototipo", E, false, "demanda", null],
  ["demanda", "relatorio_complexidade", E, false, "demanda", null],
  ["demanda", "relatorio_impactos_arquitetura", E, false, "demanda", null],
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

test("catálogo bate com a tabela fixa: 28 itens, 23 tipos, 10 regras", () => {
  assert.deepEqual(
    CATALOGO_ETAPAS.map(linha),
    TABELA.map((l) => [...l]),
  );
  assert.equal(new Set(CATALOGO_ETAPAS.map((i) => i.tipo)).size, 23);
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

test("oito etapas têm itens e só sessao_em_aberto é vazia", () => {
  for (const etapa of EtapaTicket.options) {
    assert.deepEqual(
      catalogoDaEtapa(etapa).map(linha),
      TABELA.filter((l) => l[0] === etapa).map((l) => [...l]),
    );
  }
  assert.deepEqual(catalogoDaEtapa("sessao_em_aberto"), []);
});

test("resolver_conflito repete implementar, exceto a etapa (D06)", () => {
  assert.deepEqual(
    catalogoDaEtapa("resolver_conflito").map((i) => ({ ...i, etapa: "x" })),
    catalogoDaEtapa("implementar").map((i) => ({ ...i, etapa: "x" })),
  );
});

const ctx = (etapa: ContextoEvidenciaEtapa["etapa"]): ContextoEvidenciaEtapa => ({
  demanda_id: "I-1",
  ticket_id: 7,
  etapa,
});
const ent = (o: object) => ({ demanda_id: "I-1", tipo: "plano", produtor: "agente", dados: { x: 1 }, ...o });

test("valida e normaliza metadados, dados opaco", () => {
  const r = validarEvidenciaDaEtapa(ctx("planejar"), ent({ ticket_id: 7, rodada_id: null }));
  assert.deepEqual(r, {
    demanda_id: "I-1",
    ticket_id: 7,
    rodada_id: undefined,
    tipo: "plano",
    produtor: "agente",
    dados: { x: 1 },
  });
  const d = validarEvidenciaDaEtapa(ctx("demanda"), ent({ tipo: "prototipo", produtor: "externo" }));
  assert.equal(d.ticket_id, undefined);
});

test("aprovada é exigida onde há regra, false é válido, e não onde não há", () => {
  const impl = ent({ tipo: "execucao_testes", produtor: "fabriquinha", ticket_id: 7 });
  assert.throws(() => validarEvidenciaDaEtapa(ctx("implementar"), impl), ErroDeRegra);
  assert.equal(validarEvidenciaDaEtapa(ctx("implementar"), { ...impl, aprovada: false }).aprovada, false);
  assert.equal(validarEvidenciaDaEtapa(ctx("implementar"), { ...impl, aprovada: true }).aprovada, true);
});

test("recusa metadados inválidos, outra demanda, tipo fora da etapa e dono errado", () => {
  const p = ctx("planejar");
  assert.throws(() => validarEvidenciaDaEtapa(p, null), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(p, ent({ ticket_id: 7, aprovada: "sim" })), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(p, ent({ ticket_id: 7, demanda_id: "I-2" })), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(p, ent({ ticket_id: 7, tipo: "pr_aberto" })), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(ctx("sessao_em_aberto"), ent({ ticket_id: 7 })), /nenhum tipo/);
  for (const dono of [{}, { ticket_id: 8 }, { ticket_id: 7, rodada_id: 2 }, { rodada_id: 2 }]) {
    assert.throws(() => validarEvidenciaDaEtapa(p, ent(dono)), ErroDeRegra);
  }
  for (const dono of [{ ticket_id: 7 }, { rodada_id: 2 }]) {
    assert.throws(
      () => validarEvidenciaDaEtapa(ctx("demanda"), ent({ ...dono, tipo: "prototipo", produtor: "externo" })),
      ErroDeRegra,
    );
  }
});

test("recusa produtor errado com ErroDeEscopo", () => {
  assert.throws(
    () => validarEvidenciaDaEtapa(ctx("planejar"), ent({ ticket_id: 7, produtor: "fabriquinha" })),
    ErroDeEscopo,
  );
});

test("pendências: obrigatórias ausentes e reprovadas na ordem do catálogo, outros donos ignorados", () => {
  const e = (o: object) =>
    ({ demanda_id: "I-1", rodada_id: undefined, ticket_id: 7, produtor: F, dados: null, ...o }) as never;
  const c = ctx("encerrar_rodada");
  assert.deepEqual(pendenciasDoTicket(c, []), {
    ausentes: ["mensagem_pr", "aula_codigo", "relatorio_produtividade", "pr_aberto"],
    reprovadas: [],
  });
  assert.deepEqual(
    pendenciasDoTicket(c, [
      e({ tipo: "mensagem_pr" }),
      e({ tipo: "aula_codigo", aprovada: true }),
      e({ tipo: "pr_aberto", aprovada: false }),
      e({ tipo: "video_demonstracao", aprovada: false }),
      e({ tipo: "relatorio_produtividade", ticket_id: 8 }),
      e({ tipo: "mensagem_pr", demanda_id: "I-2" }),
      e({ tipo: "mensagem_pr", rodada_id: 1 }),
    ]),
    { ausentes: ["relatorio_produtividade"], reprovadas: ["pr_aberto", "video_demonstracao"] },
  );
  const d = ctx("demanda");
  assert.deepEqual(
    pendenciasDoTicket(d, [
      e({ tipo: "criterios_aceite", ticket_id: undefined, aprovada: false }),
      e({ tipo: "desenho_solucao", ticket_id: 7 }),
    ]),
    { ausentes: ["desenho_solucao", "custos_realizados"], reprovadas: ["criterios_aceite"] },
  );
});
