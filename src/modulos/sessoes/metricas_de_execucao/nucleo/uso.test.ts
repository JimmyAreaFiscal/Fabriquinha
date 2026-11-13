// Uso: a soma por modelo, o custo desconhecido e a contagem de Trabalhos sem custo e com custo estimado.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinhaDeUso } from "../../harness/publico.ts";
import { textoDoCusto, Uso } from "./uso.ts";

const linhaDeUso = (modelo: string, custo: number | null, tokens = 10): LinhaDeUso => ({
  modelo,
  tokens_entrada: tokens,
  tokens_saida: 1,
  tokens_cache_leitura: 2,
  tokens_cache_escrita: 3,
  custo,
  chamadas: 1,
});

test("Uso.de soma o custo conhecido como número e agrupa as linhas do mesmo modelo", () => {
  const uso = Uso.de([linhaDeUso("a/m", 1.5), linhaDeUso("a/m", 2.7, 20)], 1);
  assert.deepEqual(uso.porModelo(), [
    {
      modelo: "a/m",
      tokens_entrada: 30,
      tokens_saida: 2,
      tokens_cache_leitura: 4,
      tokens_cache_escrita: 6,
      custo: 4.2,
      chamadas: 2,
    },
  ]);
  assert.deepEqual(uso.custo(), { conhecido: 4.2, trabalhosSemCusto: 0, trabalhosComCustoEstimado: 0 });
});

test("Uso.de deixa o custo desconhecido como null e conta os Trabalhos sem custo", () => {
  const uso = Uso.de([linhaDeUso("a/m", null), linhaDeUso("b/m", null)], 2);
  assert.deepEqual(
    uso.porModelo().map((linha) => linha.custo),
    [null, null],
  );
  assert.deepEqual(uso.custo(), { conhecido: 0, trabalhosSemCusto: 2, trabalhosComCustoEstimado: 0 });
});

test("Uso.de rejeita custo negativo", () => {
  assert.throws(() => Uso.de([linhaDeUso("a/m", -1)], 1), RangeError);
});

test("Uso.somar agrupa por modelo, mantém o custo conhecido diante do desconhecido e soma os Trabalhos sem custo", () => {
  const soma = Uso.vazio()
    .somar(Uso.de([linhaDeUso("b/m", 1)], 1))
    .somar(Uso.de([linhaDeUso("a/m", null), linhaDeUso("b/m", null)], 1))
    .somar(Uso.de([linhaDeUso("a/m", null)], 1));
  assert.deepEqual(
    soma.porModelo().map(({ modelo, custo, tokens_entrada }) => ({ modelo, custo, tokens_entrada })),
    [
      { modelo: "a/m", custo: null, tokens_entrada: 20 },
      { modelo: "b/m", custo: 1, tokens_entrada: 20 },
    ],
  );
  assert.deepEqual(soma.custo(), { conhecido: 1, trabalhosSemCusto: 2, trabalhosComCustoEstimado: 0 });
});

test("Uso.vazio não tem linhas nem Trabalhos sem custo", () => {
  assert.deepEqual(Uso.vazio().porModelo(), []);
  assert.deepEqual(Uso.vazio().custo(), { conhecido: 0, trabalhosSemCusto: 0, trabalhosComCustoEstimado: 0 });
});

test("textoDoCusto mostra o custo conhecido e, com Trabalho sem custo, o piso com '≥' e a contagem", () => {
  const conhecido = Uso.de([linhaDeUso("a/m", 4.2)], 1);
  assert.equal(textoDoCusto(conhecido), "US$ 4,20");
  assert.equal(textoDoCusto(conhecido.somar(Uso.de([linhaDeUso("b/m", null)], 2))), "≥ US$ 4,20 (2 sessões sem custo)");
  assert.equal(textoDoCusto(conhecido.somar(Uso.de([linhaDeUso("b/m", null)], 1))), "≥ US$ 4,20 (1 sessão sem custo)");
});

const linhaComCustoEstimado = (modelo: string, custo: number): LinhaDeUso => ({
  ...linhaDeUso(modelo, custo),
  custo_estimado: true,
});

test("Uso.de conta como estimado o Trabalho com alguma linha de custo estimado, e a soma marca o modelo estimado", () => {
  const informado = Uso.de([linhaDeUso("a/m", 1)], 1);
  const estimado = Uso.de([linhaComCustoEstimado("a/m", 2), linhaDeUso("b/m", 0.5)], 3);
  const soma = informado.somar(estimado);
  assert.deepEqual(
    soma.porModelo().map(({ modelo, custo, custo_estimado }) => ({ modelo, custo, custo_estimado })),
    [
      { modelo: "a/m", custo: 3, custo_estimado: true },
      { modelo: "b/m", custo: 0.5, custo_estimado: undefined },
    ],
  );
  assert.deepEqual(soma.custo(), { conhecido: 3.5, trabalhosSemCusto: 0, trabalhosComCustoEstimado: 3 });
  assert.equal("custo_estimado" in (informado.porModelo()[0] ?? {}), false, "o custo informado não ganha a marca");
});

test("textoDoCusto avisa o custo estimado, sozinho ou ao lado das sessões sem custo", () => {
  const estimado = Uso.de([linhaComCustoEstimado("a/m", 4.2)], 1);
  assert.equal(textoDoCusto(estimado), "US$ 4,20 (estimado em 1 sessão)");
  assert.equal(
    textoDoCusto(estimado.somar(Uso.de([linhaComCustoEstimado("b/m", 1)], 1))),
    "US$ 5,20 (estimado em 2 sessões)",
  );
  assert.equal(
    textoDoCusto(estimado.somar(Uso.de([linhaDeUso("b/m", null)], 2))),
    "≥ US$ 4,20 (2 sessões sem custo; estimado em 1 sessão)",
  );
});

test("a sessão declarada em duas demandas, somada, conta os tokens uma vez", () => {
  // O armazenamento entrega a sessão repetida só na demanda dona; a outra recebe Uso.vazio().
  const usoDaDemandaDona = Uso.de([linhaDeUso("a/m", 1.5, 10)], 1);
  const usoDaOutraDemanda = Uso.vazio();
  const soma = usoDaDemandaDona.somar(usoDaOutraDemanda);
  assert.deepEqual(
    soma.porModelo().map(({ tokens_entrada, custo }) => ({ tokens_entrada, custo })),
    [{ tokens_entrada: 10, custo: 1.5 }],
  );
  assert.equal(textoDoCusto(soma), "US$ 1,50");
});
