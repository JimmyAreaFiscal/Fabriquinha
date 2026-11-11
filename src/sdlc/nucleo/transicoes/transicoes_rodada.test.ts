import assert from "node:assert/strict";
import { test } from "node:test";
import { clonarAgregadoDemanda as structuredClone } from "../../../../apoio-testes/clonar_agregado_demanda.ts";
import { type Ator, AUDITOR, FABRIQUINHA } from "../ator.ts";
import { AgregadoDemanda } from "../demanda/agregado_demanda.ts";
import { CICLO_DA_RODADA } from "../ciclo_de_vida/ciclos.ts";
import { ErroDeEscopo } from "../../../compartilhado/nucleo/erros.ts";
import { GATES } from "../gate.ts";
import { Endereco } from "../item_de_trabalho/item_de_trabalho.ts";
import {
  conferirPullRequestRodada,
  concluirImplementacoesRodada,
  concluirSessaoRodada,
  registrarCorrecoesSessao,
} from "./transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const ctx = { agora: t1 };
const D = "I-1";
const ref = { demanda_id: D, rodada_id: 1 };
const enderecoDaRodada = Endereco.daRodada(D, 1);
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

/** A rejeição lança o erro esperado e deixa o agregado igual ao snapshot. */
const rejeitaSemMudar = (ag: AgregadoDemanda, fn: () => unknown, erro: new (...a: never[]) => Error = Error) => {
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
    rejeitaSemMudar(ag, () => concluirImplementacoesRodada(ag, ref, FABRIQUINHA, ctx));
  }
  const vazia = montar("implementar", [tk(2, "implementar", "concluido", 2)]);
  rejeitaSemMudar(vazia, () => concluirImplementacoesRodada(vazia, ref, FABRIQUINHA, ctx));
  const mista = montar("implementar", [tk(2, "implementar", "concluido"), tk(3, "implementar", "aberto")]);
  rejeitaSemMudar(mista, () => concluirImplementacoesRodada(mista, ref, FABRIQUINHA, ctx));
});

test("guardas: ator, referência, estado da rodada e da demanda", () => {
  const ag = emDesenvolvimento();
  for (const ator of [AUDITOR, agente(2)]) {
    rejeitaSemMudar(ag, () => concluirImplementacoesRodada(ag, ref, ator, ctx), ErroDeEscopo);
  }
  rejeitaSemMudar(ag, () => concluirImplementacoesRodada(ag, { ...ref, extra: 1 }, FABRIQUINHA, ctx));
  rejeitaSemMudar(ag, () => concluirImplementacoesRodada(ag, { demanda_id: "I-2", rodada_id: 1 }, FABRIQUINHA, ctx));
  rejeitaSemMudar(ag, () => concluirImplementacoesRodada(ag, { ...ref, rodada_id: 9 }, FABRIQUINHA, ctx));
  const revisao = emRevisao();
  rejeitaSemMudar(revisao, () => concluirImplementacoesRodada(revisao, ref, FABRIQUINHA, ctx));
  const planejando = montar("implementar", [tk(2, "implementar", "concluido")], "planejar");
  rejeitaSemMudar(planejando, () => concluirImplementacoesRodada(planejando, ref, FABRIQUINHA, ctx));
});

const reprovada = (extra = {}) => ({
  resultado: "reprovado" as const,
  motivo: "refazer o teste",
  correcoes: [correcao()],
  ...extra,
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
  rejeitaSemMudar(ag, () => conferirPullRequestRodada(ag, conferencia({ correcoes: [correcao()] }), FABRIQUINHA, ctx));
});

test("CA-4: conflito, check falho ou ambos exigem correções e voltam a desenvolvimento sem decisão", () => {
  for (const fatos of [{ conflito: true }, { check_falho: true }, { conflito: true, check_falho: true }]) {
    const ag = emEncerramento();
    const antes = structuredClone(ag);
    rejeitaSemMudar(ag, () => conferirPullRequestRodada(ag, conferencia(fatos), FABRIQUINHA, ctx));
    rejeitaSemMudar(ag, () =>
      conferirPullRequestRodada(ag, conferencia({ ...fatos, correcoes: [] }), FABRIQUINHA, ctx),
    );
    const novo = conferirPullRequestRodada(ag, conferencia({ ...fatos, correcoes: [correcao()] }), FABRIQUINHA, ctx);
    assert.deepEqual(ag, antes);
    assert.deepEqual(
      novo.versoes_plano.map((v) => [v.numero, v.origem, v.autor, v.rodada_id]),
      [[1, "conferencia_do_pr", FABRIQUINHA, ref.rodada_id]],
    );
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
  rejeitaSemMudar(ag, () =>
    conferirPullRequestRodada(ag, conferencia({ documentacao_entregue: false }), FABRIQUINHA, ctx),
  );
  for (const campo of ["documentacao_entregue", "conflito", "check_falho"]) {
    rejeitaSemMudar(ag, () => conferirPullRequestRodada(ag, conferencia({ [campo]: undefined }), FABRIQUINHA, ctx));
  }
  for (const ator of [AUDITOR, agente(4)]) {
    rejeitaSemMudar(ag, () => conferirPullRequestRodada(ag, conferencia(), ator, ctx), ErroDeEscopo);
  }
  rejeitaSemMudar(ag, () => conferirPullRequestRodada(ag, conferencia({ ticket_id: 3 }), FABRIQUINHA, ctx));
  const falho = emEncerramento("falhou");
  rejeitaSemMudar(falho, () => conferirPullRequestRodada(falho, conferencia(), FABRIQUINHA, ctx));
  const rev = emRevisao();
  rejeitaSemMudar(rev, () => conferirPullRequestRodada(rev, conferencia(), FABRIQUINHA, ctx));
});

test("novo ciclo abre tickets novos e preserva o histórico", () => {
  const ag0 = emRevisao();
  const ag1 = GATES.gate_revisao_rodada.decidir(ag0, enderecoDaRodada, reprovada(), agente(3), ctx); // implementar 4
  const concluido = AgregadoDemanda.parse({
    ...ag1,
    tickets: ag1.tickets.map((t) => (t.ticket_id === 4 ? { ...t, estado: "concluido" } : t)),
  });
  const ag2 = concluirImplementacoesRodada(concluido, ref, FABRIQUINHA, ctx); // revisar 5
  const ag3 = GATES.gate_revisao_rodada.decidir(ag2, enderecoDaRodada, { resultado: "aprovado" }, agente(5), ctx); // encerrar 6
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
  rejeitaSemMudar(ag4, () =>
    GATES.gate_revisao_rodada.decidir(ag4, enderecoDaRodada, { resultado: "aprovado" }, agente(3), ctx),
  );
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

test("sessão: Auditor e agente da sessão registram correções sem executar nem mudar de estado", () => {
  const ag = emSessao();
  const entrada = { ...ref, ticket_id: 5, correcoes: [correcao()] };
  for (const ator of [AUDITOR, agente(5)]) {
    const novo = registrarCorrecoesSessao(ag, entrada, ator, ctx);
    assert.deepEqual(estado(novo), ["ajustar_resultado", "implementar"]);
    assert.deepEqual(novo.tickets.at(-1)?.criado_por, ator);
    assert.deepEqual(
      novo.versoes_plano.map((v) => [v.numero, v.origem, v.autor, v.rodada_id]),
      [[1, "ajustar_resultado", ator, ref.rodada_id]],
    );
    assert.deepEqual(
      novo.tickets.slice(5).map((t) => [t.ticket_id, t.etapa, t.estado]),
      [[6, "implementar", "aberto"]],
    );
  }
  for (const ator of [FABRIQUINHA, EXTERNO]) {
    rejeitaSemMudar(ag, () => registrarCorrecoesSessao(ag, entrada, ator, ctx), ErroDeEscopo);
    assert.throws(() => registrarCorrecoesSessao(ag, entrada, ator, ctx), {
      message: "só o Auditor ou o agente da sessão registram correções (peça ao Auditor pelo web)",
    });
  }
  rejeitaSemMudar(ag, () => registrarCorrecoesSessao(ag, { ...entrada, correcoes: [] }, AUDITOR, ctx));
  rejeitaSemMudar(ag, () => registrarCorrecoesSessao(ag, { ...entrada, ticket_id: 4 }, AUDITOR, ctx));
  const dev = emDesenvolvimento();
  rejeitaSemMudar(dev, () => registrarCorrecoesSessao(dev, { ...entrada, ticket_id: 2 }, AUDITOR, ctx));
});

test("CA-8: concluir a sessão sem ticket novo, com ticket antigo ou em execução é reprovado", () => {
  const ok = { ...ref, ticket_id: 5 };
  const sem = emSessao();
  rejeitaSemMudar(sem, () => concluirSessaoRodada(sem, ok, AUDITOR, ctx));
  // implementar aberto anterior à sessão é histórico e não conta
  const antigo = montar("ajustar_resultado", [
    tk(2, "implementar", "aberto"),
    tk(3, "revisar_rodada", "concluido"),
    tk(4, "encerrar_rodada", "concluido"),
    tk(5, "ajustar_resultado", "aberto"),
  ]);
  rejeitaSemMudar(antigo, () => concluirSessaoRodada(antigo, ok, AUDITOR, ctx));
  const rodando = emSessao([tk(6, "implementar", "aberto"), tk(7, "implementar", "em_execucao")]);
  rejeitaSemMudar(rodando, () => concluirSessaoRodada(rodando, ok, AUDITOR, ctx));
  const com = emSessao([tk(6, "implementar", "aberto")]);
  for (const ator of [FABRIQUINHA, agente(5)]) {
    rejeitaSemMudar(com, () => concluirSessaoRodada(com, ok, ator, ctx), ErroDeEscopo);
  }
  rejeitaSemMudar(com, () => concluirSessaoRodada(com, { ...ok, ticket_id: 4 }, AUDITOR, ctx));
  const fim = emSessao([tk(6, "implementar", "aberto")], "concluido");
  rejeitaSemMudar(fim, () => concluirSessaoRodada(fim, ok, AUDITOR, ctx));
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

// Cada par de→para do ciclo da rodada, feito pela função de produção que o realiza, com o instante injetado.
const FUNCAO_DE_PRODUCAO_DE_CADA_TRANSICAO: Record<string, () => AgregadoDemanda> = {
  "implementar→revisar_rodada": () => concluirImplementacoesRodada(emDesenvolvimento(), ref, FABRIQUINHA, ctx),
  "revisar_rodada→encerrar_rodada": () =>
    GATES.gate_revisao_rodada.decidir(emRevisao(), enderecoDaRodada, { resultado: "aprovado" }, agente(3), ctx),
  "revisar_rodada→implementar": () =>
    GATES.gate_revisao_rodada.decidir(emRevisao(), enderecoDaRodada, reprovada(), agente(3), ctx),
  "encerrar_rodada→gate_pr": () => conferirPullRequestRodada(emEncerramento(), conferencia(), FABRIQUINHA, ctx),
  "encerrar_rodada→implementar": () =>
    conferirPullRequestRodada(
      emEncerramento(),
      conferencia({ conflito: true, correcoes: [correcao()] }),
      FABRIQUINHA,
      ctx,
    ),
  "gate_pr→ajustar_resultado": () =>
    GATES.gate_pr.decidir(emGate(), enderecoDaRodada, { resultado: "reprovado", motivo: "ajustar" }, AUDITOR, ctx),
  "gate_pr→concluida": () =>
    GATES.gate_pr.decidir(emGate(), enderecoDaRodada, { resultado: "aprovado", nota: 4 }, AUDITOR, ctx),
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
