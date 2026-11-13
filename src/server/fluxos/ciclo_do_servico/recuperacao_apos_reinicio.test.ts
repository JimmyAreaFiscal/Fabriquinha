// O fluxo da recuperação depois do reinício: a ordem dos domínios e o conjunto de sandboxes fora do ar, que não impede a
// recuperação dos processos. O que cada domínio recupera é testado nele (conjunto de Ambientes, condutor).
import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { abrirBancoTemporario } from "../../../../apoio-testes/banco/banco_temporario.ts";
import type { ConjuntoDeAmbientes } from "../../../modulos/ambiente/publico.ts";
import { condutor } from "../../../modulos/ciclo_de_vida/publico.ts";
import { recuperacaoDaSubida, recuperarAposReinicio } from "./recuperacao_apos_reinicio.ts";

/** Anota a ordem: o Ambiente pelo conjunto de sandboxes, Sessões e o Ciclo de Vida pelo condutor. */
function anotarAOrdem(t: TestContext, reconciliarAsSandboxes: () => Promise<void>) {
  const ordem: string[] = [];
  const conjuntoDeSandboxes = {
    reconciliarNaSubida: async () => {
      await reconciliarAsSandboxes();
      ordem.push("ambiente");
    },
  } as unknown as ConjuntoDeAmbientes;
  const recuperarOsProcessos = t.mock.method(condutor, "recuperarNaSubida", () => {
    ordem.push("sessoes e ciclo de vida");
  });
  return { ordem, conjuntoDeSandboxes, recuperarOsProcessos };
}

test("o Ambiente reconcilia as sandboxes antes de Sessões e o Ciclo de Vida recuperarem os processos", async (t) => {
  const { banco } = abrirBancoTemporario();
  const { ordem, conjuntoDeSandboxes, recuperarOsProcessos } = anotarAOrdem(t, () => Promise.resolve());
  const erros: unknown[] = [];
  await recuperarAposReinicio(banco, conjuntoDeSandboxes, (erro) => erros.push(erro));
  assert.deepEqual(erros, []);
  assert.deepEqual(ordem, ["ambiente", "sessoes e ciclo de vida"]);
  assert.deepEqual(recuperarOsProcessos.mock.calls[0]?.arguments, [banco, recuperacaoDaSubida]);
  banco.close();
});

test("o conjunto de sandboxes fora do ar vai ao registro de erro, e os processos se recuperam assim mesmo", async (t) => {
  const { banco } = abrirBancoTemporario();
  const foraDoAr = new Error("docker fora do ar");
  const { ordem, conjuntoDeSandboxes } = anotarAOrdem(t, () => Promise.reject(foraDoAr));
  const erros: unknown[] = [];
  await recuperarAposReinicio(banco, conjuntoDeSandboxes, (erro) => erros.push(erro));
  assert.deepEqual([erros, ordem], [[foraDoAr], ["sessoes e ciclo de vida"]]);
  banco.close();
});
