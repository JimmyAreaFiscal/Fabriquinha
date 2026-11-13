// O adaptador provisório da varredura: acha o projeto pelo nome ou pela demanda e recusa o que não existe. A varredura
// em si é testada em repositorio/commits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { registrarCommitsHumanosDoTicket, varrerCommitsHumanos } from "./varredura_de_commits_humanos.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

test("demanda inexistente é erro", async () => {
  const { banco } = abrirBancoTemporario();
  await assert.rejects(registrarCommitsHumanosDoTicket(banco, "I-99", 1, "0".repeat(40)), /a demanda I-99 não existe/);
  banco.close();
});

test("varrerBase de projeto inexistente é erro", async () => {
  const { banco } = abrirBancoTemporario();
  await assert.rejects(varrerCommitsHumanos(banco, "outro"), /o projeto outro não existe/);
  banco.close();
});
