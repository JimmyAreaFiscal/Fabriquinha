// A montagem do Ciclo de Vida: o "Executar agora" com a liberação de Demandas, a montagem sem a gestão de Ambientes e a
// subida, que mata os processos da instância anterior pelas Sessões antes de falhar os tickets sem processo.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import {
  agregadoNoEstado,
  cadastrarProjetoLoja,
  gravarAgregadoPronto,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { registrarDependencia } from "../../../../../apoio-testes/demandas_de_teste.ts";
import { cicloDeVidaDeTeste } from "../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { comSessoesDoContexto, motorDoBanco } from "../../../../../apoio-testes/sessoes_de_teste.ts";
import { recuperarAposReinicio } from "../../../../../apoio-testes/ciclo_de_vida/ciclo_de_vida_de_teste.ts";
import { demandasDoCicloDeVida, montarCicloDeVidaDoBanco } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { Endereco } from "../../etapas/publico.ts";

test("o Executar agora só aceita o planejar do pedido cujas predecessoras concluíram", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "gate_planejamento")); // sem ticket aberto
  gravarAgregadoPronto(banco, agregadoNoEstado("I-2", "planejar"));
  banco.prepare("UPDATE demanda SET enviada = 0 WHERE id = 'I-2'").run(); // a dependência só se registra antes do envio
  registrarDependencia(banco, "I-2", "I-1");
  banco.prepare("UPDATE demanda SET enviada = 1 WHERE id = 'I-2'").run();
  assert.deepEqual(demandasDoCicloDeVida(banco).predecessorasPendentes(["I-2"]), new Map([["I-2", ["I-1"]]]));
  assert.deepEqual(cicloDeVidaDeTeste(banco).executarAgora({ demanda_id: "I-2", ticket_id: 2 }), {
    tipo: "dependencia_pendente",
    aguarda: [Endereco.daDemanda("I-1")],
  });
  banco.close();
});

test("sem a gestão de Ambientes, a montagem recusa interromper a execução aberta da demanda cancelada", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "planejar"));
  const ref = { demanda_id: "I-1", ticket_id: 1 };
  comSessoesDoContexto(banco, ref, (x) => ({
    ...x,
    sessoes: [{ id: "s1", ...ref, modo: "autonomo", conversa_referencia: "c" }],
    execucoes: [{ id: "e-s1", trabalho_id: "s1", inicio: "2026-01-01T00:00:00.000Z", falha: false }],
  }));
  const cascata = montarCicloDeVidaDoBanco(banco).cancelar("I-1", []);
  assert.deepEqual(cascata.canceladas, ["I-1"]);
  assert.throws(() => {
    cascata.interromperExecucoes();
  }, /não tem a gestão de Ambientes/);
  banco.close();
});

test("a subida mata os processos da instância anterior pelas Sessões e devolve as Sessões montadas", async (t) => {
  const { banco } = abrirBancoTemporario();
  const matarOsProcessos = t.mock.method(motorDoBanco(banco), "matarProcessosDaInstanciaAnterior", () =>
    Promise.resolve(),
  );
  const sessoes = await recuperarAposReinicio(banco);
  assert.deepEqual(matarOsProcessos.mock.calls[0]?.arguments, [banco]);
  assert.deepEqual(sessoes.listar(), []);
  banco.close();
});

test("os estados vêm na ordem pedida, sem as demandas que não têm processo", () => {
  const { banco } = abrirBancoTemporario();
  cadastrarProjetoLoja(banco);
  gravarAgregadoPronto(banco, agregadoNoEstado("I-1", "planejar"));
  gravarAgregadoPronto(banco, agregadoNoEstado("I-2", "gate_planejamento"));
  const estados = montarCicloDeVidaDoBanco(banco).estados(["I-2", "I-9", "I-1"]);
  assert.deepEqual(
    [...estados].map(([id, { estado }]) => [id, estado]),
    [
      ["I-2", "gate_planejamento"],
      ["I-1", "planejar"],
    ],
  );
  banco.close();
});
