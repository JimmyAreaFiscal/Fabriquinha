import assert from "node:assert/strict";
import { test } from "node:test";
import { clonarAgregadoDemanda } from "../../../../../../apoio-testes/clonar_agregado_demanda.ts";
import { comEvidencia, comPlanoSubmetido } from "../../../../../../apoio-testes/cenarios_de_demanda.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import type { Decisao } from "../gate.ts";
import { type NomeGate } from "../../../../etapas/catalogo.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "../../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../../compartilhado/nucleo/erros.ts";
import { MOTIVO_APROVACAO_AUTOMATICA_PR } from "./gate_da_demanda.ts";
import { GATE_DA_DEMANDA, GATES } from "../../../conducao/publico.ts";
import { Endereco } from "../../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { comTentativaAberta, motivoDaFalhaDoTicket } from "../tentativa.ts";
import { falhaQueExigeOAuditor } from "../../../../compartilhado/nucleo/vocabulario_do_sdlc/resultado_da_tentativa.ts";
import {
  enviarDemanda,
  reabrirTicket,
  registrarDemanda,
  registrarFalhaTicket,
} from "../transicoes/transicoes_demanda.ts";
import { PREFIXO_TERCEIRA_REPROVACAO } from "../transicoes/transicoes_rodada.ts";

type Gate = (typeof GATES)[Exclude<NomeGate, "gate_demanda">]["regra"] | typeof GATE_DA_DEMANDA;

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const t2 = "2026-01-03T00:00:00Z";
const contexto = { agora: t2 };
const DEMANDA = "I-1";
const enderecoDaDemanda = Endereco.daDemanda(DEMANDA);
const enderecoDaRodada = Endereco.daRodada(DEMANDA, 1);
const autora: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
const agenteDoTrabalho = (numeroDoTrabalho: number): Ator => ({
  tipo: "agente",
  trabalho_id: `E-${String(numeroDoTrabalho)}`,
});
const criteriosDaDefinicao = { criterios: [{ id: "CA-1" }, { id: "CA-2" }] };

// Construtores de agregado ---------------------------------------------------------------------------------------

const demandaRegistrada = (): AgregadoDemanda =>
  registrarDemanda({ id: DEMANDA, projeto: "p", titulo: "t", tipo: "funcionalidade", descricao: "d" }, autora, {
    agora: t0,
  });
const demandaEnviada = (): AgregadoDemanda => {
  const comDefinicao = (["criterios_aceite", "desenho_solucao"] as const).reduce(
    (agregado, tipo) =>
      comEvidencia(
        agregado,
        { tipo, dados: tipo === "criterios_aceite" ? criteriosDaDefinicao : { v: 1 } },
        autora,
        t0,
      ),
    demandaRegistrada(),
  );
  return enviarDemanda(comDefinicao, autora, { agora: t1 });
};
const demandaEmPlanejamento = (): AgregadoDemanda => {
  const decisaoAprovando = GATE_DA_DEMANDA.decidir(
    demandaEnviada(),
    enderecoDaDemanda,
    { resultado: "aprovado" },
    AUDITOR,
    {
      agora: t1,
    },
  );
  return {
    ...decisaoAprovando,
    tickets: decisaoAprovando.tickets.map((t) =>
      t.etapa === "planejar" ? { ...t, estado: "em_execucao" as const } : t,
    ),
  };
};
const planoDe = (sobrescrito: Record<string, unknown> = {}) => ({
  demanda_id: DEMANDA,
  criterios: ["CA-1"],
  arquivos_previstos: ["src/b.ts"],
  rodadas: [
    {
      demanda_id: DEMANDA,
      rodada_id: 1,
      titulo: "r1",
      e2e: false,
      criterios: ["CA-1"],
      arquivos_previstos: ["src/b.ts"],
    },
    {
      demanda_id: DEMANDA,
      rodada_id: 2,
      titulo: "r2",
      e2e: true,
      arquivos_previstos: ["src/b.ts"],
      depende: [{ demanda_id: DEMANDA, rodada_id: 1 }],
    },
  ],
  tickets: [
    { demanda_id: DEMANDA, ticket_id: 2, titulo: "b", descricao: "d", rodada_id: 1, arquivos_previstos: ["src/b.ts"] },
    {
      demanda_id: DEMANDA,
      ticket_id: 1,
      titulo: "a",
      descricao: "d",
      rodada_id: 1,
      configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" },
    },
    { demanda_id: DEMANDA, ticket_id: 3, titulo: "c", descricao: "d", rodada_id: 2 },
  ],
  ...sobrescrito,
});
const demandaComPlanoSubmetido = (plano: object = planoDe()): AgregadoDemanda =>
  comPlanoSubmetido(demandaEmPlanejamento(), plano, agenteDoTrabalho(1), contexto.agora);
const semEvidenciaDePlano = (agregado: AgregadoDemanda): AgregadoDemanda => ({
  ...agregado,
  evidencias: agregado.evidencias.filter((e) => e.tipo !== "plano"),
});

const ticketDe = (ticket_id: number, etapa: string, estado: string, rodada_id: number | undefined) => ({
  demanda_id: DEMANDA,
  ticket_id,
  rodada_id,
  etapa,
  estado,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const ticketDaRodada = (ticket_id: number, etapa: string, estado: string) => ticketDe(ticket_id, etapa, estado, 1);
const rodadaDe = (rodada_id: number, estado: string) => ({
  demanda_id: DEMANDA,
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${DEMANDA}-${String(rodada_id)}`,
});
const montarAgregado = (estadoDaDemanda: string, estadosDasRodadas: string[], tickets: object[]): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: DEMANDA,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado: estadoDaDemanda,
      estado_alterado_em: t0,
      criada_por: autora,
      enviada: true,
      branch: `fabriquinha/${DEMANDA}`,
    },
    decisoes: [],
    evidencias: [{ demanda_id: DEMANDA, tipo: "criterios_aceite", dados: criteriosDaDefinicao, autor: autora, em: t0 }],
    tickets: [ticketDe(1, "entender_e_desenhar", "concluido", undefined), ...tickets],
    rodadas: estadosDasRodadas.map((estado, indice) => rodadaDe(indice + 1, estado)),
  });
const rodadaEm = (estadoDaRodada: string, tickets: object[], estadoDaDemanda = "em_execucao"): AgregadoDemanda =>
  montarAgregado(estadoDaDemanda, [estadoDaRodada, "implementar"], tickets);
const rodadaEmDesenvolvimento = () => rodadaEm("implementar", [ticketDaRodada(2, "implementar", "concluido")]);
const rodadaEmRevisao = () =>
  rodadaEm("revisar_rodada", [
    ticketDaRodada(2, "implementar", "concluido"),
    ticketDaRodada(3, "revisar_rodada", "em_execucao"),
  ]);
const rodadaEmEncerramento = () =>
  rodadaEm("encerrar_rodada", [
    ticketDaRodada(2, "implementar", "concluido"),
    ticketDaRodada(3, "revisar_rodada", "concluido"),
    ticketDaRodada(4, "encerrar_rodada", "aberto"),
  ]);
const rodadaEmGatePr = () =>
  rodadaEm("gate_pr", [
    ticketDaRodada(2, "implementar", "concluido"),
    ticketDaRodada(3, "revisar_rodada", "concluido"),
    ticketDaRodada(4, "encerrar_rodada", "aberto"),
  ]);
const demandaEmRevisaoIntegral = (ticketsExtras: object[] = [], estadosDasRodadas = ["concluida"]): AgregadoDemanda =>
  montarAgregado("revisar_demanda", estadosDasRodadas, [
    ticketDaRodada(2, "implementar", "concluido"),
    ticketDe(3, "revisar_demanda", "em_execucao", undefined),
    ...ticketsExtras,
  ]);
const demandaEmExecucaoComRevisaoIntegral = (): AgregadoDemanda =>
  montarAgregado(
    "em_execucao",
    ["concluida"],
    [ticketDaRodada(2, "implementar", "concluido"), ticketDe(3, "revisar_demanda", "em_execucao", undefined)],
  );
const correcaoDaRodada = (ticket_id = 1) => ({
  demanda_id: DEMANDA,
  ticket_id,
  rodada_id: 1,
  titulo: "corrigir",
  descricao: "d",
});
const planoCorretivo = (sobrescrito: Record<string, unknown> = {}) => ({
  demanda_id: DEMANDA,
  criterios: ["CA-2"],
  rodadas: [{ demanda_id: DEMANDA, rodada_id: 1, titulo: "corrige", e2e: false, criterios: ["CA-2"] }],
  tickets: [{ demanda_id: DEMANDA, ticket_id: 1, titulo: "c", descricao: "d", rodada_id: 1 }],
  ...sobrescrito,
});
const reprovacaoGravada = (ticket_id: number, decisao_id: number, motivo: string, gate: Decisao["gate"]): Decisao => ({
  demanda_id: DEMANDA,
  ticket_id,
  decisao_id,
  gate,
  resultado: "reprovado",
  motivo,
  por: agenteDoTrabalho(ticket_id),
  em: t0,
});
const comDecisoes = (agregado: AgregadoDemanda, ...decisoes: Decisao[]): AgregadoDemanda =>
  AgregadoDemanda.parse({ ...agregado, decisoes });
const comTicketsDaEtapaNoEstado = (agregado: AgregadoDemanda, etapa: string, estado: string): AgregadoDemanda => ({
  ...agregado,
  tickets: agregado.tickets.map((t) => (t.etapa === etapa ? { ...t, estado: estado as never } : t)),
});
const semTicketsDaEtapa = (agregado: AgregadoDemanda, etapa: string): AgregadoDemanda => ({
  ...agregado,
  tickets: agregado.tickets.filter((t) => t.etapa !== etapa),
});

// Verificação do ensaio contra a decisão ---------------------------------------------------------------------------

interface TentativaDeDecisao {
  readonly gate: Gate;
  readonly agregado: AgregadoDemanda;
  readonly endereco: Endereco;
  readonly entrada: unknown;
  readonly ator: Ator;
}

function erroLancadoPor(chamadaQueDeveLancar: () => unknown): Error {
  try {
    chamadaQueDeveLancar();
  } catch (erro) {
    assert.ok(erro instanceof Error);
    return erro;
  }
  return assert.fail("era esperado que a chamada lançasse um erro");
}

/** `ensaiar` e `decidir` rejeitam a mesma entrada com a mesma classe e a mesma mensagem, e nenhum dos dois muda o agregado. */
function exigirMesmaRejeicaoNoEnsaioENaDecisao(
  { gate, agregado, endereco, entrada, ator }: TentativaDeDecisao,
  classeDoErro: new (...argumentos: never[]) => Error,
  trechoDaMensagem?: RegExp,
): void {
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const erroDoEnsaio = erroLancadoPor(() => {
    gate.ensaiar(agregado, endereco, entrada, ator, contexto);
  });
  assert.deepEqual(agregado, agregadoAntes);
  const erroDaDecisao = erroLancadoPor(() => gate.decidir(agregado, endereco, entrada, ator, contexto));
  assert.deepEqual(agregado, agregadoAntes);
  assert.ok(erroDoEnsaio instanceof classeDoErro);
  assert.equal(erroDaDecisao.constructor, erroDoEnsaio.constructor);
  assert.equal(erroDaDecisao.message, erroDoEnsaio.message);
  if (trechoDaMensagem) assert.match(erroDoEnsaio.message, trechoDaMensagem);
}

// Cenários: um por gate, com o agregado na etapa âncora e as entradas válidas -------------------------------------

interface CenarioDoGate {
  readonly gate: Gate;
  readonly endereco: Endereco;
  readonly decisor: Ator;
  readonly atorSemPermissao: Ator;
  readonly agregadoNaEtapaAncora: () => AgregadoDemanda;
  readonly agregadoForaDaEtapaAncora: () => AgregadoDemanda;
  readonly aprovacao: object;
  readonly reprovacao: object;
}

const CENARIOS: CenarioDoGate[] = [
  {
    gate: GATE_DA_DEMANDA,
    endereco: enderecoDaDemanda,
    decisor: AUDITOR,
    atorSemPermissao: agenteDoTrabalho(1),
    agregadoNaEtapaAncora: demandaEnviada,
    agregadoForaDaEtapaAncora: demandaRegistrada,
    aprovacao: { resultado: "aprovado", nota: 5 },
    reprovacao: { resultado: "reprovado", motivo: "fora do escopo" },
  },
  {
    gate: GATES.gate_planejamento.regra,
    endereco: enderecoDaDemanda,
    decisor: AUDITOR,
    atorSemPermissao: agenteDoTrabalho(1),
    agregadoNaEtapaAncora: demandaComPlanoSubmetido,
    agregadoForaDaEtapaAncora: demandaEmPlanejamento,
    aprovacao: { resultado: "aprovado" },
    reprovacao: { resultado: "reprovado", motivo: "falta teste" },
  },
  {
    gate: GATES.gate_pr.regra,
    endereco: enderecoDaRodada,
    decisor: AUDITOR,
    atorSemPermissao: agenteDoTrabalho(4),
    agregadoNaEtapaAncora: rodadaEmGatePr,
    agregadoForaDaEtapaAncora: rodadaEmEncerramento,
    aprovacao: { resultado: "aprovado", nota: 4 },
    reprovacao: { resultado: "reprovado", motivo: "ajustar" },
  },
  {
    gate: GATES.gate_revisao_rodada.regra,
    endereco: enderecoDaRodada,
    decisor: agenteDoTrabalho(3),
    atorSemPermissao: AUDITOR,
    agregadoNaEtapaAncora: rodadaEmRevisao,
    agregadoForaDaEtapaAncora: rodadaEmDesenvolvimento,
    aprovacao: { resultado: "aprovado" },
    reprovacao: { resultado: "reprovado", motivo: "refazer o teste", correcoes: [correcaoDaRodada()] },
  },
  {
    gate: GATES.gate_revisao_demanda.regra,
    endereco: enderecoDaDemanda,
    decisor: agenteDoTrabalho(3),
    atorSemPermissao: AUDITOR,
    agregadoNaEtapaAncora: demandaEmRevisaoIntegral,
    agregadoForaDaEtapaAncora: demandaEmExecucaoComRevisaoIntegral,
    aprovacao: { resultado: "aprovado" },
    reprovacao: { resultado: "reprovado", motivo: "falta tratar erro", correcoes: planoCorretivo() },
  },
];

const tentativaDe = (cenario: CenarioDoGate, sobrescrito: Partial<TentativaDeDecisao> = {}): TentativaDeDecisao => ({
  gate: cenario.gate,
  agregado: cenario.agregadoNaEtapaAncora(),
  endereco: cenario.endereco,
  entrada: cenario.aprovacao,
  ator: cenario.decisor,
  ...sobrescrito,
});

test("cada gate declara o nome, o decisor e a etapa âncora", () => {
  assert.deepEqual(
    [
      ["gate_demanda", GATE_DA_DEMANDA] as const,
      ...Object.entries(GATES).map(([nome, { regra }]) => [nome, regra] as const),
    ].map(([nome, regra]) => [nome, regra.nome, regra.decisor, regra.etapaAncora]),
    [
      ["gate_demanda", "gate_demanda", "auditor", "entender_e_desenhar"],
      ["gate_planejamento", "gate_planejamento", "auditor", "planejar"],
      ["gate_pr", "gate_pr", "auditor", "encerrar_rodada"],
      ["gate_revisao_rodada", "gate_revisao_rodada", "agente", "revisar_rodada"],
      ["gate_revisao_demanda", "gate_revisao_demanda", "agente", "revisar_demanda"],
    ],
  );
});

// D03: validação da entrada e rejeições, gate a gate -----------------------------------------------------------------

for (const cenario of CENARIOS) {
  const { gate } = cenario;
  const nome = gate.nome;
  const dadosDoCorpo = (corpo: object) => ({ ...cenario.reprovacao, ...corpo });

  test(`${nome}: validarEntrada rejeita reprovar sem motivo`, () => {
    assert.throws(() => gate.validarEntrada({ resultado: "reprovado" }, cenario.decisor), ErroDeRegra);
  });

  test(`${nome}: validarEntrada aceita reprovar com motivo`, () => {
    const validada = gate.validarEntrada(dadosDoCorpo({ motivo: "  porque sim  " }), cenario.decisor);
    assert.equal(validada.resultado, "reprovado");
    assert.equal(validada.motivo, "porque sim");
  });

  test(`${nome}: validarEntrada aceita aprovar`, () => {
    assert.equal(gate.validarEntrada(cenario.aprovacao, cenario.decisor).resultado, "aprovado");
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente reprovar sem motivo`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { entrada: { resultado: "reprovado" } }),
      ErroDeRegra,
      /motivo/,
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente o motivo em branco`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { entrada: dadosDoCorpo({ motivo: "   " }) }),
      ErroDeRegra,
      /motivo/,
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente um resultado inválido`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(tentativaDe(cenario, { entrada: { resultado: "pendente" } }), ErroDeRegra);
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente um campo extra`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { entrada: { ...cenario.aprovacao, extra: 1 } }),
      ErroDeRegra,
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente uma entrada que não é objeto`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(tentativaDe(cenario, { entrada: null }), ErroDeRegra);
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente o ator sem permissão`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { ator: cenario.atorSemPermissao }),
      ErroDeEscopo,
      new RegExp(`decidir o ${nome}`),
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente o gate chamado fora da etapa âncora`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { agregado: cenario.agregadoForaDaEtapaAncora() }),
      ErroDeRegra,
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente o endereço de outra demanda`, () => {
    const enderecoDeOutraDemanda =
      cenario.endereco.rodada_id === undefined
        ? Endereco.daDemanda("I-2")
        : Endereco.daRodada("I-2", cenario.endereco.rodada_id);
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { endereco: enderecoDeOutraDemanda }),
      ErroDeRegra,
      /demanda I-2/,
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente a demanda sem o ticket âncora`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, { agregado: semTicketsDaEtapa(cenario.agregadoNaEtapaAncora(), gate.etapaAncora) }),
      ErroDeRegra,
      new RegExp(gate.etapaAncora),
    );
  });

  test(`${nome}: ensaiar e decidir rejeitam igualmente o ticket âncora falho`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      tentativaDe(cenario, {
        agregado: comTicketsDaEtapaNoEstado(cenario.agregadoNaEtapaAncora(), gate.etapaAncora, "falhou"),
      }),
      ErroDeRegra,
      /falhou/,
    );
  });

  if (nome === "gate_pr" || nome === "gate_revisao_rodada" || nome === "gate_revisao_demanda") {
    test(`${nome}: ensaiar e decidir rejeitam igualmente o ticket âncora já concluído`, () => {
      exigirMesmaRejeicaoNoEnsaioENaDecisao(
        tentativaDe(cenario, {
          agregado: comTicketsDaEtapaNoEstado(cenario.agregadoNaEtapaAncora(), gate.etapaAncora, "concluido"),
        }),
        ErroDeRegra,
        /só ticket aberto ou em execução age/,
      );
    });
  }

  if (cenario.endereco.rodada_id !== undefined) {
    test(`${nome}: ensaiar e decidir rejeitam igualmente o endereço da demanda, sem rodada`, () => {
      exigirMesmaRejeicaoNoEnsaioENaDecisao(
        tentativaDe(cenario, { endereco: enderecoDaDemanda }),
        ErroDeRegra,
        /não é de uma rodada/,
      );
    });

    test(`${nome}: ensaiar e decidir rejeitam igualmente a rodada que não existe`, () => {
      exigirMesmaRejeicaoNoEnsaioENaDecisao(
        tentativaDe(cenario, { endereco: Endereco.daRodada(DEMANDA, 9) }),
        ErroDeRegra,
        /rodada 9 não existe/,
      );
    });
  }

  for (const [rotulo, entrada] of [
    ["a aprovação", cenario.aprovacao],
    ["a reprovação", cenario.reprovacao],
  ] as const) {
    test(`${nome}: ensaiar ${rotulo} válida não lança e não muda o agregado`, () => {
      const agregado = cenario.agregadoNaEtapaAncora();
      const agregadoAntes = clonarAgregadoDemanda(agregado);
      assert.doesNotThrow(() => {
        gate.ensaiar(agregado, cenario.endereco, entrada, cenario.decisor, contexto);
      });
      assert.deepEqual(agregado, agregadoAntes);
    });
  }

  test(`${nome}: a decisão gravada leva o gate e o ticket âncora, e o decisao_id é o próximo do ticket`, () => {
    const agregado = cenario.agregadoNaEtapaAncora();
    const ancora = gate.ancora(agregado, cenario.endereco);
    const decisaoAnterior = reprovacaoGravada(ancora.ticket_id, 1, "antes", nome);
    const decidido = gate.decidir(
      comDecisoes(agregado, decisaoAnterior),
      cenario.endereco,
      cenario.aprovacao,
      cenario.decisor,
      contexto,
    );
    assert.equal(decidido.decisoes.length, 2);
    assert.deepEqual(decidido.decisoes[0], decisaoAnterior);
    const gravada = decidido.decisoes[1];
    assert.deepEqual(
      [gravada?.gate, gravada?.ticket_id, gravada?.decisao_id, gravada?.resultado, gravada?.por, gravada?.em],
      [nome, ancora.ticket_id, 2, "aprovado", cenario.decisor, t2],
    );
  });
}

// gate_pr: nota e a aprovação automática ----------------------------------------------------------------------------

const cenarioDoPr = CENARIOS.find((c) => c.gate.nome === "gate_pr");
if (cenarioDoPr === undefined) throw new Error("falta o cenário do gate_pr");

for (const [rotulo, nota, aceita] of [
  ["sem nota", undefined, false],
  ["nota 0", 0, false],
  ["nota 6", 6, false],
  ["nota 1", 1, true],
  ["nota 5", 5, true],
] as const) {
  const entrada = { resultado: "aprovado", nota };
  test(`gate_pr: validarEntrada ${aceita ? "aceita" : "rejeita"} aprovar com o Auditor ${rotulo}`, () => {
    if (aceita) assert.equal(GATES.gate_pr.regra.validarEntrada(entrada, AUDITOR).nota, nota);
    else assert.throws(() => GATES.gate_pr.regra.validarEntrada(entrada, AUDITOR), ErroDeRegra);
  });
  if (!aceita) {
    test(`gate_pr: ensaiar e decidir rejeitam igualmente aprovar com o Auditor ${rotulo}`, () => {
      exigirMesmaRejeicaoNoEnsaioENaDecisao(tentativaDe(cenarioDoPr, { entrada }), ErroDeRegra, /nota/);
    });
  }
}

const aprovacaoAutomatica = { resultado: "aprovado", motivo: MOTIVO_APROVACAO_AUTOMATICA_PR };

test("gate_pr: validarEntrada aceita a aprovação da Fabriquinha sem nota", () => {
  assert.equal(GATES.gate_pr.regra.validarEntrada(aprovacaoAutomatica, FABRIQUINHA).nota, undefined);
});

test("gate_pr: validarEntrada rejeita a Fabriquinha aprovar com nota", () => {
  assert.throws(() => GATES.gate_pr.regra.validarEntrada({ resultado: "aprovado", nota: 4 }, FABRIQUINHA), ErroDeRegra);
});

test("gate_pr: validarEntrada rejeita a Fabriquinha reprovar", () => {
  assert.throws(
    () => GATES.gate_pr.regra.validarEntrada({ resultado: "reprovado", motivo: "x" }, FABRIQUINHA),
    ErroDeRegra,
  );
});

test("gate_pr: validarEntrada rejeita o Auditor reprovar com nota", () => {
  assert.throws(
    () => GATES.gate_pr.regra.validarEntrada({ resultado: "reprovado", motivo: "x", nota: 3 }, AUDITOR),
    ErroDeRegra,
  );
});

test("gate_pr: ensaiar e decidir rejeitam igualmente a Fabriquinha aprovar com nota", () => {
  exigirMesmaRejeicaoNoEnsaioENaDecisao(
    tentativaDe(cenarioDoPr, { entrada: { resultado: "aprovado", nota: 4 }, ator: FABRIQUINHA }),
    ErroDeRegra,
    /só aprova o PR, e sem nota/,
  );
});

test("gate_pr: ensaiar e decidir rejeitam igualmente a Fabriquinha reprovar", () => {
  exigirMesmaRejeicaoNoEnsaioENaDecisao(
    tentativaDe(cenarioDoPr, { entrada: cenarioDoPr.reprovacao, ator: FABRIQUINHA }),
    ErroDeRegra,
    /só aprova o PR, e sem nota/,
  );
});

test("gate_pr: ensaiar e decidir rejeitam igualmente o Auditor reprovar com nota", () => {
  exigirMesmaRejeicaoNoEnsaioENaDecisao(
    tentativaDe(cenarioDoPr, { entrada: { resultado: "reprovado", motivo: "x", nota: 3 } }),
    ErroDeRegra,
    /não leva nota/,
  );
});

test("gate_pr: aprovar com nota grava a decisão, conclui o ticket e a rodada", () => {
  for (const nota of [1, 5]) {
    const agregado = rodadaEmGatePr();
    const agregadoAntes = clonarAgregadoDemanda(agregado);
    const decidido = GATES.gate_pr.regra.decidir(
      agregado,
      enderecoDaRodada,
      { resultado: "aprovado", nota },
      AUDITOR,
      contexto,
    );
    assert.deepEqual(agregado, agregadoAntes);
    assert.deepEqual(
      decidido.rodadas.map((r) => r.estado),
      ["concluida", "implementar"],
    );
    assert.equal(decidido.tickets.find((t) => t.ticket_id === 4)?.estado, "concluido");
    assert.deepEqual(decidido.decisoes, [
      {
        demanda_id: DEMANDA,
        ticket_id: 4,
        decisao_id: 1,
        gate: "gate_pr",
        resultado: "aprovado",
        nota,
        por: AUDITOR,
        em: t2,
      },
    ]);
    // repetir depois da conclusão não duplica a decisão
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      {
        gate: GATES.gate_pr.regra,
        agregado: decidido,
        endereco: enderecoDaRodada,
        entrada: { resultado: "aprovado", nota },
        ator: AUDITOR,
      },
      ErroDeRegra,
    );
  }
});

test("gate_pr: a aprovação automática da Fabriquinha conclui a rodada com o motivo no lugar da nota", () => {
  const decidido = GATES.gate_pr.regra.decidir(
    rodadaEmGatePr(),
    enderecoDaRodada,
    aprovacaoAutomatica,
    FABRIQUINHA,
    contexto,
  );
  assert.deepEqual(
    decidido.rodadas.map((r) => r.estado),
    ["concluida", "implementar"],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 4,
      decisao_id: 1,
      gate: "gate_pr",
      resultado: "aprovado",
      motivo: MOTIVO_APROVACAO_AUTOMATICA_PR,
      por: { tipo: "fabriquinha" },
      em: t2,
    },
  ]);
});

test("gate_pr: reprovar grava a decisão sem nota, conclui o gate e abre a sessão de ajustes", () => {
  const agregado = rodadaEmGatePr();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const decidido = GATES.gate_pr.regra.decidir(
    agregado,
    enderecoDaRodada,
    { resultado: "reprovado", motivo: " ajustar " },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(agregado, agregadoAntes);
  assert.deepEqual(
    decidido.rodadas.map((r) => r.estado),
    ["ajustar_resultado", "implementar"],
  );
  assert.deepEqual(
    decidido.tickets.slice(3).map((t) => [t.ticket_id, t.etapa, t.estado, t.rodada_id, t.criado_por]),
    [
      [4, "encerrar_rodada", "concluido", 1, FABRIQUINHA],
      [5, "ajustar_resultado", "aberto", 1, FABRIQUINHA],
    ],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 4,
      decisao_id: 1,
      gate: "gate_pr",
      resultado: "reprovado",
      motivo: "ajustar",
      por: AUDITOR,
      em: t2,
    },
  ]);
});

// gate_demanda ---------------------------------------------------------------------------------------------------

test("gate_demanda: aprovar grava a decisão, conclui o ticket e abre planejar", () => {
  const agregado = demandaEnviada();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const decidido = GATE_DA_DEMANDA.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "aprovado", nota: 5 },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(agregado, agregadoAntes);
  assert.equal(decidido.demanda.estado, "planejar");
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 1,
      decisao_id: 1,
      gate: "gate_demanda",
      resultado: "aprovado",
      nota: 5,
      por: AUDITOR,
      em: t2,
    },
  ]);
  assert.equal(decidido.tickets[0]?.estado, "concluido");
  assert.deepEqual(decidido.tickets[1], {
    demanda_id: DEMANDA,
    ticket_id: 2,
    etapa: "planejar",
    estado: "aberto",
    estado_alterado_em: t2,
    criado_por: FABRIQUINHA,
  });
  assert.deepEqual(decidido.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
});

test("gate_demanda: aprovar com o ticket planejar já aberto não abre outro", () => {
  const enviada = demandaEnviada();
  const planejarAberto = {
    demanda_id: DEMANDA,
    ticket_id: 2,
    etapa: "planejar" as const,
    estado: "aberto" as const,
    estado_alterado_em: t0,
    criado_por: FABRIQUINHA,
  };
  const decidido = GATE_DA_DEMANDA.decidir(
    { ...enviada, tickets: [...enviada.tickets, planejarAberto] },
    enderecoDaDemanda,
    { resultado: "aprovado" },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(decidido.tickets.slice(1), [planejarAberto]);
});

test("gate_demanda: reprovar grava o motivo, cancela a demanda e o ticket, sem novo ticket", () => {
  const decidido = GATE_DA_DEMANDA.decidir(
    demandaEnviada(),
    enderecoDaDemanda,
    { resultado: "reprovado", motivo: "fora do escopo" },
    AUDITOR,
    contexto,
  );
  assert.equal(decidido.demanda.estado, "cancelada");
  assert.equal(decidido.decisoes[0]?.resultado, "reprovado");
  assert.equal(decidido.decisoes[0].motivo, "fora do escopo");
  assert.equal(decidido.tickets.length, 1);
  assert.equal(decidido.tickets[0]?.estado, "cancelado");
  assert.deepEqual(decidido.tentativas.at(-1)?.resultado, { tipo: "interrompida", por: AUDITOR });
});

// gate_planejamento ----------------------------------------------------------------------------------------------

test("gate_planejamento: reprovar volta a planejar mantendo o ticket, o plano e as evidências", () => {
  const agregado = demandaComPlanoSubmetido();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const decidido = GATES.gate_planejamento.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "reprovado", motivo: "falta teste" },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(agregado, agregadoAntes);
  assert.equal(decidido.demanda.estado, "planejar");
  assert.deepEqual(decidido.decisoes.at(-1), {
    demanda_id: DEMANDA,
    ticket_id: 2,
    decisao_id: 1,
    gate: "gate_planejamento",
    resultado: "reprovado",
    motivo: "falta teste",
    por: AUDITOR,
    em: t2,
  });
  assert.deepEqual(decidido.tickets, agregado.tickets);
  assert.deepEqual(decidido.evidencias, agregado.evidencias);
  // a mesma sessão retoma e resubmete, substituindo o plano
  const resubmetido = comPlanoSubmetido(decidido, planoDe(), agenteDoTrabalho(1), contexto.agora);
  assert.equal(resubmetido.evidencias.filter((e) => e.tipo === "plano").length, 1);
});

test("gate_planejamento: reprovar encerra a Tentativa aberta do planejar como interrompida", () => {
  const base = demandaComPlanoSubmetido();
  const ticketPlanejar = base.tickets.find((t) => t.etapa === "planejar");
  assert.ok(ticketPlanejar);
  const agregado = { ...base, tentativas: comTentativaAberta(base.tentativas, ticketPlanejar, "exec-planejar", t1) };
  const decidido = GATES.gate_planejamento.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "reprovado", motivo: "falta teste" },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(decidido.tentativas.at(-1), {
    ticket: Endereco.doTicket(DEMANDA, 2),
    numero: 1,
    processo_id: "exec-planejar",
    inicio: t1,
    fim: t2,
    resultado: { tipo: "interrompida", por: AUDITOR, motivo: "falta teste" },
  });
  assert.equal(agregado.tentativas.at(-1)?.fim, undefined);
});

test("gate_planejamento: reprovar com o planejar falho reabre o ticket com o motivo", () => {
  const falho = registrarFalhaTicket(
    demandaComPlanoSubmetido(),
    { ticket_id: 2, falha: falhaQueExigeOAuditor("serviço reiniciado") },
    contexto,
  );
  const decidido = GATES.gate_planejamento.regra.decidir(
    falho,
    enderecoDaDemanda,
    { resultado: "reprovado", motivo: "tente de novo" },
    AUDITOR,
    contexto,
  );
  const ticketPlanejar = decidido.tickets.find((t) => t.ticket_id === 2);
  assert.equal(ticketPlanejar?.estado, "aberto");
  assert.equal(ticketPlanejar.instrucao, "tente de novo");
  assert.equal(decidido.demanda.estado, "planejar");
  assert.equal(decidido.decisoes.at(-1)?.resultado, "reprovado");
});

test("gate_planejamento: aprovar com o planejar falho é rejeitado até o Auditor reabrir", () => {
  const falho = registrarFalhaTicket(
    demandaComPlanoSubmetido(),
    { ticket_id: 2, falha: falhaQueExigeOAuditor("serviço reiniciado") },
    contexto,
  );
  exigirMesmaRejeicaoNoEnsaioENaDecisao(
    {
      gate: GATES.gate_planejamento.regra,
      agregado: falho,
      endereco: enderecoDaDemanda,
      entrada: { resultado: "aprovado" },
      ator: AUDITOR,
    },
    ErroDeRegra,
    /falhou e bloqueia/,
  );
  assert.equal(falho.demanda.estado, "gate_planejamento");
  const reaberto = reabrirTicket(falho, { ticket_id: 2, instrucao: "retome" }, AUDITOR, contexto);
  assert.equal(reaberto.tickets.find((t) => t.ticket_id === 2)?.estado, "aberto");
});

test("gate_planejamento: sem plano submetido, aprovar e reprovar são rejeitados", () => {
  const semPlano = semEvidenciaDePlano(demandaComPlanoSubmetido());
  for (const entrada of [CENARIOS[1]?.aprovacao, CENARIOS[1]?.reprovacao]) {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      { gate: GATES.gate_planejamento.regra, agregado: semPlano, endereco: enderecoDaDemanda, entrada, ator: AUDITOR },
      ErroDeRegra,
      /plano submetido/,
    );
  }
});

test("gate_planejamento: aprovar materializa rodadas, tickets renumerados, caminhos e dependências e vai a em_execucao", () => {
  const plano = planoDe({
    criterios: ["CA-1", "CA-2"],
    tickets: [
      {
        demanda_id: DEMANDA,
        ticket_id: 5,
        titulo: "b",
        descricao: "d",
        rodada_id: 2,
        arquivos_previstos: ["src/b.ts"],
      },
      {
        demanda_id: DEMANDA,
        ticket_id: 4,
        titulo: "a",
        descricao: "d",
        rodada_id: 2,
        depende: [],
        configuracao_agente: { modelo: { provedor: "p", nome: "m" }, effort: "high" },
      },
      {
        demanda_id: DEMANDA,
        ticket_id: 6,
        titulo: "c",
        descricao: "d",
        rodada_id: 2,
        depende: [{ demanda_id: DEMANDA, ticket_id: 4 }],
      },
      { demanda_id: DEMANDA, ticket_id: 7, titulo: "d", descricao: "d", rodada_id: 1 },
    ],
  });
  const agregado = demandaComPlanoSubmetido(plano);
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const decidido = GATES.gate_planejamento.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "aprovado", nota: 4 },
    AUDITOR,
    contexto,
  );
  assert.deepEqual(agregado, agregadoAntes);
  assert.deepEqual(agregado.rodadas, []);
  assert.equal(decidido.demanda.estado, "em_execucao");
  assert.deepEqual(
    decidido.rodadas.map((r) => [r.rodada_id, r.estado, r.e2e, r.branch]),
    [
      [1, "implementar", false, "fabriquinha/I-1-1"],
      [2, "implementar", true, "fabriquinha/I-1-2"],
    ],
  );
  assert.deepEqual(decidido.dependencias_rodada, [{ demanda_id: DEMANDA, rodada_id: 2, depende_rodada_id: 1 }]);
  assert.deepEqual(decidido.criterios_citados, [{ demanda_id: DEMANDA, rodada_id: 1, criterio_id: "CA-1" }]);
  // IDs do plano (4, 5, 6, 7) são renumerados depois dos existentes (1, 2), na mesma ordem
  assert.deepEqual(
    decidido.tickets
      .slice(2)
      .map((t) => [t.ticket_id, t.titulo, t.rodada_id, t.etapa, t.estado, t.configuracao_agente]),
    [
      [3, "a", 2, "implementar", "aberto", { modelo: { provedor: "p", nome: "m" }, effort: "high" }],
      [4, "b", 2, "implementar", "aberto", undefined],
      [5, "c", 2, "implementar", "aberto", undefined],
      [6, "d", 1, "implementar", "aberto", undefined],
    ],
  );
  assert.deepEqual(decidido.dependencias_ticket, [{ demanda_id: DEMANDA, ticket_id: 5, depende_ticket_id: 3 }]);
  assert.deepEqual(decidido.caminhos_ticket, [{ demanda_id: DEMANDA, ticket_id: 4, caminho: "src/b.ts" }]);
  assert.deepEqual(
    decidido.versoes_plano.map((v) => [v.numero, v.origem, v.autor, v.rodada_id]),
    [[1, "aprovacao_do_planejamento", FABRIQUINHA, undefined]],
  );
  assert.deepEqual(decidido.arquivos_previstos_demanda, [{ demanda_id: DEMANDA, caminho: "src/b.ts" }]);
  assert.deepEqual(decidido.arquivos_previstos_rodada, [
    { demanda_id: DEMANDA, rodada_id: 1, caminho: "src/b.ts" },
    { demanda_id: DEMANDA, rodada_id: 2, caminho: "src/b.ts" },
  ]);
  assert.equal(decidido.tickets[1]?.estado, "concluido");
  assert.deepEqual(decidido.decisoes.at(-1), {
    demanda_id: DEMANDA,
    ticket_id: 2,
    decisao_id: 1,
    gate: "gate_planejamento",
    resultado: "aprovado",
    nota: 4,
    por: AUDITOR,
    em: t2,
  });
});

test("gate_planejamento: aprovar sem nota grava a decisão sem nota e a Tentativa do planejar como sucesso", () => {
  const base = demandaComPlanoSubmetido();
  const ticketPlanejar = base.tickets.find((t) => t.etapa === "planejar");
  assert.ok(ticketPlanejar);
  const agregado = { ...base, tentativas: comTentativaAberta(base.tentativas, ticketPlanejar, "exec-planejar", t1) };
  const decidido = GATES.gate_planejamento.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "aprovado" },
    AUDITOR,
    contexto,
  );
  assert.equal(decidido.decisoes.at(-1)?.nota, undefined);
  assert.deepEqual(decidido.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
  assert.equal(decidido.tentativas.at(-1)?.processo_id, "exec-planejar");
});

test("gate_planejamento: o decisao_id é local ao ticket e avança a cada reprovação até a aprovação", () => {
  const decidirNoPlanejamento = (agregado: AgregadoDemanda, entrada: object) =>
    GATES.gate_planejamento.regra.decidir(agregado, enderecoDaDemanda, entrada, AUDITOR, contexto);
  const reprovarEResubmeter = (agregado: AgregadoDemanda, motivo: string) =>
    comPlanoSubmetido(
      decidirNoPlanejamento(agregado, { resultado: "reprovado", motivo }),
      planoDe(),
      agenteDoTrabalho(1),
      contexto.agora,
    );
  const submetido = demandaComPlanoSubmetido();
  const aprovado = decidirNoPlanejamento(reprovarEResubmeter(reprovarEResubmeter(submetido, "a"), "b"), {
    resultado: "aprovado",
  });
  assert.deepEqual(
    aprovado.decisoes.map((d) => [d.ticket_id, d.decisao_id, d.resultado]),
    [
      [1, 1, "aprovado"],
      [2, 1, "reprovado"],
      [2, 2, "reprovado"],
      [2, 3, "aprovado"],
    ],
  );
});

// gate_revisao_rodada --------------------------------------------------------------------------------------------

const reprovacaoDaRevisaoDaRodada = (motivo: string, correcoes: unknown = [correcaoDaRodada()]) => ({
  resultado: "reprovado" as const,
  motivo,
  correcoes,
});
const decidirRevisaoDaRodada = (agregado: AgregadoDemanda, entrada: object, ator: Ator) =>
  GATES.gate_revisao_rodada.regra.decidir(agregado, enderecoDaRodada, entrada, ator, contexto);
const rodadaComRevisoresAnteriores = (): AgregadoDemanda =>
  comDecisoes(
    rodadaEm("revisar_rodada", [
      ticketDaRodada(2, "implementar", "concluido"),
      ticketDaRodada(3, "revisar_rodada", "concluido"),
      ticketDaRodada(4, "implementar", "concluido"),
      ticketDaRodada(5, "revisar_rodada", "concluido"),
      ticketDaRodada(6, "implementar", "concluido"),
      ticketDaRodada(7, "revisar_rodada", "em_execucao"),
    ]),
    reprovacaoGravada(3, 1, "primeiro", "gate_revisao_rodada"),
    reprovacaoGravada(5, 1, "segundo", "gate_revisao_rodada"),
  );
const comTicketEmExecucao = (agregado: AgregadoDemanda, ticket_id: number): AgregadoDemanda => ({
  ...agregado,
  tickets: agregado.tickets.map((t) => (t.ticket_id === ticket_id ? { ...t, estado: "em_execucao" as const } : t)),
});

test("gate_revisao_rodada: aprovar conclui a revisão, abre encerrar_rodada e vai a encerrar_rodada", () => {
  const agregado = rodadaEmRevisao();
  const agenteRevisor = agenteDoTrabalho(3);
  const decidido = decidirRevisaoDaRodada(agregado, { resultado: "aprovado" }, agenteRevisor);
  assert.strictEqual(decidido.decisoes[0]?.por, agenteRevisor);
  assert.deepEqual(
    decidido.rodadas.map((r) => r.estado),
    ["encerrar_rodada", "implementar"],
  );
  assert.deepEqual(
    decidido.tickets.slice(2).map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [3, "revisar_rodada", "concluido"],
      [4, "encerrar_rodada", "aberto"],
    ],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_rodada",
      resultado: "aprovado",
      por: agenteRevisor,
      em: t2,
    },
  ]);
});

test("gate_revisao_rodada: reprovar grava o motivo, cria a correção e volta a implementar", () => {
  const agregado = rodadaEmRevisao();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const agenteRevisor = agenteDoTrabalho(3);
  const decidido = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada("  refazer o teste  "), agenteRevisor);
  assert.deepEqual(agregado, agregadoAntes);
  assert.deepEqual(decidido.decisoes[0]?.por, agenteRevisor);
  assert.deepEqual(decidido.tickets.at(-1)?.criado_por, agenteRevisor);
  assert.deepEqual(
    decidido.versoes_plano.map((v) => [v.numero, v.origem, v.autor, v.rodada_id]),
    [[1, "revisao_rodada", agenteRevisor, 1]],
  );
  assert.deepEqual(
    decidido.rodadas.map((r) => r.estado),
    ["implementar", "implementar"],
  );
  assert.deepEqual(
    decidido.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [1, "entender_e_desenhar", "concluido"],
      [2, "implementar", "concluido"],
      [3, "revisar_rodada", "concluido"],
      [4, "implementar", "aberto"],
    ],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_rodada",
      resultado: "reprovado",
      motivo: "refazer o teste",
      por: agenteRevisor,
      em: t2,
    },
  ]);
});

test("gate_revisao_rodada: reprovar sem correções, com a lista vazia ou de outra rodada é rejeitado", () => {
  for (const correcoes of [undefined, [], [{ ...correcaoDaRodada(), rodada_id: 2 }]]) {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      {
        gate: GATES.gate_revisao_rodada.regra,
        agregado: rodadaEmRevisao(),
        endereco: enderecoDaRodada,
        entrada: { resultado: "reprovado", motivo: "refazer", correcoes },
        ator: agenteDoTrabalho(3),
      },
      ErroDeRegra,
    );
  }
});

test("gate_revisao_rodada: com uma reprovação anterior na rodada, reprovar ainda cria a correção", () => {
  const agregado = comDecisoes(rodadaEmRevisao(), reprovacaoGravada(3, 1, "a", "gate_revisao_rodada"));
  const decidido = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada("b"), agenteDoTrabalho(3));
  assert.equal(decidido.tickets.find((t) => t.ticket_id === 3)?.estado, "concluido");
  assert.equal(decidido.tickets.at(-1)?.etapa, "implementar");
  assert.equal(decidido.rodadas[0]?.estado, "implementar");
});

test("gate_revisao_rodada: a terceira reprovação da rodada falha o ticket, sem corretivos, com os três motivos", () => {
  // duas reprovações em revisores anteriores da rodada e a terceira no atual
  const agregado = rodadaComRevisoresAnteriores();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const decidido = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada("terceiro"), agenteDoTrabalho(7));
  assert.deepEqual(agregado, agregadoAntes);
  assert.equal(decidido.tickets.length, agregado.tickets.length);
  const ticketFalho = decidido.tickets.find((t) => t.ticket_id === 7);
  assert.equal(ticketFalho?.estado, "falhou");
  const motivoDaFalha = motivoDaFalhaDoTicket(decidido.tentativas, ticketFalho) ?? "";
  assert.ok(motivoDaFalha.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  for (const motivo of ["primeiro", "segundo", "terceiro"]) assert.match(motivoDaFalha, new RegExp(motivo));
  assert.equal(decidido.rodadas[0]?.estado, "revisar_rodada");
  assert.deepEqual(decidido.decisoes.at(-1), {
    ...reprovacaoGravada(7, 1, "terceiro", "gate_revisao_rodada"),
    por: agenteDoTrabalho(7),
    em: t2,
  });
});

test("gate_revisao_rodada: reaberto pelo Auditor, o mesmo ticket aprova ou falha outra vez, sem corretivos", () => {
  const agregado = comDecisoes(
    rodadaEmRevisao(),
    reprovacaoGravada(3, 1, "a", "gate_revisao_rodada"),
    reprovacaoGravada(3, 2, "b", "gate_revisao_rodada"),
  );
  const terceira = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada("c"), agenteDoTrabalho(3));
  assert.equal(terceira.decisoes.at(-1)?.decisao_id, 3);
  const reaberto = comTicketEmExecucao(
    reabrirTicket(terceira, { ticket_id: 3, instrucao: "aceite o achado" }, AUDITOR, contexto),
    3,
  );

  const aprovado = decidirRevisaoDaRodada(reaberto, { resultado: "aprovado" }, agenteDoTrabalho(3));
  assert.equal(aprovado.rodadas[0]?.estado, "encerrar_rodada");
  assert.equal(aprovado.decisoes.at(-1)?.decisao_id, 4);

  const outra = decidirRevisaoDaRodada(reaberto, reprovacaoDaRevisaoDaRodada("d"), agenteDoTrabalho(3));
  const ticketFalho = outra.tickets.find((t) => t.ticket_id === 3);
  assert.equal(ticketFalho?.estado, "falhou");
  assert.ok(motivoDaFalhaDoTicket(outra.tentativas, ticketFalho)?.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.equal(outra.tickets.length, reaberto.tickets.length);
  assert.equal(outra.decisoes.at(-1)?.decisao_id, 4);
});

test("gate_revisao_rodada: a quarta reprovação com motivos longos mantém o prefixo e a demanda carregável", () => {
  const motivoLongo = (letra: string) => `${letra} `.repeat(999).trim(); // 999 palavras: o Motivo aceita até 2.000 caracteres
  const agregado = comDecisoes(
    rodadaEmRevisao(),
    reprovacaoGravada(3, 1, motivoLongo("a"), "gate_revisao_rodada"),
    reprovacaoGravada(3, 2, motivoLongo("b"), "gate_revisao_rodada"),
  );
  const terceira = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada(motivoLongo("c")), agenteDoTrabalho(3));
  const reaberto = comTicketEmExecucao(
    reabrirTicket(terceira, { ticket_id: 3, instrucao: "decida" }, AUDITOR, contexto),
    3,
  );
  const quarta = decidirRevisaoDaRodada(reaberto, reprovacaoDaRevisaoDaRodada(motivoLongo("d")), agenteDoTrabalho(3));
  const ticketFalho = quarta.tickets.find((t) => t.ticket_id === 3);
  assert.ok(ticketFalho);
  const motivoDaFalha = motivoDaFalhaDoTicket(quarta.tentativas, ticketFalho) ?? "";
  assert.ok(motivoDaFalha.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.ok(motivoDaFalha.endsWith(" d d d"));
  assert.match(motivoDaFalha, /\(3 reprovações anteriores omitidas\)/);
  assert.doesNotThrow(() => AgregadoDemanda.parse(quarta));
});

test("gate_revisao_rodada: motivos curtos de mais de três reprovações cabem inteiros, sem aviso de omissão", () => {
  const agregado = comDecisoes(
    rodadaEmRevisao(),
    reprovacaoGravada(3, 1, "a", "gate_revisao_rodada"),
    reprovacaoGravada(3, 2, "b", "gate_revisao_rodada"),
    reprovacaoGravada(3, 3, "c", "gate_revisao_rodada"),
  );
  const quarta = decidirRevisaoDaRodada(agregado, reprovacaoDaRevisaoDaRodada("d"), agenteDoTrabalho(3));
  const ticketFalho = quarta.tickets.find((t) => t.ticket_id === 3);
  assert.ok(ticketFalho);
  assert.equal(
    motivoDaFalhaDoTicket(quarta.tentativas, ticketFalho),
    `${PREFIXO_TERCEIRA_REPROVACAO}\n- a\n- b\n- c\n- d`,
  );
});

// gate_revisao_demanda -------------------------------------------------------------------------------------------

test("gate_revisao_demanda: aprovar conclui a revisão, abre encerrar_demanda e vai a encerrar_demanda", () => {
  const agregado = demandaEmRevisaoIntegral();
  const agenteRevisor = agenteDoTrabalho(3);
  const decidido = GATES.gate_revisao_demanda.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "aprovado" },
    agenteRevisor,
    contexto,
  );
  assert.equal(decidido.demanda.estado, "encerrar_demanda");
  assert.deepEqual(decidido.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
  assert.deepEqual(decidido.rodadas, agregado.rodadas);
  assert.deepEqual(
    decidido.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [1, "entender_e_desenhar", "concluido"],
      [2, "implementar", "concluido"],
      [3, "revisar_demanda", "concluido"],
      [4, "encerrar_demanda", "aberto"],
    ],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_demanda",
      resultado: "aprovado",
      por: agenteRevisor,
      em: t2,
    },
  ]);
});

test("gate_revisao_demanda: reprovar cria só rodadas novas, preserva as integradas e volta a em_execucao", () => {
  const agregado = demandaEmRevisaoIntegral();
  const agregadoAntes = clonarAgregadoDemanda(agregado);
  const agenteRevisor = agenteDoTrabalho(3);
  const decidido = GATES.gate_revisao_demanda.regra.decidir(
    agregado,
    enderecoDaDemanda,
    { resultado: "reprovado", motivo: "falta tratar erro", correcoes: planoCorretivo() },
    agenteRevisor,
    contexto,
  );
  assert.deepEqual(agregado, agregadoAntes);
  assert.equal(decidido.demanda.estado, "em_execucao");
  assert.deepEqual(decidido.rodadas.slice(0, 1), agregado.rodadas);
  assert.deepEqual(
    decidido.rodadas.map((r) => [r.rodada_id, r.estado]),
    [
      [1, "concluida"],
      [2, "implementar"],
    ],
  );
  assert.deepEqual(
    decidido.tickets.map((t) => [t.ticket_id, t.etapa, t.estado, t.rodada_id]),
    [
      [1, "entender_e_desenhar", "concluido", undefined],
      [2, "implementar", "concluido", 1],
      [3, "revisar_demanda", "concluido", undefined],
      [4, "implementar", "aberto", 2],
    ],
  );
  assert.deepEqual(decidido.decisoes, [
    {
      demanda_id: DEMANDA,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_demanda",
      resultado: "reprovado",
      motivo: "falta tratar erro",
      por: agenteRevisor,
      em: t2,
    },
  ]);
  assert.deepEqual(decidido.evidencias, agregado.evidencias);
  assert.deepEqual(decidido.tentativas.at(-1)?.resultado, { tipo: "sucesso" });
  assert.deepEqual(
    decidido.versoes_plano.map((v) => [v.numero, v.origem, v.autor, v.rodada_id]),
    [[1, "revisao_demanda", agenteRevisor, undefined]],
  );
});

for (const [rotulo, correcoes] of [
  ["sem plano corretivo", undefined],
  ["com um plano corretivo sem rodadas", planoCorretivo({ rodadas: [], tickets: [] })],
  ["com um plano corretivo sem tickets", planoCorretivo({ tickets: [] })],
  ["com um critério que a definição não tem", planoCorretivo({ criterios: ["CA-9"] })],
  ["com o plano corretivo de outra demanda", planoCorretivo({ demanda_id: "I-2" })],
] as const) {
  test(`gate_revisao_demanda: ensaiar e decidir rejeitam igualmente reprovar ${rotulo}`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      {
        gate: GATES.gate_revisao_demanda.regra,
        agregado: demandaEmRevisaoIntegral(),
        endereco: enderecoDaDemanda,
        entrada: { resultado: "reprovado", motivo: "falta tratar erro", correcoes },
        ator: agenteDoTrabalho(3),
      },
      ErroDeRegra,
    );
  });
}

for (const [rotulo, agregado] of [
  ["rodada ainda em revisão", demandaEmRevisaoIntegral([], ["concluida", "revisar_rodada"])],
  ["implementação aberta", demandaEmRevisaoIntegral([ticketDaRodada(4, "implementar", "aberto")])],
  ["ticket da rodada falho", demandaEmRevisaoIntegral([ticketDaRodada(4, "encerrar_rodada", "falhou")])],
] as const) {
  test(`gate_revisao_demanda: ensaiar e decidir rejeitam igualmente aprovar com ${rotulo}`, () => {
    exigirMesmaRejeicaoNoEnsaioENaDecisao(
      {
        gate: GATES.gate_revisao_demanda.regra,
        agregado,
        endereco: enderecoDaDemanda,
        entrada: { resultado: "aprovado" },
        ator: agenteDoTrabalho(3),
      },
      ErroDeRegra,
    );
  });
}
