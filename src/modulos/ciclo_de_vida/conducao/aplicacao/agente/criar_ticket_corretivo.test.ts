// O ticket corretivo que o agente de uma sessão de ajustes cria na própria rodada, contra banco real.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO as em,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../../../../apoio-testes/cenarios_de_demanda.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import { criarTicketCorretivo } from "./criar_ticket_corretivo.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

/** I-206 com a rodada 2 em `ajustar_resultado`, o ticket T9 de ajustes em execução nela e a execução aberta no T9. */
function cenario() {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [montarRodada("I-206", 2, "ajustar_resultado")],
      tickets: [
        montarTicket("I-206", 3, "implementar", { rodada_id: 2, estado: "concluido" }),
        montarTicket("I-206", 9, "ajustar_resultado", { rodada_id: 2, estado: "em_execucao" }),
      ],
    }),
  );
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-206", ticket_id: 9 });
  return { banco, processo: { id: trabalho_id } };
}

const ticketsDa = (banco: ReturnType<typeof cenario>["banco"]) =>
  carregarDemanda(banco, "I-206").tickets.map((t) => t.ticket_id);

test("cria o corretivo na rodada do agente com o título como descrição, e devolve o endereço dele", () => {
  const { banco, processo } = cenario();
  assert.deepEqual(criarTicketCorretivo(banco, processo, { rodada: "I-206.R2", titulo: "Corrigir" }), {
    rodada: "I-206.R2",
    tickets: ["I-206.T10"],
  });
  const criado = carregarDemanda(banco, "I-206").tickets.find((t) => t.ticket_id === 10);
  assert.deepEqual(
    [criado?.etapa, criado?.rodada_id, criado?.titulo, criado?.descricao],
    ["implementar", 2, "Corrigir", "Corrigir"],
  );
});

test("o ticket corretivo nasce no instante do relógio", () => {
  const { banco, processo } = cenario();
  const instante = "2031-05-06T07:08:09.000Z";
  criarTicketCorretivo(banco, processo, { rodada: "I-206.R2", titulo: "Corrigir" }, relogioFixo(instante));
  assert.equal(carregarDemanda(banco, "I-206").tickets.find((t) => t.ticket_id === 10)?.estado_alterado_em, instante);
});

test("sem título, endereço que não é de rodada ou rodada de outra demanda não cria nada e mostra a rodada certa", () => {
  const { banco, processo } = cenario();
  const forma = "(use a rodada do seu ticket, I-206.R2)";
  assert.throws(() => criarTicketCorretivo(banco, processo, { rodada: "I-206.R2", titulo: undefined }), {
    name: "ErroDeRegra",
    message: "falta o título do ticket corretivo (passe --titulo <texto>)",
  });
  assert.throws(() => criarTicketCorretivo(banco, processo, { rodada: "T-9", titulo: "x" }), {
    message: `T-9 não é um endereço de rodada ${forma}`,
  });
  assert.throws(() => criarTicketCorretivo(banco, processo, { rodada: "I-206.T9", titulo: "x" }), {
    message: `I-206.T9 não é uma rodada ${forma}`,
  });
  assert.throws(() => criarTicketCorretivo(banco, processo, { rodada: "I-999.R2", titulo: "x" }), {
    name: "ErroDeEscopo",
    message: `I-999.R2 é de outra demanda ${forma}`,
  });
  assert.deepEqual(ticketsDa(banco), [3, 9]);
});

test("execução terminada não cria nada", () => {
  const { banco, processo } = cenario();
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run(em, processo.id);
  assert.throws(() => criarTicketCorretivo(banco, processo, { rodada: "I-206.R2", titulo: "x" }), /já terminou/);
  assert.deepEqual(ticketsDa(banco), [3, 9]);
});
