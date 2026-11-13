import assert from "node:assert/strict";
import { test } from "node:test";
import type { AgregadoDemanda } from "../../processo/publico.ts";
import { comEvidencia } from "../../../../../apoio-testes/cenarios_de_demanda.ts";
import { type Ator, FABRIQUINHA, TIPOS_DA_DEMANDA } from "../../etapas/publico.ts";
import { pendentesDeEnvio } from "./evidencia_demanda.ts";

const em = "2026-01-01T00:00:00Z";
const autora: Ator = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
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
  arquivos_previstos_rodada: [],
  arquivos_previstos_demanda: [],
  versoes_plano: [],
  pull_requests: [],
});
test("catálogo: obrigatórias e opcionais da demanda", () => {
  assert.equal(TIPOS_DA_DEMANDA.length, 6);
  assert.deepEqual(pendentesDeEnvio(base()), ["criterios_aceite", "desenho_solucao"]);
  const ag = comEvidencia(base(), { tipo: "desenho_solucao", dados: { v: 1 } }, autora, em);
  assert.deepEqual(pendentesDeEnvio(ag), ["criterios_aceite"]);
});

test("pendentesDeEnvio só conta evidência do dono demanda", () => {
  const ag = comEvidencia(base(), { tipo: "criterios_aceite", dados: { v: 1 }, ticket_id: 1 }, autora, em);
  assert.deepEqual(pendentesDeEnvio(ag), ["criterios_aceite", "desenho_solucao"]);
  assert.deepEqual(pendentesDeEnvio(comEvidencia(ag, { tipo: "criterios_aceite", dados: { v: 1 } }, autora, em)), [
    "desenho_solucao",
  ]);
});
