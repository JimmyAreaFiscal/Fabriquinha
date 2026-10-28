import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { backfillDemandas } from "./backfill_demanda.ts";
import { abrir } from "./banco.ts";
import { carregarDemanda } from "./demandas.ts";

const origem = process.env.FABRIQUINHA_BANCO_COPIA;
const sha256 = (arquivo: string) => createHash("sha256").update(readFileSync(arquivo)).digest("hex");

// ponytail: pulado sem a variável; a prova no banco real é manual e roda sobre uma cópia.
test("CA-14: backfill sobre a cópia do banco real", { skip: origem === undefined }, () => {
  const original = origem ?? "";
  const raiz = mkdtempSync(join(tmpdir(), "backfill-real-"));
  const hashAntes = sha256(original);
  const banco = (() => {
    copyFileSync(original, join(raiz, "fabriquinha.db"));
    if (existsSync(`${original}-wal`)) copyFileSync(`${original}-wal`, join(raiz, "fabriquinha.db-wal"));
    return abrir(raiz);
  })();
  try {
    const issues = banco
      .prepare("SELECT 'I-' || id AS id FROM issue ORDER BY id")
      .all()
      .map((l) => l.id as string);
    // Issue com PR do legado ou execução ativa recusa a migração inteira: a prova então é a recusa citando cada uma.
    let relatorio: ReturnType<typeof backfillDemandas> | undefined;
    let recusa: string | undefined;
    try {
      relatorio = backfillDemandas(banco);
    } catch (e) {
      if (!(e instanceof ErroDeRegra)) throw e;
      recusa = e.message;
    }
    if (relatorio) {
      const demandas = banco
        .prepare("SELECT id FROM demanda ORDER BY CAST(substr(id, 3) AS INTEGER)")
        .all()
        .map((l) => l.id as string);
      assert.deepEqual(demandas, issues);
      assert.deepEqual(relatorio.naoMigradas, []);
      for (const id of demandas) assert.equal(carregarDemanda(banco, id).demanda.id, id);
      const segunda = backfillDemandas(banco);
      assert.deepEqual(segunda.antes, relatorio.depois);
      assert.deepEqual(segunda.depois, relatorio.depois);
      assert.deepEqual(segunda.emVoo, relatorio.emVoo);
      assert.deepEqual(segunda.naoMigradas, relatorio.naoMigradas);
    } else {
      // A recusa cita cada issue bloqueada e deixa as tabelas novas como estavam.
      for (const bloqueada of recusa?.match(/I-\d+/g) ?? []) assert.ok(issues.includes(bloqueada));
      assert.ok(recusa?.match(/I-\d+/));
      assert.equal(banco.prepare("SELECT COUNT(*) AS n FROM demanda").get()?.n, 0);
    }
    assert.equal(sha256(original), hashAntes);
    console.log(
      JSON.stringify({
        issues: issues.length,
        sha256: hashAntes,
        recusa,
        antes: relatorio?.antes,
        depois: relatorio?.depois,
        migradas: relatorio ? issues : [],
        emVoo: relatorio?.emVoo,
      }),
    );
  } finally {
    banco.close();
    rmSync(raiz, { recursive: true, force: true });
  }
});
