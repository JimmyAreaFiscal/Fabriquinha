import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { encerrarExecucao, iniciarExecucao, registrarUso, totalDoTicket } from "../dominio/sessoes.ts";
import type { ExecucaoSessao, Sessao, UsoModeloExecucao } from "../dominio/sessoes.ts";
import { migrar } from "./banco.ts";
import { MIGRACOES } from "./migracoes.ts";
import {
  carregarSessoesDaDemanda,
  carregarSessoesDoTicket,
  comSessoesDoTicket,
  execucoesAbertasDaDemanda,
} from "./sessoes.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const em = "2026-01-01T00:00:00.000Z";
const ref = { demanda_id: "I-1", ticket_id: 1 };

const banco = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrar(b, MIGRACOES);
  b.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('p', '/repo/p', 'main', 'github', '["t"]', 'k', '[{"nome":"f"}]');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T});`);
  return b;
};

const sessao = (id = "s1", ticket_id = 1): Sessao => ({
  id,
  demanda_id: "I-1",
  ticket_id,
  modo: "autonomo",
  conversa_referencia: "c",
});
const execucao = (id = "e1", sessao_id = "s1"): ExecucaoSessao => ({ id, sessao_id, inicio: em, falha: false });
const uso = (extra: Partial<UsoModeloExecucao> = {}): UsoModeloExecucao => ({
  execucao_id: "e1",
  modelo_provedor: "claude-bridge",
  modelo_nome: "claude-haiku-5-5",
  tokens_entrada: 100,
  tokens_saida: 10,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  ...extra,
});
const gravar = (b: DatabaseSync, s: Sessao[], e: ExecucaoSessao[], u: UsoModeloExecucao[], r = ref) =>
  comSessoesDoTicket(b, r, (x) => ({
    sessoes: [...x.sessoes, ...s],
    execucoes: [...x.execucoes, ...e],
    usos: u.reduce(registrarUso, x.usos),
  }));

test("CA-8, CA-9, CA-12: ida e volta; execução sem fim volta nula e custo ausente não vira zero", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  const lido = carregarSessoesDoTicket(b, ref);
  assert.deepEqual(lido, { sessoes: [sessao()], execucoes: [{ ...execucao(), fim: null }], usos: [uso()] });
  assert.equal(b.prepare("SELECT fim FROM execucao_sessao").get()?.fim, null);
  assert.equal("custo" in (lido.usos[0] ?? {}), false);
});

test("encerrar a execução e registrar custo atualizam a linha existente", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso({ custo: 0.5 })]);
  comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, true) }));
  const lido = carregarSessoesDoTicket(b, ref);
  assert.deepEqual(lido.execucoes, [{ ...execucao(), fim: em, falha: true }]);
  assert.equal(lido.usos[0]?.custo, 0.5);
});

test("CA-11: registrar de novo o mesmo uso substitui, não soma", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comSessoesDoTicket(b, ref, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 40 })) }));
  const { usos } = carregarSessoesDoTicket(b, ref);
  assert.equal(usos.length, 1);
  assert.equal(usos[0]?.tokens_entrada, 40);
});

test("CA-10, CA-13, CA-14: FK ou CHECK desfazem a gravação inteira", () => {
  const b = banco();
  const recusa = (f: () => unknown, padrao: RegExp) => {
    assert.throws(f, padrao);
    assert.deepEqual(carregarSessoesDaDemanda(b, "I-1"), { sessoes: [], execucoes: [], usos: [] });
    assert.equal(b.isTransaction, false);
  };
  recusa(() => gravar(b, [sessao("s2", 99)], [], [], { demanda_id: "I-1", ticket_id: 99 }), /FOREIGN KEY/);
  recusa(() => gravar(b, [sessao()], [execucao()], [uso({ execucao_id: "inexistente" })]), /não é de uma execução/);
  // sem passar por registrarUso: a CHECK do banco recusa depois de sessão e execução já inseridas
  recusa(
    () =>
      comSessoesDoTicket(b, ref, () => ({
        sessoes: [sessao()],
        execucoes: [execucao()],
        usos: [uso({ tokens_saida: -1 })],
      })),
    /CHECK/,
  );
});

test("CA-15: carregar por demanda e o total do ticket sobre o que foi lido", () => {
  const b = banco();
  const ref2 = { demanda_id: "I-1", ticket_id: 2 };
  const s = [sessao(), sessao("s2", 2)];
  const e = [execucao(), execucao("e2", "s2")];
  const u = [uso({ custo: 1 }), uso({ execucao_id: "e2", tokens_entrada: 7 })];
  gravar(b, [sessao()], [execucao()], [u[0] as never]);
  gravar(b, [sessao("s2", 2)], [execucao("e2", "s2")], [u[1] as never], ref2);
  const ticket = carregarSessoesDoTicket(b, ref);
  assert.equal(ticket.sessoes.length, 1);
  const antes = totalDoTicket(s, e, u, ref);
  assert.deepEqual(totalDoTicket(ticket.sessoes, ticket.execucoes, ticket.usos, ref), antes);
  assert.equal(carregarSessoesDaDemanda(b, "I-1").usos.length, 2);
  comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: [...x.execucoes] }));
  assert.throws(
    () =>
      comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: iniciarExecucao(x.sessoes, x.execucoes, execucao("e3")) })),
    /sem fim/,
  );
});

const noTicket2 = { demanda_id: "I-1", ticket_id: 2 };
const comEncerrada = () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  return { b, antes: carregarSessoesDoTicket(b, ref) };
};

test("id de sessão repetido em outro ticket falha e o ticket original não muda", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() => comSessoesDoTicket(b, noTicket2, (x) => ({ ...x, sessoes: [...x.sessoes, sessao("s1", 2)] })));
  assert.deepEqual(carregarSessoesDoTicket(b, ref), antes);
});

test("id de execução repetido em outro ticket falha e o fim da original fica", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comSessoesDoTicket(b, noTicket2, (x) => {
      const sessoes = [...x.sessoes, sessao("s9", 2)];
      return { ...x, sessoes, execucoes: iniciarExecucao(sessoes, x.execucoes, execucao("e1", "s9")) };
    }),
  );
  assert.deepEqual(carregarSessoesDoTicket(b, ref), antes);
});

test("uso de execução de outro ticket é recusado sem alterar o uso original", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comSessoesDoTicket(b, noTicket2, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 1 })) })),
  );
  assert.deepEqual(carregarSessoesDoTicket(b, ref), antes);
});

test("sessão de outro ticket e execução de sessão fora do resultado são recusadas", () => {
  const b = banco();
  assert.throws(() => comSessoesDoTicket(b, ref, (x) => ({ ...x, sessoes: [sessao("s2", 2)] })), /não é do ticket/);
  assert.throws(
    () => comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: [execucao("e2", "s7")] })),
    /sessão do ticket/,
  );
});

test("CA-1, CA-2: controle da execução volta igual; ausente volta sem a chave", () => {
  const b = banco();
  const completa: ExecucaoSessao = {
    ...execucao(),
    grupo_processo: 4321,
    erro: "falhou no pi",
    modelo_provedor: "claude-bridge",
    modelo_nome: "claude-sonnet-5-5",
    effort: "high",
  };
  gravar(b, [sessao()], [completa, execucao("e2")], []);
  const { execucoes } = carregarSessoesDoTicket(b, ref);
  assert.deepEqual(execucoes[0], { ...completa, fim: null });
  const nua = execucoes[1] ?? {};
  for (const c of ["grupo_processo", "erro", "modelo_provedor", "modelo_nome", "effort"]) assert.equal(c in nua, false);
});

test("CA-3: effort inválido falha com ErroDeRegra citando o campo e não altera nada", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], []);
  const antes = JSON.stringify(b.prepare("SELECT * FROM execucao_sessao").all());
  const ruim = { ...execucao("e2"), effort: "turbo" } as unknown as ExecucaoSessao;
  assert.throws(
    () => gravar(b, [], [ruim], []),
    (e) => e instanceof ErroDeRegra && e.message.includes("effort"),
  );
  assert.equal(JSON.stringify(b.prepare("SELECT * FROM execucao_sessao").all()), antes);
});

test("CA-10: execuções abertas de qualquer ticket, com grupo de processo nulo ou gravado; as encerradas ficam de fora", () => {
  const b = banco();
  gravar(b, [sessao("s1")], [execucao("e1"), { ...execucao("e2"), grupo_processo: 4321 }], []);
  gravar(b, [sessao("s2", 2)], [execucao("e3", "s2")], [], noTicket2);
  comSessoesDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  assert.deepEqual(execucoesAbertasDaDemanda(b), [
    { id: "e2", sessao_id: "s1", demanda_id: "I-1", ticket_id: 1, grupo_processo: 4321 },
    { id: "e3", sessao_id: "s2", demanda_id: "I-1", ticket_id: 2, grupo_processo: null },
  ]);
});
