import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backfillDemandas } from "./backfill_demanda.ts";
import { abrir } from "./banco.ts";
import { carregarDemanda } from "./demandas.ts";

const origem = process.env.FABRIQUINHA_BANCO_COPIA;
const sha256 = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");

// ponytail: pulado sem a variável; a prova no banco real é manual e roda sobre uma cópia.
test("CA-15: backfill sobre a cópia do banco real", { skip: origem === undefined }, () => {
  const original = origem ?? "";
  const raiz = mkdtempSync(join(tmpdir(), "backfill-real-"));
  const hashAntes = sha256(original);
  const banco = (() => {
    copyFileSync(original, join(raiz, "fabriquinha.db"));
    if (existsSync(`${original}-wal`)) copyFileSync(`${original}-wal`, join(raiz, "fabriquinha.db-wal"));
    return abrir(raiz);
  })();
  try {
    const encerradas = banco
      .prepare(
        "SELECT 'I-' || id AS id FROM issue WHERE fase = 'concluida' OR cancelada_em IS NOT NULL ORDER BY issue.id",
      )
      .all()
      .map((l) => l.id as string);
    const emAndamento = banco
      .prepare(
        "SELECT 'I-' || id AS id FROM issue WHERE NOT (fase = 'concluida' OR cancelada_em IS NOT NULL) ORDER BY issue.id",
      )
      .all()
      .map((l) => l.id as string);

    const primeira = backfillDemandas(banco);
    const demandas = banco
      .prepare("SELECT id FROM demanda ORDER BY CAST(substr(id, 3) AS INTEGER)")
      .all()
      .map((l) => l.id as string);
    assert.deepEqual(demandas, encerradas);
    assert.deepEqual(primeira.naoMigradas.map((n) => n.issue).sort(), [...emAndamento].sort());
    for (const n of primeira.naoMigradas) assert.equal(n.motivo, "em andamento");
    for (const id of demandas) assert.equal(carregarDemanda(banco, id).demanda.id, id);

    const segunda = backfillDemandas(banco);
    assert.deepEqual(segunda.antes, primeira.depois);
    assert.deepEqual(segunda.depois, primeira.depois);
    assert.equal(sha256(original), hashAntes);
    console.log(
      JSON.stringify({
        encerradas: encerradas.length,
        emAndamento: emAndamento.length,
        sha256: hashAntes,
        antes: primeira.antes,
        depois: primeira.depois,
        dependenciasPendentes: primeira.dependenciasPendentes.length,
      }),
    );
  } finally {
    banco.close();
    rmSync(raiz, { recursive: true, force: true });
  }
});
