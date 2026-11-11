import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfiguracaoDoAmbiente } from "./configuracao_do_ambiente.ts";

test("ConfiguracaoDoAmbiente: host_local por padrão e limites mínimos do container", () => {
  assert.deepEqual(ConfiguracaoDoAmbiente.parse({}), {
    tipo: "host_local",
    memoria_maxima_mb: 2048,
    cpus: 2,
    ociosidade_para_eliminar_min: 60,
  });
  assert.equal(
    ConfiguracaoDoAmbiente.safeParse({ tipo: "container", memoria_maxima_mb: 512, cpus: 0.5 }).success,
    true,
  );
  for (const errada of [{ tipo: "vm" }, { memoria_maxima_mb: 511 }, { cpus: 0 }, { ociosidade_para_eliminar_min: 4 }])
    assert.equal(ConfiguracaoDoAmbiente.safeParse(errada).success, false, JSON.stringify(errada));
});
