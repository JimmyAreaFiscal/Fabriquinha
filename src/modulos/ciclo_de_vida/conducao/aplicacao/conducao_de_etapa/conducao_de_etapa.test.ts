// A base das conduções: o endereço que ela aceita (os passos da condução determinística são cobertos pela `ConducaoDeEncerrarDemanda`).
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Endereco } from "../../../etapas/publico.ts";
import { configuracao } from "../../../despacho/publico.ts";
import { anotar } from "../../../../../shared/infra/registro.ts";
import { cenarioRevisao } from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";

const RELOGIO = relogioFixo("2026-01-01T00:00:00.000Z");
import { condutor } from "../politica_dos_agentes/condutor.ts";
import { ConducaoDeRevisarDemanda } from "../revisar_demanda/conducao_de_revisar_demanda.ts";
import { reservadoPeloDespacho } from "../../../../../../apoio-testes/reserva_do_despacho.ts";

test("só se conduz o endereço de um ticket", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const conducao = new ConducaoDeRevisarDemanda({ banco, relogio: RELOGIO, condutor, registro: anotar });
  await assert.rejects(conducao.conduzir(Endereco.daRodada("I-1", 1)), /I-1.R1 não é um ticket/);
});

test("o limite informado nas deps é o que o agente recebe; sem ele vale o timeoutMin da configuração", async (t: TestContext) => {
  const lancarExecucao = condutor.lancarExecucao.bind(condutor);
  const limites: number[] = [];
  t.mock.method(condutor, "lancarExecucao", (pedido: Parameters<typeof lancarExecucao>[0]) => {
    limites.push(pedido.limiteMin);
    return lancarExecucao(pedido);
  });
  let timeoutDaConfiguracao = 0;
  for (const limiteMin of [0.5, undefined]) {
    const { banco } = await cenarioRevisao({ integral: true });
    timeoutDaConfiguracao = configuracao(banco).timeoutMin;
    await new ConducaoDeRevisarDemanda({
      banco,
      relogio: RELOGIO,
      condutor,
      registro: anotar,
      limiteMin,
    }).conduzir(reservadoPeloDespacho(banco, Endereco.doTicket("I-1", 3)));
  }
  assert.deepEqual(limites, [0.5, timeoutDaConfiguracao]);
});
