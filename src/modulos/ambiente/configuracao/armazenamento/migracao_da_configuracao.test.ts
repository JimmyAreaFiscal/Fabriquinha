// A migração 54 sobre um banco na versão 53 com a Configuração do Ambiente gravada: os valores passam à tabela própria do
// Ambiente, e a `configuracao` do serviço fica como estava.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { configuracaoDoAmbiente } from "./configuracao_do_ambiente.ts";
import { MIGRACOES_DO_AMBIENTE } from "./migracao_da_configuracao.ts";

test("a 54 leva a Configuração do Ambiente gravada para configuracao_ambiente e não muda a configuracao", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, 53);
  banco.exec(`UPDATE configuracao SET ambiente_tipo = 'container', ambiente_memoria_maxima_mb = 4096, ambiente_cpus = 1.5,
    ambiente_ociosidade_para_eliminar_min = 30, limite_paralelismo = 7`);
  const configuracaoAntes = { ...banco.prepare("SELECT * FROM configuracao").get() };

  migrarBancoDaFabriquinha(banco, 54);

  assert.equal(banco.prepare("PRAGMA user_version").get()?.user_version, 54);
  assert.deepEqual(configuracaoDoAmbiente(banco), {
    tipo: "container",
    memoria_maxima_mb: 4096,
    cpus: 1.5,
    ociosidade_para_eliminar_min: 30,
  });
  assert.deepEqual({ ...banco.prepare("SELECT * FROM configuracao").get() }, configuracaoAntes);
  assert.deepEqual(
    MIGRACOES_DO_AMBIENTE.migracoes.map(({ versao }) => versao),
    [54],
  );
  banco.close();
});
