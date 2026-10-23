import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { materializarCorrecoesRodada, materializarRodadasCorretivas } from "./correcoes_demanda.ts";
import { ErroDeRegra } from "./erros.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const D = "I-1";
const tk = (ticket_id: number, rodada_id: number | undefined, extra = {}) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  etapa: "implementar",
  status: "concluido",
  status_alterado_em: t0,
  ...extra,
});
const rd = (rodada_id: number) => ({
  demanda_id: D,
  rodada_id,
  titulo: "r",
  fase: "concluida",
  e2e: false,
  branch: `fabriquinha/${D}-${String(rodada_id)}`,
});
// IDs esparsos: rodadas 1 e 5, tickets 1, 3, 9 e 20.
const base = (): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "execucao",
      fase_alterada_em: t0,
      origem_ferramenta: "f",
      origem_sessao: "s",
      enviada: true,
      branch: `fabriquinha/${D}`,
    },
    decisoes: [],
    evidencias: [
      {
        demanda_id: D,
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1" }, { id: "CA-2" }] },
        em: t0,
      },
    ],
    tickets: [
      { demanda_id: D, ticket_id: 1, etapa: "demanda", status: "concluido", status_alterado_em: t0 },
      tk(3, 1),
      tk(9, 5),
      tk(20, 5),
    ],
    rodadas: [rd(1), rd(5)],
    dependencias_ticket: [{ demanda_id: D, ticket_id: 20, depende_ticket_id: 9 }],
    caminhos_ticket: [{ demanda_id: D, ticket_id: 3, caminho: "a.ts" }],
  });
const ref = { demanda_id: D, rodada_id: 5 };
const t = (ticket_id: number, rodada_id: number | undefined, extra = {}) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  titulo: `t${String(ticket_id)}`,
  descricao: "d",
  ...extra,
});
const recusa = (fn: () => unknown, trecho: string) => {
  const ag = base();
  const antes = structuredClone(ag);
  assert.throws(fn, (e: Error) => e instanceof ErroDeRegra && e.message.includes(trecho));
  assert.deepEqual(ag, antes);
};

test("rodada: renumera depois do máximo, mapeia vínculos e preserva o resto", () => {
  const ag = base();
  const antes = structuredClone(ag);
  const novo = materializarCorrecoesRodada(
    ag,
    ref,
    [
      t(7, 5, {
        caminhos: ["x.ts"],
        depende: [{ demanda_id: D, ticket_id: 2 }],
        modelo_provedor: "anthropic",
        modelo_nome: "m",
        effort: "high",
      }),
      t(2, 5, { status: "concluido", etapa: "revisar_rodada" }),
    ],
    t1,
  );
  assert.deepEqual(ag, antes);
  assert.deepEqual(novo.tickets.slice(0, 4), ag.tickets);
  assert.deepEqual(
    novo.tickets.slice(4).map((x) => [x.ticket_id, x.rodada_id, x.titulo, x.etapa, x.status, x.status_alterado_em]),
    [
      [21, 5, "t2", "implementar", "aberto", t1],
      [22, 5, "t7", "implementar", "aberto", t1],
    ],
  );
  const novo22 = novo.tickets[5];
  assert.deepEqual([novo22?.modelo_provedor, novo22?.modelo_nome, novo22?.effort], ["anthropic", "m", "high"]);
  assert.deepEqual(novo.dependencias_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, depende_ticket_id: 21 }]);
  assert.deepEqual(novo.caminhos_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, caminho: "x.ts" }]);
  assert.deepEqual(novo.rodadas, ag.rodadas);
  assert.deepEqual(novo.decisoes, ag.decisoes);
  assert.equal(novo.demanda.fase, "execucao");
});

test("rodada: recusa vazio, referência alheia, rodada inexistente e ticket de outra rodada ou global", () => {
  recusa(() => materializarCorrecoesRodada(base(), ref, [], t1), "vazia");
  recusa(() => materializarCorrecoesRodada(base(), { ...ref, demanda_id: "I-2" }, [t(1, 5)], t1), "I-2");
  recusa(() => materializarCorrecoesRodada(base(), { ...ref, rodada_id: 6 }, [t(1, 6)], t1), "não existe");
  recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, 1)], t1), "não é da rodada 5");
  recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, undefined)], t1), "não é da rodada 5");
  recusa(() => materializarCorrecoesRodada(base(), ref, [{ ...t(1, 5), demanda_id: "I-2" }], t1), "outra demanda");
  recusa(() => materializarCorrecoesRodada(base(), ref, "x", t1), "inválida");
});

test("rodada: recusa caminho inseguro, duplicata, ciclo, dependência fora do fragmento e modelo incompleto", () => {
  for (const caminho of ["/abs", "../fora", "a\\b", "C:/x"]) {
    recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, 5, { caminhos: [caminho] })], t1), "inválida");
  }
  recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, 5), t(1, 5)], t1), "se repete");
  recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, 5, { caminhos: ["a", "a"] })], t1), "repete caminho");
  const dep = (a: number, b: number) => t(a, 5, { depende: [{ demanda_id: D, ticket_id: b }] });
  recusa(() => materializarCorrecoesRodada(base(), ref, [dep(1, 2), dep(2, 1)], t1), "ciclo");
  recusa(() => materializarCorrecoesRodada(base(), ref, [dep(1, 9)], t1), "não existe"); // ticket 9 é do agregado
  recusa(() => materializarCorrecoesRodada(base(), ref, [t(1, 5, { modelo_nome: "m" })], t1), "juntos");
});

const rodadaP = (rodada_id: number, extra = {}) => ({
  demanda_id: D,
  rodada_id,
  titulo: `r${String(rodada_id)}`,
  e2e: true,
  ...extra,
});
const plano = (extra = {}) => ({
  demanda_id: D,
  criterios: ["CA-1", "CA-2"],
  rodadas: [
    rodadaP(2, { criterios: ["CA-2"], depende: [{ demanda_id: D, rodada_id: 1 }] }),
    rodadaP(1, { criterios: ["CA-1"] }),
  ],
  tickets: [
    t(4, 2, { caminhos: ["n.ts"], depende: [{ demanda_id: D, ticket_id: 3 }] }),
    t(3, 2),
    t(8, 1, { effort: "low", modelo_provedor: "openai", modelo_nome: "g" }),
  ],
  ...extra,
});

test("integral: acrescenta rodadas novas com IDs e vínculos remapeados, sem tocar no antigo", () => {
  const ag = base();
  const antes = structuredClone(ag);
  const novo = materializarRodadasCorretivas(ag, plano(), t1);
  assert.deepEqual(ag, antes);
  assert.deepEqual(novo.rodadas.slice(0, 2), ag.rodadas);
  assert.deepEqual(
    novo.rodadas.slice(2).map((r) => [r.rodada_id, r.titulo, r.fase, r.e2e, r.branch]),
    [
      [6, "r1", "desenvolvimento", true, "fabriquinha/I-1-6"],
      [7, "r2", "desenvolvimento", true, "fabriquinha/I-1-7"],
    ],
  );
  assert.deepEqual(novo.dependencias_rodada, [{ demanda_id: D, rodada_id: 7, depende_rodada_id: 6 }]);
  assert.deepEqual(
    novo.criterios_citados.map((c) => [c.rodada_id, c.criterio_id]),
    [
      [6, "CA-1"],
      [7, "CA-2"],
    ],
  );
  assert.deepEqual(
    novo.tickets.slice(4).map((x) => [x.ticket_id, x.rodada_id, x.status, x.effort, x.modelo_nome]),
    [
      [21, 7, "aberto", undefined, undefined],
      [22, 7, "aberto", undefined, undefined],
      [23, 6, "aberto", "low", "g"],
    ],
  );
  assert.deepEqual(novo.dependencias_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, depende_ticket_id: 21 }]);
  assert.deepEqual(novo.caminhos_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, caminho: "n.ts" }]);
  assert.deepEqual(novo.evidencias, ag.evidencias);
  assert.equal(novo.demanda.fase, "execucao");
});

test("integral: recusa vazio, demanda alheia, global, rodada sem ticket, escopo e grafos inválidos", () => {
  recusa(() => materializarRodadasCorretivas(base(), plano({ rodadas: [], tickets: [] }), t1), "não tem rodadas");
  recusa(() => materializarRodadasCorretivas(base(), plano({ demanda_id: "I-2" }), t1), "outra demanda");
  const alheio = {
    ...plano(),
    demanda_id: "I-2",
    rodadas: [{ ...rodadaP(1), demanda_id: "I-2" }],
    tickets: [{ ...t(3, 1), demanda_id: "I-2" }],
  };
  recusa(() => materializarRodadasCorretivas(base(), alheio, t1), "I-2");
  recusa(
    () =>
      materializarRodadasCorretivas(base(), plano({ rodadas: [rodadaP(2)], tickets: [t(3, 2), t(4, undefined)] }), t1),
    "não tem rodada",
  );
  recusa(
    () => materializarRodadasCorretivas(base(), plano({ tickets: [t(3, 2)] }), t1),
    "não tem ticket de implementação",
  );
  recusa(() => materializarRodadasCorretivas(base(), plano({ criterios: ["CA-1", "CA-2", "CA-9"] }), t1), "CA-9");
  recusa(() => materializarRodadasCorretivas(base(), plano({ criterios: [] }), t1), "a demanda não tem");
  recusa(
    () =>
      materializarRodadasCorretivas(
        base(),
        plano({ rodadas: [rodadaP(1, { depende: [{ demanda_id: D, rodada_id: 5 }] }), rodadaP(2)] }),
        t1,
      ),
    "não existe",
  );
  recusa(
    () =>
      materializarRodadasCorretivas(
        base(),
        plano({
          rodadas: [
            rodadaP(1, { depende: [{ demanda_id: D, rodada_id: 2 }] }),
            rodadaP(2, { depende: [{ demanda_id: D, rodada_id: 1 }] }),
          ],
        }),
        t1,
      ),
    "ciclo",
  );
  recusa(() => materializarRodadasCorretivas(base(), plano({ rodadas: [rodadaP(1), rodadaP(1)] }), t1), "se repete");
  recusa(() => materializarRodadasCorretivas(base(), "x", t1), "inválida");
});

test("integral: sem definição congelada nenhum CA é aceito", () => {
  const ag = { ...base(), evidencias: [] };
  assert.throws(() => materializarRodadasCorretivas(ag, plano(), t1), ErroDeRegra);
});
