import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import { encerrarProcesso, iniciarProcesso, registrarUso } from "../nucleo/trabalho_agentico.ts";
import type { ProcessoDoTrabalho, TrabalhoGerenciado, UsoModeloExecucao } from "../nucleo/trabalho_agentico.ts";
import { ticketsComPiAtivo } from "../../../server/consultas/sessoes/historico_demanda.ts";
import {
  carregarTrabalhosDaDemanda,
  carregarTrabalhosDoTicket,
  comTrabalhosDoTicket,
  gravarAmbienteDoProcesso,
  gravarTokenDoProcesso,
  processosAbertos,
  processoVivoDoToken,
  sessaoDeCadaTicketDasDemandas,
  ticketDoTrabalho,
} from "./trabalho_agentico.ts";
import { migrarBancoDaFabriquinha } from "../../../server/composicao/banco_da_fabriquinha.ts";

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

const sessao = (id = "s1", ticket_id = 1): TrabalhoGerenciado => ({
  id,
  demanda_id: "I-1",
  ticket_id,
  modo: "autonomo",
  conversa_referencia: "c",
});
const execucao = (id = "e1", trabalho_id = "s1"): ProcessoDoTrabalho => ({ id, trabalho_id, inicio: em, falha: false });
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
const gravar = (b: DatabaseSync, s: TrabalhoGerenciado[], e: ProcessoDoTrabalho[], u: UsoModeloExecucao[], r = ref) =>
  comTrabalhosDoTicket(b, r, (x) => ({
    sessoes: [...x.sessoes, ...s],
    execucoes: [...x.execucoes, ...e],
    usos: u.reduce(registrarUso, x.usos),
  }));

test("CA-8, CA-9, CA-12: ida e volta; execução sem fim volta nula e custo ausente não vira zero", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  const lido = carregarTrabalhosDoTicket(b, ref);
  assert.deepEqual(lido, { sessoes: [sessao()], execucoes: [{ ...execucao(), fim: null }], usos: [uso()] });
  assert.equal(b.prepare("SELECT fim FROM processo_do_trabalho").get()?.fim, null);
  assert.equal("custo" in (lido.usos[0] ?? {}), false);
});

test("encerrar a execução e registrar custo atualizam a linha existente", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso({ custo: 0.5 })]);
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarProcesso(x.execucoes, "e1", em, true) }));
  const lido = carregarTrabalhosDoTicket(b, ref);
  assert.deepEqual(lido.execucoes, [{ ...execucao(), fim: em, falha: true }]);
  assert.equal(lido.usos[0]?.custo, 0.5);
});

test("CA-11: registrar de novo o mesmo uso substitui, não soma", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 40 })) }));
  const { usos } = carregarTrabalhosDoTicket(b, ref);
  assert.equal(usos.length, 1);
  assert.equal(usos[0]?.tokens_entrada, 40);
});

test("CA-10, CA-13, CA-14: FK ou CHECK desfazem a gravação inteira", () => {
  const b = banco();
  const recusa = (f: () => unknown, padrao: RegExp) => {
    assert.throws(f, padrao);
    assert.deepEqual(carregarTrabalhosDaDemanda(b, "I-1"), { sessoes: [], execucoes: [], usos: [] });
    assert.equal(b.isTransaction, false);
  };
  recusa(() => gravar(b, [sessao("s2", 99)], [], [], { demanda_id: "I-1", ticket_id: 99 }), /FOREIGN KEY/);
  recusa(() => gravar(b, [sessao()], [execucao()], [uso({ execucao_id: "inexistente" })]), /não é de uma execução/);
  // sem passar por registrarUso: a CHECK do banco recusa depois de sessão e execução já inseridas
  recusa(
    () =>
      comTrabalhosDoTicket(b, ref, () => ({
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
  const ticket = carregarTrabalhosDoTicket(b, ref);
  assert.equal(ticket.sessoes.length, 1);
  assert.deepEqual(ticket.usos, [u[0]]);
  assert.equal(carregarTrabalhosDaDemanda(b, "I-1").usos.length, 2);
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: [...x.execucoes] }));
  assert.throws(
    () =>
      comTrabalhosDoTicket(b, ref, (x) => ({
        ...x,
        execucoes: iniciarProcesso(x.sessoes, x.execucoes, execucao("e3")),
      })),
    /sem fim/,
  );
});

const noTicket2 = { demanda_id: "I-1", ticket_id: 2 };
const comEncerrada = () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], [uso()]);
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarProcesso(x.execucoes, "e1", em, false) }));
  return { b, antes: carregarTrabalhosDoTicket(b, ref) };
};

test("id de sessão repetido em outro ticket falha e o ticket original não muda", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() => comTrabalhosDoTicket(b, noTicket2, (x) => ({ ...x, sessoes: [...x.sessoes, sessao("s1", 2)] })));
  assert.deepEqual(carregarTrabalhosDoTicket(b, ref), antes);
});

test("id de execução repetido em outro ticket falha e o fim da original fica", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comTrabalhosDoTicket(b, noTicket2, (x) => {
      const sessoes = [...x.sessoes, sessao("s9", 2)];
      return { ...x, sessoes, execucoes: iniciarProcesso(sessoes, x.execucoes, execucao("e1", "s9")) };
    }),
  );
  assert.deepEqual(carregarTrabalhosDoTicket(b, ref), antes);
});

test("uso de execução de outro ticket é rejeitado sem alterar o uso original", () => {
  const { b, antes } = comEncerrada();
  assert.throws(() =>
    comTrabalhosDoTicket(b, noTicket2, (x) => ({ ...x, usos: registrarUso(x.usos, uso({ tokens_entrada: 1 })) })),
  );
  assert.deepEqual(carregarTrabalhosDoTicket(b, ref), antes);
});

test("sessão de outro ticket e execução de sessão fora do resultado são rejeitadas", () => {
  const b = banco();
  assert.throws(() => comTrabalhosDoTicket(b, ref, (x) => ({ ...x, sessoes: [sessao("s2", 2)] })), /não é do ticket/);
  assert.throws(
    () => comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: [execucao("e2", "s7")] })),
    /sessão do ticket/,
  );
});

test("CA-1, CA-2: controle da execução volta igual; ausente volta sem a chave", () => {
  const b = banco();
  const completa: ProcessoDoTrabalho = {
    ...execucao(),
    grupo_processo: 4321,
    configuracao_agente: { modelo: { provedor: "claude-bridge", nome: "claude-sonnet-5-5" }, effort: "high" },
  };
  gravar(b, [sessao()], [completa, execucao("e2")], []);
  const { execucoes } = carregarTrabalhosDoTicket(b, ref);
  assert.deepEqual(execucoes[0], { ...completa, fim: null });
  const nua = execucoes[1] ?? {};
  for (const c of ["grupo_processo", "configuracao_agente", "modelo_provedor", "modelo_nome", "effort"])
    assert.equal(c in nua, false);
});

test("CA-3: effort inválido falha com ErroDeRegra citando o campo e não altera nada", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], []);
  const antes = JSON.stringify(b.prepare("SELECT * FROM processo_do_trabalho").all());
  const ruim = { ...execucao("e2"), configuracao_agente: { effort: "turbo" } } as unknown as ProcessoDoTrabalho;
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
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarProcesso(x.execucoes, "e1", em, false) }));
  assert.deepEqual(ticketsComPiAtivo(b), new Set(["I-1.T1"]));
  assert.deepEqual(processosAbertos(b), [
    { id: "e2", trabalho_id: "s1", demanda_id: "I-1", ticket_id: 1, grupo_processo: 4321, ambiente_id: "host_local" },
    { id: "e3", trabalho_id: "s2", demanda_id: "I-1", ticket_id: 2, grupo_processo: null, ambiente_id: "host_local" },
  ]);
});

test("o Ambiente gravado no processo aberto volta em processosAbertos, para a recuperação da subida", () => {
  const b = banco();
  gravar(b, [sessao("s1")], [{ ...execucao("e1"), grupo_processo: 77 }], []);
  gravarAmbienteDoProcesso(b, "e1", "amb-9");
  assert.equal(processosAbertos(b)[0]?.ambiente_id, "amb-9");
  comTrabalhosDoTicket(b, ref, (x) => ({
    ...x,
    execucoes: x.execucoes.map((e) => ({ ...e, grupo_processo: 78 })),
  }));
  assert.equal(processosAbertos(b)[0]?.ambiente_id, "amb-9"); // o upsert do processo não o apaga
});

test("o ticket dono do trabalho; id desconhecido volta sem ticket", () => {
  const b = banco();
  gravar(b, [sessao("s1")], [], []);
  gravar(b, [sessao("s2", 2)], [], [], noTicket2);
  assert.deepEqual({ ...ticketDoTrabalho(b, "s2") }, noTicket2);
  assert.equal(ticketDoTrabalho(b, "nao-existe"), undefined);
});

test("sessaoDeCadaTicketDasDemandas separa por demanda e devolve vazio para a que não tem sessão", () => {
  const b = banco();
  b.exec(`INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-2', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-2', 1, 'implementar', 'aberto', ${T})`);
  const nova = b.prepare(
    "INSERT INTO trabalho_agentico (id, demanda_id, ticket_id, modo, conversa_referencia) VALUES (?, ?, 1, 'autonomo', 'c')",
  );
  nova.run("s-1", "I-1");
  nova.run("s-2", "I-2");
  assert.deepEqual(
    sessaoDeCadaTicketDasDemandas(b, ["I-2", "I-1", "I-9"]),
    new Map([
      ["I-2", new Map([[1, "s-2"]])],
      ["I-1", new Map([[1, "s-1"]])],
      ["I-9", new Map()],
    ]),
  );
});

test("o token resolve só o processo vivo dono dele; encerrado, de outro e desconhecido não resolvem", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao("e1"), execucao("e2")], []);
  gravarTokenDoProcesso(b, "e1", "token-1");
  gravarTokenDoProcesso(b, "e2", "token-2");

  assert.equal(processoVivoDoToken(b, "token-1"), "e1");
  assert.equal(processoVivoDoToken(b, "token-2"), "e2");
  assert.equal(processoVivoDoToken(b, "desconhecido"), undefined);
  assert.equal(processoVivoDoToken(b, ""), undefined);

  // o upsert do ticket (encerrar) não apaga o hash, mas o processo terminado deixa de resolver
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarProcesso(x.execucoes, "e1", em, false) }));
  assert.equal(processoVivoDoToken(b, "token-1"), undefined);
  assert.equal(processoVivoDoToken(b, "token-2"), "e2");
});

test("o banco guarda só o hash do token, e processo inexistente ou terminado não recebe token", () => {
  const b = banco();
  gravar(b, [sessao()], [execucao()], []);
  gravarTokenDoProcesso(b, "e1", "segredo");
  const hash = String(b.prepare("SELECT hash_do_token FROM processo_do_trabalho").get()?.hash_do_token);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(hash, "segredo");

  assert.throws(() => {
    gravarTokenDoProcesso(b, "inexistente", "t");
  }, ErroDeRegra);
  comTrabalhosDoTicket(b, ref, (x) => ({ ...x, execucoes: encerrarProcesso(x.execucoes, "e1", em, false) }));
  assert.throws(() => {
    gravarTokenDoProcesso(b, "e1", "outro");
  }, /já terminou/);
  assert.throws(() => {
    b.exec("UPDATE processo_do_trabalho SET hash_do_token = 'curto'");
  }, /CHECK/);
});
