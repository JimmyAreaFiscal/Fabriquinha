import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AgregadoDemanda,
  DecisaoDemanda,
  Demanda,
  donoDe,
  EvidenciaDemanda,
  TicketDemanda,
} from "./agregado_demanda.ts";

const em = "2026-01-01T00:00:00Z";
const demanda = (m: Record<string, unknown> = {}) => ({
  id: "I-1",
  projeto: "p",
  titulo: "t",
  tipo: "funcionalidade",
  descricao: "d",
  fase: "registro",
  fase_alterada_em: em,
  origem_ferramenta: "claude",
  origem_sessao: "s1",
  enviada: false,
  branch: "fabriquinha/I-1",
  ...m,
});
const ticket = (ticket_id = 1, m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  ticket_id,
  etapa: "demanda",
  status: "aberto",
  status_alterado_em: em,
  ...m,
});
const decisao = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  ticket_id: 1,
  decisao_id: 1,
  resultado: "aprovado",
  por: "auditor",
  em,
  ...m,
});
const evidencia = (m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  tipo: "criterios_aceite",
  dados: {},
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
  assert.ok(!Demanda.safeParse(demanda({ fase: "desenho" })).success);
  assert.ok(TicketDemanda.safeParse(ticket()).success);
  assert.ok(!TicketDemanda.safeParse(ticket(1, { status: "x" })).success);
  assert.ok(DecisaoDemanda.safeParse(decisao({ nota: 5, motivo: "ok" })).success);
  assert.ok(!DecisaoDemanda.safeParse(decisao({ nota: 0 })).success);
  assert.ok(!DecisaoDemanda.safeParse(decisao({ nota: 6 })).success);
  assert.ok(!DecisaoDemanda.safeParse({ ...decisao(), demanda_id: undefined }).success);
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
  recusa(agregado({ decisoes: [decisao({ resultado: "recusado" })] }), "exige motivo");
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
    em: "2026-01-01T00:00:00Z",
  });
  assert.equal(donoDe(e), "demanda");
  assert.equal(donoDe({ ...e, rodada_id: 2, ticket_id: undefined }), "rodada");
});

const rodada = (rodada_id = 1, m: Record<string, unknown> = {}) => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  fase: "desenvolvimento",
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
        tickets: [rodadaDoTicket(1), rodadaDoTicket(2), ticket(3, { modelo_provedor: "p", modelo_nome: "m" })],
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
  recusa(agregado({ tickets: [ticket(1, { modelo_nome: "m" })] }), "juntos");
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
