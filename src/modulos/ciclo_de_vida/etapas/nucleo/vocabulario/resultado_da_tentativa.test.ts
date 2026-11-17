import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../../../../../shared/nucleo/demanda/ator.ts";
import { ErroDeReprovacao, ErroDeRegra, ErroExterno } from "../../../../../shared/nucleo/erros.ts";
import {
  falhaDoErro,
  falhaInterrompidaPeloAuditor,
  falhaPorServicoReiniciado,
  falhaQueExigeOAuditor,
  resultadoDoErro,
  rotuloDaCausa,
} from "./resultado_da_tentativa.ts";

test("o rótulo da causa: o reinício tem o seu; as demais falhas de ambiente, o mesmo", () => {
  assert.equal(rotuloDaCausa("servico_reiniciado"), "serviço reiniciado");
  for (const causa of [
    "tempo_limite",
    "cota",
    "modelo_sem_resposta",
    "comando_ausente",
    "servico_externo_inacessivel",
    "sandbox_caiu",
  ] as const) {
    assert.equal(rotuloDaCausa(causa), "falha de infraestrutura");
  }
  assert.equal(falhaPorServicoReiniciado.motivo, "serviço reiniciado");
  assert.deepEqual(falhaInterrompidaPeloAuditor, {
    tipo: "interrompida",
    por: AUDITOR,
    motivo: "interrompida pelo Auditor",
  });
});

test("o erro vira resultado num ponto só: reprovação, infraestrutura ou falha que pede o Auditor", () => {
  const reprovado = new ErroDeReprovacao("o commit foi rejeitado", "corrija");
  assert.deepEqual(resultadoDoErro(reprovado), { tipo: "reprovacao", motivo: reprovado.message });
  const externo = new ErroExterno("o gh não respondeu", "confira o gh");
  assert.deepEqual(falhaDoErro(externo), {
    tipo: "falha_infraestrutura",
    causa: "servico_externo_inacessivel",
    motivo: `falha de infraestrutura: ${externo.message}`,
  });
  assert.deepEqual(resultadoDoErro(externo), falhaDoErro(externo));
  const regra = new ErroDeRegra("regra", "orientação");
  assert.deepEqual(falhaDoErro(regra), falhaQueExigeOAuditor(regra.message));
  assert.deepEqual(falhaDoErro("texto solto"), { tipo: "interrompida", por: FABRIQUINHA, motivo: "texto solto" });
  assert.equal(falhaQueExigeOAuditor("x".repeat(3000)).motivo.length, 2000);
});

test("o sandbox caído (docker parado, container parado ou sumido) é falha de infraestrutura, mesmo num erro de regra", () => {
  for (const relato of [
    "docker build falhou: Cannot connect to the Docker daemon at unix:///var/run/docker.sock (confira se o Docker está rodando)",
    "Error response from daemon: container 4f2a9c is not running",
    "Error response from daemon: No such container: 4f2a9c",
  ]) {
    const falha = { tipo: "falha_infraestrutura", causa: "sandbox_caiu", motivo: `falha de infraestrutura: ${relato}` };
    assert.deepEqual(falhaDoErro(new ErroDeRegra(relato)), falha);
    assert.deepEqual(resultadoDoErro(new Error(relato)), falha);
  }
  assert.equal(falhaDoErro(new ErroDeRegra("o docker build falhou: sem espaço em disco")).tipo, "interrompida");
});
