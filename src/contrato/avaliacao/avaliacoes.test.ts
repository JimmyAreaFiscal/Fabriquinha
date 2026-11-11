import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AchadoEncaminhado,
  AvaliacaoCriada,
  DadosDaAvaliacao,
  NovaAvaliacao,
  NovaMensagemDaAvaliacao,
  PeriodoDaAvaliacao,
} from "./avaliacoes.ts";

const periodo = { projeto: "p", de: "2026-01-01", ate: "2026-01-31" };

test("a nova avaliação exige o período, apara o pedido e recusa campo desconhecido", () => {
  assert.deepEqual(NovaAvaliacao.parse({ ...periodo, pedido: "  olhe  ", demandas: ["I-1"] }), {
    ...periodo,
    pedido: "olhe",
    demandas: ["I-1"],
  });
  assert.throws(() => NovaAvaliacao.parse({ ...periodo, extra: 1 }));
  assert.throws(() => PeriodoDaAvaliacao.parse({ projeto: "", de: "a", ate: "b" }));
  assert.throws(() => NovaMensagemDaAvaliacao.parse({ texto: " " }));
});

test("as respostas da criação e do encaminhamento levam só o id", () => {
  assert.deepEqual(AvaliacaoCriada.parse({ id: "u1" }), { id: "u1" });
  assert.deepEqual(AchadoEncaminhado.parse({ demanda: "I-2" }), { demanda: "I-2" });
});

test("a avaliação aberta leva escopo, achados, uso, estado e conversa", () => {
  const aberta = {
    id: "u1",
    ...periodo,
    pedido: "",
    criada_em: "2026-02-01T00:00:00.000Z",
    demandas: ["I-1"],
    achados: [{ achado_id: 1, titulo: "t", descricao: "d", evidencia: "e", demanda_id: null }],
    uso: [
      {
        modelo_provedor: "p",
        modelo_nome: "m",
        chamadas: 1,
        tokens_entrada: 1,
        tokens_saida: 2,
        tokens_cache_leitura: 3,
        tokens_cache_escrita: 4,
        custo: null,
      },
    ],
    estado: "rodando",
    conversa: [{ type: "message_end", fabriquinha: true }],
  };
  assert.deepEqual(DadosDaAvaliacao.parse(aberta), aberta);
  assert.throws(() => DadosDaAvaliacao.parse({ ...aberta, estado: "parada" }));
});
