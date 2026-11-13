import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfiguracaoDoAmbiente } from "./configuracao_do_ambiente.ts";

test("ConfiguracaoDoAmbiente: host_local por padrão, conjunto variável sem limite, e limites mínimos do container", () => {
  assert.deepEqual(ConfiguracaoDoAmbiente.parse({}), {
    tipo: "host_local",
    memoria_maxima_mb: 2048,
    cpus: 2,
    ociosidade_para_eliminar_min: 60,
    conjunto: "variavel",
    capacidade_do_conjunto: null,
    minimo_do_conjunto: 0,
  });
  assert.equal(
    ConfiguracaoDoAmbiente.safeParse({ tipo: "container", memoria_maxima_mb: 512, cpus: 0.5 }).success,
    true,
  );
  for (const errada of [{ tipo: "vm" }, { memoria_maxima_mb: 511 }, { cpus: 0 }, { ociosidade_para_eliminar_min: 4 }])
    assert.equal(ConfiguracaoDoAmbiente.safeParse(errada).success, false, JSON.stringify(errada));
});

test("ConfiguracaoDoAmbiente: o fixo exige a capacidade, e o mínimo do variável não passa dela", () => {
  for (const certa of [
    { conjunto: "fixo", capacidade_do_conjunto: 3 },
    { conjunto: "fixo", capacidade_do_conjunto: 2, minimo_do_conjunto: 5 }, // o fixo não usa o mínimo
    { conjunto: "variavel", capacidade_do_conjunto: 3, minimo_do_conjunto: 3 },
    { conjunto: "variavel", minimo_do_conjunto: 4 }, // sem capacidade, sem teto
  ])
    assert.equal(ConfiguracaoDoAmbiente.safeParse(certa).success, true, JSON.stringify(certa));

  const erroDe = (entrada: unknown) => ConfiguracaoDoAmbiente.safeParse(entrada).error?.issues;
  assert.deepEqual(
    erroDe({ conjunto: "fixo" })?.map(({ path, message }) => ({ path, message })),
    [{ path: ["capacidade_do_conjunto"], message: "o conjunto fixo precisa de uma capacidade" }],
  );
  assert.deepEqual(
    erroDe({ conjunto: "variavel", capacidade_do_conjunto: 2, minimo_do_conjunto: 3 })?.map(({ path, message }) => ({
      path,
      message,
    })),
    [{ path: ["minimo_do_conjunto"], message: "o mínimo passa da capacidade do conjunto" }],
  );
  for (const errada of [
    { conjunto: "elastico" },
    { capacidade_do_conjunto: 0 },
    { capacidade_do_conjunto: 1.5 },
    { minimo_do_conjunto: -1 },
    { minimo_do_conjunto: 0.5 },
  ])
    assert.equal(ConfiguracaoDoAmbiente.safeParse(errada).success, false, JSON.stringify(errada));
});
