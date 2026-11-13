// Os meses e seus intervalos. O fuso é fixado aqui, antes de qualquer data: o mês é o do fuso do serviço, e o teste não
// pode depender do fuso da máquina.
process.env.TZ = "America/Sao_Paulo"; // UTC−3, sem horário de verão desde 2019

import assert from "node:assert/strict";
import { test } from "node:test";
import { intervalo, somarMeses } from "./periodo.ts";

test("intervalo: as meias-noites do mês no fuso do serviço, em UTC, e a virada do ano", () => {
  assert.deepEqual(intervalo("2026-12"), {
    mes: "2026-12",
    inicio: "2026-12-01T03:00:00.000Z",
    fim: "2027-01-01T03:00:00.000Z",
  });
  assert.equal(somarMeses("2026-01", -1), "2025-12");
});
