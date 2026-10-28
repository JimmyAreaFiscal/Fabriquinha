import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type AvaliacaoListada,
  caixinhasDeDemandas,
  dataBr,
  listaDasAvaliacoes,
  paginaDasAvaliacoes,
} from "./avaliacoes.ts";

const avaliacao = (a: Partial<AvaliacaoListada> = {}): AvaliacaoListada => ({
  id: "a/1",
  projeto: "loja <api>",
  de: "2026-10-01",
  ate: "2026-10-31",
  pedido: "",
  criada_em: "2026-11-01T10:00:00.000Z",
  achados: 3,
  estado: "concluida",
  ...a,
});

test("dataBr inverte AAAA-MM-DD", () => {
  assert.equal(dataBr("2026-10-05"), "05/10/2026");
});

test("página: projetos escapados, datas, pedido e o lugar da lista", () => {
  const html = paginaDasAvaliacoes(["loja", "site <x>"]);
  assert.match(html, /<option value="loja">loja<\/option>/);
  assert.match(html, /<option value="site &#60;x&#62;">site &#60;x&#62;<\/option>/);
  assert.match(html, /<input type="date" data-de>.*<input type="date" data-ate>/);
  assert.match(
    html,
    /<textarea data-pedido .*<button type="submit" class="btn btn-primario" data-avaliar>Avaliar<\/button>.*<div data-lista><\/div>/,
  );
});

test("caixinhas: dica sem período, vazio, e uma por demanda com o texto escapado", () => {
  assert.match(caixinhasDeDemandas(undefined), /Escolha o projeto e o período/);
  assert.match(caixinhasDeDemandas([]), /Nenhuma demanda com sessão neste período/);
  const html = caixinhasDeDemandas([{ id: "I-10", titulo: "<b>x</b>" }]);
  assert.match(
    html,
    /<input type="checkbox" value="I-10" data-demanda> <span class="id">I-10<\/span> &#60;b&#62;x&#60;\/b&#62;/,
  );
});

test("lista: período, projeto escapado, estado e número de achados com link; vazia dá a frase", () => {
  const html = listaDasAvaliacoes([avaliacao(), avaliacao({ id: "b", estado: "rodando", achados: 1 })]);
  assert.match(html, /href="\/evaluations\/a%2F1"/);
  assert.match(html, /01\/10\/2026 a 31\/10\/2026/);
  assert.match(html, /loja &#60;api&#62;/);
  assert.match(html, /pill-ok">concluída.*3 achados/);
  assert.match(html, /pill-rodando">rodando.*1 achado</);
  assert.match(listaDasAvaliacoes([]), /Nenhuma avaliação ainda/);
});
