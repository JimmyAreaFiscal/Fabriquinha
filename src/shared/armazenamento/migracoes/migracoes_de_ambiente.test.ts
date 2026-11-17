// A migração do slot sobre um banco com Ambientes antigos: a linha segue como estava, com o slot nulo, e o slot é único só
// entre os que não foram eliminados.
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { migrarBancoDaFabriquinha } from "../../../server/system/banco_da_fabriquinha.ts";
import { VERSAO_DO_SLOT_DO_AMBIENTE } from "./migracoes_de_ambiente.ts";

const CRIADO_EM_DOS_AMBIENTES = "2026-01-01T00:00:00.000Z";

const inserirAmbiente = (banco: DatabaseSync, id: string, estado: string, slot?: number) => {
  const alocadoPara = estado === "alocado" ? `'${id}-dono'` : "NULL";
  const [colunaDoSlot, valorDoSlot] = slot === undefined ? ["", ""] : [", slot", `, ${String(slot)}`];
  banco.exec(
    `INSERT INTO ambiente (id, container_id, imagem, estado, alocado_para, criado_em${colunaDoSlot})
     VALUES ('${id}', 'c-${id}', 'alpine', '${estado}', ${alocadoPara}, '${CRIADO_EM_DOS_AMBIENTES}'${valorDoSlot})`,
  );
};

test("a migração acrescenta o slot sem perder linha, nulo nos Ambientes que existem", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco, VERSAO_DO_SLOT_DO_AMBIENTE - 1);
  inserirAmbiente(banco, "a1", "alocado");
  inserirAmbiente(banco, "a2", "eliminado");

  migrarBancoDaFabriquinha(banco);

  assert.deepEqual(
    banco
      .prepare("SELECT id, slot FROM ambiente ORDER BY id")
      .all()
      .map((linha) => ({ ...linha })),
    [
      { id: "a1", slot: null },
      { id: "a2", slot: null },
    ],
  );
  banco.close();
});

test("o slot é único entre os Ambientes vivos: o do eliminado volta a servir, e o nulo repete", () => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);

  inserirAmbiente(banco, "b1", "livre", 1);
  assert.throws(() => {
    inserirAmbiente(banco, "b2", "livre", 1);
  }, /UNIQUE/);
  banco.exec("UPDATE ambiente SET estado = 'eliminado' WHERE id = 'b1'");
  inserirAmbiente(banco, "b3", "livre", 1);
  inserirAmbiente(banco, "b4", "livre");
  inserirAmbiente(banco, "b5", "livre");
  assert.throws(() => {
    inserirAmbiente(banco, "b6", "livre", 0);
  }, /CHECK/);
  banco.close();
});
