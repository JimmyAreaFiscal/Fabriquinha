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
  type EvidenciaEtapa,
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

test("contexto inválido vira ErroDeRegra na validação e na consulta", () => {
  const invalidos: unknown[] = [null, undefined, {}, { ...ctx("planejar"), etapa: "inexistente" }];
  for (const campo of ["demanda_id", "ticket_id"]) {
    for (const valor of [undefined, null, "", "errado", 0, -1, 1.5]) {
      invalidos.push({ ...ctx("planejar"), [campo]: valor });
    }
  }
  for (const invalido of invalidos) {
    const contexto = invalido as ContextoEvidenciaEtapa;
    assert.throws(() => validarEvidenciaDaEtapa(contexto, ent({ ticket_id: 7 })), ErroDeRegra);
    assert.throws(() => pendenciasDoTicket(contexto, []), ErroDeRegra);
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

const entradaDoItem = (item: ItemCatalogoEtapa) => ({
  demanda_id: "I-1",
  ticket_id: item.dono === "ticket" ? 7 : undefined,
  tipo: item.tipo,
  produtor: item.produtor,
  dados: { resultado: "contraditório: F3 é quem decide" },
  ...(item.regraAprovacao === null ? {} : { aprovada: true }),
});

for (const item of CATALOGO_ETAPAS) {
  test(`${item.etapa}/${item.tipo}: aceita metadados e booleanos sem calcular dados`, () => {
    const contexto = ctx(item.etapa);
    const entrada = entradaDoItem(item);
    const resultado = validarEvidenciaDaEtapa(contexto, entrada);
    assert.equal(resultado.tipo, item.tipo);
    assert.equal(resultado.ticket_id, entrada.ticket_id);
    assert.equal(resultado.rodada_id, undefined);
    assert.equal(resultado.dados, entrada.dados);
    assert.equal(resultado.aprovada, entrada.aprovada);
    for (const aprovada of [true, false]) {
      const validada = validarEvidenciaDaEtapa(contexto, { ...entrada, aprovada });
      assert.equal(validada.aprovada, aprovada);
      assert.equal(validada.dados, entrada.dados);
    }
    for (const aprovada of [null, "true"]) {
      assert.throws(() => validarEvidenciaDaEtapa(contexto, { ...entrada, aprovada }), ErroDeRegra);
    }
    const { aprovada: _, ...semAprovada } = entrada;
    if (item.regraAprovacao !== null) {
      assert.throws(() => validarEvidenciaDaEtapa(contexto, semAprovada), ErroDeRegra);
      assert.throws(() => validarEvidenciaDaEtapa(contexto, { ...entrada, aprovada: undefined }), ErroDeRegra);
    } else {
      assert.equal(validarEvidenciaDaEtapa(contexto, semAprovada).aprovada, undefined);
    }
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
    assert.deepEqual(pendenciasDoTicket(ctx("planejar"), Object.freeze([validada])), {
      ausentes: [],
      reprovadas: [],
    });
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
      const validada = validarEvidenciaDaEtapa(ctx("demanda"), demanda);
      assert.equal(validada.rodada_id, undefined);
      assert.equal(validada.ticket_id, undefined);
      assert.throws(() => validarEvidenciaDaEtapa(ctx("planejar"), ent({ ...rodada, ...ticket })), ErroDeRegra);
    }
    assert.equal(validarEvidenciaDaEtapa(ctx("planejar"), ent({ ticket_id: 7, ...rodada })).rodada_id, undefined);
  }
  for (const dono of [{ ticket_id: 7 }, { rodada_id: 2 }, { ticket_id: 7, rodada_id: 2 }]) {
    assert.throws(
      () => validarEvidenciaDaEtapa(ctx("demanda"), ent({ tipo: "prototipo", produtor: "externo", ...dono })),
      ErroDeRegra,
    );
  }
});

for (const etapa of EtapaTicket.options) {
  test(`${etapa}: consulta vazia, completa e mista na ordem do catálogo`, () => {
    const contexto = ctx(etapa);
    const itens = catalogoDaEtapa(etapa);
    assert.deepEqual(pendenciasDoTicket(contexto, []), {
      ausentes: itens.filter((i) => i.obrigatoria).map((i) => i.tipo),
      reprovadas: [],
    });
    const completas = itens.map((i) => validarEvidenciaDaEtapa(contexto, entradaDoItem(i)));
    assert.deepEqual(pendenciasDoTicket(contexto, completas.toReversed()), { ausentes: [], reprovadas: [] });
    const mistas = completas
      .filter((_, indice) => indice % 3 !== 0)
      .map((e, indice) => ({
        ...e,
        aprovada: indice % 2 === 0 ? false : e.aprovada,
      }));
    const esperado = {
      ausentes: itens.filter((i) => i.obrigatoria && !mistas.some((e) => e.tipo === i.tipo)).map((i) => i.tipo),
      reprovadas: itens.filter((i) => mistas.some((e) => e.tipo === i.tipo && e.aprovada === false)).map((i) => i.tipo),
    };
    const resultado = pendenciasDoTicket(contexto, mistas.toReversed());
    assert.deepEqual(resultado, esperado);
    assert.equal(new Set(resultado.ausentes).size, resultado.ausentes.length);
    assert.equal(new Set(resultado.reprovadas).size, resultado.reprovadas.length);
  });
}

test("opcionais ausentes não geram pendência; false reprova obrigatórias e opcionais presentes", () => {
  for (const etapa of ["demanda", "encerrar_rodada"] as const) {
    const contexto = ctx(etapa);
    const itens = catalogoDaEtapa(etapa);
    const obrigatorias = itens
      .filter((i) => i.obrigatoria)
      .map((i) => validarEvidenciaDaEtapa(contexto, { ...entradaDoItem(i), aprovada: false }));
    assert.deepEqual(pendenciasDoTicket(contexto, obrigatorias), {
      ausentes: [],
      reprovadas: obrigatorias.map((e) => e.tipo),
    });
    const todas = itens.map((i) => validarEvidenciaDaEtapa(contexto, { ...entradaDoItem(i), aprovada: false }));
    assert.deepEqual(pendenciasDoTicket(contexto, todas.toReversed()), {
      ausentes: [],
      reprovadas: itens.map((i) => i.tipo),
    });
  }
});

test("consulta isola revisões da mesma rodada pelo ticket e pela demanda, não por rodada extra no contexto", () => {
  const contexto = { ...ctx("revisar_rodada"), rodada_id: 3 };
  const itens = catalogoDaEtapa(contexto.etapa);
  const de7 = itens.map((i) => validarEvidenciaDaEtapa(contexto, entradaDoItem(i)));
  const de8 = de7.map((e) => ({ ...e, ticket_id: 8, aprovada: false }));
  const outraDemanda = de7.map((e) => ({ ...e, demanda_id: "I-2", aprovada: false }));
  const daRodada = de7.map((e) => ({ ...e, ticket_id: undefined, rodada_id: 3, aprovada: false }));
  const daDemanda = de7.map((e) => ({ ...e, ticket_id: undefined, aprovada: false }));
  assert.deepEqual(pendenciasDoTicket(contexto, [...de8, ...outraDemanda, ...daRodada, ...daDemanda]), {
    ausentes: itens.map((i) => i.tipo),
    reprovadas: [],
  });
  const colecao = [...de8, ...outraDemanda, ...daRodada, ...daDemanda, ...de7].toReversed();
  assert.deepEqual(pendenciasDoTicket(contexto, colecao), { ausentes: [], reprovadas: [] });
  assert.deepEqual(pendenciasDoTicket({ ...contexto, ticket_id: 8 }, colecao), {
    ausentes: [],
    reprovadas: itens.map((i) => i.tipo),
  });
  assert.deepEqual(pendenciasDoTicket({ ...contexto, demanda_id: "I-2" }, colecao), {
    ausentes: [],
    reprovadas: itens.map((i) => i.tipo),
  });
});

test("consulta da demanda ignora donos ticket/rodada e tipos fora do catálogo, mesmo reprovados", () => {
  const contexto = ctx("demanda");
  const itens = catalogoDaEtapa("demanda");
  const daDemanda = itens.map((i) => validarEvidenciaDaEtapa(contexto, entradaDoItem(i)));
  const alheias: EvidenciaEtapa[] = [
    ...daDemanda.map((e) => ({ ...e, ticket_id: 7, aprovada: false })),
    ...daDemanda.map((e) => ({ ...e, rodada_id: 3, aprovada: false })),
    {
      demanda_id: "I-1",
      ticket_id: undefined,
      rodada_id: undefined,
      tipo: "plano",
      produtor: "agente",
      aprovada: false,
      dados: null,
    },
  ];
  assert.deepEqual(pendenciasDoTicket(contexto, alheias), {
    ausentes: itens.filter((i) => i.obrigatoria).map((i) => i.tipo),
    reprovadas: [],
  });
  assert.deepEqual(pendenciasDoTicket(contexto, [...alheias, ...daDemanda]), { ausentes: [], reprovadas: [] });
});

test("não muta entrada, contexto, coleção ou catálogo e percorre a coleção uma vez", () => {
  const contexto = Object.freeze({ ...ctx("implementar"), rodada_id: 3 });
  const snapshotContexto = structuredClone(contexto);
  const snapshotCatalogo = structuredClone(CATALOGO_ETAPAS);
  const entradas = catalogoDaEtapa(contexto.etapa).map((i) =>
    Object.freeze({
      ...entradaDoItem(i),
      dados: Object.freeze({ comandos: Object.freeze(["falhou"]) }),
    }),
  );
  const snapshotEntradas = structuredClone(entradas);
  const evidencias = Object.freeze(entradas.map((e) => Object.freeze(validarEvidenciaDaEtapa(contexto, e))));
  const snapshotEvidencias = structuredClone(evidencias);
  let varreduras = 0;
  const colecao = new Proxy(evidencias, {
    get(alvo, chave, receptor) {
      if (chave === Symbol.iterator) {
        varreduras++;
        assert.equal(varreduras, 1);
      }
      assert.notEqual(chave, "filter");
      assert.notEqual(chave, "map");
      assert.notEqual(chave, "find");
      return Reflect.get(alvo, chave, receptor) as unknown;
    },
  });
  const resultado = pendenciasDoTicket(contexto, colecao);
  assert.equal(varreduras, 1);
  assert.deepEqual(resultado, { ausentes: [], reprovadas: [] });
  assert.deepEqual(contexto, snapshotContexto);
  assert.deepEqual(entradas, snapshotEntradas);
  assert.deepEqual(evidencias, snapshotEvidencias);
  assert.deepEqual(CATALOGO_ETAPAS, snapshotCatalogo);
});
