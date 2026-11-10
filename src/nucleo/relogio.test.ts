// O relógio e a conta de calendário. O fuso é fixado antes de qualquer data, para o teste não depender da máquina.
process.env.TZ = "America/Sao_Paulo"; // UTC−3, sem horário de verão desde 2019

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  comoInstante,
  inicioDoMes,
  instanteAntes,
  instanteDepois,
  mesDoInstante,
  type Relogio,
  relogioDoSistema,
  relogioFixo,
} from "./relogio.ts";

test("relogioDoSistema devolve o instante de agora em ISO", () => {
  const antes = Date.now();
  const agora = Date.parse(relogioDoSistema.agora());
  assert.ok(agora >= antes && agora <= Date.now());
});

test("relogioFixo devolve sempre o mesmo instante", () => {
  const relogio: Relogio = relogioFixo("2026-05-01T12:00:00.000Z");
  assert.equal(relogio.agora(), "2026-05-01T12:00:00.000Z");
  assert.equal(relogio.agora(), "2026-05-01T12:00:00.000Z");
});

test("inicioDoMes: a meia-noite do dia 1 no fuso do serviço, em UTC, e a virada do ano", () => {
  assert.equal(inicioDoMes(2026, 12), "2026-12-01T03:00:00.000Z");
  assert.equal(inicioDoMes(2026, 13), "2027-01-01T03:00:00.000Z");
  assert.equal(inicioDoMes(2026, 0), "2025-12-01T03:00:00.000Z");
});

test("instanteAntes recua o instante em milissegundos", () => {
  assert.equal(instanteAntes("2026-10-11T12:00:00.000Z", 24 * 60 * 60_000), "2026-10-10T12:00:00.000Z");
});

test("mesDoInstante: o mês do fuso do serviço, não o do UTC", () => {
  assert.equal(mesDoInstante("2026-11-01T02:59:59.999Z"), "2026-10");
  assert.equal(mesDoInstante("2026-11-01T03:00:00.000Z"), "2026-11");
});

test("instanteDepois adianta o instante em milissegundos", () => {
  assert.equal(instanteDepois("2026-10-10T12:00:00.000Z", 24 * 60 * 60_000), "2026-10-11T12:00:00.000Z");
});

test("comoInstante normaliza a data com fuso para UTC", () => {
  assert.equal(comoInstante("2026-05-01T09:00:00-03:00"), "2026-05-01T12:00:00.000Z");
});
