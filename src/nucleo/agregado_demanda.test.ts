import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgregadoDemanda,
  Decisao,
  Demanda,
  donoDe,
  EvidenciaDemanda,
  prDaDemanda,
  TicketDemanda,
} from "./agregado_demanda.ts";
import { AUDITOR, FABRIQUINHA } from "./ator.ts";
import { Endereco } from "./item_de_trabalho.ts";

const em = "2026-01-01T00:00:00Z";
const demanda = (m: Record<string, unknown> = {}) => ({
  id: "I-1",
  projeto: "p",
  titulo: "t",
  tipo: "funcionalidade",
  descricao: "d",
  estado: "entender_e_desenhar",
  estado_alterado_em: em,
  criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
  enviada: false,
  branch: "fabriquinha/I-1",
  ...m,
});
const ticket = (ticket_id = 1, m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  ticket_id,
  etapa: "entender_e_desenhar",
  estado: "aberto",
  estado_alterado_em: em,
  criado_por: FABRIQUINHA,
  ...m,
});
const decisao = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  ticket_id: 1,
  decisao_id: 1,
  gate: "gate_demanda",
  resultado: "aprovado",
  por: AUDITOR,
  em,
  ...m,
});
const evidencia = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  tipo: "criterios_aceite",
  dados: {},
  autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
  em,
  ...m,
});
const agregado = (m: Record<string, unknown> = {}) => ({
  demanda: demanda(),
  tickets: [ticket()],
  decisoes: [],
  evidencias: [],
  ...m,
});
const recusa = (valor: unknown, trecho: string) => {
  const r = AgregadoDemanda.safeParse(valor);
  assert.ok(!r.success, "deveria recusar");
  assert.ok(
    r.error.issues.some((i) => i.message.includes(trecho)),
    r.error.message,
  );
};

test("campos da demanda, ticket e decisão", () => {
  assert.ok(Demanda.safeParse(demanda()).success);
  assert.ok(!Demanda.safeParse(demanda({ branch: "fabriquinha/I-2" })).success);
  assert.ok(!Demanda.safeParse(demanda({ estado: "desenho" })).success);
  assert.ok(TicketDemanda.safeParse(ticket()).success);
  assert.ok(!TicketDemanda.safeParse(ticket(1, { estado: "x" })).success);
  assert.ok(Decisao.safeParse(decisao({ nota: 5, motivo: "ok" })).success);
  assert.ok(!Decisao.safeParse(decisao({ nota: 0 })).success);
  assert.ok(!Decisao.safeParse(decisao({ nota: 6 })).success);
  assert.ok(!Decisao.safeParse({ ...decisao(), demanda_id: undefined }).success);
  assert.ok(!Decisao.safeParse({ ...decisao(), gate: undefined }).success);
  assert.ok(!Decisao.safeParse(decisao({ gate: "registro" })).success);
  assert.ok(!Decisao.safeParse(decisao({ resultado: "inexistente" })).success);
});

test("criado_por, autor e por são obrigatórios e validam a identidade do ator", () => {
  const identidadesInvalidas: unknown[] = [
    undefined,
    null,
    "auditor",
    {},
    { tipo: "desconhecido" },
    { tipo: "agente" },
    { tipo: "agente", trabalho_id: "" },
    { tipo: "externo", ferramenta: "Claude Code", sessao: "s1" },
    { tipo: "externo", ferramenta: "claude", sessao: "" },
  ];
  for (const identidade of identidadesInvalidas) {
    assert.equal(TicketDemanda.safeParse(ticket(1, { criado_por: identidade })).success, false);
    assert.equal(EvidenciaDemanda.safeParse(evidencia({ autor: identidade })).success, false);
    assert.equal(Decisao.safeParse(decisao({ por: identidade })).success, false);
  }
  for (const identidade of [AUDITOR, FABRIQUINHA, { tipo: "agente", trabalho_id: "E-1" }]) {
    assert.deepEqual(TicketDemanda.parse(ticket(1, { criado_por: identidade })).criado_por, identidade);
    assert.deepEqual(EvidenciaDemanda.parse(evidencia({ autor: identidade })).autor, identidade);
    assert.deepEqual(Decisao.parse(decisao({ por: identidade })).por, identidade);
  }
});

test("criado_por do ticket recusa o externo, que o banco não consegue reler", () => {
  const externo = { tipo: "externo", ferramenta: "claude", sessao: "s1" };
  assert.equal(TicketDemanda.safeParse(ticket(1, { criado_por: externo })).success, false);
  assert.ok(EvidenciaDemanda.safeParse(evidencia({ autor: externo })).success);
});

test("criada_por exige um externo com ferramenta Slug e sessão não vazia", () => {
  for (const identidade of [
    undefined,
    null,
    {},
    AUDITOR,
    FABRIQUINHA,
    { tipo: "agente", trabalho_id: "E-1" },
    { tipo: "externo", sessao: "s1" },
    { tipo: "externo", ferramenta: "Claude Code", sessao: "s1" },
    { tipo: "externo", ferramenta: "claude" },
    { tipo: "externo", ferramenta: "claude", sessao: "" },
  ]) {
    assert.equal(Demanda.safeParse(demanda({ criada_por: identidade })).success, false);
  }
  assert.deepEqual(Demanda.parse(demanda()).criada_por, { tipo: "externo", ferramenta: "claude", sessao: "s1" });
});

test("Tentativas pertencem à demanda e a um ticket existente; histórico independe do estado atual", () => {
  assert.deepEqual(AgregadoDemanda.parse(agregado()).tentativas, []);
  const tentativa = {
    ticket: Endereco.doTicket("I-1", 1),
    numero: 1,
    inicio: em,
    fim: em,
    resultado: { tipo: "reprovacao", motivo: "m" },
  };
  for (const estado of ["aberto", "falhou", "cancelado"]) {
    assert.ok(
      AgregadoDemanda.safeParse(
        agregado({
          tickets: [ticket(1, { estado })],
          tentativas: [tentativa],
        }),
      ).success,
    );
  }
  recusa(
    agregado({ tentativas: [{ ...tentativa, ticket: Endereco.doTicket("I-2", 1) }] }),
    "não existe na demanda I-1",
  );
  recusa(agregado({ tentativas: [{ ...tentativa, ticket: Endereco.doTicket("I-1", 9) }] }), "não existe");
});

test("dono da evidência: demanda, rodada ou ticket, nunca rodada e ticket juntos (CA-10, CA-11)", () => {
  const sem = EvidenciaDemanda.parse(evidencia());
  assert.equal(donoDe(sem), "demanda");
  assert.equal(donoDe(EvidenciaDemanda.parse(evidencia({ rodada_id: 1 }))), "rodada");
  assert.equal(donoDe(EvidenciaDemanda.parse(evidencia({ ticket_id: 1 }))), "ticket");
  const r = EvidenciaDemanda.safeParse(evidencia({ rodada_id: 1, ticket_id: 1 }));
  assert.ok(!r.success);
  assert.match(r.error.message, /rodada_id e ticket_id não podem/);
  assert.ok(!EvidenciaDemanda.safeParse({ ...evidencia(), demanda_id: undefined }).success);
});

test("agregado válido e identidades compostas", () => {
  assert.ok(
    AgregadoDemanda.safeParse(
      agregado({
        tickets: [ticket(1), ticket(2)],
        decisoes: [decisao(), decisao({ ticket_id: 2 })],
        evidencias: [evidencia(), evidencia({ ticket_id: 1 }), evidencia({ rodada_id: 1 })],
      }),
    ).success,
  );
  recusa(agregado({ tickets: [ticket(1), ticket(1)] }), "se repete");
  recusa(agregado({ tickets: [ticket(1, { demanda_id: "I-2" })] }), "outra demanda");
  recusa(agregado({ decisoes: [decisao(), decisao()] }), "se repete");
  recusa(agregado({ decisoes: [decisao({ demanda_id: "I-2" })] }), "outra demanda");
  recusa(agregado({ decisoes: [decisao({ ticket_id: 9 })] }), "não existe");
  recusa(agregado({ decisoes: [decisao({ resultado: "reprovado" })] }), "exige motivo");
});

test("uma evidência ativa por tipo e dono (CA-9)", () => {
  recusa(agregado({ evidencias: [evidencia(), evidencia()] }), "mais de uma evidência");
  recusa(agregado({ evidencias: [evidencia({ demanda_id: "I-2" })] }), "outra demanda");
  recusa(agregado({ evidencias: [evidencia({ ticket_id: 9 })] }), "não existe");
});

test("CA-11: schema aceita dono null/null e normaliza para a demanda", () => {
  const e = EvidenciaDemanda.parse({
    demanda_id: "I-1",
    rodada_id: null,
    ticket_id: null,
    tipo: "criterios_aceite",
    dados: { v: 1 },
    autor: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    em: "2026-01-01T00:00:00Z",
  });
  assert.equal(donoDe(e), "demanda");
  assert.equal(donoDe({ ...e, rodada_id: 2, ticket_id: undefined }), "rodada");
});

const rodada = (rodada_id = 1, m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado: "implementar",
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
  ...m,
});

test("estado materializado do plano: rodadas, critérios, caminhos e dependências", () => {
  const rodadaDoTicket = (id: number) => ticket(id, { rodada_id: 1 });
  assert.ok(
    AgregadoDemanda.safeParse(
      agregado({
        rodadas: [rodada(1), rodada(2)],
        tickets: [
          rodadaDoTicket(1),
          rodadaDoTicket(2),
          ticket(3, { configuracao_agente: { modelo: { provedor: "p", nome: "m" } } }),
        ],
        dependencias_rodada: [{ demanda_id: "I-1", rodada_id: 2, depende_rodada_id: 1 }],
        criterios_citados: [{ demanda_id: "I-1", rodada_id: 1, criterio_id: "CA-1" }],
        dependencias_ticket: [{ demanda_id: "I-1", ticket_id: 2, depende_ticket_id: 1 }],
        caminhos_ticket: [{ demanda_id: "I-1", ticket_id: 1, caminho: "src/a.ts" }],
      }),
    ).success,
  );
  const d = (m: Record<string, unknown>) => ({ demanda_id: "I-1", ...m });
  recusa(agregado({ rodadas: [rodada(1), rodada(1)] }), "rodada 1 se repete");
  recusa(agregado({ rodadas: [rodada(1, { demanda_id: "I-2" })] }), "outra demanda");
  recusa(agregado({ rodadas: [rodada(1, { branch: "x" })] }), "branch da rodada");
  recusa(agregado({ tickets: [ticket(1, { rodada_id: 9 })] }), "rodada 9, que não existe");
  recusa(agregado({ tickets: [ticket(1, { configuracao_agente: { modelo: { nome: "m" } } })] }), "esperava um texto");
  recusa(agregado({ caminhos_ticket: [{ ...d({ ticket_id: 1, caminho: "a" }), demanda_id: "I-2" }] }), "outra demanda");
  recusa(
    agregado({ rodadas: [rodada(1)], dependencias_rodada: [d({ rodada_id: 1, depende_rodada_id: 1 })] }),
    "de si mesma",
  );
  recusa(
    agregado({ rodadas: [rodada(1)], dependencias_rodada: [d({ rodada_id: 1, depende_rodada_id: 2 })] }),
    "não existe",
  );
  recusa(agregado({ criterios_citados: [d({ rodada_id: 3, criterio_id: "CA-1" })] }), "rodada 3, que não existe");
  recusa(agregado({ caminhos_ticket: [d({ ticket_id: 7, caminho: "a" })] }), "ticket 7, que não existe");
  recusa(agregado({ dependencias_ticket: [d({ ticket_id: 1, depende_ticket_id: 1 })] }), "de si mesmo");
  recusa(agregado({ dependencias_ticket: [d({ ticket_id: 1, depende_ticket_id: 7 })] }), "ticket que não existe");
  recusa(
    agregado({
      rodadas: [rodada(1), rodada(2)],
      tickets: [ticket(1, { rodada_id: 1 }), ticket(2, { rodada_id: 2 })],
      dependencias_ticket: [d({ ticket_id: 2, depende_ticket_id: 1 })],
    }),
    "mesma rodada",
  );
});

test("encerramento: ausente continua válido e cada invariante recusa", () => {
  const enc = (m: Record<string, unknown> = {}) => ({
    demanda_id: "I-1",
    branch: "fabriquinha/I-1",
    base: "develop",
    limpeza_pendente: [],
    ...m,
  });
  const emEncerramento = (encerramento: unknown, tickets = [ticket()]) =>
    agregado({ demanda: demanda({ estado: "encerrar_demanda" }), tickets, encerramento });
  assert.ok(AgregadoDemanda.safeParse(agregado()).success);
  assert.ok(AgregadoDemanda.safeParse(emEncerramento(enc())).success);
  assert.ok(AgregadoDemanda.safeParse({ ...emEncerramento(enc()), demanda: demanda({ estado: "concluida" }) }).success);
  for (const estado of ["cancelada", "arquivada"])
    assert.ok(AgregadoDemanda.safeParse({ ...emEncerramento(enc()), demanda: demanda({ estado }) }).success);
  for (const estado of [
    "entender_e_desenhar",
    "gate_demanda",
    "planejar",
    "gate_planejamento",
    "em_execucao",
    "revisar_demanda",
  ])
    recusa({ ...emEncerramento(enc()), demanda: demanda({ estado }) }, "só existe nos estados");
  recusa(agregado({ encerramento: enc() }), "só existe nos estados");
  recusa(emEncerramento(enc({ demanda_id: "I-2", branch: "fabriquinha/I-2" })), "outra demanda");
  recusa(emEncerramento(enc({ branch: "main" })), "branch do encerramento");
  recusa(emEncerramento(enc({ integracao: { sha: "d" } })), "exige o PR");
  recusa(emEncerramento(enc({ limpeza_pendente: ["a"] })), "exige a integração");
  recusa(emEncerramento(enc({ conflito_pendente: { ticket_id: 1 } })), "resolver_conflito existente");
  recusa(emEncerramento(enc({ conflito_pendente: { ticket_id: 9 } })), "resolver_conflito existente");
  const resolver = ticket(2, { etapa: "resolver_conflito" });
  assert.ok(
    AgregadoDemanda.safeParse(emEncerramento(enc({ conflito_pendente: { ticket_id: 2 } }), [ticket(), resolver]))
      .success,
  );
});

test("pull_requests: um PR por Espaço, de rodada que existe; o final é o sem rodada e a integração o exige", () => {
  const pr = (m: Record<string, unknown> = {}) => ({
    numero: 7,
    url: "https://h/pr/7",
    head: "abc",
    estado: "aberto",
    atualizado_em: em,
    ...m,
  });
  const emEncerramento = (pull_requests: unknown[]) =>
    agregado({
      demanda: demanda({ estado: "encerrar_demanda" }),
      encerramento: {
        demanda_id: "I-1",
        branch: "fabriquinha/I-1",
        base: "develop",
        integracao: { sha: "d" },
        limpeza_pendente: [],
      },
      pull_requests,
    });
  assert.deepEqual(AgregadoDemanda.parse(agregado()).pull_requests, []);
  assert.deepEqual(
    prDaDemanda(AgregadoDemanda.parse(agregado({ rodadas: [rodada(1)], pull_requests: [pr({ rodada_id: 1 })] }))),
    undefined,
  );
  const final = AgregadoDemanda.parse(emEncerramento([pr()]));
  assert.equal(prDaDemanda(final)?.numero, 7);
  recusa(emEncerramento([]), "a integração exige o PR final");
  recusa(emEncerramento([pr({ rodada_id: 1 })]), "a integração exige o PR final");
  recusa(agregado({ pull_requests: [pr({ rodada_id: 9 })] }), "rodada 9, que não existe");
  recusa(agregado({ pull_requests: [pr(), pr({ numero: 8 })] }), "mais de um PR para o mesmo Espaço");
  recusa(agregado({ pull_requests: [pr({ estado: "perdido" })] }), "Opção inválida");
  recusa(agregado({ pull_requests: [pr({ url: "pull/7" })] }), "URL inválido");
});
