// A decisão do agente sobre o próprio ticket de revisão, contra banco real: aprovar exige as evidências, reprovar traz o
// motivo e as correções (rodada) ou o plano (demanda), e o que não vale é recusado antes de ler o JSON ou gravar.
import assert from "node:assert/strict";
import type { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  comEvidencia,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO as em,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../apoio-testes/cenarios_de_demanda.ts";
import { carregarDemanda, comDemanda } from "../../sdlc/armazenamento/demandas.ts";
import { decidirRevisao } from "./decidir_revisao.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const lerJson = (valor: string) => Promise.resolve(JSON.parse(valor) as unknown);

/** I-206 em `estado`, a rodada 2 em `faseDaRodada` e o ticket T9 de `etapa` (da rodada 2 se `naRodada`) com a execução aberta. */
function cenario(estado: string, faseDaRodada: string, etapa: string, naRodada = true) {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", estado, {
      rodadas: [montarRodada("I-206", 2, faseDaRodada)],
      tickets: [
        montarTicket("I-206", 1, "planejar", { estado: "concluido" }),
        montarTicket("I-206", 3, "implementar", { rodada_id: 2, estado: "concluido" }),
        montarTicket("I-206", 9, etapa, { ...(naRodada && { rodada_id: 2 }) }),
      ],
    }),
  );
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-206", ticket_id: 9 });
  return { banco, processo: { id: trabalho_id } };
}

const COMPROVACAO = { criterios: [{ id: "CA-1", atendido: true, arquivos: [] }] };
const EVIDENCIAS_RODADA: [string, object][] = [
  ["arquivos_alterados", { base: "a", head: "b", arquivos: [], previstosNaoTocados: [] }],
  ["matriz_fitness", { linhas: [{ nome: "f", comando: "c", codigoSaida: 0, log: "f.log" }] }],
  ["explicacao_fitness", { explicacoes: [] }],
  ["comprovacao_criterios", COMPROVACAO],
];
const EVIDENCIAS_INTEGRAL: [string, object][] = [
  ["comprovacao_criterios", COMPROVACAO],
  [
    "testes_estresse",
    {
      aplicavel: true,
      justificativa: "",
      cenarios: [{ nome: "n", objetivo: "o", comando: "c", resultado: "passou", observado: "ok" }],
    },
  ],
  [
    "analise_seguranca",
    { aplicavel: true, justificativa: "", ameacas: [{ descricao: "d", mitigacao: "m" }], achados: [] },
  ],
];

/** Submete ao ticket as evidências que a Revisão confere na aprovação. */
function evidenciar(banco: DatabaseSync, lista: [string, object][]) {
  comDemanda(banco, "I-206", (ag) =>
    lista.reduce(
      (a, [tipo, dados]) => comEvidencia(a, { tipo, dados, ticket_id: 9 } as never, a.demanda.criada_por, em),
      ag,
    ),
  );
}

const estadoDa = (banco: DatabaseSync) => {
  const { demanda, rodadas, tickets } = carregarDemanda(banco, "I-206");
  return {
    demanda: demanda.estado,
    rodada: rodadas[0]?.estado,
    ticket: tickets.find((t) => t.ticket_id === 9)?.estado,
  };
};

const decisoes = (banco: DatabaseSync) => carregarDemanda(banco, "I-206").decisoes;

test("aprovar a revisão de rodada registra a decisão do agente na rodada", async () => {
  const { banco, processo } = cenario("em_execucao", "revisar_rodada", "revisar_rodada");
  evidenciar(banco, EVIDENCIAS_RODADA);
  const resposta = await decidirRevisao(banco, processo, { ticket: "I-206.T9", veredito: "aprovar" }, lerJson);
  assert.deepEqual(resposta, { ticket: "I-206.T9", rodada: "I-206.R2", resultado: "aprovado" });
  assert.deepEqual(estadoDa(banco), { demanda: "em_execucao", rodada: "encerrar_rodada", ticket: "concluido" });
  assert.deepEqual(
    decisoes(banco).map((d) => [d.ticket_id, d.resultado, d.por]),
    [[9, "aprovado", { tipo: "agente", trabalho_id: processo.id }]],
  );
});

test("aprovar sem as evidências lista as ausentes e a rodada segue em revisão", async () => {
  const { banco, processo } = cenario("em_execucao", "revisar_rodada", "revisar_rodada");
  const aprovar = decidirRevisao(banco, processo, { ticket: "I-206.T9", veredito: "aprovar" }, lerJson);
  await assert.rejects(aprovar, (erro: Error) =>
    EVIDENCIAS_RODADA.every(([tipo]) => erro.message.includes(`${tipo} ausente`)),
  );
  assert.equal(estadoDa(banco).rodada, "revisar_rodada");
  assert.deepEqual(decisoes(banco), []);
});

test("a revisão integral exige as três evidências e, com elas, vai a encerramento", async () => {
  const { banco, processo } = cenario("revisar_demanda", "concluida", "revisar_demanda", false);
  const pedido = { ticket: "I-206.T9", veredito: "aprovar" };
  await assert.rejects(decidirRevisao(banco, processo, pedido, lerJson), (erro: Error) =>
    EVIDENCIAS_INTEGRAL.every(([tipo]) => erro.message.includes(`${tipo} ausente`)),
  );
  evidenciar(banco, EVIDENCIAS_INTEGRAL);
  assert.deepEqual(await decidirRevisao(banco, processo, pedido, lerJson), {
    ticket: "I-206.T9",
    resultado: "aprovado",
  });
  assert.equal(estadoDa(banco).demanda, "encerrar_demanda");
});

test("reprovar a revisão de rodada completa as correções com demanda, rodada e ticket local", async () => {
  const { banco, processo } = cenario("em_execucao", "revisar_rodada", "revisar_rodada");
  const lidos: unknown[][] = [];
  const correcoes = JSON.stringify([{ titulo: "a", descricao: "b" }]);
  const resposta = await decidirRevisao(
    banco,
    processo,
    { ticket: "I-206.T9", veredito: "reprovar", motivo: "falta", correcoes },
    (valor, opcao) => {
      lidos.push([valor, opcao]);
      return lerJson(valor);
    },
  );
  assert.deepEqual(resposta, { ticket: "I-206.T9", rodada: "I-206.R2", resultado: "reprovado" });
  assert.deepEqual(lidos, [[correcoes, "--correcoes"]]);
  const agregado = carregarDemanda(banco, "I-206");
  assert.equal(agregado.rodadas[0]?.estado, "implementar");
  assert.equal(agregado.tickets.filter((t) => t.etapa === "implementar").length, 2);
});

test("reprovar a revisão integral registra a decisão com o motivo e lê o plano", async () => {
  const { banco, processo } = cenario("revisar_demanda", "concluida", "revisar_demanda", false);
  const plano = {
    demanda_id: "I-206",
    criterios: [],
    rodadas: [{ demanda_id: "I-206", rodada_id: 1, titulo: "corrige", e2e: false }],
    tickets: [{ demanda_id: "I-206", ticket_id: 1, rodada_id: 1, titulo: "t", descricao: "d" }],
  };
  const resposta = await decidirRevisao(
    banco,
    processo,
    { ticket: "I-206.T9", veredito: "reprovar", motivo: "falta", plano: JSON.stringify(plano) },
    lerJson,
  );
  assert.deepEqual(resposta, { ticket: "I-206.T9", resultado: "reprovado" });
  assert.deepEqual(
    decisoes(banco).map((d) => [d.ticket_id, d.resultado, d.motivo]),
    [[9, "reprovado", "falta"]],
  );
  assert.equal(carregarDemanda(banco, "I-206").rodadas.length, 2);
});

test("veredito fora de aprovar|reprovar, opção que falta ou sobra e ticket alheio não gravam nada", async () => {
  const { banco, processo } = cenario("em_execucao", "revisar_rodada", "revisar_rodada");
  const decidir = (veredito: string, extra: object = {}, ticket = "I-206.T9") =>
    decidirRevisao(banco, processo, { ticket, veredito, ...extra }, lerJson);
  await assert.rejects(decidir("talvez"), { message: 'veredito "talvez" inválido (use aprovar ou reprovar)' });
  await assert.rejects(decidir("reprovar"), { message: "reprovar exige --motivo (passe --motivo)" });
  await assert.rejects(decidir("reprovar", { motivo: "m" }), {
    message: "reprovar exige --correcoes (passe --correcoes)",
  });
  await assert.rejects(decidir("reprovar", { motivo: "m", correcoes: "{" }), SyntaxError);
  await assert.rejects(decidir("reprovar", { motivo: "m", correcoes: "{}" }), /vetor/);
  for (const opcao of ["motivo", "correcoes", "plano"]) {
    await assert.rejects(decidir("aprovar", { [opcao]: "m" }), { message: /^aprovar não leva/ });
  }
  await assert.rejects(decidir("aprovar", {}, "I-206.T3"), {
    message: "o agente só age no próprio ticket (aja em I-206.T9)",
  });
  await assert.rejects(decidir("aprovar", {}, "T-9"), /I-206\.T9/);
  assert.deepEqual(decisoes(banco), []);
});

test("o ticket que não é de revisão não decide", async () => {
  const { banco, processo } = cenario("em_execucao", "implementar", "implementar");
  await assert.rejects(decidirRevisao(banco, processo, { ticket: "I-206.T9", veredito: "aprovar" }, lerJson), {
    message: "o ticket I-206.T9 é de implementar, não de revisão (só ticket de revisão decide)",
  });
});

test("execução terminada, inclusive durante a leitura do JSON, não grava", async () => {
  const { banco, processo } = cenario("em_execucao", "revisar_rodada", "revisar_rodada");
  const encerrar = () => banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run(em, processo.id);
  const pedido = { ticket: "I-206.T9", veredito: "reprovar", motivo: "m", correcoes: "[]" };
  await assert.rejects(
    decidirRevisao(banco, processo, pedido, (valor) => {
      encerrar();
      return lerJson(valor);
    }),
    /já terminou/,
  );
  await assert.rejects(
    decidirRevisao(banco, processo, { ticket: "I-206.T9", veredito: "aprovar" }, lerJson),
    /já terminou/,
  );
  assert.deepEqual(decisoes(banco), []);
});
