import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../ator.ts";
import { AgregadoDemanda, prDaDemanda } from "../../../demanda/nucleo/agregado_demanda.ts";
import { ErroDeEscopo, ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
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
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const montar = (m: Record<string, unknown> = {}, status = "aberto", estado = "encerrar_demanda") =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    tickets: [tk(1, "entender_e_desenhar", "concluido"), tk(2, "encerrar_demanda", status)],
    decisoes: [],
    evidencias: [],
    ...m,
  });
const pr = { numero: 7, url: "https://h/pr/7" };
// O PR do Espaço da demanda que a tentativa grava: head é o SHA verificado e a data é a do contexto `c`.
const prDoEspaco = { ...pr, head: "s1", estado: "aberto" as const, atualizado_em: t1 };
const tentativa = (m: Record<string, unknown> = {}) => ({ demanda_id: D, base: "develop", pr, sha: "s1", ...m });
const prog = (m: Record<string, unknown> = {}) => ({
  demanda_id: D,
  branch: "fabriquinha/I-1",
  base: "develop",
  sha_verificado: "s1",
  limpeza_pendente: [],
  ...m,
});
const comProgresso = (m: Record<string, unknown> = {}, status = "aberto", pull_requests: unknown[] = [prDoEspaco]) =>
  montar({ encerramento: prog(m), pull_requests }, status);
const emConflito = (statusResolver = "aberto") =>
  montar({
    tickets: [
      tk(1, "entender_e_desenhar", "concluido"),
      tk(2, "encerrar_demanda", "aberto"),
      tk(3, "resolver_conflito", statusResolver),
    ],
    encerramento: prog({ conflito_pendente: { ticket_id: 3 } }),
    pull_requests: [prDoEspaco],
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
  const novo = registrarTentativaEncerramento(ag, tentativa(), FABRIQUINHA, c);
  assert.deepEqual(novo.encerramento, prog());
  assert.equal(novo.encerramento.base, "develop");
  assert.deepEqual(novo.pull_requests, [prDoEspaco]);
  assert.deepEqual(ag, antes);
});

test("CA-2 e CA-13: retomada reaproveita o PR; repetição idêntica devolve agregado igual; PR ou base diferentes recusam", () => {
  const ag = comProgresso();
  assert.deepEqual(registrarTentativaEncerramento(ag, tentativa(), FABRIQUINHA, c), ag);
  regra(() => registrarTentativaEncerramento(ag, tentativa({ pr: { numero: 8, url: "u" } }), FABRIQUINHA, c));
  regra(() => registrarTentativaEncerramento(ag, tentativa({ base: "main" }), FABRIQUINHA, c));
  const semPr = montar({ encerramento: prog({ sha_verificado: undefined }) });
  assert.deepEqual(prDaDemanda(registrarTentativaEncerramento(semPr, tentativa(), FABRIQUINHA, c)), prDoEspaco);
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
    c,
  );
  assert.equal(novo.encerramento?.conflito_pendente, undefined);
  assert.equal(novo.encerramento?.falha, undefined);
  assert.equal(novo.encerramento?.sha_verificado, "s2");
  const integ = comProgresso({ falha: { etapa: "integracao", motivo: "x" } });
  assert.equal(
    registrarTentativaEncerramento(integ, tentativa(), FABRIQUINHA, c).encerramento?.falha?.etapa,
    "integracao",
  );
});

test("tentativa recusa quando podeTentarEncerramento é falso, outro ator, outra demanda e estado errado", () => {
  regra(() => registrarTentativaEncerramento(emConflito("aberto"), tentativa(), FABRIQUINHA, c));
  regra(() => registrarTentativaEncerramento(montar({}, "falhou"), tentativa(), FABRIQUINHA, c));
  regra(() => registrarTentativaEncerramento(montar({}, "aberto", "em_execucao"), tentativa(), FABRIQUINHA, c));
  regra(() => registrarTentativaEncerramento(montar(), tentativa({ demanda_id: "I-2" }), FABRIQUINHA, c));
  assert.throws(() => registrarTentativaEncerramento(montar(), tentativa(), AUDITOR, c), ErroDeEscopo);
  assert.throws(() => registrarTentativaEncerramento(montar(), tentativa({ extra: 1 }), FABRIQUINHA, c));
});

test("tentativa aceita o encerrar_demanda reservado (em_execucao) e mantém as demais regras", () => {
  const novo = registrarTentativaEncerramento(montar({}, "em_execucao"), tentativa(), FABRIQUINHA, c);
  assert.deepEqual(prDaDemanda(novo), prDoEspaco);
  regra(() => registrarTentativaEncerramento(montar({}, "concluido"), tentativa(), FABRIQUINHA, c));
  regra(() => registrarTentativaEncerramento(emConflito("aberto"), tentativa(), FABRIQUINHA, c));
  const reservadoEmConflito = (r: string) => {
    const ag = emConflito(r);
    return {
      ...ag,
      tickets: ag.tickets.map((t) => (t.ticket_id === 2 ? { ...t, estado: "em_execucao" as const } : t)),
    };
  };
  regra(() => registrarTentativaEncerramento(reservadoEmConflito("aberto"), tentativa(), FABRIQUINHA, c));
  assert.equal(
    registrarTentativaEncerramento(reservadoEmConflito("concluido"), tentativa(), FABRIQUINHA, c).encerramento
      ?.conflito_pendente,
    undefined,
  );
});

test("podeTentarEncerramento: sem conflito, resolver aberto/falho/concluído, encerrar falhou, estado errado, sem ticket", () => {
  assert.equal(podeTentarEncerramento(montar()), true);
  assert.equal(podeTentarEncerramento(comProgresso()), true);
  assert.equal(podeTentarEncerramento(emConflito("concluido")), true);
  assert.equal(podeTentarEncerramento(emConflito("aberto")), false);
  assert.equal(podeTentarEncerramento(emConflito("falhou")), false);
  assert.equal(podeTentarEncerramento(montar({}, "falhou")), false);
  assert.equal(podeTentarEncerramento(montar({}, "em_execucao")), false);
  assert.equal(podeTentarEncerramento(montar({}, "aberto", "em_execucao")), false);
  assert.equal(podeTentarEncerramento(montar({ tickets: [tk(1, "entender_e_desenhar", "concluido")] })), false);
  const reaberto = reabrirTicket(emConflito("falhou"), { ticket_id: 3, instrucao: "refaça" }, AUDITOR, c);
  assert.equal(podeTentarEncerramento(reaberto), false);
});

test("CA-4: conflito cria resolver_conflito aberto, grava conflito_pendente e deixa encerrar_demanda aberto", () => {
  const ag = comProgresso({}, "em_execucao");
  const novo = registrarConflitoEncerramento(ag, { demanda_id: D }, FABRIQUINHA, c);
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [1, "entender_e_desenhar", "concluido"],
      [2, "encerrar_demanda", "aberto"],
      [3, "resolver_conflito", "aberto"],
    ],
  );
  assert.deepEqual(novo.encerramento?.conflito_pendente, { ticket_id: 3 });
  assert.equal(novo.demanda.estado, "encerrar_demanda");
  assert.equal(novo.encerramento.integracao, undefined);
  assert.deepEqual(novo.decisoes, []);
  assert.deepEqual(novo.dependencias_ticket, []);
  assert.equal(ag.tickets.length, 2);
});

test("conflito: repetir não cria segundo ticket; recusa sem progresso, com integração, ticket inativo e estado errado", () => {
  const um = registrarConflitoEncerramento(comProgresso(), { demanda_id: D }, FABRIQUINHA, c);
  assert.deepEqual(registrarConflitoEncerramento(um, { demanda_id: D }, FABRIQUINHA, c), um);
  regra(() => registrarConflitoEncerramento(montar(), { demanda_id: D }, FABRIQUINHA, c));
  regra(() =>
    registrarConflitoEncerramento(comProgresso({ integracao: { sha: "i" } }), { demanda_id: D }, FABRIQUINHA, c),
  );
  regra(() => registrarConflitoEncerramento(comProgresso({}, "falhou"), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => registrarConflitoEncerramento(montar({}, "aberto", "em_execucao"), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => registrarConflitoEncerramento(montar({ tickets: [] }), { demanda_id: D }, FABRIQUINHA, c));
  assert.throws(() => registrarConflitoEncerramento(comProgresso(), { demanda_id: D }, AUDITOR, c), ErroDeEscopo);
});

test("CA-5: resolução verificada conclui o resolver, grava o SHA e libera a tentativa sem decisão", () => {
  const deRodada = { ...prDoEspaco, numero: 8, rodada_id: 1 };
  const ag = AgregadoDemanda.parse({
    ...emConflito("em_execucao"),
    rodadas: [
      {
        demanda_id: D,
        rodada_id: 1,
        titulo: "r",
        estado: "concluida",
        estado_alterado_em: t0,
        e2e: false,
        branch: "fabriquinha/I-1-1",
      },
    ],
    pull_requests: [prDoEspaco, deRodada],
  });
  const novo = concluirResolucaoConflito(ag, resolucao(), FABRIQUINHA, c);
  assert.deepEqual(novo.pull_requests, [{ ...prDoEspaco, head: "s2" }, deRodada]);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 3)?.estado, "concluido");
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "aberto");
  assert.equal(novo.encerramento?.sha_verificado, "s2");
  assert.deepEqual(prDaDemanda(novo), { ...prDoEspaco, head: "s2" });
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

test("falha de encerramento com causa registra infraestrutura na Tentativa", () => {
  const ag = comProgresso({}, "em_execucao");
  const novo = registrarFalhaEncerramento(
    ag,
    { demanda_id: D, etapa: "check_final", motivo: "sem resposta", causa: "tempo_limite" },
    FABRIQUINHA,
    c,
  );
  assert.deepEqual(novo.tentativas.at(-1)?.resultado, {
    tipo: "falha_infraestrutura",
    causa: "tempo_limite",
    motivo: "sem resposta",
  });
  assert.equal(novo.tickets.find((ticket) => ticket.ticket_id === 2)?.estado, "falhou");
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
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "falhou");
  assert.equal(novo.tickets.length, 2);
  assert.equal(novo.demanda.estado, "encerrar_demanda");
  assert.equal(novo.encerramento?.integracao, undefined);
  assert.deepEqual(novo.encerramento?.limpeza_pendente, []);
  assert.deepEqual(novo.encerramento.falha, { etapa: "check_final", motivo: "x" });
  assert.deepEqual(novo.tentativas.at(-1)?.resultado, { tipo: "interrompida", por: FABRIQUINHA, motivo: "x" });
  assert.deepEqual(registrarFalhaEncerramento(novo, falhaEnt(), FABRIQUINHA, c), novo);
  regra(() => registrarFalhaEncerramento(novo, falhaEnt({ motivo: "outro" }), FABRIQUINHA, c));
});

test("CA-9: falha da integração preserva PR e SHA e não marca a integração", () => {
  const novo = registrarFalhaEncerramento(comProgresso(), falhaEnt({ etapa: "integracao" }), FABRIQUINHA, c);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "falhou");
  assert.deepEqual(prDaDemanda(novo), prDoEspaco);
  assert.equal(novo.encerramento?.sha_verificado, "s1");
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
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "falhou");
  const rep = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["worktree"] });
  assert.deepEqual(registrarFalhaEncerramento(novo, rep, FABRIQUINHA, c), novo);
  const outra = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["branch"] });
  regra(() => registrarFalhaEncerramento(novo, outra, FABRIQUINHA, c));
  const nova = falhaEnt({ etapa: "limpeza", limpeza_pendente: ["x"] });
  regra(() => registrarFalhaEncerramento(ag, nova, FABRIQUINHA, c));
});

test("falha recusa etapa incompatível com o progresso, sem progresso, outro ator e estado errado", () => {
  regra(() => registrarFalhaEncerramento(integrada(), falhaEnt(), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(comProgresso(), falhaEnt({ etapa: "limpeza" }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(integrada(), falhaEnt({ etapa: "limpeza" }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(comProgresso(), falhaEnt({ limpeza_pendente: ["x"] }), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(montar(), falhaEnt(), FABRIQUINHA, c));
  regra(() => registrarFalhaEncerramento(montar({}, "aberto", "em_execucao"), falhaEnt(), FABRIQUINHA, c));
  regra(() =>
    registrarFalhaEncerramento(comProgresso({}, "aberto", []), falhaEnt({ etapa: "integracao" }), FABRIQUINHA, c),
  );
  assert.throws(() => registrarFalhaEncerramento(comProgresso(), falhaEnt(), AUDITOR, c), ErroDeEscopo);
});

test("CA-7: integração sem confirmação recusa e o progresso fica igual", () => {
  const ag = comProgresso();
  const antes = structuredClone(ag);
  regra(() => registrarIntegracao(ag, integEnt({ confirmada: false }), FABRIQUINHA, c));
  assert.deepEqual(ag, antes);
});

test("CA-8 e CA-13: integração confirmada grava SHA e limpeza e limpa a falha de integração; repetida é igual", () => {
  const ag = comProgresso({ falha: { etapa: "integracao", motivo: "x" } });
  const novo = registrarIntegracao(ag, integEnt(), FABRIQUINHA, c);
  assert.deepEqual(novo.encerramento?.integracao, { sha: "i1" });
  assert.equal(prDaDemanda(novo)?.estado, "integrado");
  assert.deepEqual(novo.encerramento.limpeza_pendente, ["branch", "worktree"]);
  assert.equal(novo.encerramento.falha, undefined);
  assert.deepEqual(registrarIntegracao(novo, integEnt(), FABRIQUINHA, c), novo);
  regra(() => registrarIntegracao(novo, integEnt({ sha: "i2" }), FABRIQUINHA, c));
});

test("integração mantém falha de outra etapa e recusa sem PR, sem progresso, ticket falho e outro ator", () => {
  const outra = comProgresso({ falha: { etapa: "limpeza", motivo: "x" } });
  assert.equal(registrarIntegracao(outra, integEnt(), FABRIQUINHA, c).encerramento?.falha?.etapa, "limpeza");
  regra(() => registrarIntegracao(comProgresso({}, "aberto", []), integEnt(), FABRIQUINHA, c));
  regra(() => registrarIntegracao(montar(), integEnt(), FABRIQUINHA, c));
  regra(() => registrarIntegracao(comProgresso({}, "falhou"), integEnt(), FABRIQUINHA, c));
  regra(() => registrarIntegracao(montar({}, "aberto", "em_execucao"), integEnt(), FABRIQUINHA, c));
  regra(() => registrarIntegracao(comProgresso(), integEnt({ demanda_id: "I-2" }), FABRIQUINHA, c));
  assert.throws(() => registrarIntegracao(comProgresso(), integEnt(), AUDITOR, c), ErroDeEscopo);
});

test("CA-10: solicitar integração marca a espera pelo merge humano e devolve o ticket; repetir é igual", () => {
  const ag = comProgresso({ falha: { etapa: "integracao", motivo: "PR fechado" } }, "em_execucao");
  const novo = solicitarIntegracao(ag, { demanda_id: D }, FABRIQUINHA, c);
  assert.equal(novo.encerramento?.aguardando_merge_humano, true);
  assert.equal(novo.encerramento.falha, undefined);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "aberto");
  assert.deepEqual(solicitarIntegracao(novo, { demanda_id: D }, FABRIQUINHA, c), novo);
  const integrado = registrarIntegracao(novo, integEnt(), FABRIQUINHA, c);
  assert.equal(integrado.encerramento?.aguardando_merge_humano, undefined);
  const outra = comProgresso({ falha: { etapa: "limpeza", motivo: "x" } });
  assert.equal(solicitarIntegracao(outra, { demanda_id: D }, FABRIQUINHA, c).encerramento?.falha?.etapa, "limpeza");
  assert.throws(
    () => solicitarIntegracao(integrada(), { demanda_id: D }, FABRIQUINHA, c),
    (e: unknown) => e instanceof ErroDeRegra && e.message.includes("falta só a limpeza: branch"),
  );
  regra(() => solicitarIntegracao(integrada({ limpeza_pendente: [] }), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => solicitarIntegracao(comProgresso({}, "aberto", []), { demanda_id: D }, FABRIQUINHA, c));
  regra(() => solicitarIntegracao(montar(), { demanda_id: D }, FABRIQUINHA, c));
  assert.throws(() => solicitarIntegracao(ag, { demanda_id: D }, AUDITOR, c), ErroDeEscopo);
});

test("CA-12 e CA-13: concluir encerramento deixa a demanda concluida com o histórico; repetir é igual", () => {
  const ag = integrada({ falha: { etapa: "limpeza", motivo: "x" } }, "em_execucao");
  const novo = concluirEncerramento(ag, { demanda_id: D, limpeza_pendente: [] }, FABRIQUINHA, c);
  assert.equal(novo.demanda.estado, "concluida");
  assert.equal(novo.tickets.find((t) => t.ticket_id === 2)?.estado, "concluido");
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
  let ag = registrarTentativaEncerramento(montar(), tentativa(), FABRIQUINHA, c);
  ag = registrarConflitoEncerramento(ag, fim, FABRIQUINHA, c);
  assert.equal(podeTentarEncerramento(ag), false);
  ag = concluirResolucaoConflito(ag, resolucao(), FABRIQUINHA, c);
  assert.equal(podeTentarEncerramento(ag), true);
  ag = registrarTentativaEncerramento(ag, tentativa({ sha: "s2" }), FABRIQUINHA, c);
  ag = registrarFalhaEncerramento(ag, { ...fim, etapa: "integracao", motivo: "x" }, FABRIQUINHA, c);
  ag = reabrirTicket(ag, { ticket_id: 2, instrucao: "tente de novo" }, AUDITOR, c);
  ag = registrarIntegracao(
    ag,
    { ...fim, confirmada: true, sha: "i1", limpeza_pendente: ["branch", "worktree"] },
    FABRIQUINHA,
    c,
  );
  ag = registrarTentativaEncerramento(ag, tentativa({ sha: "s2" }), FABRIQUINHA, c);
  ag = registrarFalhaEncerramento(
    ag,
    { ...fim, etapa: "limpeza", motivo: "y", limpeza_pendente: ["worktree"] },
    FABRIQUINHA,
    c,
  );
  ag = reabrirTicket(ag, { ticket_id: 2, instrucao: "limpe o que falta" }, AUDITOR, c);
  ag = concluirEncerramento(ag, { ...fim, limpeza_pendente: [] }, FABRIQUINHA, c);
  assert.equal(ag.demanda.estado, "concluida");
  assert.deepEqual(ag.encerramento?.integracao, { sha: "i1" });
  assert.equal(ag.encerramento.falha, undefined);
});
