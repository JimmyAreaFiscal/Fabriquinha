// O fluxo da recuperação depois do reinício: Sessões e o Ciclo de Vida recuperam os processos pelo condutor. A conferência
// das sandboxes vem antes, na montagem da gestão de Ambientes (o teste dela), e o que cada domínio recupera é testado nele.
import assert from "node:assert/strict";
import { test } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import { condutor } from "../../../modulos/ciclo_de_vida/publico.ts";
import { recuperacaoDaSubida, recuperarAposReinicio } from "./recuperacao_apos_reinicio.ts";

test("Sessões e o Ciclo de Vida recuperam os processos pelo condutor, com o que a subida recupera", async (t) => {
  const { banco } = abrirBancoTemporario();
  const recuperarOsProcessos = t.mock.method(condutor, "recuperarNaSubida", () => Promise.resolve());
  await recuperarAposReinicio(banco);
  assert.deepEqual(recuperarOsProcessos.mock.calls[0]?.arguments, [banco, recuperacaoDaSubida]);
  banco.close();
});
