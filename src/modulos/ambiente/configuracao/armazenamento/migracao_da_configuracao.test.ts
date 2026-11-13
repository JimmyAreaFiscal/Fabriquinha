// As migrações do Ambiente sobre bancos com a Configuração do Ambiente gravada: a 54 leva os valores da `configuracao`
// para a tabela própria do Ambiente, e a do conjunto fixo ou variável dá a ele o tipo e os limites, com o padrão que mantém o que ele já fazia.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../../server/composicao/banco_da_fabriquinha.ts";
import { configuracaoDoAmbiente } from "./configuracao_do_ambiente.ts";
import { MIGRACOES_DO_AMBIENTE, VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL } from "./migracao_da_configuracao.ts";

const versaoDo = (banco: DatabaseSync) => banco.prepare("PRAGMA user_version").get()?.user_version;

test("a 54 leva a Configuração do Ambiente gravada para configuracao_ambiente e não muda a configuracao", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, 53);
  banco.exec(`UPDATE configuracao SET ambiente_tipo = 'container', ambiente_memoria_maxima_mb = 4096, ambiente_cpus = 1.5,
    ambiente_ociosidade_para_eliminar_min = 30, limite_paralelismo = 7`);
  const configuracaoAntes = { ...banco.prepare("SELECT * FROM configuracao").get() };

  migrarBancoDaFabriquinha(banco, 54);

  assert.equal(versaoDo(banco), 54);
  assert.deepEqual(
    {
      ...banco
        .prepare("SELECT tipo, memoria_maxima_mb, cpus, ociosidade_para_eliminar_min FROM configuracao_ambiente")
        .get(),
    },
    { tipo: "container", memoria_maxima_mb: 4096, cpus: 1.5, ociosidade_para_eliminar_min: 30 },
  );
  assert.deepEqual({ ...banco.prepare("SELECT * FROM configuracao").get() }, configuracaoAntes);
  assert.deepEqual(
    MIGRACOES_DO_AMBIENTE.migracoes.map(({ versao }) => versao),
    [54, VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL],
  );
  banco.close();
});

test("a migração do conjunto mantém o gravado e dá ao conjunto o variável sem limite, o que ele já fazia: cria sob demanda e elimina os ociosos", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL - 1);
  banco.exec(`UPDATE configuracao_ambiente SET tipo = 'container', memoria_maxima_mb = 4096, cpus = 1.5,
    ociosidade_para_eliminar_min = 30`);

  migrarBancoDaFabriquinha(banco, VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL);

  assert.equal(versaoDo(banco), VERSAO_DO_CONJUNTO_FIXO_OU_VARIAVEL);
  assert.deepEqual(configuracaoDoAmbiente(banco), {
    tipo: "container",
    memoria_maxima_mb: 4096,
    cpus: 1.5,
    ociosidade_para_eliminar_min: 30,
    conjunto: "variavel",
    capacidade_do_conjunto: null,
    minimo_do_conjunto: 0,
  });
  for (const errada of [
    "conjunto = 'elastico'",
    "capacidade_do_conjunto = 0",
    "capacidade_do_conjunto = 1.5",
    "minimo_do_conjunto = -1",
    "minimo_do_conjunto = NULL",
  ])
    assert.throws(
      () => {
        banco.exec(`UPDATE configuracao_ambiente SET ${errada}`);
      },
      /constraint/i,
      errada,
    );
  banco.close();
});
