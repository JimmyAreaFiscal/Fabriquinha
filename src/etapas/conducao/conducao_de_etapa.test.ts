// A base das conduções: o endereço que ela aceita (os passos da condução determinística são cobertos pela `ConducaoDeEncerrarDemanda`).
import assert from "node:assert/strict";
import { type TestContext, test } from "node:test";
import { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { configuracao } from "../../compartilhado/armazenamento/servico.ts";
import { anotar } from "../../compartilhado/infra/registro.ts";
import { cenarioRevisao } from "../../../apoio-testes/cenarios_de_demanda.ts";
import { relogioFixo } from "../../compartilhado/nucleo/relogio.ts";

const RELOGIO = relogioFixo("2026-01-01T00:00:00.000Z");
import { condutor } from "../../trabalho_agentico/aplicacao/trabalho/condutor.ts";
import { ConducaoDeRevisarDemanda } from "../revisar_demanda/conducao_de_revisar_demanda.ts";

test("só se conduz o endereço de um ticket", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const conducao = new ConducaoDeRevisarDemanda({ banco, relogio: RELOGIO, condutor, registro: anotar });
  await assert.rejects(conducao.conduzir(Endereco.daRodada("I-1", 1)), /I-1.R1 não é um ticket/);
});

test("o limite informado nas deps é o que o agente recebe; sem ele vale o timeoutMin da configuração", async (t: TestContext) => {
  const iniciar = condutor.iniciar.bind(condutor);
  const limites: number[] = [];
  t.mock.method(condutor, "iniciar", (pedido: Parameters<typeof iniciar>[0]) => {
    limites.push(pedido.limiteMin);
    return iniciar(pedido);
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
    }).conduzir(Endereco.doTicket("I-1", 3));
  }
  assert.deepEqual(limites, [0.5, timeoutDaConfiguracao]);
});
