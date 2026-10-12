// Rotas das métricas (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { AUDITOR } from "../../dominio/agregado.ts";
import type { MetricasMes } from "../../metricas/periodo.ts";
import { abrir } from "../../persistencia/banco.ts";
import { registrarIssue } from "../../persistencia/issues.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../rotas.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-metricas-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  for (const nome of ["loja", "site"]) {
    registrarProjeto(banco, {
      nome,
      repo: `/repos/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "c", descricao: "d" }],
    });
  }
});

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(endereco: string): Promise<unknown> {
  const url = new URL(endereco, "http://x");
  for (const rota of ROTAS) {
    const params = rota.metodo === "GET" ? casar(rota.caminho, url.pathname) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date(), executarAgora: () => Promise.resolve() },
        params,
        query: url.searchParams,
        corpo: undefined,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
  }
  throw new Error(`GET ${endereco} não existe`);
}

const agora = new Date();
const mes = (n: number) => {
  const d = new Date(agora.getFullYear(), agora.getMonth() + n, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

test("GET /api/metricas: padrão nos 11 meses anteriores mais o corrente, de todos os projetos", async () => {
  registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  registrarIssue(banco, { projeto: "site" }, AUDITOR);
  const meses = (await chamar("/api/metricas")) as MetricasMes[];
  assert.deepEqual(
    meses.map((m) => m.mes),
    Array.from({ length: 12 }, (_, i) => mes(i - 11)),
  );
  assert.equal(meses.at(-1)?.projeto, null);
  assert.equal(meses.at(-1)?.issues.registradas, 2);
});

test("GET /api/metricas: de um projeto, de `de` a `ate`; só `ate` leva `de` 11 meses antes", async () => {
  registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  const [so] = (await chamar(`/api/metricas?projeto=site&de=${mes(0)}&ate=${mes(0)}`)) as MetricasMes[];
  assert.equal(so?.projeto, "site");
  assert.equal(so.issues.registradas, 0);
  const meses = (await chamar("/api/metricas?ate=2026-03")) as MetricasMes[];
  assert.deepEqual([meses[0]?.mes, meses.at(-1)?.mes, meses.length], ["2025-04", "2026-03", 12]);
});

test("GET /api/metricas: 422 para mês inválido, `de` depois de `ate` ou mais de 24 meses", async () => {
  for (const query of ["ate=2026-13", "de=2026-05&ate=2026-04", "de=2024-03&ate=2026-03", "projeto=Loja"]) {
    const [status] = (await chamar(`/api/metricas?${query}`)) as [number, string];
    assert.equal(status, 422, query);
  }
  const [, mensagem] = (await chamar("/api/metricas?de=2024-03&ate=2026-03")) as [number, string];
  assert.match(mensagem, /no máximo 24 meses/);
  assert.equal(((await chamar("/api/metricas?de=2024-04&ate=2026-03")) as unknown[]).length, 24);
  const [status] = (await chamar("/api/metricas/issues?ate=2026-13")) as [number, string];
  assert.equal(status, 422);
});

test("GET /api/metricas/issues: as issues com execução no período", async () => {
  assert.deepEqual(await chamar("/api/metricas/issues"), []);
  assert.deepEqual(await chamar(`/api/metricas/issues?projeto=loja&de=${mes(0)}&ate=${mes(0)}`), []);
});
