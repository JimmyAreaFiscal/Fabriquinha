// O escopo do agente: a execução precisa existir e estar aberta, e só o próprio ticket e a própria demanda passam.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../../apoio-testes/cenarios_de_demanda.ts";
import { ErroDeEscopo } from "../../../../../shared/nucleo/erros.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import {
  enderecoDoTicketDoAgente,
  escopoDoProcessoAberto,
  exigirDemandaPropria,
  exigirTicket,
  exigirTicketProprio,
  reconferirExecucao,
} from "./escopo.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

/** I-206 do projeto `loja` com o ticket T9 de revisão da rodada 2 em execução, e a execução aberta nele. */
function cenario() {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [montarRodada("I-206", 2, "revisar_rodada")],
      tickets: [montarTicket("I-206", 9, "revisar_rodada", { rodada_id: 2, estado: "em_execucao" })],
    }),
  );
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-206", ticket_id: 9 });
  return { banco, execucao: trabalho_id };
}

test("o escopo da execução aberta traz o Ator, a sessão, o ticket composto e o projeto", () => {
  const { banco, execucao } = cenario();
  assert.deepEqual(escopoDoProcessoAberto(banco, { id: execucao }), {
    ator: { tipo: "agente", trabalho_id: execucao },
    sessao: `s-${execucao}`,
    demanda_id: "I-206",
    ticket_id: 9,
    projeto: "loja",
  });
});

test("execução que não existe é recusada pelo caso de uso", () => {
  const { banco } = cenario();
  assert.throws(() => escopoDoProcessoAberto(banco, { id: "exec-x" }), {
    name: "ErroDeRegra",
    message: "a execução exec-x não existe (confira a execução)",
  });
});

test("execução terminada é ErroDeEscopo, na leitura do escopo e na reconferência", () => {
  const { banco, execucao } = cenario();
  const agente = escopoDoProcessoAberto(banco, { id: execucao });
  reconferirExecucao(banco, agente);
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run(INSTANTE_DO_CENARIO, execucao);
  for (const chamada of [
    () => escopoDoProcessoAberto(banco, { id: execucao }),
    () => {
      reconferirExecucao(banco, agente);
    },
  ]) {
    assert.throws(chamada, (erro) => erro instanceof ErroDeEscopo && erro.message.includes("já terminou"));
  }
});

test("a reconferência recusa o agente cuja execução não é do ticket dele", () => {
  const { banco, execucao } = cenario();
  const agente = escopoDoProcessoAberto(banco, { id: execucao });
  assert.throws(() => {
    reconferirExecucao(banco, { ...agente, ticket_id: 3 });
  }, /não é uma execução do ticket I-206\.T3/);
});

test("só o próprio ticket passa; T-3, rodada e ticket alheio erram mostrando o endereço certo", () => {
  const { banco, execucao } = cenario();
  const agente = escopoDoProcessoAberto(banco, { id: execucao });
  assert.equal(enderecoDoTicketDoAgente(agente), "I-206.T9");
  exigirTicketProprio(agente, "I-206.T9");
  const forma = "(use o endereço do seu ticket, I-206.T9)";
  assert.throws(
    () => {
      exigirTicketProprio(agente, "T-3");
    },
    {
      name: "ErroDeRegra",
      message: `T-3 não é um endereço de ticket ${forma}`,
    },
  );
  assert.throws(
    () => {
      exigirTicketProprio(agente, "I-206.R2");
    },
    {
      name: "ErroDeRegra",
      message: `I-206.R2 não é um ticket ${forma}`,
    },
  );
  assert.throws(
    () => {
      exigirTicketProprio(agente, "I-206.T3");
    },
    {
      name: "ErroDeEscopo",
      message: "o agente só lê o próprio ticket (leia I-206.T9)",
    },
  );
  assert.throws(
    () => {
      exigirTicketProprio(agente, "I-206.T3", true);
    },
    {
      name: "ErroDeEscopo",
      message: "o agente só age no próprio ticket (aja em I-206.T9)",
    },
  );
});

test("só a própria demanda passa", () => {
  const { banco, execucao } = cenario();
  const agente = escopoDoProcessoAberto(banco, { id: execucao });
  exigirDemandaPropria(agente, "I-206");
  assert.throws(
    () => {
      exigirDemandaPropria(agente, "I-207");
    },
    {
      name: "ErroDeEscopo",
      message: "o agente só lê a própria demanda (leia I-206, a do seu ticket I-206.T9)",
    },
  );
});

test("o ticket que não existe é ErroDeInexistente com o endereço público", () => {
  const { banco } = cenario();
  const agregado = carregarDemanda(banco, "I-206");
  assert.equal(exigirTicket(agregado, 9).ticket_id, 9);
  assert.throws(() => exigirTicket(agregado, 4), {
    name: "ErroDeInexistente",
    message: "o ticket I-206.T4 não existe (confira a execução)",
  });
});
