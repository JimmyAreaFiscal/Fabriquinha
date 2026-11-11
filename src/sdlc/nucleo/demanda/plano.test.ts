import assert from "node:assert/strict";
import { test } from "node:test";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { type Ator, FABRIQUINHA } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { Endereco } from "../../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import {
  CorrecaoDoPlano,
  correcaoDasRodadasNovas,
  correcaoDosTicketsDaRodada,
  lerPlanoGravado,
  materializar,
  Plano,
  PlanoProposto,
} from "./plano.ts";

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

// ——— Versões do Plano: `materializar` é o único caminho que cria Rodadas e Tickets ———

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const D = "I-1";
const REVISOR: Ator = { tipo: "agente", trabalho_id: "E-revisor" };
const ticketDoAgregado = (ticket_id: number, rodada_id: number | undefined, etapa = "implementar") => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  etapa,
  estado: "concluido",
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rodadaDoAgregado = (rodada_id: number) => ({
  demanda_id: D,
  rodada_id,
  titulo: "r",
  estado: "concluida",
  estado_alterado_em: t0,
  e2e: false,
  branch: `fabriquinha/${D}-${String(rodada_id)}`,
});
const VERSAO_1 = {
  demanda_id: D,
  numero: 1,
  origem: "aprovacao_do_planejamento",
  autor: FABRIQUINHA,
  criada_em: t0,
  dados: {},
};
// IDs esparsos: rodadas 1 e 5, tickets 1, 3, 9 e 20, e a versão 1 do Plano já gravada.
const agregadoComPlano = (): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: `fabriquinha/${D}`,
    },
    decisoes: [],
    evidencias: [
      {
        demanda_id: D,
        tipo: "criterios_aceite",
        autor: { tipo: "externo", ferramenta: "f", sessao: "s" },
        dados: { criterios: [{ id: "CA-1" }, { id: "CA-2" }] },
        em: t0,
      },
    ],
    tickets: [
      { ...ticketDoAgregado(1, undefined, "entender_e_desenhar") },
      ticketDoAgregado(3, 1),
      ticketDoAgregado(9, 5),
      ticketDoAgregado(20, 5),
    ],
    rodadas: [rodadaDoAgregado(1), rodadaDoAgregado(5)],
    dependencias_ticket: [{ demanda_id: D, ticket_id: 20, depende_ticket_id: 9 }],
    caminhos_ticket: [{ demanda_id: D, ticket_id: 3, caminho: "a.ts" }],
    arquivos_previstos_rodada: [
      { demanda_id: D, rodada_id: 1, caminho: "a.ts" },
      { demanda_id: D, rodada_id: 5, caminho: "a.ts" },
    ],
    arquivos_previstos_demanda: [{ demanda_id: D, caminho: "a.ts" }],
    versoes_plano: [VERSAO_1],
  });
const ticketCorretivo = (ticket_id: number, rodada_id: number | undefined, extra = {}) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  titulo: `t${String(ticket_id)}`,
  descricao: "d",
  ...extra,
});
const daRodada5 = (
  tickets: unknown,
  origem: "revisao_rodada" | "ajustar_resultado" | "conferencia_do_pr" = "revisao_rodada",
) => correcaoDosTicketsDaRodada(origem, REVISOR, 5, tickets);
const recusaDaMaterializacao = (fazer: (ag: AgregadoDemanda) => unknown, trecho: string) => {
  const ag = agregadoComPlano();
  const antes = structuredClone(ag);
  assert.throws(
    () => fazer(ag),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes(trecho),
  );
  assert.deepEqual(ag, antes);
};

test("correção de rodada: renumera depois do máximo, mapeia vínculos, grava a versão 2 e preserva o resto", () => {
  const ag = agregadoComPlano();
  const antes = structuredClone(ag);
  const configuracao = { modelo: { provedor: "anthropic", nome: "m" }, effort: "high" };
  const novo = materializar(
    ag,
    daRodada5([
      ticketCorretivo(7, 5, {
        arquivos_previstos: ["x.ts", "a.ts"],
        depende: [{ demanda_id: D, ticket_id: 2 }],
        configuracao_agente: configuracao,
      }),
      ticketCorretivo(2, 5, { estado: "concluido", etapa: "revisar_rodada" }),
    ]),
    { agora: t1 },
  );
  assert.deepEqual(ag, antes);
  assert.deepEqual(novo.tickets.slice(0, 4), ag.tickets);
  assert.deepEqual(
    novo.tickets.slice(4).map((x) => [x.ticket_id, x.rodada_id, x.titulo, x.etapa, x.estado, x.estado_alterado_em]),
    [
      [21, 5, "t2", "implementar", "aberto", t1],
      [22, 5, "t7", "implementar", "aberto", t1],
    ],
  );
  assert.deepEqual(
    novo.tickets.slice(4).map((ticket) => ticket.criado_por),
    [REVISOR, REVISOR],
  );
  assert.deepEqual(novo.tickets[5]?.configuracao_agente, configuracao);
  assert.deepEqual(novo.dependencias_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, depende_ticket_id: 21 }]);
  assert.deepEqual(novo.caminhos_ticket.slice(1), [
    { demanda_id: D, ticket_id: 22, caminho: "x.ts" },
    { demanda_id: D, ticket_id: 22, caminho: "a.ts" },
  ]);
  assert.deepEqual(novo.rodadas, ag.rodadas);
  assert.deepEqual(novo.decisoes, ag.decisoes);
  assert.equal(novo.demanda.estado, "em_execucao");
  // Os arquivos sobem: x.ts entra na rodada 5 e na demanda; a.ts já estava nos dois e não se repete.
  assert.deepEqual(novo.arquivos_previstos_rodada.slice(2), [{ demanda_id: D, rodada_id: 5, caminho: "x.ts" }]);
  assert.deepEqual(novo.arquivos_previstos_demanda.slice(1), [{ demanda_id: D, caminho: "x.ts" }]);
  assert.equal(novo.versoes_plano.length, 2);
  const versao = novo.versoes_plano[1];
  assert.deepEqual(
    [versao?.numero, versao?.origem, versao?.autor, versao?.rodada_id, versao?.criada_em],
    [2, "revisao_rodada", REVISOR, 5, t1],
  );
  const gravada = CorrecaoDoPlano.parse(versao?.dados);
  assert.deepEqual(
    gravada.tickets_novos.map((x) => [x.ticket_id, x.titulo, x.rodada_id]),
    [
      [21, "t2", 5],
      [22, "t7", 5],
    ],
  );
  assert.deepEqual(gravada.tickets_novos[1]?.depende, [{ demanda_id: D, ticket_id: 21 }]);
  assert.deepEqual(gravada.arquivos_acrescentados, ["x.ts", "a.ts"]);
});

test("correção: cada origem é gravada com o autor e a numeração segue a última versão", () => {
  let ag = agregadoComPlano();
  for (const origem of ["revisao_rodada", "ajustar_resultado", "conferencia_do_pr"] as const) {
    ag = materializar(ag, daRodada5([ticketCorretivo(1, 5)], origem), { agora: t1 });
  }
  assert.deepEqual(
    ag.versoes_plano.map((v) => [v.numero, v.origem, v.autor.tipo]),
    [
      [1, "aprovacao_do_planejamento", "fabriquinha"],
      [2, "revisao_rodada", "agente"],
      [3, "ajustar_resultado", "agente"],
      [4, "conferencia_do_pr", "agente"],
    ],
  );
  const semVersoes = materializar({ ...agregadoComPlano(), versoes_plano: [] }, daRodada5([ticketCorretivo(1, 5)]), {
    agora: t1,
  });
  assert.equal(semVersoes.versoes_plano[0]?.numero, 1);
});

test("correção de rodada: recusa vazio, rodada inexistente e ticket de outra rodada, global ou de outra demanda", () => {
  const materializarEm = (rodada: number, tickets: unknown) => (ag: AgregadoDemanda) =>
    materializar(ag, correcaoDosTicketsDaRodada("revisao_rodada", REVISOR, rodada, tickets), { agora: t1 });
  recusaDaMaterializacao(materializarEm(5, []), "vazia");
  recusaDaMaterializacao(materializarEm(6, [ticketCorretivo(1, 6)]), "não existe");
  recusaDaMaterializacao(materializarEm(5, [ticketCorretivo(1, 1)]), "não é da rodada 5");
  recusaDaMaterializacao(materializarEm(5, [ticketCorretivo(1, undefined)]), "não é da rodada 5");
  recusaDaMaterializacao(materializarEm(5, [{ ...ticketCorretivo(1, 5), demanda_id: "I-2" }]), "outra demanda");
  assert.throws(() => daRodada5("x"), /inválida/);
  assert.throws(() => daRodada5(undefined), /inválida/);
});

test("correção de rodada: recusa caminho inseguro, duplicata, ciclo, dependência fora do fragmento e modelo incompleto", () => {
  for (const caminho of ["/abs", "../fora", "a\\b", "C:/x"]) {
    assert.throws(() => daRodada5([ticketCorretivo(1, 5, { arquivos_previstos: [caminho] })]), /inválida/);
  }
  const materializarOs = (tickets: unknown[]) => (ag: AgregadoDemanda) =>
    materializar(ag, daRodada5(tickets), { agora: t1 });
  recusaDaMaterializacao(materializarOs([ticketCorretivo(1, 5), ticketCorretivo(1, 5)]), "se repete");
  recusaDaMaterializacao(materializarOs([ticketCorretivo(1, 5, { arquivos_previstos: ["a", "a"] })]), "repete caminho");
  const dependendo = (a: number, b: number) => ticketCorretivo(a, 5, { depende: [{ demanda_id: D, ticket_id: b }] });
  recusaDaMaterializacao(materializarOs([dependendo(1, 2), dependendo(2, 1)]), "ciclo");
  recusaDaMaterializacao(materializarOs([dependendo(1, 9)]), "não existe"); // o ticket 9 é do agregado
  assert.throws(
    () => daRodada5([ticketCorretivo(1, 5, { configuracao_agente: { modelo: { nome: "m" } } })]),
    /esperava um texto/,
  );
});

test("correção: uma rodada existente ou rodadas novas, nunca as duas", () => {
  const rodadaNova = { demanda_id: D, rodada_id: 1, titulo: "r", e2e: false };
  const ambas = {
    origem: "revisao_rodada",
    autor: REVISOR,
    rodada: 5,
    rodadas_novas: [rodadaNova],
    tickets_novos: [ticketCorretivo(1, 1)],
    arquivos_acrescentados: [],
  };
  assert.ok(!CorrecaoDoPlano.safeParse(ambas).success);
  assert.ok(CorrecaoDoPlano.safeParse({ ...ambas, rodada: undefined }).success);
});

const rodadaCorretiva = (rodada_id: number, extra = {}) => ({
  demanda_id: D,
  rodada_id,
  titulo: `r${String(rodada_id)}`,
  e2e: true,
  ...extra,
});
const planoCorretivo = (extra = {}) => ({
  demanda_id: D,
  criterios: ["CA-1", "CA-2"],
  rodadas: [
    rodadaCorretiva(2, { criterios: ["CA-2"], depende: [{ demanda_id: D, rodada_id: 1 }] }),
    rodadaCorretiva(1, { criterios: ["CA-1"] }),
  ],
  tickets: [
    ticketCorretivo(4, 2, { arquivos_previstos: ["n.ts"], depende: [{ demanda_id: D, ticket_id: 3 }] }),
    ticketCorretivo(3, 2),
    ticketCorretivo(8, 1, { configuracao_agente: { effort: "low", modelo: { provedor: "openai", nome: "g" } } }),
  ],
  ...extra,
});
const rodadasNovas = (plano: unknown) => (ag: AgregadoDemanda) =>
  materializar(ag, correcaoDasRodadasNovas(REVISOR, plano), { agora: t1 });

test("rodadas corretivas: acrescenta rodadas novas com IDs e vínculos remapeados, sem tocar no antigo", () => {
  const ag = agregadoComPlano();
  const antes = structuredClone(ag);
  const novo = rodadasNovas(planoCorretivo())(ag);
  assert.deepEqual(ag, antes);
  assert.deepEqual(novo.rodadas.slice(0, 2), ag.rodadas);
  assert.deepEqual(
    novo.rodadas.slice(2).map((r) => [r.rodada_id, r.titulo, r.estado, r.e2e, r.branch]),
    [
      [6, "r1", "implementar", true, "fabriquinha/I-1-6"],
      [7, "r2", "implementar", true, "fabriquinha/I-1-7"],
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
    novo.tickets
      .slice(4)
      .map((x) => [
        x.ticket_id,
        x.rodada_id,
        x.estado,
        x.configuracao_agente?.effort,
        x.configuracao_agente?.modelo?.nome,
      ]),
    [
      [21, 7, "aberto", undefined, undefined],
      [22, 7, "aberto", undefined, undefined],
      [23, 6, "aberto", "low", "g"],
    ],
  );
  assert.deepEqual(novo.dependencias_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, depende_ticket_id: 21 }]);
  assert.deepEqual(novo.caminhos_ticket.slice(1), [{ demanda_id: D, ticket_id: 22, caminho: "n.ts" }]);
  assert.deepEqual(
    novo.tickets.slice(4).map((ticket) => ticket.criado_por),
    [REVISOR, REVISOR, REVISOR],
  );
  assert.deepEqual(novo.evidencias, ag.evidencias);
  assert.equal(novo.demanda.estado, "em_execucao");
  // Os arquivos da rodada nova nascem com ela e sobem à demanda.
  assert.deepEqual(novo.arquivos_previstos_rodada.slice(2), [{ demanda_id: D, rodada_id: 7, caminho: "n.ts" }]);
  assert.deepEqual(novo.arquivos_previstos_demanda.slice(1), [{ demanda_id: D, caminho: "n.ts" }]);
  const versao = novo.versoes_plano[1];
  assert.deepEqual([versao?.numero, versao?.origem, versao?.rodada_id], [2, "revisao_demanda", undefined]);
  const gravada = CorrecaoDoPlano.parse(versao?.dados);
  assert.deepEqual(
    gravada.rodadas_novas.map((r) => [r.rodada_id, r.arquivos_previstos]),
    [
      [6, []],
      [7, ["n.ts"]],
    ],
  );
  assert.deepEqual(gravada.rodadas_novas[1]?.depende, [{ demanda_id: D, rodada_id: 6 }]);
  assert.deepEqual(
    gravada.tickets_novos.map((x) => [x.ticket_id, x.titulo]),
    [
      [21, "t3"],
      [22, "t4"],
      [23, "t8"],
    ],
  );
  assert.deepEqual(gravada.arquivos_acrescentados, ["n.ts"]);
});

test("rodadas corretivas: recusa vazio, demanda alheia, global, rodada sem ticket, escopo e grafos inválidos", () => {
  recusaDaMaterializacao(rodadasNovas(planoCorretivo({ rodadas: [], tickets: [] })), "não tem rodadas");
  const semTickets = CorrecaoDoPlano.parse({
    origem: "revisao_demanda",
    autor: REVISOR,
    rodadas_novas: [rodadaCorretiva(1)],
    tickets_novos: [],
    arquivos_acrescentados: [],
  });
  recusaDaMaterializacao((ag) => materializar(ag, semTickets, { agora: t1 }), "a lista de correções está vazia");
  const alheio = {
    ...planoCorretivo(),
    rodadas: [{ ...rodadaCorretiva(1), demanda_id: "I-2" }],
    tickets: [{ ...ticketCorretivo(3, 1), demanda_id: "I-2" }],
  };
  recusaDaMaterializacao(rodadasNovas(alheio), "I-2");
  recusaDaMaterializacao(
    rodadasNovas(
      planoCorretivo({
        rodadas: [rodadaCorretiva(2)],
        tickets: [ticketCorretivo(3, 2), ticketCorretivo(4, undefined)],
      }),
    ),
    "não tem rodada",
  );
  recusaDaMaterializacao(
    rodadasNovas(planoCorretivo({ tickets: [ticketCorretivo(3, 2)] })),
    "não tem ticket de implementação",
  );
  recusaDaMaterializacao(
    rodadasNovas(
      planoCorretivo({
        rodadas: [rodadaCorretiva(1, { criterios: ["CA-9"] })],
        tickets: [ticketCorretivo(3, 1)],
        criterios: ["CA-9"],
      }),
    ),
    "CA-9",
  );
  assert.throws(() => correcaoDasRodadasNovas(REVISOR, planoCorretivo({ criterios: [] })), /a demanda não tem/);
  assert.throws(
    () =>
      correcaoDasRodadasNovas(
        REVISOR,
        planoCorretivo({
          rodadas: [rodadaCorretiva(1, { depende: [{ demanda_id: D, rodada_id: 5 }] }), rodadaCorretiva(2)],
        }),
      ),
    /não existe/,
  );
  const ciclo = [
    rodadaCorretiva(1, { depende: [{ demanda_id: D, rodada_id: 2 }] }),
    rodadaCorretiva(2, { depende: [{ demanda_id: D, rodada_id: 1 }] }),
  ];
  assert.throws(() => correcaoDasRodadasNovas(REVISOR, planoCorretivo({ rodadas: ciclo })), /ciclo/);
  assert.throws(
    () => correcaoDasRodadasNovas(REVISOR, planoCorretivo({ rodadas: [rodadaCorretiva(1), rodadaCorretiva(1)] })),
    /se repete/,
  );
  assert.throws(() => correcaoDasRodadasNovas(REVISOR, "x"), /inválida/);
});

test("rodadas corretivas: sem definição congelada nenhum CA é aceito", () => {
  const ag = { ...agregadoComPlano(), evidencias: [] };
  assert.throws(() => rodadasNovas(planoCorretivo())(ag), /CA-1.*que a definição da demanda I-1 não tem/);
});

test("rodadas corretivas: o plano antigo, com caminhos nos tickets, vira arquivos previstos nos três níveis", () => {
  const antigo = {
    demanda_id: D,
    criterios: [],
    rodadas: [rodadaCorretiva(1)],
    tickets: [ticketCorretivo(3, 1, { caminhos: ["z.ts"] })],
  };
  const novo = rodadasNovas(antigo)(agregadoComPlano());
  assert.deepEqual(novo.caminhos_ticket.slice(1), [{ demanda_id: D, ticket_id: 21, caminho: "z.ts" }]);
  assert.deepEqual(novo.arquivos_previstos_rodada.slice(2), [{ demanda_id: D, rodada_id: 6, caminho: "z.ts" }]);
  assert.deepEqual(novo.arquivos_previstos_demanda.slice(1), [{ demanda_id: D, caminho: "z.ts" }]);
});

test("correção: arquivo acrescentado fora do nível de cima acrescenta também nos níveis de cima", () => {
  const correcao = { ...daRodada5([ticketCorretivo(1, 5)]), arquivos_acrescentados: ["so_a_rodada.ts"] };
  const novo = materializar(agregadoComPlano(), correcao, { agora: t1 });
  assert.deepEqual(novo.arquivos_previstos_rodada.slice(2), [
    { demanda_id: D, rodada_id: 5, caminho: "so_a_rodada.ts" },
  ]);
  assert.deepEqual(novo.arquivos_previstos_demanda.slice(1), [{ demanda_id: D, caminho: "so_a_rodada.ts" }]);
  assert.deepEqual(CorrecaoDoPlano.parse(novo.versoes_plano[1]?.dados).arquivos_acrescentados, ["so_a_rodada.ts"]);
});

test("aprovação: materializa o plano como versão 1, com as rodadas do plano e os tickets renumerados", () => {
  const base = AgregadoDemanda.parse({
    ...agregadoComPlano(),
    tickets: [ticketDoAgregado(1, undefined, "planejar")],
    rodadas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    arquivos_previstos_rodada: [],
    arquivos_previstos_demanda: [],
    versoes_plano: [],
  });
  const aprovado = PlanoProposto.parse({
    demanda_id: D,
    criterios: ["CA-1"],
    arquivos_previstos: ["a.ts", "b.ts"],
    rodadas: [
      {
        demanda_id: D,
        rodada_id: 3,
        titulo: "r3",
        e2e: true,
        criterios: ["CA-1"],
        arquivos_previstos: ["a.ts", "b.ts"],
      },
      {
        demanda_id: D,
        rodada_id: 4,
        titulo: "r4",
        e2e: false,
        depende: [{ demanda_id: D, rodada_id: 3 }],
        arquivos_previstos: ["b.ts"],
      },
    ],
    tickets: [
      ticketCorretivo(2, 3, { arquivos_previstos: ["b.ts"], depende: [{ demanda_id: D, ticket_id: 1 }] }),
      ticketCorretivo(1, 3, { arquivos_previstos: ["a.ts", "b.ts"] }),
      ticketCorretivo(5, 4, { arquivos_previstos: ["b.ts"] }),
    ],
  });
  const novo = materializar(base, aprovado, { agora: t1 });
  assert.deepEqual(
    novo.rodadas.map((r) => [r.rodada_id, r.estado, r.e2e, r.branch]),
    [
      [3, "implementar", true, "fabriquinha/I-1-3"],
      [4, "implementar", false, "fabriquinha/I-1-4"],
    ],
  );
  assert.deepEqual(
    novo.tickets.slice(1).map((x) => [x.ticket_id, x.rodada_id, x.etapa, x.estado, x.criado_por]),
    [
      [2, 3, "implementar", "aberto", FABRIQUINHA],
      [3, 3, "implementar", "aberto", FABRIQUINHA],
      [4, 4, "implementar", "aberto", FABRIQUINHA],
    ],
  );
  assert.deepEqual(novo.dependencias_ticket, [{ demanda_id: D, ticket_id: 3, depende_ticket_id: 2 }]);
  assert.deepEqual(novo.dependencias_rodada, [{ demanda_id: D, rodada_id: 4, depende_rodada_id: 3 }]);
  assert.deepEqual(novo.criterios_citados, [{ demanda_id: D, rodada_id: 3, criterio_id: "CA-1" }]);
  assert.deepEqual(
    novo.caminhos_ticket.map((c) => [c.ticket_id, c.caminho]),
    [
      [2, "a.ts"],
      [2, "b.ts"],
      [3, "b.ts"],
      [4, "b.ts"],
    ],
  );
  assert.deepEqual(
    novo.arquivos_previstos_rodada.map((c) => [c.rodada_id, c.caminho]),
    [
      [3, "a.ts"],
      [3, "b.ts"],
      [4, "b.ts"],
    ],
  );
  assert.deepEqual(
    novo.arquivos_previstos_demanda.map((c) => c.caminho),
    ["a.ts", "b.ts"],
  );
  assert.equal(novo.versoes_plano.length, 1);
  const versao = novo.versoes_plano[0];
  assert.deepEqual(
    [versao?.numero, versao?.origem, versao?.autor, versao?.rodada_id],
    [1, "aprovacao_do_planejamento", FABRIQUINHA, undefined],
  );
  assert.deepEqual(versao?.dados, JSON.parse(JSON.stringify(aprovado)));
});

test("Plano: a referência é o original e as correções acrescentam arquivos, rodadas e extras", () => {
  const original = PlanoProposto.parse(planoComArquivos(["a.ts"], ["a.ts", "b.ts"], ["a.ts", "b.ts", "c.ts"]));
  const semCorrecao = new Plano(original, []);
  assert.equal(semCorrecao.versaoAtual(), original);
  assert.deepEqual(semCorrecao.extras(), []);
  assert.deepEqual(semCorrecao.arquivosPrevistos(Endereco.daDemanda("I-1")), ["a.ts", "b.ts", "c.ts"]);
  assert.deepEqual(semCorrecao.arquivosPrevistos(Endereco.daRodada("I-1", 1)), ["a.ts", "b.ts"]);
  assert.deepEqual(semCorrecao.arquivosPrevistos(Endereco.daRodada("I-1", 9)), []);
  assert.deepEqual(semCorrecao.arquivosPrevistos(Endereco.doTicket("I-1", 1)), ["a.ts"]);
  const daRodada = daRodada5([]);
  const correcaoDaRodada1 = { ...daRodada, rodada: 1, arquivos_acrescentados: ["a.ts", "d.ts"] };
  const correcaoNova = {
    ...daRodada,
    rodada: undefined,
    rodadas_novas: [{ ...PlanoProposto.parse(planoComArquivos([], ["e.ts"], ["e.ts"])).rodadas[0], rodada_id: 2 }],
    tickets_novos: [
      {
        demanda_id: D,
        ticket_id: 7,
        rodada_id: 2,
        titulo: "t",
        descricao: "d",
        arquivos_previstos: ["e.ts"],
        depende: [],
      },
    ],
    arquivos_acrescentados: ["e.ts"],
  };
  const plano = new Plano(original, [CorrecaoDoPlano.parse(correcaoDaRodada1), CorrecaoDoPlano.parse(correcaoNova)]);
  assert.equal(plano.versaoAtual(), plano.correcoes[1]);
  assert.deepEqual(plano.extras(), ["d.ts", "e.ts"]);
  assert.deepEqual(plano.arquivosPrevistos(Endereco.daDemanda("I-1")), ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"]);
  assert.deepEqual(plano.arquivosPrevistos(Endereco.daRodada("I-1", 1)), ["a.ts", "b.ts", "d.ts"]);
  assert.deepEqual(plano.arquivosPrevistos(Endereco.daRodada("I-1", 2)), ["e.ts"]);
  assert.deepEqual(plano.arquivosPrevistos(Endereco.doTicket("I-1", 7)), ["e.ts"]);
});
