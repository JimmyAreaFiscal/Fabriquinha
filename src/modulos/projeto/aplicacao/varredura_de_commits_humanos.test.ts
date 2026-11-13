// O adaptador provisório da varredura: acha o projeto pelo nome ou pela demanda e recusa o que não existe. A varredura
// em si é testada em repositorio/commits.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { relogioFixo } from "../../../shared/nucleo/relogio.ts";
import { registrarProjeto } from "./cadastro.ts";
import {
  projetosAVarrer,
  registrarCommitsHumanosDoTicket,
  varrerCommitsHumanos,
} from "./varredura_de_commits_humanos.ts";

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

test("projetosAVarrer olha todos os projetos cadastrados", () => {
  const { banco } = abrirBancoTemporario();
  for (const nome of ["velho", "loja"])
    registrarProjeto(banco, {
      nome,
      raiz_git: `/repo/${nome}`,
      branch_base: "main",
      hospedagem: "github",
      chave_sonarqube: nome,
    });
  assert.deepEqual(projetosAVarrer(banco, relogioFixo("2026-10-11T12:00:00.000Z")), ["loja", "velho"]);
  banco.close();
});
