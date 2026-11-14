// A rota das Etapas do SDLC, com o corpo conferido pelo contrato.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { servir } from "../../../../../apoio-testes/servidor_web_de_teste.ts";
import { CATALOGO_DE_ETAPAS } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_internos.ts";
import { EtapasDoSdlc } from "../contrato/etapas.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

test("GET /api/etapas devolve as Etapas do catálogo, na ordem dele, com os textos das telas e o Gate", async () => {
  const { pedir } = await servir(abrirBancoTemporario().banco);
  const r = await pedir("/api/etapas");
  assert.equal(r.status, 200);
  const { etapas, ordem, estados } = EtapasDoSdlc.parse(r.json());
  assert.deepEqual(
    etapas.map((etapa) => etapa.nome),
    Object.keys(CATALOGO_DE_ETAPAS),
  );
  const planejar = etapas.find((etapa) => etapa.papel === "planeja_a_demanda");
  assert.equal(planejar?.exibicao.acao, "Planejar");
  assert.deepEqual(planejar.gate, {
    nome: "gate_planejamento",
    rotulo: "aprovação do planejamento",
    esperaEmEstadoProprio: true,
  });
  assert.equal(
    etapas.find((etapa) => etapa.exibicao.comoEstado === undefined)?.exibicao.rotulo,
    "Resolução de conflito",
  );
  assert.ok(ordem.demanda.includes("em_execucao"));
  assert.deepEqual(estados.rodada.at(-1), "concluida");
  assert.equal((await pedir("/api/etapas", { cookie: false })).status, 401);
});
