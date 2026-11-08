import assert from "node:assert/strict";
import { test } from "node:test";
import { clonarAgregadoDemanda as structuredClone } from "../../apoio-testes/clonar_agregado_demanda.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "./ator.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { CICLO_DA_RODADA } from "./ciclos.ts";
import { ErroDeEscopo } from "./erros.ts";
import { reabrirTicket } from "./transicoes_demanda.ts";
import { motivoDaFalhaDoTicket } from "./tentativa.ts";
import {
  PREFIXO_TERCEIRA_REPROVACAO,
  conferirPullRequestRodada,
  concluirImplementacoesRodada,
  concluirSessaoRodada,
  confirmarAprovacaoPullRequest,
  MOTIVO_APROVACAO_AUTOMATICA_PR,
  registrarCorrecoesSessao,
  registrarRevisaoRodada,
  reprovarPullRequestRodada,
  validarAprovacaoPullRequest,
} from "./transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const ctx = { agora: t1 };
const D = "I-1";
const ref = { demanda_id: D, rodada_id: 1 };
const agente = (numeroTrabalho: number): Ator => ({ tipo: "agente", trabalho_id: `E-${String(numeroTrabalho)}` });
const EXTERNO: Ator = { tipo: "externo", ferramenta: "claude", sessao: "S1" };
const tk = (ticket_id: number, etapa: string, status: string, rodada_id: number | undefined = 1) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rd = (rodada_id: number, estado: string) => ({
  demanda_id: D,
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${D}-${String(rodada_id)}`,
});
const montar = (estado: string, tickets: object[], demanda = "em_execucao"): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado: demanda,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: `fabriquinha/${D}`,
    },
    decisoes: [],
    evidencias: [],
    tickets: [
      {
        demanda_id: D,
        ticket_id: 1,
        etapa: "entender_e_desenhar",
        estado: "concluido",
        estado_alterado_em: t0,
        criado_por: FABRIQUINHA,
      },
      ...tickets,
    ],
    rodadas: [rd(1, estado), rd(2, "implementar")],
  });
const emDesenvolvimento = (impl = "concluido") => montar("implementar", [tk(2, "implementar", impl)]);
const emRevisao = () =>
  montar("revisar_rodada", [tk(2, "implementar", "concluido"), tk(3, "revisar_rodada", "em_execucao")]);
const emEncerramento = (status = "aberto") =>
  montar("encerrar_rodada", [
    tk(2, "implementar", "concluido"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", status),
  ]);
const correcao = (id = 1) => ({ demanda_id: D, ticket_id: id, rodada_id: 1, titulo: "corrigir", descricao: "d" });

/** A recusa lança o erro esperado e deixa o agregado igual ao snapshot. */
const recusa = (ag: AgregadoDemanda, fn: () => unknown, erro: new (...a: never[]) => Error = Error) => {
  const antes = structuredClone(ag);
  assert.throws(fn, erro);
  assert.deepEqual(ag, antes);
};

test("CA-1: todas as implementações concluídas levam a revisao e abrem revisar_rodada novo", () => {
  const ag = emDesenvolvimento();
  const antes = structuredClone(ag);
  const novo = concluirImplementacoesRodada(ag, ref, FABRIQUINHA, ctx);
  assert.deepEqual(ag, antes);
  assert.deepEqual(
    novo.rodadas.map((r) => r.estado),
    ["revisar_rodada", "implementar"],
  );
  assert.deepEqual(novo.tickets.slice(0, 2), ag.tickets);
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.rodada_id, t.etapa, t.estado, t.estado_alterado_em]),
    [[3, 1, "revisar_rodada", "aberto", t1]],
  );
});

test("CA-1: implementação não concluída, vazia ou de outra rodada não avança", () => {
  for (const status of ["aberto", "em_execucao", "falhou", "cancelado"]) {
    const ag = emDesenvolvimento(status);
    recusa(ag, () => concluirImplementacoesRodada(ag, ref, FABRIQUINHA, ctx));
  }
  const vazia = montar("implementar", [tk(2, "implementar", "concluido", 2)]);
  recusa(vazia, () => concluirImplementacoesRodada(vazia, ref, FABRIQUINHA, ctx));
  const mista = montar("implementar", [tk(2, "implementar", "concluido"), tk(3, "implementar", "aberto")]);
  recusa(mista, () => concluirImplementacoesRodada(mista, ref, FABRIQUINHA, ctx));
});

test("guardas: ator, referência, estado da rodada e da demanda", () => {
  const ag = emDesenvolvimento();
  for (const ator of [AUDITOR, agente(2)]) {
    recusa(ag, () => concluirImplementacoesRodada(ag, ref, ator, ctx), ErroDeEscopo);
  }
  recusa(ag, () => concluirImplementacoesRodada(ag, { ...ref, extra: 1 }, FABRIQUINHA, ctx));
  recusa(ag, () => concluirImplementacoesRodada(ag, { demanda_id: "I-2", rodada_id: 1 }, FABRIQUINHA, ctx));
  recusa(ag, () => concluirImplementacoesRodada(ag, { ...ref, rodada_id: 9 }, FABRIQUINHA, ctx));
  const revisao = emRevisao();
  recusa(revisao, () => concluirImplementacoesRodada(revisao, ref, FABRIQUINHA, ctx));
  const planejando = montar("implementar", [tk(2, "implementar", "concluido")], "planejar");
  recusa(planejando, () => concluirImplementacoesRodada(planejando, ref, FABRIQUINHA, ctx));
});

const reprovada = (extra = {}) => ({
  ...ref,
  ticket_id: 3,
  aprovado: false,
  exigencias: "  refazer o teste  ",
  correcoes: [correcao()],
  ...extra,
});

test("CA-2: reprovação grava as exigências, cria a correção e volta a desenvolvimento", () => {
  const ag = emRevisao();
  const antes = structuredClone(ag);
  const agenteRevisor = agente(3);
  const novo = registrarRevisaoRodada(ag, reprovada(), agenteRevisor, ctx);
  assert.strictEqual(novo.decisoes[0]?.por, agenteRevisor);
  assert.deepEqual(ag, antes);
  assert.deepEqual(novo.tickets.at(-1)?.criado_por, agenteRevisor);
  assert.deepEqual(
    novo.rodadas.map((r) => r.estado),
    ["implementar", "implementar"],
  );
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [1, "entender_e_desenhar", "concluido"],
      [2, "implementar", "concluido"],
      [3, "revisar_rodada", "concluido"],
      [4, "implementar", "aberto"],
    ],
  );
  assert.deepEqual(novo.decisoes, [
    {
      demanda_id: D,
      ticket_id: 3,
      decisao_id: 1,
      gate: "gate_revisao_rodada",
      resultado: "reprovado",
      motivo: "refazer o teste",
      por: agente(3),
      em: t1,
    },
  ]);
});

const reprovado = (ticket_id: number, decisao_id: number, motivo: string) => ({
  demanda_id: D,
  ticket_id,
  decisao_id,
  gate: "gate_revisao_rodada",
  resultado: "reprovado",
  motivo,
  por: agente(ticket_id),
  em: t0,
});
const comRecusas = (ag: AgregadoDemanda, ...decisoes: object[]) => AgregadoDemanda.parse({ ...ag, decisoes });

test("CA-1: a terceira reprovação da rodada falha o ticket, sem corretivos, com os três motivos", () => {
  // duas reprovações em revisores anteriores da rodada e a terceira no atual
  const ag = comRecusas(
    montar("revisar_rodada", [
      tk(2, "implementar", "concluido"),
      tk(3, "revisar_rodada", "concluido"),
      tk(4, "implementar", "concluido"),
      tk(5, "revisar_rodada", "concluido"),
      tk(6, "implementar", "concluido"),
      tk(7, "revisar_rodada", "em_execucao"),
    ]),
    reprovado(3, 1, "primeiro"),
    reprovado(5, 1, "segundo"),
  );
  const antes = structuredClone(ag);
  const novo = registrarRevisaoRodada(ag, reprovada({ ticket_id: 7, exigencias: "terceiro" }), agente(7), ctx);
  assert.deepEqual(ag, antes);
  assert.equal(novo.tickets.length, ag.tickets.length);
  const falho = novo.tickets.find((t) => t.ticket_id === 7);
  assert.equal(falho?.estado, "falhou");
  assert.ok(motivoDaFalhaDoTicket(novo.tentativas, falho)?.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  for (const motivo of ["primeiro", "segundo", "terceiro"])
    assert.match(motivoDaFalhaDoTicket(novo.tentativas, falho) ?? "", new RegExp(motivo));
  assert.equal(novo.rodadas[0]?.estado, "revisar_rodada");
  assert.deepEqual(novo.decisoes.at(-1), { ...reprovado(7, 1, "terceiro"), em: t1 });
});

test("CA-3: reaberto pelo Auditor, o mesmo ticket decide de novo: aprova ou falha outra vez, sem corretivos", () => {
  const falhou = comRecusas(emRevisao(), reprovado(3, 1, "a"), reprovado(3, 2, "b"));
  const terceira = registrarRevisaoRodada(falhou, reprovada({ exigencias: "c" }), agente(3), ctx);
  assert.equal(terceira.decisoes.at(-1)?.decisao_id, 3);
  const aberto = reabrirTicket(terceira, { ticket_id: 3, instrucao: "aceite o achado" }, AUDITOR, ctx);
  const reaberto = {
    ...aberto,
    tickets: aberto.tickets.map((ticket) =>
      ticket.ticket_id === 3 ? { ...ticket, estado: "em_execucao" as const } : ticket,
    ),
  };

  const aprovado = registrarRevisaoRodada(reaberto, { ...ref, ticket_id: 3, aprovado: true }, agente(3), ctx);
  assert.equal(aprovado.rodadas[0]?.estado, "encerrar_rodada");
  assert.equal(aprovado.decisoes.at(-1)?.decisao_id, 4);

  const outra = registrarRevisaoRodada(reaberto, reprovada({ exigencias: "d" }), agente(3), ctx);
  const ticket = outra.tickets.find((t) => t.ticket_id === 3);
  assert.equal(ticket?.estado, "falhou");
  assert.ok(motivoDaFalhaDoTicket(outra.tentativas, ticket)?.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.equal(outra.tickets.length, reaberto.tickets.length);
  assert.equal(outra.decisoes.at(-1)?.decisao_id, 4);
});

test("CA-3: a quarta reprovação com motivos longos mantém o prefixo e a demanda carregável", () => {
  const longo = (letra: string) => `${letra} `.repeat(999).trim(); // 999 palavras: o Motivo aceita até 2.000 caracteres
  const falhou = comRecusas(emRevisao(), reprovado(3, 1, longo("a")), reprovado(3, 2, longo("b")));
  const terceira = registrarRevisaoRodada(falhou, reprovada({ exigencias: longo("c") }), agente(3), ctx);
  const aberto = reabrirTicket(terceira, { ticket_id: 3, instrucao: "decida" }, AUDITOR, ctx);
  const reaberto = {
    ...aberto,
    tickets: aberto.tickets.map((ticket) =>
      ticket.ticket_id === 3 ? { ...ticket, estado: "em_execucao" as const } : ticket,
    ),
  };
  const quarta = registrarRevisaoRodada(reaberto, reprovada({ exigencias: longo("d") }), agente(3), ctx);
  const ticketFalho = quarta.tickets.find((ticket) => ticket.ticket_id === 3);
  assert.ok(ticketFalho);
  const motivoFalha = motivoDaFalhaDoTicket(quarta.tentativas, ticketFalho) ?? "";
  assert.ok(motivoFalha.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.ok(motivoFalha.endsWith(" d d d"));
  assert.match(motivoFalha, /\(3 reprovações anteriores omitidas\)/);
  assert.doesNotThrow(() => AgregadoDemanda.parse(quarta));
});

test("CA-3: motivos curtos de mais de três reprovações cabem inteiros, sem aviso de omissão", () => {
  const falhou = comRecusas(emRevisao(), reprovado(3, 1, "a"), reprovado(3, 2, "b"), reprovado(3, 3, "c"));
  const quarta = registrarRevisaoRodada(falhou, reprovada({ exigencias: "d" }), agente(3), ctx);
  const ticketFalho = quarta.tickets.find((ticket) => ticket.ticket_id === 3);
  assert.ok(ticketFalho);
  const motivoFalha = motivoDaFalhaDoTicket(quarta.tentativas, ticketFalho) ?? "";
  assert.equal(motivoFalha, `${PREFIXO_TERCEIRA_REPROVACAO}\n- a\n- b\n- c\n- d`);
});

test("CA-2: com uma recusa anterior na rodada, a reprovação ainda cria a correção", () => {
  const ag = comRecusas(emRevisao(), reprovado(3, 1, "a"));
  const novo = registrarRevisaoRodada(ag, reprovada(), agente(3), ctx);
  assert.equal(novo.tickets.find((t) => t.ticket_id === 3)?.estado, "concluido");
  assert.equal(novo.tickets.at(-1)?.etapa, "implementar");
  assert.equal(novo.rodadas[0]?.estado, "implementar");
});

test("CA-2: reprovação sem exigências, sem correções ou inválida não muda nada", () => {
  const ag = emRevisao();
  for (const entrada of [
    reprovada({ exigencias: " " }),
    reprovada({ exigencias: undefined }),
    reprovada({ correcoes: [] }),
    reprovada({ correcoes: undefined }),
    reprovada({ correcoes: [{ ...correcao(), rodada_id: 2 }] }),
    reprovada({ nota: 3 }),
  ]) {
    recusa(ag, () => registrarRevisaoRodada(ag, entrada, agente(3), ctx));
  }
});

test("CA-3: aprovação conclui a revisão, abre encerrar_rodada e vai a encerramento", () => {
  const ag = emRevisao();
  const agenteRevisor = agente(3);
  const novo = registrarRevisaoRodada(ag, { ...ref, ticket_id: 3, aprovado: true }, agenteRevisor, ctx);
  assert.strictEqual(novo.decisoes[0]?.por, agenteRevisor);
  assert.deepEqual(
    novo.rodadas.map((r) => r.estado),
    ["encerrar_rodada", "implementar"],
  );
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [3, "revisar_rodada", "concluido"],
      [4, "encerrar_rodada", "aberto"],
    ],
  );
  assert.deepEqual(
    novo.decisoes.map((d) => [d.ticket_id, d.decisao_id, d.resultado, d.motivo, d.nota, d.por]),
    [[3, 1, "aprovado", undefined, undefined, agente(3)]],
  );
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ref, ticket_id: 3, aprovado: true, nota: 5 }, agente(3), ctx));
});

test("revisão: ator, ticket, status e estado errados são reprovados", () => {
  const ag = emRevisao();
  const ok = { ...ref, ticket_id: 3, aprovado: true };
  for (const ator of [AUDITOR, FABRIQUINHA, EXTERNO]) {
    recusa(ag, () => registrarRevisaoRodada(ag, ok, ator, ctx), ErroDeEscopo);
    assert.throws(() => registrarRevisaoRodada(ag, ok, ator, ctx), {
      message: "só o agente do ticket revisar_rodada atual decide a revisão (peça à sessão de revisão)",
    });
  }
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ok, ticket_id: 2 }, agente(2), ctx));
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ok, ticket_id: 9 }, agente(9), ctx));
  const falho = montar("revisar_rodada", [tk(2, "implementar", "concluido"), tk(3, "revisar_rodada", "falhou")]);
  recusa(falho, () => registrarRevisaoRodada(falho, ok, agente(3), ctx));
  const sem = montar("revisar_rodada", [tk(2, "implementar", "concluido")]);
  recusa(sem, () => registrarRevisaoRodada(sem, ok, agente(3), ctx));
  const dev = emDesenvolvimento();
  recusa(dev, () => registrarRevisaoRodada(dev, ok, agente(3), ctx));
  // repetição após a mudança de estado não duplica decisão nem ticket
  const feito = registrarRevisaoRodada(ag, ok, agente(3), ctx);
  recusa(feito, () => registrarRevisaoRodada(feito, ok, agente(3), ctx));
});

const conferencia = (extra = {}) => ({
  ...ref,
  ticket_id: 4,
  documentacao_entregue: true,
  conflito: false,
  check_falho: false,
  ...extra,
});

test("CA-5: sem conflito nem check falho vai a gate_pr mantendo o encerrar_rodada", () => {
  const ag = emEncerramento();
  const novo = conferirPullRequestRodada(ag, conferencia(), FABRIQUINHA, ctx);
  assert.deepEqual(
    novo.rodadas.map((r) => r.estado),
    ["gate_pr", "implementar"],
  );
  assert.deepEqual(novo.tickets, ag.tickets);
  assert.deepEqual(novo.decisoes, []);
  recusa(ag, () => conferirPullRequestRodada(ag, conferencia({ correcoes: [correcao()] }), FABRIQUINHA, ctx));
});

test("CA-4: conflito, check falho ou ambos exigem correções e voltam a desenvolvimento sem decisão", () => {
  for (const fatos of [{ conflito: true }, { check_falho: true }, { conflito: true, check_falho: true }]) {
    const ag = emEncerramento();
    const antes = structuredClone(ag);
    recusa(ag, () => conferirPullRequestRodada(ag, conferencia(fatos), FABRIQUINHA, ctx));
    recusa(ag, () => conferirPullRequestRodada(ag, conferencia({ ...fatos, correcoes: [] }), FABRIQUINHA, ctx));
    const novo = conferirPullRequestRodada(ag, conferencia({ ...fatos, correcoes: [correcao()] }), FABRIQUINHA, ctx);
    assert.deepEqual(ag, antes);
    assert.deepEqual(
      novo.rodadas.map((r) => r.estado),
      ["implementar", "implementar"],
    );
    assert.deepEqual(
      novo.tickets.slice(3).map((t) => [t.ticket_id, t.etapa, t.estado]),
      [
        [4, "encerrar_rodada", "concluido"],
        [5, "implementar", "aberto"],
      ],
    );
    assert.deepEqual(novo.tickets.at(-1)?.criado_por, FABRIQUINHA);
    assert.deepEqual(novo.decisoes, []);
  }
});

test("conferência: documentação, fatos explícitos, ator, ticket e estado errados são reprovados", () => {
  const ag = emEncerramento();
  recusa(ag, () => conferirPullRequestRodada(ag, conferencia({ documentacao_entregue: false }), FABRIQUINHA, ctx));
  for (const campo of ["documentacao_entregue", "conflito", "check_falho"]) {
    recusa(ag, () => conferirPullRequestRodada(ag, conferencia({ [campo]: undefined }), FABRIQUINHA, ctx));
  }
  for (const ator of [AUDITOR, agente(4)]) {
    recusa(ag, () => conferirPullRequestRodada(ag, conferencia(), ator, ctx), ErroDeEscopo);
  }
  recusa(ag, () => conferirPullRequestRodada(ag, conferencia({ ticket_id: 3 }), FABRIQUINHA, ctx));
  const falho = emEncerramento("falhou");
  recusa(falho, () => conferirPullRequestRodada(falho, conferencia(), FABRIQUINHA, ctx));
  const rev = emRevisao();
  recusa(rev, () => conferirPullRequestRodada(rev, conferencia(), FABRIQUINHA, ctx));
});

test("novo ciclo abre tickets novos e preserva o histórico", () => {
  const ag0 = emRevisao();
  const ag1 = registrarRevisaoRodada(ag0, reprovada(), agente(3), ctx); // implementar 4
  const concluido = AgregadoDemanda.parse({
    ...ag1,
    tickets: ag1.tickets.map((t) => (t.ticket_id === 4 ? { ...t, estado: "concluido" } : t)),
  });
  const ag2 = concluirImplementacoesRodada(concluido, ref, FABRIQUINHA, ctx); // revisar 5
  const ag3 = registrarRevisaoRodada(ag2, { ...ref, ticket_id: 5, aprovado: true }, agente(5), ctx); // encerrar 6
  const ag4 = conferirPullRequestRodada(
    ag3,
    conferencia({ ticket_id: 6, conflito: true, correcoes: [correcao()] }),
    FABRIQUINHA,
    ctx,
  );
  assert.deepEqual(ag4.tickets.map((t) => [t.ticket_id, t.etapa, t.estado]).slice(2), [
    [3, "revisar_rodada", "concluido"],
    [4, "implementar", "concluido"],
    [5, "revisar_rodada", "concluido"],
    [6, "encerrar_rodada", "concluido"],
    [7, "implementar", "aberto"],
  ]);
  assert.equal(ag4.decisoes[0]?.motivo, "refazer o teste");
  assert.deepEqual(
    ag4.decisoes.map((d) => [d.ticket_id, d.decisao_id, d.resultado]),
    [
      [3, 1, "reprovado"],
      [5, 1, "aprovado"],
    ],
  );
  // o revisor antigo não decide mais
  recusa(ag4, () => registrarRevisaoRodada(ag4, { ...ref, ticket_id: 3, aprovado: true }, agente(3), ctx));
});

const emGate = (status = "aberto") =>
  montar("gate_pr", [
    tk(2, "implementar", "concluido"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", status),
  ]);
const emSessao = (extra: object[] = [], status = "aberto") =>
  montar("ajustar_resultado", [
    tk(2, "implementar", "concluido"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "ajustar_resultado", status),
    ...extra,
  ]);
const estado = (ag: AgregadoDemanda) => ag.rodadas.map((r) => r.estado);

test("CA-7: reprovar o PR registra recusa sem nota, conclui o gate e abre a sessão", () => {
  const ag = emGate();
  const antes = structuredClone(ag);
  const novo = reprovarPullRequestRodada(ag, { ...ref, ticket_id: 4, motivo: " ajustar " }, AUDITOR, ctx);
  assert.deepEqual(ag, antes);
  assert.deepEqual(estado(novo), ["ajustar_resultado", "implementar"]);
  assert.deepEqual(
    novo.tickets.slice(3).map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [4, "encerrar_rodada", "concluido"],
      [5, "ajustar_resultado", "aberto"],
    ],
  );
  assert.deepEqual(novo.decisoes, [
    {
      demanda_id: D,
      ticket_id: 4,
      decisao_id: 1,
      gate: "gate_pr",
      resultado: "reprovado",
      motivo: "ajustar",
      por: AUDITOR,
      em: t1,
    },
  ]);
  // repetição após a mudança de estado não duplica decisão
  recusa(novo, () => reprovarPullRequestRodada(novo, { ...ref, ticket_id: 4, motivo: "x" }, AUDITOR, ctx));
});

test("CA-6: reprovar sem motivo, com nota, por outro ator ou fora do gate é reprovado", () => {
  const ag = emGate();
  const ok = { ...ref, ticket_id: 4, motivo: "x" };
  for (const entrada of [
    { ...ok, motivo: " " },
    { ...ref, ticket_id: 4 },
    { ...ok, nota: 3 },
    { ...ok, ticket_id: 3 },
  ]) {
    recusa(ag, () => reprovarPullRequestRodada(ag, entrada, AUDITOR, ctx));
  }
  for (const ator of [FABRIQUINHA, agente(4)]) {
    recusa(ag, () => reprovarPullRequestRodada(ag, ok, ator, ctx), ErroDeEscopo);
  }
  const falho = emGate("falhou");
  recusa(falho, () => reprovarPullRequestRodada(falho, ok, AUDITOR, ctx));
  const enc = emEncerramento();
  recusa(enc, () => reprovarPullRequestRodada(enc, ok, AUDITOR, ctx));
});

test("sessão: Auditor e agente da sessão registram correções sem executar nem mudar de estado", () => {
  const ag = emSessao();
  const entrada = { ...ref, ticket_id: 5, correcoes: [correcao()] };
  for (const ator of [AUDITOR, agente(5)]) {
    const novo = registrarCorrecoesSessao(ag, entrada, ator, ctx);
    assert.deepEqual(estado(novo), ["ajustar_resultado", "implementar"]);
    assert.deepEqual(novo.tickets.at(-1)?.criado_por, ator);
    assert.deepEqual(
      novo.tickets.slice(5).map((t) => [t.ticket_id, t.etapa, t.estado]),
      [[6, "implementar", "aberto"]],
    );
  }
  for (const ator of [FABRIQUINHA, EXTERNO]) {
    recusa(ag, () => registrarCorrecoesSessao(ag, entrada, ator, ctx), ErroDeEscopo);
    assert.throws(() => registrarCorrecoesSessao(ag, entrada, ator, ctx), {
      message: "só o Auditor ou o agente da sessão registram correções (peça ao Auditor pelo web)",
    });
  }
  recusa(ag, () => registrarCorrecoesSessao(ag, { ...entrada, correcoes: [] }, AUDITOR, ctx));
  recusa(ag, () => registrarCorrecoesSessao(ag, { ...entrada, ticket_id: 4 }, AUDITOR, ctx));
  const dev = emDesenvolvimento();
  recusa(dev, () => registrarCorrecoesSessao(dev, { ...entrada, ticket_id: 2 }, AUDITOR, ctx));
});

test("CA-8: concluir a sessão sem ticket novo, com ticket antigo ou em execução é reprovado", () => {
  const ok = { ...ref, ticket_id: 5 };
  const sem = emSessao();
  recusa(sem, () => concluirSessaoRodada(sem, ok, AUDITOR, ctx));
  // implementar aberto anterior à sessão é histórico e não conta
  const antigo = montar("ajustar_resultado", [
    tk(2, "implementar", "aberto"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "ajustar_resultado", "aberto"),
  ]);
  recusa(antigo, () => concluirSessaoRodada(antigo, ok, AUDITOR, ctx));
  const rodando = emSessao([tk(6, "implementar", "aberto"), tk(7, "implementar", "em_execucao")]);
  recusa(rodando, () => concluirSessaoRodada(rodando, ok, AUDITOR, ctx));
  const com = emSessao([tk(6, "implementar", "aberto")]);
  for (const ator of [FABRIQUINHA, agente(5)]) {
    recusa(com, () => concluirSessaoRodada(com, ok, ator, ctx), ErroDeEscopo);
  }
  recusa(com, () => concluirSessaoRodada(com, { ...ok, ticket_id: 4 }, AUDITOR, ctx));
  const fim = emSessao([tk(6, "implementar", "aberto")], "concluido");
  recusa(fim, () => concluirSessaoRodada(fim, ok, AUDITOR, ctx));
});

test("CA-9: concluir a sessão com correção nova volta a desenvolvimento e libera o ticket", () => {
  const ag = registrarCorrecoesSessao(emSessao(), { ...ref, ticket_id: 5, correcoes: [correcao()] }, AUDITOR, ctx);
  const novo = concluirSessaoRodada(ag, { ...ref, ticket_id: 5 }, AUDITOR, ctx);
  assert.deepEqual(estado(novo), ["implementar", "implementar"]);
  assert.deepEqual(
    novo.tickets.slice(4).map((t) => [t.ticket_id, t.etapa, t.estado]),
    [
      [5, "ajustar_resultado", "concluido"],
      [6, "implementar", "aberto"],
    ],
  );
  assert.deepEqual(novo.decisoes, []);
});

const aprovacao = (extra = {}) => ({ ...ref, ticket_id: 4, nota: 4, ...extra });
const integracao = (extra = {}) => ({
  ...ref,
  ticket_id: 4,
  confirmada: true,
  branch_destino: `fabriquinha/${D}`,
  ...extra,
});

test("CA-6: validar a aprovação aceita notas 1 a 5 sem efeito e recusa o resto", () => {
  const ag = emGate();
  const antes = structuredClone(ag);
  for (const nota of [1, 5]) {
    assert.deepEqual(validarAprovacaoPullRequest(ag, aprovacao({ nota }), AUDITOR), aprovacao({ nota }));
  }
  assert.deepEqual(ag, antes);
  for (const nota of [undefined, 0, 6, 3.5, "3"]) {
    recusa(ag, () => validarAprovacaoPullRequest(ag, aprovacao({ nota }), AUDITOR));
  }
  recusa(ag, () => validarAprovacaoPullRequest(ag, aprovacao({ extra: 1 }), AUDITOR));
  recusa(ag, () => validarAprovacaoPullRequest(ag, aprovacao(), agente(4)), ErroDeEscopo);
  // A aprovação automática é da Fabriquinha e vem sem nota: a nota é do Auditor.
  recusa(ag, () => validarAprovacaoPullRequest(ag, aprovacao(), FABRIQUINHA));
  const automatica = { ...ref, ticket_id: 4 };
  assert.deepEqual(validarAprovacaoPullRequest(ag, automatica, FABRIQUINHA), automatica);
  const enc = emEncerramento();
  recusa(enc, () => validarAprovacaoPullRequest(enc, aprovacao(), AUDITOR));
  const obsoleto = montar("gate_pr", [tk(4, "encerrar_rodada", "concluido"), tk(5, "encerrar_rodada", "aberto")]);
  recusa(obsoleto, () => validarAprovacaoPullRequest(obsoleto, aprovacao(), AUDITOR));
});

test("CA-11: confirmada a integração, grava a aprovação com a nota e conclui a rodada", () => {
  for (const nota of [1, 5]) {
    const ag = emGate();
    const antes = structuredClone(ag);
    const novo = confirmarAprovacaoPullRequest(ag, aprovacao({ nota }), AUDITOR, {
      agora: t1,
      integracao: integracao(),
    });
    assert.deepEqual(ag, antes);
    assert.deepEqual(estado(novo), ["concluida", "implementar"]);
    assert.equal(novo.tickets.find((t) => t.ticket_id === 4)?.estado, "concluido");
    assert.deepEqual(novo.decisoes, [
      {
        demanda_id: D,
        ticket_id: 4,
        decisao_id: 1,
        gate: "gate_pr",
        resultado: "aprovado",
        nota,
        por: AUDITOR,
        em: t1,
      },
    ]);
    // repetição após a conclusão não duplica a decisão
    recusa(novo, () =>
      confirmarAprovacaoPullRequest(novo, aprovacao({ nota }), AUDITOR, { agora: t1, integracao: integracao() }),
    );
  }
});

test("a aprovação automática conclui a rodada com o motivo dela no lugar da nota", () => {
  const ag = emGate();
  const novo = confirmarAprovacaoPullRequest(ag, { ...ref, ticket_id: 4 }, FABRIQUINHA, {
    agora: t1,
    integracao: integracao(),
  });
  assert.deepEqual(estado(novo), ["concluida", "implementar"]);
  assert.deepEqual(novo.decisoes, [
    {
      demanda_id: D,
      ticket_id: 4,
      decisao_id: 1,
      gate: "gate_pr",
      resultado: "aprovado",
      motivo: MOTIVO_APROVACAO_AUTOMATICA_PR,
      por: { tipo: "fabriquinha" },
      em: t1,
    },
  ]);
});

test("CA-10: sem confirmação, falha, divergência ou entrada inválida nada é registrado", () => {
  const ag = emGate();
  const confirma =
    (entrada: unknown, i: unknown, ator: Ator = AUDITOR) =>
    () =>
      confirmarAprovacaoPullRequest(ag, entrada, ator, { agora: t1, integracao: i });
  for (const i of [
    undefined,
    null,
    integracao({ confirmada: false }),
    integracao({ confirmada: undefined }),
    integracao({ demanda_id: "I-2" }),
    integracao({ rodada_id: 2 }),
    integracao({ ticket_id: 3 }),
    integracao({ branch_destino: `fabriquinha/${D}-1` }),
    integracao({ extra: 1 }),
  ]) {
    recusa(ag, confirma(aprovacao(), i));
  }
  recusa(ag, confirma(aprovacao({ nota: 6 }), integracao()));
  recusa(ag, confirma(aprovacao(), integracao(), FABRIQUINHA));
  recusa(ag, confirma(aprovacao(), integracao(), agente(4)), ErroDeEscopo);
  recusa(ag, () => confirmarAprovacaoPullRequest(ag, aprovacao(), AUDITOR, ctx));
});

// Cada par de→para do ciclo da rodada, feito pela função de produção que o realiza, com o instante injetado.
const FUNCAO_DE_PRODUCAO_DE_CADA_TRANSICAO: Record<string, () => AgregadoDemanda> = {
  "implementar→revisar_rodada": () => concluirImplementacoesRodada(emDesenvolvimento(), ref, FABRIQUINHA, ctx),
  "revisar_rodada→encerrar_rodada": () =>
    registrarRevisaoRodada(emRevisao(), { ...ref, ticket_id: 3, aprovado: true }, agente(3), ctx),
  "revisar_rodada→implementar": () => registrarRevisaoRodada(emRevisao(), reprovada(), agente(3), ctx),
  "encerrar_rodada→gate_pr": () => conferirPullRequestRodada(emEncerramento(), conferencia(), FABRIQUINHA, ctx),
  "encerrar_rodada→implementar": () =>
    conferirPullRequestRodada(
      emEncerramento(),
      conferencia({ conflito: true, correcoes: [correcao()] }),
      FABRIQUINHA,
      ctx,
    ),
  "gate_pr→ajustar_resultado": () =>
    reprovarPullRequestRodada(emGate(), { ...ref, ticket_id: 4, motivo: "ajustar" }, AUDITOR, ctx),
  "gate_pr→concluida": () =>
    confirmarAprovacaoPullRequest(emGate(), aprovacao(), AUDITOR, { agora: t1, integracao: integracao() }),
  "ajustar_resultado→implementar": () =>
    concluirSessaoRodada(
      registrarCorrecoesSessao(emSessao(), { ...ref, ticket_id: 5, correcoes: [correcao()] }, AUDITOR, ctx),
      { ...ref, ticket_id: 5 },
      AUDITOR,
      ctx,
    ),
};

test("CA-4: cada transição declarada em CICLO_DA_RODADA grava o estado destino e o instante da mudança", () => {
  const declaradas = Object.entries(CICLO_DA_RODADA.transicoes).flatMap(([de, destinos]) =>
    destinos.map((para) => `${de}→${para}`),
  );
  assert.deepEqual(declaradas.sort(), Object.keys(FUNCAO_DE_PRODUCAO_DE_CADA_TRANSICAO).sort());
  for (const par of declaradas) {
    const [, para] = par.split("→");
    const rodada = FUNCAO_DE_PRODUCAO_DE_CADA_TRANSICAO[par]?.().rodadas.find((r) => r.rodada_id === 1);
    assert.equal(rodada?.estado, para, par);
    assert.equal(rodada?.estado_alterado_em, t1, par);
  }
});
