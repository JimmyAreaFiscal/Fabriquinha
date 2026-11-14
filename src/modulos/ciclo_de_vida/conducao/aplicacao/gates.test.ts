// decidirGate, o ponto de entrada único dos gates do motor (todos menos o da demanda): a entrada reprovada pela regra não muda o banco e o erro é o do ensaio do núcleo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  abrirTrabalhoDoAgente,
  agregadoComPullRequestAberto,
  agregadoEmRevisao,
  agregadoNoEstado,
  cadastrarProjetoLoja,
  cenarioRevisao,
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  REF_GLOBAL,
  REF_RODADA,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { type AgregadoDemanda, carregarDemanda } from "../../processo/publico.ts";
import { type Ator, AUDITOR, Endereco, type NomeGate } from "../../etapas/publico.ts";
import { GATES, decidirGate } from "./gates.ts";
import { relogioFixo } from "../../../../shared/nucleo/relogio.ts";
import { modulosDoCicloDeTeste } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

// O Gate da demanda decide-se pelo fluxo do cancelamento em cascata, que tem o mesmo caso no teste dele.
interface CasoDeEntradaReprovada {
  nome: Exclude<NomeGate, "gate_demanda">;
  agregado: AgregadoDemanda;
  endereco: Endereco;
  entrada: unknown;
  ator: (banco: ReturnType<typeof abrirBancoTemporario>["banco"]) => Ator;
}

const casos: CasoDeEntradaReprovada[] = [
  {
    nome: "gate_planejamento",
    agregado: agregadoNoEstado("I-1", "gate_planejamento"),
    endereco: Endereco.daDemanda("I-1"),
    entrada: { resultado: "aprovado" },
    ator: () => AUDITOR,
  },
  {
    nome: "gate_pr",
    agregado: agregadoComPullRequestAberto("I-1"),
    endereco: Endereco.daRodada("I-1", 2),
    entrada: { resultado: "aprovado" },
    ator: () => AUDITOR,
  },
  {
    nome: "gate_revisao_rodada",
    agregado: agregadoEmRevisao(),
    endereco: Endereco.daRodada("I-1", 1),
    entrada: { resultado: "reprovado", motivo: "corrigir", correcoes: [] },
    ator: (banco) => abrirTrabalhoDoAgente(banco, REF_RODADA),
  },
  {
    nome: "gate_revisao_demanda",
    agregado: agregadoEmRevisao({ integral: true }),
    endereco: Endereco.daDemanda("I-1"),
    entrada: { resultado: "reprovado", motivo: "corrigir" },
    ator: (banco) => abrirTrabalhoDoAgente(banco, REF_GLOBAL),
  },
];

test("CA-4: o gate de revisão da rodada grava o instante do Relogio injetado", async () => {
  const { banco } = await cenarioRevisao();
  const instante = "2030-03-04T05:06:07.000Z";
  const correcao = {
    demanda_id: "I-1",
    ticket_id: 1,
    rodada_id: 1,
    titulo: "corrige",
    descricao: "d",
    arquivos_previstos: [],
    depende: [],
  };
  const { demanda } = await decidirGate(
    modulosDoCicloDeTeste(banco),
    "gate_revisao_rodada",
    Endereco.daRodada("I-1", 1),
    { resultado: "reprovado", motivo: "corrigir", correcoes: [correcao] },
    abrirTrabalhoDoAgente(banco, REF_RODADA),
    relogioFixo(instante),
  );
  assert.ok(demanda.rodadas.some((r) => r.estado_alterado_em === instante));
});

for (const { nome, agregado, endereco, entrada, ator } of casos) {
  test(`${nome}: a entrada reprovada pela regra não muda o banco e o erro é o do ensaio do núcleo`, async () => {
    const { banco } = abrirBancoTemporario();
    cadastrarProjetoLoja(banco);
    gravarAgregadoPronto(banco, agregado);
    const decisor = ator(banco);
    const antes = carregarDemanda(banco, "I-1");

    let esperado: unknown;
    try {
      GATES[nome].regra.ensaiar(antes, endereco, entrada, decisor, { agora: INSTANTE_DO_CENARIO });
    } catch (erro) {
      esperado = erro;
    }
    assert.ok(esperado, "o ensaio do núcleo devia reprovar a entrada");

    await assert.rejects(decidirGate(modulosDoCicloDeTeste(banco), nome, endereco, entrada, decisor), (erro) => {
      assert.deepEqual(erro, esperado);
      return true;
    });
    assert.deepEqual(carregarDemanda(banco, "I-1"), antes);
  });
}
