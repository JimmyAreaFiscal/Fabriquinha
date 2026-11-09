// Marco e conclusão da sessão de ajustes do PR reprovado (CA-13 da I-229): a recusa vem antes do marco e da sessão.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { AUDITOR } from "../nucleo/ator.ts";
import { ErroDeEscopo } from "../nucleo/erros.ts";
import { Endereco } from "../nucleo/item_de_trabalho.ts";
import { comDemanda } from "../armazenamento/demandas.ts";
import { cenarioDeAjustes, DEMANDA, MOTIVO, reprovarPRRodada } from "../../apoio-testes/cenario_de_ajustes.ts";
import { decidirGate } from "./gates/decidir_gate.ts";

test("CA-13: reprovar sem motivo, como agente ou fora do gate é reprovado sem gravar o marco nem abrir a sessão", async () => {
  const { ag, banco, marco, prompts } = await cenarioDeAjustes();

  await assert.rejects(reprovarPRRodada(banco, ""), /informe o motivo da reprovação/);
  await assert.rejects(reprovarPRRodada(banco, MOTIVO, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);
  assert.equal(ag().rodadas[0]?.estado, "gate_pr");
  assert.equal(existsSync(marco()), false);

  // A recusa do domínio (aqui, a rodada fora do gate) vem do ensaio, antes do marco.
  comDemanda(banco, DEMANDA, (a) => ({
    ...a,
    rodadas: a.rodadas.map((r) => ({ ...r, estado: "implementar" as const })),
  }));
  await assert.rejects(reprovarPRRodada(banco, MOTIVO));
  assert.equal(existsSync(marco()), false);
  assert.deepEqual(ag().decisoes, []);
  assert.deepEqual(prompts(), []);
});

test("rodada sem PR publicado não reprova", async () => {
  const { banco, ag } = await cenarioDeAjustes();
  banco.prepare("DELETE FROM pull_request").run();
  await assert.rejects(reprovarPRRodada(banco, MOTIVO), /não tem PR publicado/);
  assert.deepEqual(ag().decisoes, []);
});

test("o endereço da demanda não reprova o PR, que é da rodada", async () => {
  const { banco, marco } = await cenarioDeAjustes();
  await assert.rejects(
    decidirGate(banco, "gate_pr", Endereco.daDemanda(DEMANDA), { resultado: "reprovado", motivo: MOTIVO }, AUDITOR),
    /não é de uma rodada/,
  );
  assert.equal(existsSync(marco()), false);
});
