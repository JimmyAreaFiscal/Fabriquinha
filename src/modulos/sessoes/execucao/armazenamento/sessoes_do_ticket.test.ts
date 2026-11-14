import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { encerrarExecucao, iniciarExecucao, type Execucao, type Sessao } from "../nucleo/sessao.ts";
import { registrarUso, type UsoDaExecucao } from "../../metricas_de_execucao/publico.ts";
import { ticketsComPiAtivo } from "../../../../server/system/api/sessoes/historico_demanda.ts";
import { carregarSessoesDoContexto, comSessoesDoContexto } from "../aplicacao/sessoes_do_contexto.ts";
import {
  gravarAmbienteDaExecucao,
  gravarTokenDaExecucao,
  execucoesAbertas,
  resumosDasSessoesEmLote,
} from "./sessoes_e_execucoes.ts";

/** A execução aberta que tem o token, pela lista das sessões filtrada por ele. */
const execucaoVivaDoToken = (b: DatabaseSync, token: string): string | undefined =>
  resumosDasSessoesEmLote(b, { token })[0]?.execucoes.find((e) => e.fim == null)?.id;
import { migrarBancoDaFabriquinha } from "../../../../server/system/banco_da_fabriquinha.ts";

const T = "'2026-01-01T00:00:00.000Z'";
const em = "2026-01-01T00:00:00.000Z";
const ref = { demanda_id: "I-1", ticket_id: 1 };

const banco = (): DatabaseSync => {
  const b = new DatabaseSync(":memory:");
  b.exec("PRAGMA foreign_keys = ON");
  migrarBancoDaFabriquinha(b);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
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
const execucao = (id = "e1", trabalho_id = "s1"): Execucao => ({ id, trabalho_id, inicio: em, falha: false });
const uso = (extra: Partial<UsoDaExecucao> = {}): UsoDaExecucao => ({
  execucao_id: "e1",
  modelo_provedor: "claude-bridge",
  modelo_nome: "claude-haiku-5-5",
  tokens_entrada: 100,
  tokens_saida: 10,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
  ...extra,
});
const gravar = (b: DatabaseSync, s: Sessao[], e: Execucao[], u: UsoDaExecucao[], r = ref) =>
  comSessoesDoContexto(b, r, (x) => ({
    sessoes: [...x.sessoes, ...s],
    execucoes: [...x.execucoes, ...e],
    usos: u.reduce(registrarUso, x.usos),
  }));

test("CA-8, CA-9, CA-12: ida e volta; execução sem fim volta nula e custo ausente não vira zero", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  const lido = carregarSessoesDoContexto(b, ref);
  assert.deepEqual(lido, { sessoes: [sessao()], execucoes: [{ ...execucao(), fim: null }], usos: [uso()] });
  assert.equal(b.prepare("SELECT fim FROM processo_do_trabalho").get()?.fim, null);
  assert.equal("custo" in (lido.usos[0] ?? {}), false);
});

test("encerrar a execução e registrar custo atualizam a linha existente", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso({ custo: 0.5 })]);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, true) }));
  const lido = carregarSessoesDoContexto(b, ref);
  assert.deepEqual(lido.execucoes, [{ ...execucao(), fim: em, falha: true }]);
  assert.equal(lido.usos[0]?.custo, 0.5);
});

test("CA-11: registrar de novo o mesmo uso substitui, não soma", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 40 })) }));
  const { usos } = carregarSessoesDoContexto(b, ref);
  assert.equal(usos.length, 1);
  assert.equal(usos[0]?.tokens_entrada, 40);
});

test("CA-10, CA-13, CA-14: FK ou CHECK desfazem a gravação inteira", () => {
  const b = banco();
  const recusa = (f: () => unknown, padrao: RegExp) => {
    assert.throws(f, padrao);
    assert.deepEqual(carregarSessoesDoContexto(b, { demanda_id: "I-1", ticket_id: null }), {
      sessoes: [],
      execucoes: [],
      usos: [],
    });
    assert.equal(b.isTransaction, false);
  };
  recusa(() => gravar(b, [sessao("s2", 99)], [], [], { demanda_id: "I-1", ticket_id: 99 }), /FOREIGN KEY/);
  recusa(() => gravar(b, [sessao()], [execucao()], [uso({ execucao_id: "inexistente" })]), /não é de uma execução/);
  // sem passar por registrarUso: a CHECK do banco recusa depois de sessão e execução já inseridas
  recusa(
    () =>
      comSessoesDoContexto(b, ref, () => ({
        sessoes: [sessao()],
        execucoes: [execucao()],
        usos: [uso({ tokens_saida: -1 })],
      })),
    /CHECK/,
  );
});

test("CA-15: carregar por demanda e o ticket sobre o que foi lido", () => {
  const b = banco();
  const ref2 = { demanda_id: "I-1", ticket_id: 2 };
  const u = [uso({ custo: 1 }), uso({ execucao_id: "e2", tokens_entrada: 7 })];
  gravar(b, [sessao()], [execucao()], [u[0] as never]);
  gravar(b, [sessao("s2", 2)], [execucao("e2", "s2")], [u[1] as never], ref2);
  const ticket = carregarSessoesDoContexto(b, ref);
  assert.equal(ticket.sessoes.length, 1);
  assert.deepEqual(ticket.usos, [u[0]]);
  assert.equal(carregarSessoesDoContexto(b, { demanda_id: "I-1", ticket_id: null }).usos.length, 2);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: [...x.execucoes] }));
  assert.throws(
    () =>
      comSessoesDoContexto(b, ref, (x) => ({
        ...x,
        execucoes: iniciarExecucao(x.sessoes, x.execucoes, execucao("e3")),
      })),
    /sem fim/,
  );
});

const noTicket2 = { demanda_id: "I-1", ticket_id: 2 };
const comEncerrada = () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  return { b, antes: carregarSessoesDoContexto(b, ref) };
};

test("id de sessão repetido em outro ticket falha e o ticket original não muda", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() => comSessoesDoContexto(b, noTicket2, (x) => ({ ...x, sessoes: [...x.sessoes, sessao("s1", 2)] })));
  assert.deepEqual(carregarSessoesDoContexto(b, ref), antes);
});

test("id de execução repetido em outro ticket falha e o fim da original fica", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comSessoesDoContexto(b, noTicket2, (x) => {
      const sessoes = [...x.sessoes, sessao("s9", 2)];
      return { ...x, sessoes, execucoes: iniciarExecucao(sessoes, x.execucoes, execucao("e1", "s9")) };
    }),
  );
  assert.deepEqual(carregarSessoesDoContexto(b, ref), antes);
});

test("uso de execução de outro ticket é rejeitado sem alterar o uso original", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comSessoesDoContexto(b, noTicket2, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 1 })) })),
  );
  assert.deepEqual(carregarSessoesDoContexto(b, ref), antes);
});

test("sessão de outro ticket e execução de sessão fora do resultado são rejeitadas", () => {
  const b = banco();
  assert.throws(() => comSessoesDoContexto(b, ref, (x) => ({ ...x, sessoes: [sessao("s2", 2)] })), /não é do ticket/);
  assert.throws(
    () => comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: [execucao("e2", "s7")] })),
    /sessão do ticket/,
  );
});

test("CA-1, CA-2: controle da execução volta igual; ausente volta sem a chave", () => {
  const b = banco();
  const completa: Execucao = {
    ...execucao(),
    grupo_processo: 4321,
    configuracao_agente: { modelo: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" }, effort: "high" },
  };
  gravar(b, [sessao()], [completa, execucao("e2")], []);
  const { execucoes } = carregarSessoesDoContexto(b, ref);
  assert.deepEqual(execucoes[0], { ...completa, fim: null });
  const nua = execucoes[1] ?? {};
  for (const c of ["grupo_processo", "configuracao_agente", "modelo_provedor", "modelo_nome", "effort"])
    assert.equal(c in nua, false);
});

test("CA-3: effort inválido falha com ErroDeRegra citando o campo e não altera nada", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], []);
  const antes = JSON.stringify(b.prepare("SELECT * FROM processo_do_trabalho").all());
  const ruim = { ...execucao("e2"), configuracao_agente: { effort: "turbo" } } as unknown as Execucao;
  assert.throws(
    () => gravar(b, [], [ruim], []),
    (e) => e instanceof ErroDeRegra && e.message.includes("effort"),
  );
  assert.equal(JSON.stringify(b.prepare("SELECT * FROM processo_do_trabalho").all()), antes);
});

test("CA-10: execuções abertas de qualquer ticket, com grupo de processo nulo ou gravado; as encerradas ficam de fora", () => {
  const b = banco();
  assert.deepEqual(ticketsComPiAtivo(b), new Set());
  gravar(b, [sessao("s1")], [execucao("e1"), { ...execucao("e2"), grupo_processo: 4321 }], []);
  gravar(b, [sessao("s2", 2)], [execucao("e3", "s2")], [], noTicket2);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  assert.deepEqual(ticketsComPiAtivo(b), new Set(["I-1.T1"]));
  assert.deepEqual(execucoesAbertas(b), [
    { id: "e2", trabalho_id: "s1", demanda_id: "I-1", ticket_id: 1, grupo_processo: 4321, ambiente_id: "host_local" },
    { id: "e3", trabalho_id: "s2", demanda_id: "I-1", ticket_id: 2, grupo_processo: null, ambiente_id: "host_local" },
  ]);
});

test("o Ambiente gravado no processo aberto volta em processosAbertos, para a recuperação da subida", () => {
  const b = banco();
  gravar(b, [sessao("s1")], [{ ...execucao("e1"), grupo_processo: 77 }], []);
  gravarAmbienteDaExecucao(b, "e1", "amb-9");
  assert.equal(execucoesAbertas(b)[0]?.ambiente_id, "amb-9");
  comSessoesDoContexto(b, ref, (x) => ({
    ...x,
    execucoes: x.execucoes.map((e) => ({ ...e, grupo_processo: 78 })),
  }));
  assert.equal(execucoesAbertas(b)[0]?.ambiente_id, "amb-9"); // o upsert do processo não o apaga
});

test("a lista pelas sessões e pelas execuções traz a sessão dona; id desconhecido não traz nenhuma", () => {
  const b = banco();
  gravar(b, [sessao("s1")], [execucao("e1")], []);
  gravar(b, [sessao("s2", 2)], [], [], noTicket2);
  assert.partialDeepStrictEqual(resumosDasSessoesEmLote(b, { sessoes: ["s2"] }), [{ id: "s2", ...noTicket2 }]);
  assert.deepEqual(resumosDasSessoesEmLote(b, { sessoes: ["nao-existe"] }), []);
  assert.partialDeepStrictEqual(resumosDasSessoesEmLote(b, { execucoes: ["e1"] }), [{ id: "s1", ...ref }]);
  assert.deepEqual(resumosDasSessoesEmLote(b, { execucoes: ["nao-existe"] }), []);
});

test("o token resolve só o processo vivo dono dele; encerrado, de outro e desconhecido não resolvem", () => {
  const b = banco();
  gravar(b, [sessao(), sessao("s2")], [execucao("e1"), execucao("e2", "s2")], []);
  gravarTokenDaExecucao(b, "e1", "token-1");
  gravarTokenDaExecucao(b, "e2", "token-2");

  assert.equal(execucaoVivaDoToken(b, "token-1"), "e1");
  assert.equal(execucaoVivaDoToken(b, "token-2"), "e2");
  assert.equal(execucaoVivaDoToken(b, "desconhecido"), undefined);
  assert.equal(execucaoVivaDoToken(b, ""), undefined);

  // o upsert do ticket (encerrar) não apaga o hash, mas o processo terminado deixa de resolver
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  assert.equal(execucaoVivaDoToken(b, "token-1"), undefined);
  assert.equal(execucaoVivaDoToken(b, "token-2"), "e2");
});

test("o banco guarda só o hash do token, e processo inexistente ou terminado não recebe token", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], []);
  gravarTokenDaExecucao(b, "e1", "segredo");
  const hash = String(b.prepare("SELECT hash_do_token FROM processo_do_trabalho").get()?.hash_do_token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, "segredo");

  assert.throws(() => {
    gravarTokenDaExecucao(b, "inexistente", "t");
  }, ErroDeRegra);
  comSessoesDoContexto(b, ref, (x) => ({ ...x, execucoes: encerrarExecucao(x.execucoes, "e1", em, false) }));
  assert.throws(() => {
    gravarTokenDaExecucao(b, "e1", "outro");
  }, /já terminou/);
  assert.throws(() => {
    b.exec("UPDATE processo_do_trabalho SET hash_do_token = 'curto'");
  }, /CHECK/);
});
