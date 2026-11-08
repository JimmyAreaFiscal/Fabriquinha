import assert from "node:assert/strict";
import { test } from "node:test";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  CATALOGO_ETAPAS,
  catalogoDaEtapa,
  ItemCatalogoEtapa,
  validarEvidenciaDaEtapa,
  type ContextoEvidenciaEtapa,
} from "./evidencia_etapa.ts";
import { EtapaTicket } from "./primitivos.ts";

const [E, A, F] = ["externo", "agente", "fabriquinha"];
const [TE, TF, TS] = ["todos_comandos_exit_zero", "todas_fitness_passam", "sem_issue_aberta_arquivos_alterados"];
// [etapa, tipo, produtor, obrigatória, dono, regra]
const TABELA = [
  ["entender_e_desenhar", "criterios_aceite", E, true, "demanda", null],
  ["entender_e_desenhar", "desenho_solucao", E, true, "demanda", null],
  ["entender_e_desenhar", "custos_realizados", E, true, "demanda", null],
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
  const d = validarEvidenciaDaEtapa(ctx("entender_e_desenhar"), ent({ tipo: "prototipo", produtor: "externo" }));
  assert.equal(d.ticket_id, undefined);
});

test("recusa metadados inválidos, outra demanda, tipo fora da etapa e dono errado", () => {
  const p = ctx("planejar");
  assert.throws(() => validarEvidenciaDaEtapa(p, null), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(p, ent({ ticket_id: 7, demanda_id: "I-2" })), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(p, ent({ ticket_id: 7, tipo: "pr_aberto" })), ErroDeRegra);
  assert.throws(() => validarEvidenciaDaEtapa(ctx("ajustar_resultado"), ent({ ticket_id: 7 })), /nenhum tipo/);
  for (const dono of [{}, { ticket_id: 8 }, { ticket_id: 7, rodada_id: 2 }, { rodada_id: 2 }]) {
    assert.throws(() => validarEvidenciaDaEtapa(p, ent(dono)), ErroDeRegra);
  }
  for (const dono of [{ ticket_id: 7 }, { rodada_id: 2 }]) {
    assert.throws(
      () =>
        validarEvidenciaDaEtapa(ctx("entender_e_desenhar"), ent({ ...dono, tipo: "prototipo", produtor: "externo" })),
      ErroDeRegra,
    );
  }
});

test("contexto inválido vira ErroDeRegra na validação", () => {
  const invalidos: unknown[] = [null, undefined, {}, { ...ctx("planejar"), etapa: "inexistente" }];
  for (const campo of ["demanda_id", "ticket_id"]) {
    for (const valor of [undefined, null, "", "errado", 0, -1, 1.5]) {
      invalidos.push({ ...ctx("planejar"), [campo]: valor });
    }
  }
  for (const invalido of invalidos) {
    const contexto = invalido as ContextoEvidenciaEtapa;
    assert.throws(() => validarEvidenciaDaEtapa(contexto, ent({ ticket_id: 7 })), ErroDeRegra);
  }
});

test("recusa produtor errado com ErroDeEscopo", () => {
  assert.throws(
    () => validarEvidenciaDaEtapa(ctx("planejar"), ent({ ticket_id: 7, produtor: "fabriquinha" })),
    ErroDeEscopo,
  );
});

const entradaDoItem = (item: ItemCatalogoEtapa) => ({
  demanda_id: "I-1",
  ticket_id: item.dono === "ticket" ? 7 : undefined,
  tipo: item.tipo,
  produtor: item.produtor,
  dados: { resultado: "contraditório: F3 é quem decide" },
});

for (const item of CATALOGO_ETAPAS) {
  test(`${item.etapa}/${item.tipo}: aceita metadados sem calcular dados`, () => {
    const entrada = entradaDoItem(item);
    const resultado = validarEvidenciaDaEtapa(ctx(item.etapa), entrada);
    assert.equal(resultado.tipo, item.tipo);
    assert.equal(resultado.ticket_id, entrada.ticket_id);
    assert.equal(resultado.rodada_id, undefined);
    assert.equal(resultado.dados, entrada.dados);
  });
}

test("dados são referência opaca: Proxy intocável, ciclo e valores arbitrários", () => {
  const explodir = (): never => {
    throw new Error("dados foram inspecionados");
  };
  const proxy = new Proxy(
    {},
    {
      get: explodir,
      ownKeys: explodir,
      getOwnPropertyDescriptor: explodir,
      getPrototypeOf: explodir,
      has: explodir,
      set: explodir,
    },
  );
  const ciclo: { si?: unknown } = {};
  ciclo.si = ciclo;
  Object.freeze(ciclo);
  for (const dados of [proxy, ciclo, undefined, null, "texto", 42, false]) {
    const entrada = Object.freeze(ent({ ticket_id: 7, dados }));
    const validada = validarEvidenciaDaEtapa(ctx("planejar"), entrada);
    assert.equal(validada.dados, dados);
  }
});

test("recusa formatos inválidos de entrada, IDs, tipo e produtor", () => {
  const entrada = ent({ ticket_id: 7 });
  const invalidas: unknown[] = [undefined, [], "texto", 1, true];
  for (const campo of ["demanda_id", "tipo", "produtor"]) {
    for (const valor of [undefined, null, "", "desconhecido", 1]) {
      invalidas.push({ ...entrada, [campo]: valor });
    }
  }
  for (const campo of ["ticket_id", "rodada_id"]) {
    for (const valor of [0, -1, 1.5, "7", true]) {
      invalidas.push({ ...entrada, [campo]: valor });
    }
  }
  for (const invalida of invalidas) {
    assert.throws(() => validarEvidenciaDaEtapa(ctx("planejar"), invalida), ErroDeRegra);
  }
  for (const produtor of ["externo", "fabriquinha"]) {
    assert.throws(() => validarEvidenciaDaEtapa(ctx("planejar"), { ...entrada, produtor }), ErroDeEscopo);
  }
});

test("donos null e omitidos normalizam; técnica exige ticket e demanda não aceita outro dono", () => {
  for (const rodada of [{}, { rodada_id: null }]) {
    for (const ticket of [{}, { ticket_id: null }]) {
      const demanda = ent({ tipo: "prototipo", produtor: "externo", ...rodada, ...ticket });
      const validada = validarEvidenciaDaEtapa(ctx("entender_e_desenhar"), demanda);
      assert.equal(validada.rodada_id, undefined);
      assert.equal(validada.ticket_id, undefined);
      assert.throws(() => validarEvidenciaDaEtapa(ctx("planejar"), ent({ ...rodada, ...ticket })), ErroDeRegra);
    }
    assert.equal(validarEvidenciaDaEtapa(ctx("planejar"), ent({ ticket_id: 7, ...rodada })).rodada_id, undefined);
  }
  for (const dono of [{ ticket_id: 7 }, { rodada_id: 2 }, { ticket_id: 7, rodada_id: 2 }]) {
    assert.throws(
      () =>
        validarEvidenciaDaEtapa(ctx("entender_e_desenhar"), ent({ tipo: "prototipo", produtor: "externo", ...dono })),
      ErroDeRegra,
    );
  }
});
