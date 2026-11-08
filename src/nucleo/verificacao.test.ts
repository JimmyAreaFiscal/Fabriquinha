// A regra única de classificação da saída de um comando de Verificação, por tabela.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classificarSaidaDeComando } from "./verificacao.ts";

const CODIGO_DE_REPROVACAO = 3;

const tabela: [string, { codigo: number | null; estourou: boolean }, number | undefined, string][] = [
  ["saída 0", { codigo: 0, estourou: false }, undefined, "passou"],
  ["saída 0 com código de reprovação", { codigo: 0, estourou: false }, CODIGO_DE_REPROVACAO, "passou"],
  ["estouro", { codigo: null, estourou: true }, undefined, "falha_infraestrutura"],
  ["estouro com código de reprovação", { codigo: null, estourou: true }, CODIGO_DE_REPROVACAO, "falha_infraestrutura"],
  ["126", { codigo: 126, estourou: false }, undefined, "falha_infraestrutura"],
  ["126 com código de reprovação", { codigo: 126, estourou: false }, CODIGO_DE_REPROVACAO, "falha_infraestrutura"],
  ["127", { codigo: 127, estourou: false }, undefined, "falha_infraestrutura"],
  ["127 com código de reprovação", { codigo: 127, estourou: false }, CODIGO_DE_REPROVACAO, "falha_infraestrutura"],
  ["o código de reprovação", { codigo: CODIGO_DE_REPROVACAO, estourou: false }, CODIGO_DE_REPROVACAO, "reprovacao"],
  [
    "outro código com código de reprovação",
    { codigo: 2, estourou: false },
    CODIGO_DE_REPROVACAO,
    "falha_infraestrutura",
  ],
  ["saída 1 sem código de reprovação", { codigo: 1, estourou: false }, undefined, "reprovacao"],
  ["sem código de saída e sem estouro", { codigo: null, estourou: false }, undefined, "reprovacao"],
];

for (const [nome, saida, codigoDeReprovacao, esperado] of tabela) {
  test(`classificarSaidaDeComando: ${nome} → ${esperado}`, () => {
    assert.equal(classificarSaidaDeComando(saida, codigoDeReprovacao), esperado);
  });
}
