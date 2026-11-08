import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "./ator.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  exigirAutoria,
  pendentesDeEnvio,
  submeterEvidenciaDemanda,
  TipoEvidenciaDemanda,
} from "./evidencia_demanda.ts";

const em = "2026-01-01T00:00:00Z";
const autora: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
const outra: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s2" };
const base = (enviada = false): AgregadoDemanda => ({
  demanda: {
    id: "I-1",
    projeto: "p",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    estado: enviada ? "gate_demanda" : "entender_e_desenhar",
    estado_alterado_em: em,
    criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    enviada,
    branch: "fabriquinha/I-1",
  },
  tickets: [
    {
      demanda_id: "I-1",
      ticket_id: 1,
      etapa: "entender_e_desenhar",
      estado: "aberto",
      estado_alterado_em: em,
      criado_por: FABRIQUINHA,
    },
  ],
  decisoes: [],
  tentativas: [],
  evidencias: [],
  rodadas: [],
  dependencias_rodada: [],
  criterios_citados: [],
  dependencias_ticket: [],
  caminhos_ticket: [],
});
const entrada = (tipo: string, extra: Record<string, unknown> = {}, v = 1) => ({
  tipo: tipo as never,
  dados: { v },
  ...extra,
});

test("catálogo: obrigatórias e opcionais da demanda", () => {
  assert.equal(TipoEvidenciaDemanda.options.length, 7);
  assert.deepEqual(pendentesDeEnvio(base()), ["criterios_aceite", "desenho_solucao", "custos_realizados"]);
  const ag = submeterEvidenciaDemanda(base(), entrada("desenho_solucao"), autora, em);
  assert.deepEqual(pendentesDeEnvio(ag), ["criterios_aceite", "custos_realizados"]);
});

test("dono demanda: tipo fora do catálogo é recusado, e o agregado não muda", () => {
  const ag = base();
  assert.throws(() => submeterEvidenciaDemanda(ag, entrada("mensagem_pr"), autora, em), ErroDeRegra);
  assert.deepEqual(ag, base());
});

test("CA-6: outra ferramenta ou sessão é recusada antes do envio", () => {
  const ag = base();
  assert.throws(() => submeterEvidenciaDemanda(ag, entrada("criterios_aceite"), outra, em), ErroDeEscopo);
  assert.throws(() => {
    exigirAutoria(ag.demanda, { tipo: "externo", ferramenta: "pi", sessao: "s1" }, "editar");
  }, ErroDeEscopo);
  assert.deepEqual(ag, base());
});

test("CA-6: exigirAutoria recusa não-externos e externos de outra sessão ou ferramenta", () => {
  const ag = base();
  const recusados: Ator[] = [
    AUDITOR,
    FABRIQUINHA,
    { tipo: "agente", trabalho_id: "E-1" },
    outra,
    { tipo: "externo", ferramenta: "pi", sessao: "s1" },
  ];
  for (const autor of recusados) {
    assert.throws(
      () => {
        exigirAutoria(ag.demanda, autor, "editar");
      },
      {
        name: "ErroDeEscopo",
        message:
          "só a ferramenta claude da sessão s1 pode editar a demanda I-1 (peça a quem registrou a demanda, na mesma sessão)",
      },
    );
  }
  assert.doesNotThrow(() => {
    exigirAutoria(ag.demanda, autora, "editar");
  });
  assert.deepEqual(ag, base());
});

test("a evidência grava o autor externo, agente, Auditor ou Fabriquinha recebido", () => {
  const autores: Ator[] = [autora, outra, { tipo: "agente", trabalho_id: "E-1" }, AUDITOR, FABRIQUINHA];
  for (const autor of autores) {
    const ag = submeterEvidenciaDemanda(base(true), entrada("mensagem_pr", { ticket_id: 1 }), autor, em);
    assert.deepEqual(ag.evidencias[0]?.autor, autor);
  }
  const ag = submeterEvidenciaDemanda(base(), entrada("criterios_aceite"), autora, em);
  assert.deepEqual(ag.evidencias[0]?.autor, autora);
});

test("CA-9: nova evidência do mesmo tipo e dono substitui a anterior", () => {
  const um = submeterEvidenciaDemanda(base(), entrada("criterios_aceite", {}, 1), autora, em);
  const dois = submeterEvidenciaDemanda(um, entrada("criterios_aceite", {}, 2), autora, em);
  assert.equal(dois.evidencias.length, 1);
  assert.deepEqual(dois.evidencias[0]?.dados, { v: 2 });
  assert.equal(um.evidencias[0]?.dados.v, 1);
});

test("CA-10: rodada_id e ticket_id juntos são recusados", () => {
  assert.throws(
    () => submeterEvidenciaDemanda(base(), entrada("mensagem_pr", { rodada_id: 1, ticket_id: 1 }), autora, em),
    /rodada_id e ticket_id/,
  );
});

test("CA-11: sem rodada e ticket o dono é a demanda; mesmo tipo em outro dono convive", () => {
  let ag = submeterEvidenciaDemanda(base(), entrada("comportamento"), autora, em);
  ag = submeterEvidenciaDemanda(ag, entrada("comportamento", { ticket_id: 1 }), autora, em);
  ag = submeterEvidenciaDemanda(ag, entrada("comportamento", { rodada_id: 1 }), autora, em);
  assert.equal(ag.evidencias.length, 3);
  assert.equal(ag.evidencias[0]?.rodada_id, undefined);
});

test("ticket inexistente é recusado", () => {
  assert.throws(
    () => submeterEvidenciaDemanda(base(), entrada("mensagem_pr", { ticket_id: 9 }), autora, em),
    ErroDeRegra,
  );
});

test("CA-7: depois do envio a definição fica congelada, inclusive para a autora", () => {
  const ag = base(true);
  assert.throws(() => submeterEvidenciaDemanda(ag, entrada("criterios_aceite"), autora, em), ErroDeRegra);
  assert.deepEqual(ag, base(true));
});

test("CA-8: depois do envio entram custos e evidências de etapas posteriores, sem mexer na definição", () => {
  let ag = submeterEvidenciaDemanda(base(), entrada("criterios_aceite"), autora, em);
  ag = { ...ag, demanda: { ...ag.demanda, enviada: true, estado: "gate_demanda" } };
  const antes = ag.evidencias[0];
  ag = submeterEvidenciaDemanda(ag, entrada("custos_realizados"), outra, em);
  ag = submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { ticket_id: 1 }), outra, em);
  ag = submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { rodada_id: 1 }), outra, em);
  assert.equal(ag.evidencias.length, 4);
  assert.equal(ag.evidencias[0], antes);
});

test("CA-11: null explícito é dono demanda, conta no envio e substitui a versão omitida", () => {
  const nulos = { rodada_id: null, ticket_id: null };
  let ag = submeterEvidenciaDemanda(base(), entrada("criterios_aceite", nulos), autora, em);
  assert.equal(ag.evidencias[0]?.rodada_id, undefined);
  assert.equal(ag.evidencias[0]?.ticket_id, undefined);
  assert.deepEqual(pendentesDeEnvio(ag), ["desenho_solucao", "custos_realizados"]);
  ag = submeterEvidenciaDemanda(ag, entrada("criterios_aceite", {}, 2), autora, em);
  ag = submeterEvidenciaDemanda(ag, entrada("criterios_aceite", nulos, 3), autora, em);
  assert.deepEqual(
    ag.evidencias.map((e) => e.dados),
    [{ v: 3 }],
  );
  const doTicket = submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { rodada_id: null, ticket_id: 1 }), autora, em);
  assert.equal(doTicket.evidencias.length, 2);
  assert.throws(
    () => submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { rodada_id: 1, ticket_id: 1 }), autora, em),
    ErroDeRegra,
  );
});

test("plano não entra pelo envio genérico, nem antes nem depois do envio", () => {
  for (const enviada of [false, true]) {
    const ag = base(enviada);
    assert.throws(() => submeterEvidenciaDemanda(ag, entrada("plano", { ticket_id: 1 }), autora, em), ErroDeEscopo);
  }
});
