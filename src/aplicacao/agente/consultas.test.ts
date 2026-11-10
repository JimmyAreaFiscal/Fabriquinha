// As leituras do agente contra banco real: o projeto, a demanda e o ticket do próprio agente, pelo endereço público.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../apoio-testes/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO as em,
  montarAgregadoDemanda,
  montarRodada,
  montarTicket,
} from "../../../apoio-testes/cenarios_de_demanda.ts";
import { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { comDemanda } from "../../armazenamento/demandas.ts";
import { verDemanda, verProjeto, verTicket } from "./consultas.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

/** Projeto `loja`, demanda I-206 com T1 (planejar, decidido), T3 e T4 (implementar, rodada 2) e a execução aberta no T3. */
function cenario() {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  const decisao = (ticket_id: number) => ({
    demanda_id: "I-206",
    ticket_id,
    decisao_id: ticket_id,
    gate: "gate_planejamento",
    resultado: "reprovado",
    motivo: "refaça",
    por: { tipo: "auditor" },
    em,
  });
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [montarRodada("I-206", 2, "implementar")],
      tickets: [
        montarTicket("I-206", 1, "planejar", { estado: "concluido" }),
        montarTicket("I-206", 3, "implementar", { rodada_id: 2 }),
        montarTicket("I-206", 4, "implementar", { rodada_id: 2 }),
      ],
      decisoes: [decisao(1), decisao(3)],
      evidencias: [
        {
          demanda_id: "I-206",
          ticket_id: 3,
          tipo: "comprovacao_criterios",
          autor: { tipo: "agente", trabalho_id: "e-I-206-T3" },
          em,
          dados: { criterios: [{ atendido: false }] },
        },
      ],
    }),
  );
  const { trabalho_id } = abrirTrabalhoDoAgente(banco, { demanda_id: "I-206", ticket_id: 3 });
  return { banco, processo: { id: trabalho_id } };
}

test("verProjeto devolve o projeto da demanda do agente", () => {
  const { banco, processo } = cenario();
  assert.equal(verProjeto(banco, processo).nome, "loja");
});

test("verDemanda mostra rodadas, decisões e tickets pelo endereço, e as evidências só do próprio ticket", () => {
  const { banco, processo } = cenario();
  banco
    .prepare(
      "INSERT INTO evidencia_demanda (demanda_id, ticket_id, tipo, dados, em) VALUES ('I-206', 3, 'plano', '{}', ?)",
    )
    .run(em);
  const lida = verDemanda(banco, processo, "I-206");
  assert.equal(lida.demanda.id, "I-206");
  assert.deepEqual(
    lida.rodadas.map((r) => r.rodada),
    ["I-206.R2"],
  );
  assert.deepEqual(
    lida.decisoes.map(({ ticket, rodada, por }) => [ticket, rodada, por]),
    [
      ["I-206.T1", undefined, "auditor"],
      ["I-206.T3", "I-206.R2", "auditor"],
    ],
  );
  assert.deepEqual(
    lida.tickets.map((t) => t.ticket),
    ["I-206.T1", "I-206.T3", "I-206.T4"],
  );
  assert.deepEqual(
    lida.tickets.map((t) => "criado_por" in t),
    [false, false, false],
  );
  assert.deepEqual(
    lida.tickets.map((t) => ("evidencias" in t ? t.evidencias : undefined)),
    [
      undefined,
      [
        { tipo: "comprovacao_criterios", em, veredito: "nao_atende" },
        { tipo: "plano", em, veredito: undefined },
      ],
      undefined,
    ],
  );
});

test("verDemanda recusa a demanda de outro", () => {
  const { banco, processo } = cenario();
  assert.throws(() => verDemanda(banco, processo, "I-207"), {
    name: "ErroDeEscopo",
    message: "o agente só lê a própria demanda (leia I-206, a do seu ticket I-206.T3)",
  });
});

test("verTicket mostra o próprio ticket, com o motivo da última Tentativa quando ele falhou", () => {
  const { banco, processo } = cenario();
  assert.deepEqual(verTicket(banco, processo, "I-206.T3"), {
    ticket: "I-206.T3",
    rodada: "I-206.R2",
    etapa: "implementar",
    estado: "aberto",
    estado_alterado_em: em,
  });
  comDemanda(banco, "I-206", (agregado) => ({
    ...agregado,
    tickets: agregado.tickets.map((ticket) => (ticket.ticket_id === 3 ? { ...ticket, estado: "falhou" } : ticket)),
    tentativas: [
      {
        ticket: Endereco.doTicket("I-206", 3),
        numero: 1,
        inicio: em,
        fim: em,
        resultado: { tipo: "interrompida", por: { tipo: "fabriquinha" }, motivo: "teste de erro falhou" },
      },
    ],
  }));
  assert.equal(verTicket(banco, processo, "I-206.T3").motivo, "teste de erro falhou");
});

test("verTicket recusa o ticket de outro, e a execução terminada não lê nada", () => {
  const { banco, processo } = cenario();
  assert.throws(() => verTicket(banco, processo, "I-206.T4"), {
    name: "ErroDeEscopo",
    message: "o agente só lê o próprio ticket (leia I-206.T3)",
  });
  banco.prepare("UPDATE processo_do_trabalho SET fim = ? WHERE id = ?").run(em, processo.id);
  assert.throws(() => verProjeto(banco, processo), { name: "ErroDeEscopo" });
  assert.throws(() => verDemanda(banco, processo, "I-206"), { name: "ErroDeEscopo" });
  assert.throws(() => verTicket(banco, processo, "I-206.T3"), { name: "ErroDeEscopo" });
});
