// O catálogo de preços: cada preço com a origem e a vigência; o preço que muda fecha a vigência do anterior, o modelo que
// sai da fonte fecha a dele, e a leitura acha o preço vigente num instante.
import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";
import type { PrecoDoModelo } from "../nucleo/preco_do_modelo.ts";
import { gravarCatalogoDePrecos, lerPrecoVigente } from "./catalogo_de_precos.ts";

const SONNET = { provedor: "anthropic", nome: "claude-sonnet-5-5" };
const OPUS = { provedor: "anthropic", nome: "claude-opus-5-5" };
const preco = (modelo: typeof SONNET, entrada: number): PrecoDoModelo => ({
  modelo,
  usd_por_milhao: { entrada, saida: 10, cache_leitura: 0.1, cache_escrita: 2.5 },
  origem: "pi",
});
const bancoEmMemoria = (): DatabaseSync => {
  const banco = new DatabaseSync(":memory:");
  migrarBancoDaFabriquinha(banco);
  return banco;
};
const [T1, T2, T3] = ["2026-11-01T00:00:00.000Z", "2026-11-10T00:00:00.000Z", "2026-11-20T00:00:00.000Z"];

test("o catálogo guarda o preço, a origem e a vigência, e a mesma fonte de novo não abre outra vigência", () => {
  const banco = bancoEmMemoria();
  gravarCatalogoDePrecos(banco, [preco(SONNET, 2)], T1);
  gravarCatalogoDePrecos(banco, [preco(SONNET, 2)], T2);
  const vigente = lerPrecoVigente(banco, SONNET, T2);
  assert.deepEqual(vigente, { id: vigente?.id, ...preco(SONNET, 2), vigente_de: T1 });
  assert.equal(lerPrecoVigente(banco, SONNET, "2026-10-31T23:59:59.999Z"), undefined, "antes da vigência não há preço");
  assert.equal(lerPrecoVigente(banco, OPUS, T2), undefined);
});

test("o preço que muda fecha a vigência do anterior, e cada instante lê o preço vigente nele", () => {
  const banco = bancoEmMemoria();
  gravarCatalogoDePrecos(banco, [preco(SONNET, 2), preco(OPUS, 4)], T1);
  gravarCatalogoDePrecos(banco, [preco(SONNET, 3), preco(OPUS, 4)], T2);
  const antigo = lerPrecoVigente(banco, SONNET, "2026-11-05T00:00:00.000Z");
  const novo = lerPrecoVigente(banco, SONNET, T3);
  assert.deepEqual(antigo, { id: antigo?.id, ...preco(SONNET, 2), vigente_de: T1, vigente_ate: T2 });
  assert.deepEqual(novo, { id: novo?.id, ...preco(SONNET, 3), vigente_de: T2 });
  assert.equal(lerPrecoVigente(banco, OPUS, T3)?.vigente_de, T1);
});

test("o modelo que sai da fonte tem a vigência fechada: depois dela o custo dele não é estimado", () => {
  const banco = bancoEmMemoria();
  gravarCatalogoDePrecos(banco, [preco(SONNET, 2), preco(OPUS, 4)], T1);
  gravarCatalogoDePrecos(banco, [preco(SONNET, 2)], T2);
  assert.equal(lerPrecoVigente(banco, OPUS, T3), undefined);
  assert.equal(lerPrecoVigente(banco, OPUS, "2026-11-05T00:00:00.000Z")?.vigente_ate, T2);
});
