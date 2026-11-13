import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "../../processo/nucleo/agregado/agregado_demanda.ts";
import { AUDITOR, Endereco, FABRIQUINHA } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import {
  criarTicket,
  estaOcupado,
  GrafoDeDependencias,
  proximoIdDeRodada,
  proximoIdDeTicket,
  ticketAtualDaEtapa,
} from "./item_de_trabalho.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const tk = (ticket_id: number, rodada_id?: number, etapa = "implementar", estado = "aberto") => ({
  demanda_id: "I-1",
  ticket_id,
  ...(rodada_id !== undefined && { rodada_id }),
  etapa,
  estado,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rd = (rodada_id: number) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado: "implementar",
  estado_alterado_em: t0,
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});
const montar = (extra: Record<string, unknown> = {}) =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [],
    ...extra,
  });

const ARESTAS_COM_CICLO: Record<
  string,
  { itens: string; casos: Record<string, [string | number, string | number][]> }
> = {
  demanda: {
    itens: "as demandas",
    casos: {
      direto: [
        ["I-2", "I-1"],
        ["I-1", "I-2"],
      ],
      indireto: [
        ["I-2", "I-1"],
        ["I-3", "I-2"],
        ["I-1", "I-3"],
      ],
      autodependência: [["I-1", "I-1"]],
    },
  },
  rodada: {
    itens: "as rodadas",
    casos: {
      direto: [
        [1, 2],
        [2, 1],
      ],
      indireto: [
        [1, 3],
        [3, 2],
        [2, 1],
      ],
      autodependência: [[1, 1]],
    },
  },
  ticket: {
    itens: "os tickets",
    casos: {
      direto: [
        [1, 2],
        [2, 1],
      ],
      indireto: [
        [4, 6],
        [6, 5],
        [5, 4],
      ],
      autodependência: [[1, 1]],
    },
  },
};

for (const [item, { itens, casos }] of Object.entries(ARESTAS_COM_CICLO)) {
  for (const [caso, arestas] of Object.entries(casos)) {
    test(`GrafoDeDependencias: ${item} com ciclo ${caso} é rejeitado`, () => {
      const grafo = new GrafoDeDependencias(arestas, itens);
      assert.throws(
        () => {
          grafo.exigirSemCiclo();
        },
        (e) => e instanceof ErroDeRegra && e.message.startsWith(itens) && e.message.includes("ciclo de dependência"),
      );
    });
  }
}

test("GrafoDeDependencias: diamante e correntes sem ciclo são aceitos", () => {
  const demandas = new GrafoDeDependencias<string>([
    ["I-2", "I-1"],
    ["I-3", "I-1"],
    ["I-4", "I-2"],
    ["I-4", "I-3"],
  ]);
  const rodadas = new GrafoDeDependencias([[2, 1]]);
  const tickets = new GrafoDeDependencias([
    [4, 6],
    [6, 5],
  ]);
  for (const grafo of [demandas, rodadas, tickets]) {
    assert.equal(grafo.descreverCiclo(), undefined);
    grafo.exigirSemCiclo();
  }
});

test("GrafoDeDependencias: nomeia os itens do ciclo, com 'os itens' por padrão", () => {
  assert.equal(
    new GrafoDeDependencias([
      [1, 2],
      [2, 1],
    ]).descreverCiclo(),
    "os itens 1 → 2 formam um ciclo de dependência",
  );
});

test("GrafoDeDependencias.pendentes: as dependências que a regra ainda recusa, na ordem das arestas", () => {
  const grafo = new GrafoDeDependencias([
    [3, 1],
    [3, 2],
    [4, 1],
  ]);
  assert.deepEqual(
    grafo.pendentes(3, () => false),
    [1, 2],
  );
  assert.deepEqual(
    grafo.pendentes(3, (dependencia) => dependencia === 1),
    [2],
  );
  assert.deepEqual(
    grafo.pendentes(3, () => true),
    [],
  );
  assert.deepEqual(
    grafo.pendentes(1, () => false),
    [],
  );
});

test("GrafoDeDependencias: monta o grafo das rodadas e dos tickets do agregado", () => {
  const ag = montar({
    rodadas: [rd(1), rd(2)],
    tickets: [tk(1, 1), tk(2, 2), tk(3, 2)],
    dependencias_rodada: [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }],
    dependencias_ticket: [{ demanda_id: "I-1", ticket_id: 3, depende_ticket_id: 2 }],
  });
  assert.deepEqual(
    GrafoDeDependencias.dasRodadas(ag).pendentes(2, () => false),
    [1],
  );
  assert.deepEqual(
    GrafoDeDependencias.dosTickets(ag).pendentes(3, () => false),
    [2],
  );
});

test("ticketAtualDaEtapa: o de maior id da etapa, na rodada quando informada", () => {
  const ag = montar({
    rodadas: [rd(1), rd(2)],
    tickets: [
      tk(3, 1, "revisar_rodada"),
      tk(1, 1, "revisar_rodada", "concluido"),
      tk(2, 2, "revisar_rodada"),
      tk(4, undefined, "revisar_demanda"),
    ],
  });
  assert.equal(ticketAtualDaEtapa(ag, "revisar_rodada")?.ticket_id, 3);
  assert.equal(ticketAtualDaEtapa(ag, "revisar_rodada", 2)?.ticket_id, 2);
  assert.equal(ticketAtualDaEtapa(ag, "revisar_demanda")?.ticket_id, 4);
  assert.equal(ticketAtualDaEtapa(ag, "revisar_rodada", 3), undefined);
  assert.equal(ticketAtualDaEtapa(ag, "encerrar_demanda"), undefined);
});

test("ticketAtualDaEtapa: o aceito de maior id, ignorando os maiores que a regra recusa", () => {
  const ag = montar({
    rodadas: [rd(1)],
    tickets: [tk(1, 1, "implementar", "concluido"), tk(2, 1, "implementar", "concluido"), tk(3, 1)],
  });
  const concluido = (t: { estado: string }) => t.estado === "concluido";
  assert.equal(ticketAtualDaEtapa(ag, "implementar", undefined, concluido)?.ticket_id, 2);
  assert.equal(ticketAtualDaEtapa(ag, "implementar", 1, concluido)?.ticket_id, 2);
  assert.equal(ticketAtualDaEtapa(ag, "revisar_rodada", undefined, concluido), undefined);
});

test("proximoIdDeTicket e proximoIdDeRodada: maior id existente mais um, 1 sem nenhum", () => {
  assert.equal(proximoIdDeTicket(montar()), 1);
  assert.equal(proximoIdDeRodada(montar()), 1);
  const ag = montar({ rodadas: [rd(1), rd(4)], tickets: [tk(2, 1), tk(7, 4), tk(5, 1)] });
  assert.equal(proximoIdDeTicket(ag), 8);
  assert.equal(proximoIdDeRodada(ag), 5);
});

test("criarTicket: abre o ticket com o próximo id, sem rodada_id quando não é de rodada", () => {
  const ag = montar({ rodadas: [rd(1)], tickets: [tk(3, 1)] });
  assert.deepEqual(criarTicket(ag, { etapa: "revisar_demanda", criado_por: FABRIQUINHA, agora: t1 }), {
    demanda_id: "I-1",
    ticket_id: 4,
    etapa: "revisar_demanda",
    estado: "aberto",
    estado_alterado_em: t1,
    criado_por: FABRIQUINHA,
  });
  assert.deepEqual(criarTicket(ag, { etapa: "revisar_rodada", rodada: 1, criado_por: AUDITOR, agora: t1 }), {
    demanda_id: "I-1",
    ticket_id: 4,
    rodada_id: 1,
    etapa: "revisar_rodada",
    estado: "aberto",
    estado_alterado_em: t1,
    criado_por: AUDITOR,
  });
});

test("estaOcupado: o ticket, a rodada e a demanda ocupados por falha ou execução", () => {
  const ag = montar({
    rodadas: [rd(1), rd(2), rd(3)],
    tickets: [
      tk(1, 1, "implementar", "em_execucao"),
      tk(2, 2, "implementar", "falhou"),
      tk(3, 3, "implementar", "concluido"),
      tk(4, 3),
      tk(5, undefined, "revisar_demanda"),
    ],
  });
  assert.equal(estaOcupado(ag, Endereco.doTicket("I-1", 1)), true);
  assert.equal(estaOcupado(ag, Endereco.doTicket("I-1", 2)), true);
  assert.equal(estaOcupado(ag, Endereco.doTicket("I-1", 4)), false);
  assert.equal(estaOcupado(ag, Endereco.daRodada("I-1", 1)), true);
  assert.equal(estaOcupado(ag, Endereco.daRodada("I-1", 3)), false);
  assert.equal(estaOcupado(ag, Endereco.daDemanda("I-1")), false);
  const global = montar({ tickets: [tk(1, undefined, "revisar_demanda", "falhou"), tk(2, undefined, "planejar")] });
  assert.equal(estaOcupado(global, Endereco.daDemanda("I-1")), true);
});
