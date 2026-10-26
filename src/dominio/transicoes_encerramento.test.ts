import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import {
  concluirEncerramento,
  concluirResolucaoConflito,
  podeTentarEncerramento,
  registrarConflitoEncerramento,
  registrarFalhaEncerramento,
  registrarIntegracao,
  registrarTentativaEncerramento,
  solicitarIntegracao,
} from "./transicoes_encerramento.ts";
import { reabrirTicket } from "./transicoes_demanda.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const c = { agora: t1 };
const D = "I-1";
const tk = (ticket_id: number, etapa: string, status: string) => ({
  demanda_id: D,
  ticket_id,
  etapa,
  status,
  status_alterado_em: t0,
});
const montar = (m: Record<string, unknown> = {}, status = "aberto", fase = "encerramento") =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: t0,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    tickets: [tk(1, "demanda", "concluido"), tk(2, "encerrar_demanda", status)],
    decisoes: [],
    evidencias: [],
    ...m,
  });
const pr = { numero: 7, url: "https://h/pr/7" };
const tentativa = (m: Record<string, unknown> = {}) => ({ demanda_id: D, base: "develop", pr, sha: "s1", ...m });
const prog = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  branch: "fabriquinha/I-1",
  base: "develop",
  pr,
  sha_verificado: "s1",
  limpeza_pendente: [],
  ...m,
});
const comProgresso = (m: Record<string, unknown> = {}, status = "aberto") => montar({ encerramento: prog(m) }, status);
const emConflito = (statusResolver = "aberto") =>
  montar({
    tickets: [
      tk(1, "demanda", "concluido"),
      tk(2, "encerrar_demanda", "aberto"),
      tk(3, "resolver_conflito", statusResolver),
    ],
    encerramento: prog({ conflito_pendente: { ticket_id: 3 } }),
  });
const resolucao = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  testes: true,
  fitness: true,
  sonar: true,
  sha: "s2",
  ...m,
});
const regra = (fn: () => unknown) => {
  assert.throws(fn, ErroDeRegra);
};

test("CA-1 e CA-3: primeira tentativa grava PR, branch, base da entrada e SHA, sem mutar a entrada", () => {
  const ag = montar();
  const antes = structuredClone(ag);
  const novo = registrarTentativaEncerramento(ag, tentativa(), FABRIQUINHA);
  assert.deepEqual(novo.encerramento, prog());
  assert.equal(novo.encerramento.base, "develop");
  assert.deepEqual(ag, antes);
});

test("CA-2 e CA-13: retomada reaproveita o PR; repetição idêntica devolve agregado igual; PR ou base diferentes recusam", () => {
  const ag = comProgresso();
  assert.deepEqual(registrarTentativaEncerramento(ag, tentativa(), FABRIQUINHA), ag);
  regra(() => registrarTentativaEncerramento(ag, tentativa({ pr: { numero: 8, url: "u" } }), FABRIQUINHA));
  regra(() => registrarTentativaEncerramento(ag, tentativa({ base: "main" }), FABRIQUINHA));
  const semPr = montar({ encerramento: prog({ pr: undefined, sha_verificado: undefined }) });
  assert.deepEqual(registrarTentativaEncerramento(semPr, tentativa(), FABRIQUINHA).encerramento?.pr, pr);
});

test("tentativa aceita limpa conflito_pendente e falha de check_final, mas mantém a de integração", () => {
  const livre = emConflito("concluido");
  const novo = registrarTentativaEncerramento(
    AgregadoDemanda.parse({
      ...livre,
      encerramento: { ...livre.encerramento, falha: { etapa: "check_final", motivo: "x" } },
    }),
    tentativa({ sha: "s2" }),
    FABRIQUINHA,
  );
  assert.equal(novo.encerramento?.conflito_pendente, undefined);
  assert.equal(novo.encerramento?.falha, undefined);
  assert.equal(novo.encerramento?.sha_verificado, "s2");
  const integ = comProgresso({ falha: { etapa: "integracao", motivo: "x" } });
  assert.equal(
    registrarTentativaEncerramento(integ, tentativa(), FABRIQUINHA).encerramento?.falha?.etapa,
    "integracao",
  );
});

test("tentativa recusa quando podeTentarEncerramento é falso, outro ator, outra demanda e fase errada", () => {
  regra(() => registrarTentativaEncerramento(emConflito("aberto"), tentativa(), FABRIQUINHA));
  regra(() => registrarTentativaEncerramento(montar({}, "falhou"), tentativa(), FABRIQUINHA));
  regra(() => registrarTentativaEncerramento(montar({}, "aberto", "execucao"), tentativa(), FABRIQUINHA));
  regra(() => registrarTentativaEncerramento(montar(), tentativa({ demanda_id: "I-2" }), FABRIQUINHA));
  assert.throws(() => registrarTentativaEncerramento(montar(), tentativa(), AUDITOR), ErroDeEscopo);
  assert.throws(() => registrarTentativaEncerramento(montar(), tentativa({ extra: 1 }), FABRIQUINHA));
});

test("podeTentarEncerramento: sem conflito, resolver aberto/falho/concluído, encerrar falhou, fase errada, sem ticket", () => {
  assert.equal(podeTentarEncerramento(montar()), true);
  assert.equal(podeTentarEncerramento(comProgresso()), true);
  assert.equal(podeTentarEncerramento(emConflito("concluido")), true);
  assert.equal(podeTentarEncerramento(emConflito("aberto")), false);
  assert.equal(podeTentarEncerramento(emConflito("falhou")), false);
  assert.equal(podeTentarEncerramento(montar({}, "falhou")), false);
  assert.equal(podeTentarEncerramento(montar({}, "em_execucao")), false);
  assert.equal(podeTentarEncerramento(montar({}, "aberto", "execucao")), false);
  assert.equal(podeTentarEncerramento(montar({ tickets: [tk(1, "demanda", "concluido")] })), false);
  const reaberto = reabrirTicket(emConflito("falhou"), { ticket_id: 3, instrucao: "refaça" }, AUDITOR, c);
  assert.equal(podeTentarEncerramento(reaberto), false);
});

test("CA-4: conflito cria resolver_conflito aberto, grava conflito_pendente e deixa encerrar_demanda aberto", () => {
  const ag = comProgresso({}, "em_execucao");
  const novo = registrarConflitoEncerramento(ag, { demanda_id: D }, FABRIQUINHA, c);
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.status]),
    [
      [1, "demanda", "concluido"],
      [2, "encerrar_demanda", "aberto"],
      [3, "resolver_conflito", "aberto"],
    ],
  );
  assert.deepEqual(novo.encerramento?.conflito_pendente, { ticket_id: 3 });
  assert.equal(novo.demanda.fase, "encerramento");
  assert.equal(novo.encerramento.integracao, undefined);
  assert.deepEqual(novo.decisoes, []);
  assert.deepEqual(novo.dependencias_ticket, []);
  assert.equal(ag.tickets.length, 2);
});

test("conflito: repetir não cria segundo ticket; recusa sem progresso, com integração, ticket inativo e fase errada", () => {
  const um = registrarConflitoEncerramento(comProgresso(), { demanda_id: D }, FABRIQUINHA, c);
  assert.deepEqual(registrarConflitoEncerramento(um, { demanda_id: D }, FABRIQUINHA, c), um);
  regra(() => registrarConflitoEncerramento(montar(), { demanda_id: D }, FABRIQUINHA, c));
  regra(() =>
    registrarConflitoEncerramento(comProgresso({ integracao: { sha: "i" } }), { demanda_id: D }, FABRIQUINHA, c),
  );
  regra(() => registrarConflitoEncerramento(comProgresso({}, "falhou"), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => registrarConflitoEncerramento(montar({}, "aberto", "execucao"), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => registrarConflitoEncerramento(montar({ tickets: [] }), { demanda_id: D }, FABRIQUINHA, c));
  assert.throws(() => registrarConflitoEncerramento(comProgresso(), { demanda_id: D }, AUDITOR, c), ErroDeEscopo);
});

test("CA-5: resolução verificada conclui o resolver, grava o SHA e libera a tentativa sem decisão", () => {
  const ag = emConflito("em_execucao");
  const novo = concluirResolucaoConflito(ag, resolucao(), FABRIQUINHA, c);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 3)?.status, "concluido");
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.status, "aberto");
  assert.equal(novo.encerramento?.sha_verificado, "s2");
  assert.deepEqual(novo.decisoes, []);
  assert.equal(novo.tickets.length, 3);
  assert.equal(podeTentarEncerramento(novo), true);
  assert.deepEqual(concluirResolucaoConflito(novo, resolucao(), FABRIQUINHA, c), novo);
});

test("resolução recusa verificação incompleta, sem conflito, resolver concluído com outro SHA ou falho", () => {
  for (const k of ["testes", "fitness", "sonar"]) {
    regra(() => concluirResolucaoConflito(emConflito(), resolucao({ [k]: false }), FABRIQUINHA, c));
  }
  regra(() => concluirResolucaoConflito(comProgresso(), resolucao(), FABRIQUINHA, c));
  regra(() => concluirResolucaoConflito(montar(), resolucao(), FABRIQUINHA, c));
  regra(() => concluirResolucaoConflito(emConflito("falhou"), resolucao(), FABRIQUINHA, c));
  regra(() => concluirResolucaoConflito(emConflito("concluido"), resolucao({ sha: "outro" }), FABRIQUINHA, c));
  regra(() => concluirResolucaoConflito(emConflito(), resolucao({ demanda_id: "I-2" }), FABRIQUINHA, c));
  assert.throws(() => concluirResolucaoConflito(emConflito(), resolucao(), AUDITOR, c), ErroDeEscopo);
});

const falhaEnt = (m: Record<string, unknown> = {}) => ({ demanda_id: D, etapa: "check_final", motivo: "x", ...m });
const integEnt = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  confirmada: true,
  sha: "i1",
  limpeza_pendente: ["branch", "worktree"],
  ...m,
});
const integrada = (m: Record<string, unknown> = {}, status = "aberto") =>
  comProgresso({ integracao: { sha: "i1" }, limpeza_pendente: ["branch"], ...m }, status);

test("CA-6: falha do check final falha o ticket sem integrar, limpar nem abrir implementação; repetida é igual", () => {
  const ag = comProgresso({}, "em_execucao");
  const novo = registrarFalhaEncerramento(ag, falhaEnt(), FABRIQUINHA, c);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.status, "falhou");
  assert.equal(novo.tickets.length, 2);
  assert.equal(novo.demanda.fase, "encerramento");
  assert.equal(novo.encerramento?.integracao, undefined);
  assert.deepEqual(novo.encerramento?.limpeza_pendente, []);
  assert.deepEqual(novo.encerramento.falha, { etapa: "check_final", motivo: "x" });
  assert.deepEqual(registrarFalhaEncerramento(novo, falhaEnt(), FABRIQUINHA, c), novo);
  regra(() => registrarFalhaEncerramento(novo, falhaEnt({ motivo: "outro" }), FABRIQUINHA, c));
});

test("CA-9: falha da integração preserva PR e SHA e não marca a integração", () => {
  const novo = registrarFalhaEncerramento(comProgresso(), falhaEnt({ etapa: "integracao" }), FABRIQUINHA, c);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.status, "falhou");
  assert.deepEqual(novo.encerramento?.pr, pr);
  assert.equal(novo.encerramento.sha_verificado, "s1");
  assert.equal(novo.encerramento.integracao, undefined);
  regra(() => registrarFalhaEncerramento(montar(), falhaEnt({ etapa: "integracao" }), FABRIQUINHA, c));
});

test("CA-11: falha parcial da limpeza mantém a integração e grava as pendências; repetida é igual", () => {
  const ag = integrada({ limpeza_pendente: ["branch", "worktree"] });
  const novo = registrarFalhaEncerramento(
    ag,
    falhaEnt({ etapa: "limpeza", limpeza_pendente: ["worktree"] }),
    FABRIQUINHA,
    c,
  );
  assert.deepEqual(novo.encerramento?.integracao, { sha: "i1" });
  assert.deepEqual(novo.encerramento.limpeza_pendente, ["worktree"]);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.status, "falhou");
  const rep = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["worktree"] });
  assert.deepEqual(registrarFalhaEncerramento(novo, rep, FABRIQUINHA, c), novo);
  const outra = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["branch"] });
  regra(() => registrarFalhaEncerramento(novo, outra, FABRIQUINHA, c));
  const nova = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["x"] });
  regra(() => registrarFalhaEncerramento(ag, nova, FABRIQUINHA, c));
});

test("falha recusa etapa incompatível com o progresso, sem progresso, outro ator e fase errada", () => {
  regra(() => registrarFalhaEncerramento(integrada(), falhaEnt(), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(comProgresso(), falhaEnt({ etapa: "limpeza" }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(integrada(), falhaEnt({ etapa: "limpeza" }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(comProgresso(), falhaEnt({ limpeza_pendente: ["x"] }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(montar(), falhaEnt(), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(montar({}, "aberto", "execucao"), falhaEnt(), FABRIQUINHA, c));
  regra(() =>
    registrarFalhaEncerramento(comProgresso({ pr: undefined }), falhaEnt({ etapa: "integracao" }), FABRIQUINHA, c),
  );
  assert.throws(() => registrarFalhaEncerramento(comProgresso(), falhaEnt(), AUDITOR, c), ErroDeEscopo);
});

test("CA-7: integração sem confirmação recusa e o progresso fica igual", () => {
  const ag = comProgresso();
  const antes = structuredClone(ag);
  regra(() => registrarIntegracao(ag, integEnt({ confirmada: false }), FABRIQUINHA));
  assert.deepEqual(ag, antes);
});

test("CA-8 e CA-13: integração confirmada grava SHA e limpeza e limpa a falha de integração; repetida é igual", () => {
  const ag = comProgresso({ falha: { etapa: "integracao", motivo: "x" } });
  const novo = registrarIntegracao(ag, integEnt(), FABRIQUINHA);
  assert.deepEqual(novo.encerramento?.integracao, { sha: "i1" });
  assert.deepEqual(novo.encerramento.limpeza_pendente, ["branch", "worktree"]);
  assert.equal(novo.encerramento.falha, undefined);
  assert.deepEqual(registrarIntegracao(novo, integEnt(), FABRIQUINHA), novo);
  regra(() => registrarIntegracao(novo, integEnt({ sha: "i2" }), FABRIQUINHA));
});

test("integração mantém falha de outra etapa e recusa sem PR, sem progresso, ticket falho e outro ator", () => {
  const outra = comProgresso({ falha: { etapa: "limpeza", motivo: "x" } });
  assert.equal(registrarIntegracao(outra, integEnt(), FABRIQUINHA).encerramento?.falha?.etapa, "limpeza");
  regra(() => registrarIntegracao(comProgresso({ pr: undefined }), integEnt(), FABRIQUINHA));
  regra(() => registrarIntegracao(montar(), integEnt(), FABRIQUINHA));
  regra(() => registrarIntegracao(comProgresso({}, "falhou"), integEnt(), FABRIQUINHA));
  regra(() => registrarIntegracao(montar({}, "aberto", "execucao"), integEnt(), FABRIQUINHA));
  regra(() => registrarIntegracao(comProgresso(), integEnt({ demanda_id: "I-2" }), FABRIQUINHA));
  assert.throws(() => registrarIntegracao(comProgresso(), integEnt(), AUDITOR), ErroDeEscopo);
});

test("CA-10: solicitar integração é guarda sem efeito; com integração confirmada recusa citando só a limpeza", () => {
  const ag = comProgresso();
  assert.deepEqual(solicitarIntegracao(ag, { demanda_id: D }, FABRIQUINHA), ag);
  assert.throws(
    () => solicitarIntegracao(integrada(), { demanda_id: D }, FABRIQUINHA),
    (e: unknown) => e instanceof ErroDeRegra && e.message.includes("falta só a limpeza: branch"),
  );
  regra(() => solicitarIntegracao(integrada({ limpeza_pendente: [] }), { demanda_id: D }, FABRIQUINHA));
  regra(() => solicitarIntegracao(comProgresso({ pr: undefined }), { demanda_id: D }, FABRIQUINHA));
  regra(() => solicitarIntegracao(montar(), { demanda_id: D }, FABRIQUINHA));
  assert.throws(() => solicitarIntegracao(ag, { demanda_id: D }, AUDITOR), ErroDeEscopo);
});

test("CA-12 e CA-13: concluir encerramento deixa a demanda concluida com o histórico; repetir é igual", () => {
  const ag = integrada({ falha: { etapa: "limpeza", motivo: "x" } }, "em_execucao");
  const novo = concluirEncerramento(ag, { demanda_id: D, limpeza_pendente: [] }, FABRIQUINHA, c);
  assert.equal(novo.demanda.fase, "concluida");
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.status, "concluido");
  assert.equal(novo.tickets.length, 2);
  assert.deepEqual(novo.decisoes, []);
  assert.deepEqual(novo.encerramento?.limpeza_pendente, []);
  assert.equal(novo.encerramento.falha, undefined);
  assert.deepEqual(concluirEncerramento(novo, { demanda_id: D, limpeza_pendente: [] }, FABRIQUINHA, c), novo);
});

test("concluir encerramento recusa sem integração, com limpeza pendente, ticket falho e outro ator", () => {
  const fim = { demanda_id: D, limpeza_pendente: [] };
  regra(() => concluirEncerramento(comProgresso(), fim, FABRIQUINHA, c));
  regra(() => concluirEncerramento(integrada({}, "falhou"), fim, FABRIQUINHA, c));
  regra(() => concluirEncerramento(integrada(), { ...fim, limpeza_pendente: ["x"] }, FABRIQUINHA, c));
  assert.throws(() => concluirEncerramento(integrada(), fim, AUDITOR, c), ErroDeEscopo);
});

test("ponta a ponta: tentativa, conflito, resolução, falha, reabertura, integração, limpeza parcial e conclusão", () => {
  const fim = { demanda_id: D };
  let ag = registrarTentativaEncerramento(montar(), tentativa(), FABRIQUINHA);
  ag = registrarConflitoEncerramento(ag, fim, FABRIQUINHA, c);
  assert.equal(podeTentarEncerramento(ag), false);
  ag = concluirResolucaoConflito(ag, resolucao(), FABRIQUINHA, c);
  assert.equal(podeTentarEncerramento(ag), true);
  ag = registrarTentativaEncerramento(ag, tentativa({ sha: "s2" }), FABRIQUINHA);
  ag = registrarFalhaEncerramento(ag, { ...fim, etapa: "integracao", motivo: "x" }, FABRIQUINHA, c);
  ag = reabrirTicket(ag, { ticket_id: 2, instrucao: "tente de novo" }, AUDITOR, c);
  ag = registrarIntegracao(
    ag,
    { ...fim, confirmada: true, sha: "i1", limpeza_pendente: ["branch", "worktree"] },
    FABRIQUINHA,
  );
  ag = registrarTentativaEncerramento(ag, tentativa({ sha: "s2" }), FABRIQUINHA);
  ag = registrarFalhaEncerramento(
    ag,
    { ...fim, etapa: "limpeza", motivo: "y", limpeza_pendente: ["worktree"] },
    FABRIQUINHA,
    c,
  );
  ag = reabrirTicket(ag, { ticket_id: 2, instrucao: "limpe o que falta" }, AUDITOR, c);
  ag = concluirEncerramento(ag, { ...fim, limpeza_pendente: [] }, FABRIQUINHA, c);
  assert.equal(ag.demanda.fase, "concluida");
  assert.deepEqual(ag.encerramento?.integracao, { sha: "i1" });
  assert.equal(ag.encerramento.falha, undefined);
});
