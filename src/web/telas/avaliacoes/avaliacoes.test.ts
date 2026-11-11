import assert from "node:assert/strict";
import { test } from "node:test";
import {
  achadosDaAvaliacao,
  type AvaliacaoListada,
  barraDaAvaliacao,
  caixinhasDeDemandas,
  conversaDaAvaliacao,
  type DadosDaAvaliacao,
  dataBr,
  envioDaAvaliacao,
  escopoDaAvaliacao,
  linhaDoInicioDaAvaliacao,
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

const detalhe = (d: Partial<DadosDaAvaliacao> = {}): DadosDaAvaliacao => ({
  id: "a1",
  projeto: "loja <api>",
  de: "2026-10-01",
  ate: "2026-10-31",
  pedido: "",
  criada_em: "2026-11-01T10:00:00.000Z",
  demandas: ["I-10"],
  achados: [],
  uso: [],
  estado: "concluida",
  conversa: [],
  ...d,
});

test("barra: projeto escapado, período, estado e link da lista", () => {
  const html = barraDaAvaliacao(detalhe(), "modelo padrão do pi");
  assert.match(html, /Avaliação<\/span> loja &#60;api&#62;/);
  assert.match(html, /01\/10\/2026 a 31\/10\/2026/);
  assert.match(html, /pill-ok">concluída/);
  assert.match(html, /href="\/evaluations"/);
  assert.match(barraDaAvaliacao(detalhe({ estado: "rodando" }), ""), /pill-rodando">rodando/);
});

test("escopo: demandas com link e o pedido só quando houve", () => {
  const html = escopoDaAvaliacao(detalhe({ demandas: ["I-10", "I-<2>"], pedido: "foco <b>" }));
  assert.match(html, /<a class="id" href="\/demandas\/I-10">I-10<\/a>/);
  assert.match(html, /I-&#60;2&#62;/);
  assert.match(html, /Pedido<\/dt><dd>foco &#60;b&#62;/);
  assert.doesNotMatch(escopoDaAvaliacao(detalhe()), /Pedido/);
});

test("achados: cartão com título, descrição e evidência escapados; botão ou link da demanda; frase quando vazio", () => {
  const achado = { achado_id: 2, titulo: "T <x>", descricao: "D", evidencia: "E <y>", demanda_id: null };
  const html = achadosDaAvaliacao(detalhe({ achados: [achado, { ...achado, achado_id: 3, demanda_id: "I-11" }] }));
  assert.match(html, /<h2>Achados <span class="muted">2<\/span>/);
  assert.match(html, /#2<\/span> T &#60;x&#62;.*E &#60;y&#62;/);
  assert.match(html, /data-encaminhar="2">Encaminhar como demanda/);
  assert.doesNotMatch(html, /data-encaminhar="3"/);
  assert.match(html, /href="\/demandas\/I-11"/);
  const vinte = achadosDaAvaliacao(
    detalhe({ achados: Array.from({ length: 20 }, (_, i) => ({ ...achado, achado_id: i + 1 })) }),
  );
  assert.equal(vinte.match(/<article/g)?.length, 20);
  assert.match(achadosDaAvaliacao(detalhe()), /A avaliação não registrou achados/);
  assert.match(achadosDaAvaliacao(detalhe({ estado: "rodando" })), /ainda não registrou/);
});

test("envio: Abortar com o agente rodando, compositor depois", () => {
  assert.match(JSON.stringify(envioDaAvaliacao("rodando")), /data-abortar/);
  assert.match(JSON.stringify(envioDaAvaliacao("concluida")), /Pergunte sobre a avaliação/);
});

test("conversa: o prompt da Fabriquinha vira a linha do início, com o pedido em balão; o resto é mensagem", () => {
  const prompt = { role: "user", content: "# Avaliação do projeto", timestamp: 1 };
  const resposta = { role: "assistant", content: [{ type: "text", text: "ok" }], timestamp: 2 };
  const d = detalhe({
    pedido: "foco",
    conversa: [
      { type: "message", message: prompt, fabriquinha: true },
      { type: "message", message: resposta },
      { type: "outro" },
    ],
  });
  const mensagens = conversaDaAvaliacao(d);
  assert.equal(mensagens.length, 3);
  assert.match(
    JSON.stringify(mensagens[0]),
    /Avaliação de loja &#60;api&#62; \(01\/10\/2026 a 31\/10\/2026\) iniciada/,
  );
  assert.match(JSON.stringify(mensagens[1]), /foco/);
  assert.equal(mensagens[2]?.role, "assistant");
  assert.equal(linhaDoInicioDaAvaliacao(prompt, d).length, 2);
  assert.equal(linhaDoInicioDaAvaliacao(prompt, detalhe()).length, 1);
});

test("conversa: o resultado da ferramenta se junta à chamada", () => {
  const chamada = {
    role: "assistant",
    content: [{ type: "toolCall", id: "t1", name: "registrar_achado", arguments: {} }],
    timestamp: 1,
  };
  const resultado = { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "feito" }], timestamp: 2 };
  const mensagens = conversaDaAvaliacao(
    detalhe({
      conversa: [
        { type: "message", message: chamada },
        { type: "message", message: resultado },
      ],
    }),
  );
  assert.equal(mensagens.length, 1);
  assert.match(JSON.stringify(mensagens[0]), /feito/);
});
