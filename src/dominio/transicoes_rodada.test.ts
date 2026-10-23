import assert from "node:assert/strict";
import { test } from "node:test";
import { type Ator, AUDITOR, FABRIQUINHA } from "./agregado.ts";
import { AgregadoDemanda } from "./agregado_demanda.ts";
import { ErroDeEscopo } from "./erros.ts";
import {
  conferirPullRequestRodada,
  concluirImplementacoesRodada,
  concluirSessaoRodada,
  confirmarAprovacaoPullRequest,
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
const agente = (ticket: number): Ator => ({ tipo: "agente", execucao: 1, ticket });
const tk = (ticket_id: number, etapa: string, status: string, rodada_id: number | undefined = 1) => ({
  demanda_id: D,
  ticket_id,
  rodada_id,
  etapa,
  status,
  status_alterado_em: t0,
});
const rd = (rodada_id: number, fase: string) => ({
  demanda_id: D,
  rodada_id,
  titulo: "r",
  fase,
  e2e: false,
  branch: `fabriquinha/${D}-${String(rodada_id)}`,
});
const montar = (fase: string, tickets: object[], demanda = "execucao"): AgregadoDemanda =>
  AgregadoDemanda.parse({
    demanda: {
      id: D,
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: demanda,
      fase_alterada_em: t0,
      origem_ferramenta: "f",
      origem_sessao: "s",
      enviada: true,
      branch: `fabriquinha/${D}`,
    },
    decisoes: [],
    evidencias: [],
    tickets: [
      { demanda_id: D, ticket_id: 1, etapa: "demanda", status: "concluido", status_alterado_em: t0 },
      ...tickets,
    ],
    rodadas: [rd(1, fase), rd(2, "desenvolvimento")],
  });
const emDesenvolvimento = (impl = "concluido") => montar("desenvolvimento", [tk(2, "implementar", impl)]);
const emRevisao = () => montar("revisao", [tk(2, "implementar", "concluido"), tk(3, "revisar_rodada", "em_execucao")]);
const emEncerramento = (status = "aberto") =>
  montar("encerramento", [
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
    novo.rodadas.map((r) => r.fase),
    ["revisao", "desenvolvimento"],
  );
  assert.deepEqual(novo.tickets.slice(0, 2), ag.tickets);
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.rodada_id, t.etapa, t.status, t.status_alterado_em]),
    [[3, 1, "revisar_rodada", "aberto", t1]],
  );
});

test("CA-1: implementação não concluída, vazia ou de outra rodada não avança", () => {
  for (const status of ["aberto", "em_execucao", "falhou", "fechado", "cancelado"]) {
    const ag = emDesenvolvimento(status);
    recusa(ag, () => concluirImplementacoesRodada(ag, ref, FABRIQUINHA, ctx));
  }
  const vazia = montar("desenvolvimento", [tk(2, "implementar", "concluido", 2)]);
  recusa(vazia, () => concluirImplementacoesRodada(vazia, ref, FABRIQUINHA, ctx));
  const mista = montar("desenvolvimento", [tk(2, "implementar", "concluido"), tk(3, "implementar", "aberto")]);
  recusa(mista, () => concluirImplementacoesRodada(mista, ref, FABRIQUINHA, ctx));
});

test("guardas: ator, referência, fase da rodada e da demanda", () => {
  const ag = emDesenvolvimento();
  for (const ator of [AUDITOR, agente(2)]) {
    recusa(ag, () => concluirImplementacoesRodada(ag, ref, ator, ctx), ErroDeEscopo);
  }
  recusa(ag, () => concluirImplementacoesRodada(ag, { ...ref, extra: 1 }, FABRIQUINHA, ctx));
  recusa(ag, () => concluirImplementacoesRodada(ag, { demanda_id: "I-2", rodada_id: 1 }, FABRIQUINHA, ctx));
  recusa(ag, () => concluirImplementacoesRodada(ag, { ...ref, rodada_id: 9 }, FABRIQUINHA, ctx));
  const revisao = emRevisao();
  recusa(revisao, () => concluirImplementacoesRodada(revisao, ref, FABRIQUINHA, ctx));
  const planejando = montar("desenvolvimento", [tk(2, "implementar", "concluido")], "planejamento");
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
  const novo = registrarRevisaoRodada(ag, reprovada(), agente(3), ctx);
  assert.deepEqual(ag, antes);
  assert.deepEqual(
    novo.rodadas.map((r) => r.fase),
    ["desenvolvimento", "desenvolvimento"],
  );
  assert.deepEqual(
    novo.tickets.map((t) => [t.ticket_id, t.etapa, t.status]),
    [
      [1, "demanda", "concluido"],
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
      resultado: "recusado",
      motivo: "refazer o teste",
      por: "agente",
      em: t1,
    },
  ]);
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
  const novo = registrarRevisaoRodada(ag, { ...ref, ticket_id: 3, aprovado: true }, agente(3), ctx);
  assert.deepEqual(
    novo.rodadas.map((r) => r.fase),
    ["encerramento", "desenvolvimento"],
  );
  assert.deepEqual(
    novo.tickets.slice(2).map((t) => [t.ticket_id, t.etapa, t.status]),
    [
      [3, "revisar_rodada", "concluido"],
      [4, "encerrar_rodada", "aberto"],
    ],
  );
  assert.deepEqual(
    novo.decisoes.map((d) => [d.ticket_id, d.decisao_id, d.resultado, d.motivo, d.nota, d.por]),
    [[3, 1, "aprovado", undefined, undefined, "agente"]],
  );
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ref, ticket_id: 3, aprovado: true, nota: 5 }, agente(3), ctx));
});

test("revisão: ator, ticket, status e fase errados são recusados", () => {
  const ag = emRevisao();
  const ok = { ...ref, ticket_id: 3, aprovado: true };
  for (const ator of [AUDITOR, FABRIQUINHA, agente(2)]) {
    recusa(ag, () => registrarRevisaoRodada(ag, ok, ator, ctx), ErroDeEscopo);
  }
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ok, ticket_id: 2 }, agente(2), ctx));
  recusa(ag, () => registrarRevisaoRodada(ag, { ...ok, ticket_id: 9 }, agente(9), ctx));
  const falho = montar("revisao", [tk(2, "implementar", "concluido"), tk(3, "revisar_rodada", "falhou")]);
  recusa(falho, () => registrarRevisaoRodada(falho, ok, agente(3), ctx));
  const sem = montar("revisao", [tk(2, "implementar", "concluido")]);
  recusa(sem, () => registrarRevisaoRodada(sem, ok, agente(3), ctx));
  const dev = emDesenvolvimento();
  recusa(dev, () => registrarRevisaoRodada(dev, ok, agente(3), ctx));
  // repetição após a mudança de fase não duplica decisão nem ticket
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

test("CA-5: sem conflito nem check falho vai a aprovacao_pull_request mantendo o encerrar_rodada", () => {
  const ag = emEncerramento();
  const novo = conferirPullRequestRodada(ag, conferencia(), FABRIQUINHA, ctx);
  assert.deepEqual(
    novo.rodadas.map((r) => r.fase),
    ["aprovacao_pull_request", "desenvolvimento"],
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
      novo.rodadas.map((r) => r.fase),
      ["desenvolvimento", "desenvolvimento"],
    );
    assert.deepEqual(
      novo.tickets.slice(3).map((t) => [t.ticket_id, t.etapa, t.status]),
      [
        [4, "encerrar_rodada", "concluido"],
        [5, "implementar", "aberto"],
      ],
    );
    assert.deepEqual(novo.decisoes, []);
  }
});

test("conferência: documentação, fatos explícitos, ator, ticket e fase errados são recusados", () => {
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
    tickets: ag1.tickets.map((t) => (t.ticket_id === 4 ? { ...t, status: "concluido" } : t)),
  });
  const ag2 = concluirImplementacoesRodada(concluido, ref, FABRIQUINHA, ctx); // revisar 5
  const ag3 = registrarRevisaoRodada(ag2, { ...ref, ticket_id: 5, aprovado: true }, agente(5), ctx); // encerrar 6
  const ag4 = conferirPullRequestRodada(
    ag3,
    conferencia({ ticket_id: 6, conflito: true, correcoes: [correcao()] }),
    FABRIQUINHA,
    ctx,
  );
  assert.deepEqual(ag4.tickets.map((t) => [t.ticket_id, t.etapa, t.status]).slice(2), [
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
      [3, 1, "recusado"],
      [5, 1, "aprovado"],
    ],
  );
  // o revisor antigo não decide mais
  recusa(ag4, () => registrarRevisaoRodada(ag4, { ...ref, ticket_id: 3, aprovado: true }, agente(3), ctx));
});

const emGate = (status = "aberto") =>
  montar("aprovacao_pull_request", [
    tk(2, "implementar", "concluido"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", status),
  ]);
const emSessao = (extra: object[] = [], status = "aberto") =>
  montar("sessao", [
    tk(2, "implementar", "concluido"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "sessao_em_aberto", status),
    ...extra,
  ]);
const fase = (ag: AgregadoDemanda) => ag.rodadas.map((r) => r.fase);

test("CA-7: reprovar o PR registra recusa sem nota, conclui o gate e abre a sessão", () => {
  const ag = emGate();
  const antes = structuredClone(ag);
  const novo = reprovarPullRequestRodada(ag, { ...ref, ticket_id: 4, motivo: " ajustar " }, AUDITOR, ctx);
  assert.deepEqual(ag, antes);
  assert.deepEqual(fase(novo), ["sessao", "desenvolvimento"]);
  assert.deepEqual(
    novo.tickets.slice(3).map((t) => [t.ticket_id, t.etapa, t.status]),
    [
      [4, "encerrar_rodada", "concluido"],
      [5, "sessao_em_aberto", "aberto"],
    ],
  );
  assert.deepEqual(novo.decisoes, [
    { demanda_id: D, ticket_id: 4, decisao_id: 1, resultado: "recusado", motivo: "ajustar", por: "auditor", em: t1 },
  ]);
  // repetição após a mudança de fase não duplica decisão
  recusa(novo, () => reprovarPullRequestRodada(novo, { ...ref, ticket_id: 4, motivo: "x" }, AUDITOR, ctx));
});

test("CA-6: reprovar sem motivo, com nota, por outro ator ou fora do gate é recusado", () => {
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

test("sessão: Auditor e agente da sessão registram correções sem executar nem mudar de fase", () => {
  const ag = emSessao();
  const entrada = { ...ref, ticket_id: 5, correcoes: [correcao()] };
  for (const ator of [AUDITOR, agente(5)]) {
    const novo = registrarCorrecoesSessao(ag, entrada, ator, ctx);
    assert.deepEqual(fase(novo), ["sessao", "desenvolvimento"]);
    assert.deepEqual(
      novo.tickets.slice(5).map((t) => [t.ticket_id, t.etapa, t.status]),
      [[6, "implementar", "aberto"]],
    );
  }
  for (const ator of [FABRIQUINHA, agente(2)]) {
    recusa(ag, () => registrarCorrecoesSessao(ag, entrada, ator, ctx), ErroDeEscopo);
  }
  recusa(ag, () => registrarCorrecoesSessao(ag, { ...entrada, correcoes: [] }, AUDITOR, ctx));
  recusa(ag, () => registrarCorrecoesSessao(ag, { ...entrada, ticket_id: 4 }, AUDITOR, ctx));
  const dev = emDesenvolvimento();
  recusa(dev, () => registrarCorrecoesSessao(dev, { ...entrada, ticket_id: 2 }, AUDITOR, ctx));
});

test("CA-8: concluir a sessão sem ticket novo, com ticket antigo ou em execução é recusado", () => {
  const ok = { ...ref, ticket_id: 5 };
  const sem = emSessao();
  recusa(sem, () => concluirSessaoRodada(sem, ok, AUDITOR, ctx));
  // implementar aberto anterior à sessão é histórico e não conta
  const antigo = montar("sessao", [
    tk(2, "implementar", "aberto"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "sessao_em_aberto", "aberto"),
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
  assert.deepEqual(fase(novo), ["desenvolvimento", "desenvolvimento"]);
  assert.deepEqual(
    novo.tickets.slice(4).map((t) => [t.ticket_id, t.etapa, t.status]),
    [
      [5, "sessao_em_aberto", "concluido"],
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
  for (const ator of [FABRIQUINHA, agente(4)]) {
    recusa(ag, () => validarAprovacaoPullRequest(ag, aprovacao(), ator), ErroDeEscopo);
  }
  const enc = emEncerramento();
  recusa(enc, () => validarAprovacaoPullRequest(enc, aprovacao(), AUDITOR));
  const obsoleto = montar("aprovacao_pull_request", [
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "encerrar_rodada", "aberto"),
  ]);
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
    assert.deepEqual(fase(novo), ["concluida", "desenvolvimento"]);
    assert.equal(novo.tickets.find((t) => t.ticket_id === 4)?.status, "concluido");
    assert.deepEqual(novo.decisoes, [
      { demanda_id: D, ticket_id: 4, decisao_id: 1, resultado: "aprovado", nota, por: "auditor", em: t1 },
    ]);
    // repetição após a conclusão não duplica a decisão
    recusa(novo, () =>
      confirmarAprovacaoPullRequest(novo, aprovacao({ nota }), AUDITOR, { agora: t1, integracao: integracao() }),
    );
  }
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
  recusa(ag, confirma(aprovacao(), integracao(), FABRIQUINHA), ErroDeEscopo);
  recusa(ag, () => confirmarAprovacaoPullRequest(ag, aprovacao(), AUDITOR, ctx));
});
