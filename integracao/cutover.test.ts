// Cutover (I-245, CA-1 a CA-4): a subida do serviço migra as issues legadas para demandas I-<n> e recusa a que não migra.
// Base legada numa raiz temporária (a fixture do backfill), serviço na porta 0; nunca o banco real.
import assert from "node:assert/strict";
import { mkdtempSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";
import { iniciarServico } from "../src/execucao/servico.ts";
import { montarFixture } from "../src/persistencia/fixture_backfill.test.ts";
import { base } from "./apoio.ts";

beforeEach(() => {
  process.env.FABRIQUINHA_PORTA = "0";
});

const contar = (banco: DatabaseSync, sql: string) => Number(banco.prepare(sql).get()?.n);

/** Raiz com a base legada da fixture (I-1 a I-10); `ajustar` mexe nela antes de salvar. */
function raizLegada(ajustar?: (b: DatabaseSync) => void): string {
  const raiz = realpathSync(mkdtempSync(join(base, "cutover-")));
  const origem = montarFixture();
  // A execução em andamento da instância anterior, que a subida encerra, precisa de uma sessão válida do pi.
  origem.exec(`UPDATE execucao SET sessao_pi = '${crypto.randomUUID()}' WHERE id = 4`);
  ajustar?.(origem);
  origem.exec(`VACUUM INTO '${join(raiz, "fabriquinha.db")}'`);
  origem.close();
  return raiz;
}

test("CA-1, CA-2: a subida vira demandas I-<n> sem mexer no legado, e a segunda subida não duplica", async () => {
  const raiz = raizLegada();
  const s = await iniciarServico(raiz);
  const legado = (b: DatabaseSync) => JSON.stringify(b.prepare("SELECT id, fase FROM issue ORDER BY id").all());
  const tickets = (b: DatabaseSync) => contar(b, "SELECT count(*) AS n FROM ticket");
  const antes = { issues: legado(s.banco), tickets: tickets(s.banco) };
  assert.equal(contar(s.banco, "SELECT count(*) AS n FROM demanda"), 10);
  assert.deepEqual(
    s.banco
      .prepare("SELECT id, fase FROM demanda WHERE id IN ('I-1', 'I-6', 'I-7', 'I-5') ORDER BY id")
      .all()
      .map((d) => [d.id, d.fase]),
    [
      ["I-1", "concluida"],
      ["I-5", "execucao"],
      ["I-6", "registro"],
      ["I-7", "planejamento"],
    ],
  );
  const migradas = contar(s.banco, "SELECT count(*) AS n FROM rodada");
  await s.parar();

  const segunda = await iniciarServico(raiz);
  assert.equal(contar(segunda.banco, "SELECT count(*) AS n FROM demanda"), 10);
  assert.equal(contar(segunda.banco, "SELECT count(*) AS n FROM rodada"), migradas);
  assert.equal(legado(segunda.banco), antes.issues);
  assert.equal(tickets(segunda.banco), antes.tickets);
  await segunda.parar();
});

test("CA-3: sessão interativa aberta recusa a subida citando cada issue, sem criar demanda", async () => {
  const raiz = raizLegada((b) => {
    b.exec("UPDATE ticket SET status = 'em_execucao', enviado_em = NULL WHERE id IN (12, 14)");
  });
  await assert.rejects(iniciarServico(raiz), (erro: Error) => {
    assert.match(erro.message, /I-6: a sessão do ticket T-12 está aberta.*envie a sessão ou cancele a issue/);
    assert.match(erro.message, /I-7: a sessão do ticket T-14 está aberta/);
    return true;
  });
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  assert.equal(contar(banco, "SELECT count(*) AS n FROM demanda"), 0);
  banco.close();
});

test("CA-4: issue sem ticket de desenho recusa a subida citando a issue e o motivo, sem criar demanda", async () => {
  const raiz = raizLegada((b) => {
    b.exec("UPDATE ticket SET etapa = 'registro' WHERE id = 17");
  });
  await assert.rejects(iniciarServico(raiz), /I-8.*não tem ticket de desenho/);
  const banco = new DatabaseSync(join(raiz, "fabriquinha.db"));
  assert.equal(contar(banco, "SELECT count(*) AS n FROM demanda"), 0);
  banco.close();
});
