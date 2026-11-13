// O fluxo da recuperação depois do reinício: as Sessões montadas na subida matam os processos da instância anterior, e o
// Ciclo de Vida falha os tickets sem processo. A conferência das sandboxes vem antes, na montagem da gestão de Ambientes
// (o teste dela), e o que cada domínio recupera é testado nele.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import { condutor } from "../../../modulos/ciclo_de_vida/publico.ts";
import { recuperarAposReinicio } from "./recuperacao_apos_reinicio.ts";

test("a subida mata os processos da instância anterior pelas Sessões e devolve as Sessões montadas", async (t) => {
  const { banco } = abrirBancoTemporario();
  const matarOsProcessos = t.mock.method(condutor, "matarProcessosDaInstanciaAnterior", () => Promise.resolve());
  const sessoes = await recuperarAposReinicio(banco);
  assert.deepEqual(matarOsProcessos.mock.calls[0]?.arguments, [banco]);
  assert.deepEqual(sessoes.listar(), []);
  banco.close();
});
