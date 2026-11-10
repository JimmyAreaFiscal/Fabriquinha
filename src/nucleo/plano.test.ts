import assert from "node:assert/strict";
import { test } from "node:test";
import { lerPlanoGravado, PlanoProposto } from "./plano.ts";

const plano = (mudanca: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  criterios: ["CA-1", "CA-2"],
  arquivos_previstos: ["src/a.ts"],
  rodadas: [
    {
      demanda_id: "I-1",
      rodada_id: 1,
      titulo: "r1",
      e2e: false,
      criterios: ["CA-1"],
      arquivos_previstos: ["src/a.ts"],
    },
    { demanda_id: "I-1", rodada_id: 2, titulo: "r2", e2e: true, depende: [{ demanda_id: "I-1", rodada_id: 1 }] },
  ],
  tickets: [
    { demanda_id: "I-1", ticket_id: 1, titulo: "t1", descricao: "d" },
    { demanda_id: "I-1", ticket_id: 2, titulo: "t2", descricao: "d", rodada_id: 1, arquivos_previstos: ["src/a.ts"] },
    {
      demanda_id: "I-1",
      ticket_id: 3,
      titulo: "t3",
      descricao: "d",
      rodada_id: 1,
      depende: [{ demanda_id: "I-1", ticket_id: 2 }],
    },
    { demanda_id: "I-1", ticket_id: 4, titulo: "t4", descricao: "d", rodada_id: 2 },
  ],
  ...mudanca,
});
const recusa = (p: unknown, trecho: string) => {
  const r = PlanoProposto.safeParse(p);
  assert.ok(!r.success, "deveria recusar");
  assert.ok(
    r.error.issues.some((i) => i.message.includes(trecho)),
    r.error.message,
  );
};
const tk = (ticket_id: number, rodada_id?: number, depende: number[] = []) => ({
  demanda_id: "I-1",
  ticket_id,
  titulo: "t",
  descricao: "d",
  rodada_id,
  depende: depende.map((d) => ({ demanda_id: "I-1", ticket_id: d })),
});
const rd = (rodada_id: number, depende: number[] = [], demanda_id = "I-1") => ({
  demanda_id,
  rodada_id,
  titulo: "r",
  e2e: false,
  depende: depende.map((d) => ({ demanda_id: "I-1", rodada_id: d })),
});

test("plano válido é aceito", () => {
  assert.ok(PlanoProposto.safeParse(plano()).success);
});

test("plano recusa rodada ou ticket duplicado, de outra demanda ou em rodada inexistente", () => {
  recusa(plano({ rodadas: [rd(1), rd(1)] }), "rodada 1 se repete");
  recusa(plano({ rodadas: [rd(1, [], "I-2")] }), "outra demanda");
  recusa(plano({ tickets: [tk(1), tk(1)] }), "ticket 1 se repete");
  recusa(plano({ tickets: [{ ...tk(1), demanda_id: "I-2" }] }), "outra demanda");
  recusa(plano({ tickets: [tk(1, 9)] }), "rodada 9, que não existe");
});

test("CA-SDLC-03: dependência de rodada recusa autorreferência, ciclo, outra demanda e inexistente", () => {
  recusa(plano({ rodadas: [rd(1, [1])] }), "de si mesma");
  recusa(plano({ rodadas: [rd(1, [2]), rd(2, [1])] }), "ciclo");
  recusa(plano({ rodadas: [rd(1, [3]), rd(2), rd(3, [2]), rd(4, [1, 9])] }), "não existe");
  recusa(plano({ rodadas: [{ ...rd(1), depende: [{ demanda_id: "I-2", rodada_id: 2 }] }, rd(2)] }), "outra demanda");
});

test("dependência de ticket recusa autorreferência, ciclo, outra demanda e inexistente", () => {
  recusa(plano({ tickets: [tk(1, 1, [1])] }), "de si mesmo");
  recusa(plano({ tickets: [tk(1, 1, [2]), tk(2, 1, [1])] }), "ciclo");
  recusa(plano({ tickets: [tk(1, 1, [9])] }), "não existe");
  recusa(
    plano({ tickets: [{ ...tk(1, 1), depende: [{ demanda_id: "I-2", ticket_id: 2 }] }, tk(2, 1)] }),
    "outra demanda",
  );
});

test("CA-SDLC-19: dependência entre rodadas distintas ou com ticket sem rodada é rejeitada", () => {
  recusa(plano({ tickets: [tk(1, 1), tk(2, 2, [1])] }), "outra rodada");
  recusa(plano({ tickets: [tk(1), tk(2, 1, [1])] }), "sem rodada");
  recusa(plano({ tickets: [tk(1, 1), tk(2, undefined, [1])] }), "sem rodada");
});

test("CA-SDLC-19: critério citado ausente entre os CA-n da demanda é rejeitado", () => {
  recusa(plano({ rodadas: [{ ...rd(1), criterios: ["CA-9"] }] }), "cita o CA-9");
  recusa(plano({ rodadas: [{ ...rd(1), criterios: ["criterio"] }] }), "CA-n");
});

test("ticket do plano: arquivos_previstos relativos, par de modelo e effort válidos", () => {
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["/etc/passwd"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["a/../b"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["a\\b"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["C:/fora/segredo.ts"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["c:/fora/segredo.ts"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["C:\\fora\\segredo.ts"] }] }), "caminho relativo");
  recusa(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["a", "a"] }] }), "repete caminho");
  recusa(
    plano({ tickets: [{ ...tk(1), configuracao_agente: { modelo: { provedor: "openai" } } }] }),
    "esperava um texto",
  );
  recusa(plano({ tickets: [{ ...tk(1), configuracao_agente: { modelo: { nome: "gpt" } } }] }), "esperava um texto");
  recusa(plano({ tickets: [{ ...tk(1), configuracao_agente: { effort: "enorme" } }] }), "");
  recusa(plano({ tickets: [{ ...tk(1), titulo: "" }] }), "");
  assert.ok(
    PlanoProposto.safeParse(
      plano({
        rodadas: [rd(1)],
        tickets: [
          { ...tk(1, 1), configuracao_agente: { modelo: { provedor: "openai", nome: "gpt" }, effort: "high" } },
        ],
      }),
    ).success,
  );
});

test("CA-2: rodada declarada sem ticket é rejeitada, mas a demanda pode ter zero rodadas", () => {
  recusa(plano({ rodadas: [rd(1), rd(2)], tickets: [tk(1, 1)] }), "rodada 2 não tem ticket");
  recusa(plano({ rodadas: [rd(1)], tickets: [tk(1)] }), "rodada 1 não tem ticket");
  assert.ok(PlanoProposto.safeParse(plano({ rodadas: [], tickets: [tk(1)] })).success);
});

const planoComArquivos = (ticket: string[], rodada: string[], demanda: string[]) =>
  plano({
    arquivos_previstos: demanda,
    rodadas: [{ ...rd(1), arquivos_previstos: rodada }],
    tickets: [{ ...tk(1, 1), arquivos_previstos: ticket }],
  });

test("inclusão: Ticket ⊆ Rodada ⊆ Demanda aceita o plano que prevê cada arquivo nos três níveis", () => {
  assert.ok(PlanoProposto.safeParse(planoComArquivos(["a.ts"], ["a.ts", "b.ts"], ["a.ts", "b.ts", "c.ts"])).success);
});

test("inclusão: arquivo do ticket fora da rodada é recusado com o caminho, o ticket e a rodada", () => {
  recusa(
    planoComArquivos(["a.ts"], ["b.ts"], ["a.ts", "b.ts"]),
    "o arquivo a.ts do ticket 1 não está nos arquivos previstos da rodada 1",
  );
});

test("inclusão: arquivo da rodada fora da demanda é recusado com o caminho, a rodada e a demanda", () => {
  recusa(
    planoComArquivos(["a.ts"], ["a.ts"], ["b.ts"]),
    "o arquivo a.ts da rodada 1 não está nos arquivos previstos da demanda I-1",
  );
});

test("inclusão: ticket sem rodada não é conferido contra a rodada", () => {
  assert.ok(
    PlanoProposto.safeParse(plano({ tickets: [{ ...tk(1), arquivos_previstos: ["a.ts"] }], rodadas: [] })).success,
  );
});

test("leitor de plano gravado: plano antigo troca caminhos por arquivos_previstos e une os tickets em rodada e demanda", () => {
  const antigo = {
    demanda_id: "I-1",
    criterios: [],
    rodadas: [
      { demanda_id: "I-1", rodada_id: 1, titulo: "r1", e2e: false },
      { demanda_id: "I-1", rodada_id: 2, titulo: "r2", e2e: false },
    ],
    tickets: [
      { demanda_id: "I-1", ticket_id: 1, titulo: "t1", descricao: "d", rodada_id: 1, caminhos: ["a.ts", "b.ts"] },
      { demanda_id: "I-1", ticket_id: 2, titulo: "t2", descricao: "d", rodada_id: 1, caminhos: ["b.ts"] },
      { demanda_id: "I-1", ticket_id: 3, titulo: "t3", descricao: "d", rodada_id: 2 },
    ],
  };
  const lido = lerPlanoGravado(antigo);
  assert.deepEqual(lido.arquivos_previstos, ["a.ts", "b.ts"]);
  assert.deepEqual(
    lido.rodadas.map((r) => r.arquivos_previstos),
    [["a.ts", "b.ts"], []],
  );
  assert.deepEqual(
    lido.tickets.map((t) => t.arquivos_previstos),
    [["a.ts", "b.ts"], ["b.ts"], []],
  );
});

test("leitor de plano gravado: plano novo mantém os arquivos previstos de cada nível", () => {
  const novo = planoComArquivos(["a.ts"], ["a.ts", "b.ts"], ["a.ts", "b.ts", "c.ts"]);
  assert.deepEqual(lerPlanoGravado(novo), PlanoProposto.parse(novo));
});

test("leitor de plano gravado: dado que não é plano lança o motivo do plano", () => {
  assert.throws(() => lerPlanoGravado({ demanda_id: "I-1" }), /rodadas/);
  assert.throws(() => lerPlanoGravado(planoComArquivos(["a.ts"], ["b.ts"], ["a.ts", "b.ts"])), /rodada 1/);
});
