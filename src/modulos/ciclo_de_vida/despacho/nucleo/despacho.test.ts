import assert from "node:assert/strict";
import { test } from "node:test";
import { AUDITOR, Endereco, FABRIQUINHA } from "../../etapas/publico.ts";
import { AgregadoDemanda } from "../../processo/publico.ts";
import {
  Despacho,
  motivoDeRecusaDoItem,
  MotivoDeRecusa,
  prontosParaExecutarAgora,
  type ResultadoDoDespacho,
  situacaoDeUmaDemanda,
} from "./despacho.ts";
import { GATES } from "../../conducao/publico.ts";
import { concluirSessaoRodada, registrarCorrecoesSessao } from "../../processo/nucleo/transicoes/transicoes_rodada.ts";

const t0 = "2026-01-01T00:00:00Z";
const t1 = "2026-01-02T00:00:00Z";
const t2 = "2026-01-03T00:00:00Z";
const tk = (ticket_id: number, rodada_id: number | undefined, status = "aberto", etapa = "implementar") => ({
  demanda_id: "I-1",
  ticket_id,
  rodada_id,
  etapa,
  estado: status,
  estado_alterado_em: t0,
  criado_por: FABRIQUINHA,
});
const rd = (rodada_id: number, estado = "implementar") => ({
  demanda_id: "I-1",
  rodada_id,
  titulo: "r",
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/I-1-${String(rodada_id)}`,
});
const montar = (extra: Record<string, unknown>, estado = "em_execucao") =>
  AgregadoDemanda.parse({
    demanda: {
      id: "I-1",
      projeto: "p",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      estado,
      estado_alterado_em: t0,
      criada_por: { tipo: "externo", ferramenta: "f", sessao: "s" },
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    decisoes: [],
    evidencias: [],
    tickets: [],
    ...extra,
  });
const selecao = (extra: Record<string, unknown>, estado?: string, predecessorasSatisfeitas = true) =>
  new Despacho().selecionar(situacaoDeUmaDemanda(montar(extra, estado), predecessorasSatisfeitas));
const ids = (extra: Record<string, unknown>, estado?: string, predecessorasSatisfeitas = true) =>
  selecao(extra, estado, predecessorasSatisfeitas).prontos.map((t) => t.ticket_id);
const dep = (rodada_id: number, depende_rodada_id: number) => ({ demanda_id: "I-1", rodada_id, depende_rodada_id });
const depTicket = (ticket_id: number, depende_ticket_id: number) => ({
  demanda_id: "I-1",
  ticket_id,
  depende_ticket_id,
});
const ticketDe = (n: number, demanda = "I-1") => Endereco.doTicket(demanda, n);
const recusasDe = (...pares: [Endereco, MotivoDeRecusa][]) => new Map(pares);

test("fora de execucao nada é elegível", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, 1)] }, "planejar"), []);
});

test("CA-8: rodada com dependência não concluída não devolve ticket; concluída libera", () => {
  const base = {
    rodadas: [rd(1), rd(2)],
    tickets: [tk(2, 1, "em_execucao"), tk(3, 2)],
    dependencias_rodada: [dep(2, 1)],
  };
  assert.deepEqual(ids(base), []);
  assert.deepEqual(ids({ ...base, rodadas: [rd(1, "concluida"), rd(2)] }), [3]);
});

test("CA-9: rodadas independentes saem juntas, com o menor ticket aberto de cada; dependência de ticket respeitada", () => {
  assert.deepEqual(ids({ rodadas: [rd(1), rd(2)], tickets: [tk(5, 1), tk(4, 1), tk(7, 2), tk(6, 2)] }), [4, 6]);
  assert.deepEqual(
    ids({
      rodadas: [rd(1)],
      tickets: [tk(4, 1), tk(5, 1, "concluido"), tk(6, 1)],
      dependencias_ticket: [depTicket(4, 6), depTicket(6, 5)],
    }),
    [6],
  );
});

test("CA-10: ticket em_execucao na rodada impede outro; CA-11: falha bloqueia só a rodada", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao"), tk(3, 1)] }), []);
  assert.deepEqual(ids({ rodadas: [rd(1), rd(2)], tickets: [tk(2, 1, "falhou"), tk(3, 1), tk(4, 2)] }), [4]);
});

test("CA-12: ticket global falhou bloqueia a demanda", () => {
  assert.deepEqual(ids({ rodadas: [rd(1)], tickets: [tk(2, undefined, "falhou"), tk(3, 1)] }), []);
});

test("CA-15: só rodadas em desenvolvimento devolvem ticket, qualquer que seja a outra estado", () => {
  for (const estado of ["revisar_rodada", "encerrar_rodada", "gate_pr", "ajustar_resultado", "concluida"]) {
    assert.deepEqual(ids({ rodadas: [rd(1, estado), rd(2)], tickets: [tk(2, 1), tk(3, 2)] }), [3], estado);
  }
});

test("CA-3: em desenvolvimento só o implementar é elegível; ajustar_resultado nunca sai", () => {
  const rodadas = [rd(1)];
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "revisar_rodada")] }), []);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "encerrar_rodada"), tk(3, 1)] }), [3]);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, 1, "aberto", "ajustar_resultado")] }), []);
});

test("CA-2, CA-4: rodada em revisao devolve revisar_rodada; em encerramento, encerrar_rodada", () => {
  assert.deepEqual(ids({ rodadas: [rd(1, "revisar_rodada")], tickets: [tk(2, 1, "aberto", "revisar_rodada")] }), [2]);
  assert.deepEqual(ids({ rodadas: [rd(1, "encerrar_rodada")], tickets: [tk(2, 1, "aberto", "encerrar_rodada")] }), [2]);
  assert.deepEqual(ids({ rodadas: [rd(1, "revisar_rodada")], tickets: [tk(2, 1, "aberto", "encerrar_rodada")] }), []);
});

test("CA-1, CA-17: planejar aberto sai com predecessoras satisfeitas; pendentes não devolvem", () => {
  const extra = { tickets: [tk(5, undefined, "aberto", "planejar"), tk(4, undefined, "aberto", "planejar")] };
  assert.deepEqual(ids(extra, "planejar"), [4]);
  assert.deepEqual(ids(extra, "planejar", false), []);
});

const encerrando = (resolver: string, conflito = true, mergeHumano = false) => ({
  rodadas: [rd(1, "concluida")],
  tickets: [tk(2, undefined, "aberto", "encerrar_demanda"), tk(3, undefined, resolver, "resolver_conflito")],
  encerramento: {
    demanda_id: "I-1",
    branch: "fabriquinha/I-1",
    base: "develop",
    limpeza_pendente: [],
    ...(conflito ? { conflito_pendente: { ticket_id: 3 } } : {}),
    ...(mergeHumano ? { aguardando_merge_humano: true } : {}),
  },
});

test("CA-5, CA-6, CA-7: encerrar_demanda só sem conflito pendente; resolver_conflito aberto sai", () => {
  assert.deepEqual(ids(encerrando("concluido"), "encerrar_demanda"), [2]);
  assert.deepEqual(ids(encerrando("concluido", false), "encerrar_demanda"), [2]);
  assert.deepEqual(ids(encerrando("aberto"), "encerrar_demanda"), [3]);
  assert.deepEqual(ids(encerrando("em_execucao"), "encerrar_demanda"), []);
});

test("CA-8, CA-9: revisar_demanda só com todas as rodadas concluídas", () => {
  const tickets = [tk(2, undefined, "aberto", "revisar_demanda")];
  assert.deepEqual(ids({ rodadas: [rd(1, "concluida"), rd(2)], tickets }, "revisar_demanda"), []);
  assert.deepEqual(ids({ rodadas: [rd(1, "concluida"), rd(2, "concluida")], tickets }, "revisar_demanda"), [2]);
});

test("na mesma demanda, tickets globais saem por id", () => {
  const extra = {
    ...encerrando("aberto", false),
    tickets: [tk(5, undefined, "aberto", "resolver_conflito"), tk(2, undefined, "aberto", "encerrar_demanda")],
  };
  assert.deepEqual(ids(extra, "encerrar_demanda"), [2, 5]);
});

test("demanda não sai fora dos estados com etapa automática", () => {
  assert.deepEqual(ids({ tickets: [tk(2, undefined, "aberto", "entender_e_desenhar")] }, "entender_e_desenhar"), []);
});

const demandaNum = (id: string, extra: Record<string, unknown>, estado = "em_execucao") => {
  const ag = montar(extra, estado);
  return {
    agregado: {
      ...ag,
      demanda: { ...ag.demanda, id, branch: `fabriquinha/${id}` },
      rodadas: ag.rodadas.map((r) => ({ ...r, demanda_id: id })),
      tickets: ag.tickets.map((t) => ({ ...t, demanda_id: id })),
    },
    predecessoras_pendentes: [],
  };
};
const umImplementar = { rodadas: [rd(1)], tickets: [tk(2, 1)] };
const rodando = { rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao")] };
// `ocupadas` demandas com um ticket em execução ocupam o limite sem concorrer a vaga.
const globais = (n: number, limite: number, ocupadas: number) =>
  new Despacho(limite)
    .selecionar({
      demandas: [
        ...Array.from({ length: n }, (_, i) => demandaNum(`I-${String(i + 1)}`, umImplementar)),
        ...Array.from({ length: ocupadas }, (_, i) => demandaNum(`I-${String(i + 100)}`, rodando)),
      ],
      vivos: [],
    })
    .prontos.map((t) => t.demanda_id);

test("CA-13, CA-14: o limite global descontado o que está em andamento; sem vagas, nada", () => {
  assert.deepEqual(globais(3, 3, 1), ["I-1", "I-2"]);
  assert.deepEqual(globais(2, 2, 2), []);
  assert.deepEqual(globais(2, 1, 5), []);
});

test("CA-15: desempate por demanda (numérica), prefixo, rodada e ticket", () => {
  const i1 = demandaNum("I-1", { rodadas: [rd(1), rd(2)], tickets: [tk(9, 2), tk(7, 1)] });
  const i2 = demandaNum("I-2", { rodadas: [rd(1)], tickets: [tk(3, 1)] });
  const i10 = demandaNum("I-10", umImplementar);
  const sel = new Despacho(3).selecionar({ demandas: [i10, i2, i1, demandaNum("I-9", rodando)], vivos: [] });
  assert.deepEqual(
    sel.prontos.map((t) => [t.demanda_id, t.ticket_id]),
    [
      ["I-1", 7],
      ["I-1", 9],
    ],
  );
  const mesmoNumero = new Despacho(2).selecionar({
    demandas: [demandaNum("X-1", umImplementar), demandaNum("A-1", umImplementar)],
    vivos: [],
  });
  assert.deepEqual(
    mesmoNumero.prontos.map((t) => t.demanda_id),
    ["A-1", "X-1"],
  );
  const global = demandaNum("I-3", { tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejar");
  assert.deepEqual(
    new Despacho().selecionar({ demandas: [global, i1], vivos: [] }).prontos.map((t) => t.ticket_id),
    [7, 9, 1],
  );
});

test("CA-2 (1): duas demandas, duas rodadas e dois tickets, dados fora de ordem, saem por demanda, rodada e ticket", () => {
  const i10 = demandaNum("I-10", {
    rodadas: [rd(2), rd(1)],
    tickets: [tk(9, 2), tk(8, 2), tk(7, 1), tk(6, 1)],
  });
  const i2 = demandaNum("I-2", { rodadas: [rd(2), rd(1)], tickets: [tk(5, 2), tk(4, 2), tk(3, 1), tk(2, 1)] });
  const { prontos, recusas } = new Despacho().selecionar({ demandas: [i10, i2], vivos: [] });
  assert.deepEqual(
    prontos.map((t) => [t.demanda_id, t.rodada_id, t.ticket_id]),
    [
      ["I-2", 1, 2],
      ["I-2", 2, 4],
      ["I-10", 1, 6],
      ["I-10", 2, 8],
    ],
  );
  assert.deepEqual(recusas, new Map());
});

test("CA-15: trabalho global aberto não concorre; em execução ou falho bloqueia as rodadas", () => {
  const rodadas = [rd(1), rd(2, "revisar_rodada")];
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "aberto", "entender_e_desenhar"), tk(3, 1)] }), [3]);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "em_execucao", "entender_e_desenhar"), tk(3, 1)] }), []);
  assert.deepEqual(ids({ rodadas, tickets: [tk(2, undefined, "falhou", "entender_e_desenhar"), tk(3, 1)] }), []);
});

test("reprovação do PR → sessão sem implementação → correção nova → concluir sessão → seleciona a correção", () => {
  const ref = { demanda_id: "I-1", rodada_id: 1 };
  const ctx = { agora: "2026-01-02T00:00:00Z" };
  const prontos = (ag: AgregadoDemanda) => new Despacho().selecionar(situacaoDeUmaDemanda(ag, true)).prontos;
  const gate = montar({
    rodadas: [rd(1, "gate_pr"), rd(2)],
    tickets: [tk(2, 1, "concluido"), tk(3, 1, "aberto", "encerrar_rodada"), tk(4, 2)],
  });
  const sessao = GATES.gate_pr.regra.decidir(
    gate,
    Endereco.daRodada("I-1", 1),
    { resultado: "reprovado", motivo: "ajustar" },
    AUDITOR,
    ctx,
  );
  assert.deepEqual(
    prontos(sessao).map((t) => t.ticket_id),
    [4],
  );
  const sessaoTicket = sessao.tickets.find((t) => t.etapa === "ajustar_resultado")?.ticket_id ?? 0;
  const corrigida = registrarCorrecoesSessao(
    sessao,
    {
      ...ref,
      ticket_id: sessaoTicket,
      correcoes: [{ demanda_id: "I-1", ticket_id: 1, rodada_id: 1, titulo: "c", descricao: "d" }],
    },
    AUDITOR,
    ctx,
  );
  assert.deepEqual(
    prontos(corrigida).map((t) => t.ticket_id),
    [4],
  );
  const volta = concluirSessaoRodada(corrigida, { ...ref, ticket_id: sessaoTicket }, AUDITOR, ctx);
  assert.deepEqual(
    prontos(volta).map((t) => t.ticket_id),
    [6, 4],
  );
});

test("CA-2 (2): com o limite cheio, os prontos que passam do limite saem em recusas com limite_de_paralelismo", () => {
  const demandas = [rodando, umImplementar, umImplementar, umImplementar].map((extra, i) =>
    demandaNum(`I-${String(i + 1)}`, extra),
  );
  const { prontos, recusas } = new Despacho(2).selecionar({ demandas, vivos: [] });
  assert.deepEqual(
    prontos.map((t) => t.demanda_id),
    ["I-2"],
  );
  const cheio: MotivoDeRecusa = { tipo: "limite_de_paralelismo", em_uso: 1, limite: 2 };
  assert.deepEqual(recusas, recusasDe([ticketDe(2, "I-3"), cheio], [ticketDe(2, "I-4"), cheio]));
});

test("CA-2 (3): dependencia_pendente lista os tickets e as rodadas que faltam, na ordem", () => {
  const extra = {
    rodadas: [rd(1), rd(2), rd(3)],
    tickets: [tk(2, 1), tk(3, 1), tk(4, 2, "em_execucao"), tk(5, 3)],
    dependencias_ticket: [depTicket(3, 2)],
    dependencias_rodada: [dep(3, 2), dep(3, 1)],
  };
  const { prontos, recusas } = selecao(extra);
  assert.deepEqual(
    prontos.map((t) => t.ticket_id),
    [2],
  );
  assert.deepEqual(
    recusas,
    recusasDe(
      [ticketDe(3), { tipo: "dependencia_pendente", aguarda: [ticketDe(2)] }],
      [
        ticketDe(5),
        { tipo: "dependencia_pendente", aguarda: [Endereco.daRodada("I-1", 2), Endereco.daRodada("I-1", 1)] },
      ],
    ),
  );
});

test("CA-2 (3): dependencia_pendente do planejar lista as predecessoras da demanda", () => {
  const agregado = montar({ tickets: [tk(1, undefined, "aberto", "planejar")] }, "planejar");
  const { prontos, recusas } = new Despacho().selecionar({
    demandas: [{ agregado, predecessoras_pendentes: ["I-0", "I-5"] }],
    vivos: [],
  });
  assert.deepEqual(prontos, []);
  assert.deepEqual(
    recusas,
    recusasDe([
      ticketDe(1),
      { tipo: "dependencia_pendente", aguarda: [Endereco.daDemanda("I-0"), Endereco.daDemanda("I-5")] },
    ]),
  );
});

test("CA-2 (3): gate_aguardando para o ticket aberto da rodada que espera o gate ou a sessão de ajustes", () => {
  for (const estado of ["gate_pr", "ajustar_resultado"]) {
    const { prontos, recusas } = selecao({
      rodadas: [rd(1, estado)],
      tickets: [tk(2, 1, "aberto", "encerrar_rodada")],
    });
    assert.deepEqual(prontos, []);
    assert.deepEqual(recusas, recusasDe([ticketDe(2), { tipo: "gate_aguardando", gate: "gate_pr" }]), estado);
  }
});

test("CA-2 (3): ocupado aponta o ticket que ocupa a rodada ou a demanda", () => {
  const daRodada = selecao({ rodadas: [rd(1)], tickets: [tk(2, 1, "em_execucao"), tk(3, 1)] });
  assert.deepEqual(daRodada.recusas, recusasDe([ticketDe(3), { tipo: "ocupado", por: ticketDe(2) }]));
  const daDemanda = selecao({
    rodadas: [rd(1), rd(2)],
    tickets: [tk(2, undefined, "em_execucao", "resolver_conflito"), tk(3, 1), tk(4, 2)],
  });
  assert.deepEqual(
    daDemanda.recusas,
    recusasDe(
      [ticketDe(3), { tipo: "ocupado", por: ticketDe(2) }],
      [ticketDe(4), { tipo: "ocupado", por: ticketDe(2) }],
    ),
  );
});

test("CA-2 (3): bloqueado leva o motivo da última Tentativa, ou só as tentativas esgotadas", () => {
  const tentativa = {
    ticket: ticketDe(2),
    numero: 1,
    inicio: t0,
    fim: t1,
    resultado: { tipo: "reprovacao", motivo: "corrija os testes" },
  };
  const comMotivo = selecao({ rodadas: [rd(1)], tickets: [tk(2, 1, "falhou")], tentativas: [tentativa] });
  assert.deepEqual(
    comMotivo.recusas,
    recusasDe([ticketDe(2), { tipo: "bloqueado", motivo: "Tentativas esgotadas: corrija os testes" }]),
  );
  const semMotivo = selecao({ rodadas: [rd(1)], tickets: [tk(2, 1, "falhou")] });
  assert.deepEqual(semMotivo.recusas, recusasDe([ticketDe(2), { tipo: "bloqueado", motivo: "Tentativas esgotadas" }]));
});

test("CA-2 (3): aguarda_acao_externa no encerrar_demanda à espera do merge; o ciclo ainda o lê, o Auditor não o executa", () => {
  const resultado = selecao(encerrando("concluido", false, true), "encerrar_demanda");
  assert.deepEqual(
    resultado.prontos.map((t) => t.ticket_id),
    [2],
  );
  assert.deepEqual(resultado.recusas, recusasDe([ticketDe(2), { tipo: "aguarda_acao_externa" }]));
  assert.deepEqual(prontosParaExecutarAgora(resultado), []);
  const semMerge = selecao(encerrando("concluido", false), "encerrar_demanda");
  assert.deepEqual(
    prontosParaExecutarAgora(semMerge).map((t) => t.ticket_id),
    [2],
  );
});

test("CA-2 (3): limite_de_paralelismo leva a contagem real em uso e o limite", () => {
  const { recusas } = new Despacho(1).selecionar({
    demandas: [demandaNum("I-1", rodando), demandaNum("I-2", umImplementar)],
    vivos: [],
  });
  assert.deepEqual(recusas, recusasDe([ticketDe(2, "I-2"), { tipo: "limite_de_paralelismo", em_uso: 1, limite: 1 }]));
});

test("o motivo de recusa é validado pelo esquema, com endereços como instâncias de Endereco", () => {
  const motivos: MotivoDeRecusa[] = [
    { tipo: "limite_de_paralelismo", em_uso: 2, limite: 2 },
    { tipo: "dependencia_pendente", aguarda: [ticketDe(1), Endereco.daRodada("I-1", 1)] },
    { tipo: "gate_aguardando", gate: "gate_pr" },
    { tipo: "ocupado", por: ticketDe(1) },
    { tipo: "bloqueado", motivo: "Tentativas esgotadas" },
    { tipo: "aguarda_acao_externa" },
  ];
  for (const m of motivos) assert.deepEqual(MotivoDeRecusa.parse(m), m);
  assert.throws(() => MotivoDeRecusa.parse({ tipo: "ocupado", por: "I-1.T1" }));
  assert.throws(() => MotivoDeRecusa.parse({ tipo: "gate_aguardando", gate: "outro" }));
});

test("motivoDeRecusaDoItem acha a recusa pelo endereço público, não pela instância", () => {
  const recusas = new Map<Endereco, MotivoDeRecusa>([[ticketDe(2), { tipo: "aguarda_acao_externa" }]]);
  assert.deepEqual(motivoDeRecusaDoItem(recusas, Endereco.ler("I-1.T2")), { tipo: "aguarda_acao_externa" });
  assert.equal(motivoDeRecusaDoItem(recusas, Endereco.ler("I-1.T3")), undefined);
});

// O `planejar` reprovado é um ticket pronto como os outros, mas só sem trabalho vivo e sem Tentativa depois da recusa.
const recusaDoPlano = (decisao_id: number, resultado: string, em: string) => ({
  demanda_id: "I-1",
  ticket_id: 1,
  decisao_id,
  gate: "gate_planejamento",
  resultado,
  ...(resultado === "reprovado" && { motivo: "refaça o plano" }),
  por: AUDITOR,
  em,
});
const tentativaDoPlano = (inicio: string) => ({ ticket: ticketDe(1), numero: 1, inicio, fim: inicio });
const planejando = (decisoes: unknown[], tentativas: unknown[] = []) =>
  montar({ tickets: [tk(1, undefined, "em_execucao", "planejar")], decisoes, tentativas }, "planejar");
const retomadas = (ag: AgregadoDemanda, vivos: Endereco[] = []) =>
  new Despacho()
    .selecionar({ demandas: [{ agregado: ag, predecessoras_pendentes: [] }], vivos })
    .prontos.map((t) => t.ticket_id);

test("o planejar reprovado é retomado sem trabalho vivo e só depois de uma recusa nova", () => {
  assert.deepEqual(retomadas(planejando([])), []); // sem recusa
  const reprovado = planejando([recusaDoPlano(1, "reprovado", t0)]);
  assert.deepEqual(retomadas(reprovado, [ticketDe(1)]), []); // execução aberta: o pi vivo recebe o motivo
  assert.deepEqual(retomadas(reprovado, [ticketDe(1, "I-2")]), [1]); // trabalho vivo de outra demanda não vale
  assert.deepEqual(retomadas(reprovado), [1]); // sem pi vivo, a retomada leva o motivo
  const retomado = planejando([recusaDoPlano(1, "reprovado", t0)], [tentativaDoPlano(t1)]);
  assert.deepEqual(retomadas(retomado), []); // o agente saiu sem submeter, não retoma em laço
  const novaRecusa = planejando(
    [recusaDoPlano(1, "reprovado", t0), recusaDoPlano(2, "reprovado", t2)],
    [tentativaDoPlano(t1)],
  );
  assert.deepEqual(retomadas(novaRecusa), [1]);
  assert.deepEqual(retomadas(planejando([recusaDoPlano(1, "reprovado", t0), recusaDoPlano(2, "aprovado", t1)])), []);
});

test("o planejar reprovado pronto convive com o aberto e com a Dependência pendente", () => {
  const extra = {
    tickets: [tk(1, undefined, "em_execucao", "planejar"), tk(2, undefined, "aberto", "planejar")],
    decisoes: [recusaDoPlano(1, "reprovado", t0)],
  };
  assert.deepEqual(ids(extra, "planejar"), [1, 2]);
  const pendente = new Despacho().selecionar({
    demandas: [{ agregado: montar(extra, "planejar"), predecessoras_pendentes: ["I-0"] }],
    vivos: [],
  });
  assert.deepEqual(
    pendente.prontos.map((t) => t.ticket_id),
    [1],
  );
  assert.deepEqual(
    pendente.recusas,
    recusasDe([ticketDe(2), { tipo: "dependencia_pendente", aguarda: [Endereco.daDemanda("I-0")] }]),
  );
});

// A sonda é uma demanda com um pronto: com o limite 0 ela é recusada, e a recusa conta quantos ocupam o limite.
const emUsoVistoPeloLimite = (demandas: ReturnType<typeof demandaNum>[], vivos: Endereco[] = []) => {
  const recusas = new Despacho(0).selecionar({
    demandas: [...demandas, demandaNum("I-99", umImplementar)],
    vivos,
  }).recusas;
  const recusa = motivoDeRecusaDoItem(recusas, ticketDe(2, "I-99"));
  return recusa?.tipo === "limite_de_paralelismo" ? recusa.em_uso : undefined;
};

test("ocupação: conta em_execucao nos estados lidos e ignora gates humanos", () => {
  const demandas = [
    demandaNum("I-1", {
      rodadas: [rd(1)],
      tickets: [tk(1, 1, "em_execucao"), tk(2, 1), tk(3, 1, "em_execucao", "ajustar_resultado")],
    }),
    demandaNum("I-2", { rodadas: [rd(1, "gate_pr")], tickets: [tk(1, 1, "em_execucao", "encerrar_rodada")] }),
    demandaNum("I-3", { rodadas: [rd(1, "encerrar_rodada")], tickets: [tk(1, 1, "em_execucao", "encerrar_rodada")] }),
    demandaNum("I-4", { tickets: [tk(1, undefined, "em_execucao", "encerrar_demanda")] }, "encerrar_demanda"),
  ];
  assert.equal(emUsoVistoPeloLimite(demandas), 3); // I-1.T1, o encerrar_rodada de I-3 e o encerrar_demanda de I-4
});

test("ocupação ignora o planejar reprovado sem execução aberta, mas conta o que roda", () => {
  const planejando2 = (id: string, decisoes: unknown[]) =>
    demandaNum(id, { tickets: [tk(1, undefined, "em_execucao", "planejar")], decisoes }, "planejar");
  const reprovado = [recusaDoPlano(1, "reprovado", t0)];
  const vivos = [ticketDe(1, "I-2")];
  const contar = (decisoesDeI1: unknown[]) =>
    emUsoVistoPeloLimite([planejando2("I-1", decisoesDeI1), planejando2("I-2", reprovado)], vivos);
  assert.equal(contar([]), 2);
  assert.equal(contar(reprovado), 1); // o de I-2 tem execução aberta
  assert.equal(contar([...reprovado, recusaDoPlano(2, "aprovado", t1)]), 2);
});

test("sem limite informado, a seleção não corta ninguém; o limite 0 corta todos", () => {
  assert.equal(globais(3, Number.POSITIVE_INFINITY, 2).length, 3);
  assert.equal(globais(3, 0, 0).length, 0);
});

test("prontosParaExecutarAgora tira a retomada em execução e deixa o aberto", () => {
  const extra = {
    tickets: [tk(1, undefined, "em_execucao", "planejar"), tk(2, undefined, "aberto", "planejar")],
    decisoes: [recusaDoPlano(1, "reprovado", t0)],
  };
  const resultado: ResultadoDoDespacho = selecao(extra, "planejar");
  assert.deepEqual(
    resultado.prontos.map((t) => t.ticket_id),
    [1, 2],
  );
  assert.deepEqual(
    prontosParaExecutarAgora(resultado).map((t) => t.ticket_id),
    [2],
  );
});
