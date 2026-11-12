import assert from "node:assert/strict";
import { test } from "node:test";
import { EstadoDemanda } from "../../../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { bloqueiosDaDemanda } from "./bloqueios.ts";

test("bloqueiam as predecessoras que não satisfazem a Dependência; concluída e arquivada satisfazem", () => {
  const predecessoras = EstadoDemanda.options.map((estado, i) => ({ demanda_id: `I-${String(i + 1)}`, estado }));
  assert.deepEqual(
    bloqueiosDaDemanda(predecessoras).map((p) => p.estado),
    EstadoDemanda.options.filter((estado) => estado !== "concluida" && estado !== "arquivada"),
  );
  assert.deepEqual(bloqueiosDaDemanda([]), []);
});
