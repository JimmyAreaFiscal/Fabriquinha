// Roda fora do `npm test`: node --test estresse/medir.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { medir, percentil } from "./medir.ts";

test("percentil por posto mais próximo", () => {
  const t = Array.from({ length: 100 }, (_, i) => i + 1);
  assert.equal(percentil(t, 50), 50);
  assert.equal(percentil(t, 95), 95);
  assert.equal(percentil([], 95), 0);
});

test("respeita n e a concorrência, e resume os tempos", async () => {
  let ativas = 0;
  let pico = 0;
  let chamadas = 0;
  const m = await medir(
    async () => {
      chamadas++;
      pico = Math.max(pico, ++ativas);
      await new Promise((r) => setTimeout(r, 1));
      ativas--;
      return chamadas;
    },
    { n: 50, concorrencia: 5, orcamento: 1000 },
  );
  assert.equal(chamadas, 50);
  assert.equal(pico, 5);
  assert.equal(m.n, 50);
  assert.equal(m.erros, 0);
  assert.equal(m.max, 50);
  assert.equal(m.acimaDoOrcamento, false);
});

test("conta erros e marca p95 acima do orçamento", async () => {
  let i = 0;
  const m = await medir(() => (++i % 10 === 0 ? Promise.reject(new Error("500")) : Promise.resolve(5)), {
    n: 20,
    concorrencia: 2,
    orcamento: 0,
  });
  assert.equal(m.erros, 2);
  assert.equal(m.p95, 5);
  assert.equal(m.acimaDoOrcamento, true);
});

test("concorrência maior que n e n zero", async () => {
  const m = await medir(() => Promise.resolve(1), { n: 0, concorrencia: 3, orcamento: 1 });
  assert.deepEqual([m.n, m.p95, m.max, m.acimaDoOrcamento], [0, 0, 0, false]);
});
