import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  exigirAutoria,
  pendentesDeEnvio,
  submeterEvidenciaDemanda,
  TipoEvidenciaDemanda,
} from "./evidencia_demanda.ts";

const em = "2026-01-01T00:00:00Z";
const autora = { ferramenta: "claude", sessao: "s1" };
const outra = { ferramenta: "claude", sessao: "s2" };
const base = (enviada = false): AgregadoDemanda => ({
  demanda: {
    id: "I-1",
    projeto: "p",
    titulo: "t",
    tipo: "funcionalidade",
    descricao: "d",
    fase: enviada ? "aprovacao_demanda" : "registro",
    fase_alterada_em: em,
    origem_ferramenta: "claude",
    origem_sessao: "s1",
    enviada,
    branch: "fabriquinha/I-1",
  },
  tickets: [{ demanda_id: "I-1", ticket_id: 1, etapa: "demanda", status: "aberto", status_alterado_em: em }],
  decisoes: [],
  evidencias: [],
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
    exigirAutoria(ag.demanda, { ferramenta: "pi", sessao: "s1" }, "editar");
  }, ErroDeEscopo);
  assert.deepEqual(ag, base());
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
  ag = { ...ag, demanda: { ...ag.demanda, enviada: true, fase: "aprovacao_demanda" } };
  const antes = ag.evidencias[0];
  ag = submeterEvidenciaDemanda(ag, entrada("custos_realizados"), outra, em);
  ag = submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { ticket_id: 1 }), outra, em);
  ag = submeterEvidenciaDemanda(ag, entrada("mensagem_pr", { rodada_id: 1 }), outra, em);
  assert.equal(ag.evidencias.length, 4);
  assert.equal(ag.evidencias[0], antes);
});
