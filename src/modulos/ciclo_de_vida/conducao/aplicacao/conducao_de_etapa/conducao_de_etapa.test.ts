// A base das conduções: o endereço que ela aceita (os passos da condução determinística são cobertos pela `ConducaoDeEncerrarDemanda`).
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Endereco } from "../../../etapas/publico.ts";
import { configuracao } from "../../../despacho/publico.ts";
import { anotar } from "../../../../../shared/infra/registro.ts";
import { cenarioRevisao } from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { relogioFixo } from "../../../../../shared/nucleo/relogio.ts";

const RELOGIO = relogioFixo("2026-01-01T00:00:00.000Z");
import { motorDoBanco } from "../../../../../../apoio-testes/sessoes_de_teste.ts";
import { ConducaoDeRevisarDemanda } from "../revisar_demanda/conducao_de_revisar_demanda.ts";
import { reservadoPeloDespacho } from "../../../../../../apoio-testes/reserva_do_despacho.ts";
import { modulosDoCicloDeTeste } from "../../../../../../apoio-testes/falsos/ambiente_falso.ts";

test("só se conduz o endereço de um ticket", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const conducao = new ConducaoDeRevisarDemanda({
    ...modulosDoCicloDeTeste(banco),
    relogio: RELOGIO,
    registro: anotar,
  });
  await assert.rejects(conducao.conduzir(Endereco.daRodada("I-1", 1)), /I-1.R1 não é um ticket/);
});

test("o limite informado nas deps é o que o agente recebe; sem ele vale o timeoutMin da configuração", async (t: TestContext) => {
  const limites: number[] = [];
  let timeoutDaConfiguracao = 0;
  for (const limiteMin of [0.5, undefined]) {
    const { banco } = await cenarioRevisao({ integral: true });
    const motor = motorDoBanco(banco);
    const lancarExecucao = motor.lancarExecucao.bind(motor);
    t.mock.method(motor, "lancarExecucao", (pedido: Parameters<typeof lancarExecucao>[0]) => {
      limites.push(pedido.limiteMin);
      return lancarExecucao(pedido);
    });
    timeoutDaConfiguracao = configuracao(banco).timeoutMin;
    await new ConducaoDeRevisarDemanda({
      ...modulosDoCicloDeTeste(banco),
      relogio: RELOGIO,
      registro: anotar,
      limiteMin,
    }).conduzir(reservadoPeloDespacho(banco, Endereco.doTicket("I-1", 3)));
  }
  assert.deepEqual(limites, [0.5, timeoutDaConfiguracao]);
});
