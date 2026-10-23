// Visão por mês e por issue no período (F6 §5.7, §5.8, §10) contra banco real. O fuso é fixado aqui, antes de
// qualquer data: o mês é o do fuso do serviço, e o teste não pode depender do fuso da máquina. A remoção do ticket
// passa pelo comando do F1 via `comIssue`; os demais fatos vão direto em SQL, nas datas que o teste pede, como nos
// testes das métricas da issue (a decisão `pr` e a evidência `pr_aberto` ainda não têm comando com data controlável).
process.env.TZ = "America/Sao_Paulo"; // UTC−3, sem horário de verão desde 2019

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { after, test } from "node:test";
import { ZodError } from "zod";
import { AUDITOR } from "../dominio/agregado.ts";
import { removerTicket } from "../dominio/tickets.ts";
import { abrir } from "../persistencia/banco.ts";
import { arquivarConcluidas, comIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { mesPorExtenso, metricasPorIssue, metricasPorMes } from "./periodo.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-periodo-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const inserir = (banco: DatabaseSync, tabela: string, linha: Record<string, SQLInputValue>) =>
  banco
    .prepare(
      `INSERT INTO ${tabela} (${Object.keys(linha).join(", ")}) VALUES (${Object.keys(linha)
        .map((c) => "$" + c)
        .join(", ")})`,
    )
    .run(linha);

/**
 * O instante UTC, como o banco grava, de uma data e hora em São Paulo (`AAAA-MM-DD HH:MM`). O deslocamento é fixo, e
 * não o do processo, para o teste provar que o código usa o fuso do serviço.
 */
const local = (quando: string) => new Date(quando.replace(" ", "T") + ":00-03:00").toISOString();

const consumo = (chamadas: number, input: number, output: number, custo: number) => ({
  chamadas,
  tokens: { input, output, cacheRead: 0, cacheWrite: 0 },
  custo,
});
const ZERO = consumo(0, 0, 0, 0);
const apoio = (execucoes: number, falhas: number, reprovacoes: number, minutos: number, iteracoes = 0) => ({
  execucoes,
  falhas,
  reprovacoes,
  iteracoes,
  duracaoMs: minutos * 60_000,
});
/** As 6 etapas zeradas, com as que o teste pede sobrepostas. */
const etapas = (preenchidas: Record<string, object>) =>
  ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"].map((etapa) => ({
    etapa,
    ...ZERO,
    ...apoio(0, 0, 0, 0),
    ...preenchidas[etapa],
  }));

/**
 * O cenário do F6 §10: a I-1 (`loja`) é registrada em janeiro, tem uma execução de 31/01 que termina em 01/02, um PR
 * aberto em janeiro, reprovado e atualizado em fevereiro, e é encerrada em fevereiro com nota 4; um ticket dela é
 * removido no desenho. A I-2 é do projeto `outro`, e a I-3 (`loja`), registrada em fevereiro, só executa em março.
 */
function cenario(): DatabaseSync {
  const banco = abrir(mkdtempSync(join(base, "raiz-")));
  for (const nome of ["loja", "outro"]) {
    registrarProjeto(banco, {
      nome,
      repo: `/repos/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    });
  }
  const issue = (id: number, projeto: string, criada: string, fase: string, titulo: string | null) => {
    inserir(banco, "issue", { id, projeto, titulo, tipo: titulo && "problema", fase, criada_em: local(criada) });
  };
  const ticket = (id: number, issue: number, etapa: string, criado: string, concluido: string | null, outros = {}) => {
    inserir(banco, "ticket", {
      id,
      issue,
      etapa,
      titulo: `T-${String(id)}`,
      status: concluido === null ? "aberto" : "concluido",
      origem: "fabriquinha",
      criado_em: local(criado),
      concluido_em: concluido && local(concluido),
      ...outros,
    });
  };
  const execucao = (id: number, ticket: number, modo: string, inicio: string, fim: string, erro: string | null) => {
    inserir(banco, "execucao", {
      id,
      ticket,
      modo,
      sessao_pi: crypto.randomUUID(),
      resultado: erro === null ? "sucesso" : "falha",
      erro,
      iniciada_em: local(inicio),
      terminada_em: local(fim),
    });
  };
  const uso = (execucao: number, modelo: string, chamadas: number, input: number, output: number, custo: number) => {
    const [provedor = "", nome = ""] = modelo.split("/");
    inserir(banco, "uso", {
      execucao,
      provedor,
      modelo: nome,
      chamadas,
      input,
      output,
      cache_read: 0,
      cache_write: 0,
      custo,
    });
  };
  const decisao = (id: number, ticket: number, gate: string, quando: string, outros: object) => {
    inserir(banco, "decisao", { id, issue: 1, ticket, gate, por: "auditor", em: local(quando), ...outros });
  };
  const prAberto = (ticket: number, quando: string) => {
    inserir(banco, "evidencia", { ticket, tipo: "pr_aberto", produtor: "fabriquinha", em: local(quando) });
  };

  issue(1, "loja", "2026-01-05 09:00", "aprovacao_desenho", "Login lento");
  ticket(1, 1, "registro", "2026-01-05 09:00", "2026-01-06 09:00");
  ticket(2, 1, "desenho", "2026-01-06 09:00", "2026-01-07 09:00");
  ticket(3, 1, "desenvolvimento", "2026-01-07 09:00", "2026-01-31 23:00", { origem: "agente", origem_ticket: 2 });
  ticket(7, 1, "desenvolvimento", "2026-01-07 09:00", null, { origem: "agente", origem_ticket: 2 });
  // §10: o Auditor remove um ticket no desenho (C13), e ele some das contagens.
  comIssue(banco, 1, "removerTicket", AUDITOR, (ag) => removerTicket(ag, { ticket: 7 }, AUDITOR));
  banco.prepare("UPDATE issue SET fase = 'concluida', concluida_em = ? WHERE id = 1").run(local("2026-02-20 15:00"));
  ticket(4, 1, "encerramento", "2026-01-31 20:00", "2026-01-31 22:00");
  ticket(6, 1, "sessao", "2026-02-01 09:00", "2026-02-02 09:00"); // o pedido de mudanças
  ticket(5, 1, "encerramento", "2026-02-10 09:00", "2026-02-10 10:00");

  execucao(1, 1, "interativo", "2026-01-05 10:00", "2026-01-05 10:30", null);
  // §10: começa em 31/01 no fuso do serviço (01/02 em UTC) e termina em fevereiro: conta inteira em janeiro.
  execucao(2, 3, "autonomo", "2026-01-31 23:30", "2026-02-01 00:10", "pi saiu com 1");
  execucao(3, 3, "consulta", "2026-02-03 10:00", "2026-02-03 10:05", null); // no consumo do mês, fora das etapas
  execucao(4, 6, "interativo", "2026-02-01 10:00", "2026-02-01 11:00", null);
  uso(1, "anthropic/claude-sonnet-5", 2, 100, 10, 0.5);
  uso(2, "llamacpp/qwen", 1, 50, 5, 0);
  uso(3, "anthropic/claude-sonnet-5", 1, 10, 1, 0.25);
  uso(4, "openai/gpt-5", 1, 20, 2, 0.125);

  decisao(1, 1, "registro", "2026-01-06 09:00", { aprovado: 1 });
  // §10: o PR aberto em janeiro é reprovado e atualizado em fevereiro; pedir mudanças não gera nota.
  prAberto(4, "2026-01-31 22:00");
  decisao(2, 4, "pr", "2026-02-01 09:00", { aprovado: 0, motivo: "ajuste o título" });
  prAberto(5, "2026-02-10 10:00");
  decisao(3, 5, "pr", "2026-02-20 15:00", { aprovado: 1, nota: 4 });

  issue(2, "outro", "2026-01-20 09:00", "registro", null);
  ticket(9, 2, "registro", "2026-01-20 09:00", null);
  execucao(5, 9, "interativo", "2026-01-20 10:00", "2026-01-20 10:10", null);
  uso(5, "anthropic/claude-sonnet-5", 1, 1, 1, 1);

  issue(3, "loja", "2026-02-25 09:00", "registro", null);
  ticket(8, 3, "registro", "2026-02-25 09:00", null);
  execucao(6, 8, "interativo", "2026-03-02 10:00", "2026-03-02 10:20", null);
  return banco;
}

const deModelo = (modelo: string, ...n: Parameters<typeof consumo>) => {
  const [provedor = "", nome = ""] = modelo.split("/");
  return { provedor, modelo: nome, ...consumo(...n) };
};

/** O mês sem nenhum fato. */
const vazio = (mes: string, projeto: string | null) => ({
  mes,
  projeto,
  consumo: ZERO,
  modelos: [],
  issues: { registradas: 0, concluidas: 0 },
  tickets: { criados: 0, concluidos: 0 },
  prs: { abertos: 0, mergeados: 0 },
  notaPR: { media: null, notas: 0 },
  etapas: etapas({}),
});

test("visão por mês: regras de entrada no mês do F6 §5.7, no fuso do serviço, com meses vazios", () => {
  const banco = cenario();
  assert.deepEqual(metricasPorMes(banco, { projeto: "loja", de: "2025-12", ate: "2026-03" }), [
    vazio("2025-12", "loja"),
    {
      mes: "2026-01",
      projeto: "loja",
      consumo: consumo(3, 150, 15, 0.5),
      modelos: [deModelo("anthropic/claude-sonnet-5", 2, 100, 10, 0.5), deModelo("llamacpp/qwen", 1, 50, 5, 0)],
      issues: { registradas: 1, concluidas: 0 },
      // T-1 a T-4; o T-7, removido no desenho, não conta. O T-3 terminou às 23h de 31/01 (02h de 01/02 em UTC).
      tickets: { criados: 4, concluidos: 4 },
      prs: { abertos: 1, mergeados: 0 },
      notaPR: { media: null, notas: 0 },
      etapas: etapas({
        registro: { ...consumo(2, 100, 10, 0.5), ...apoio(1, 0, 0, 30) },
        desenvolvimento: { ...consumo(1, 50, 5, 0), ...apoio(1, 1, 0, 40) },
      }),
    },
    {
      mes: "2026-02",
      projeto: "loja",
      consumo: consumo(2, 30, 3, 0.375),
      modelos: [deModelo("anthropic/claude-sonnet-5", 1, 10, 1, 0.25), deModelo("openai/gpt-5", 1, 20, 2, 0.125)],
      issues: { registradas: 1, concluidas: 1 },
      tickets: { criados: 3, concluidos: 2 },
      // O PR atualizado não conta de novo; a nota é a da issue encerrada no mês.
      prs: { abertos: 0, mergeados: 1 },
      notaPR: { media: 4, notas: 1 },
      etapas: etapas({
        encerramento: apoio(0, 0, 1, 0),
        sessao: { ...consumo(1, 20, 2, 0.125), ...apoio(1, 0, 0, 60) },
      }),
    },
    {
      ...vazio("2026-03", "loja"),
      etapas: etapas({ registro: apoio(1, 0, 0, 20) }),
    },
  ]);
  banco.close();
});

test("visão por mês: sem projeto soma todos; com projeto, as issues do outro ficam de fora", () => {
  const banco = cenario();
  const [todos] = metricasPorMes(banco, { de: "2026-01", ate: "2026-01" });
  const [loja] = metricasPorMes(banco, { projeto: "loja", de: "2026-01", ate: "2026-01" });
  assert.ok(todos);
  assert.equal(todos.projeto, null);
  assert.deepEqual(
    [todos.consumo, todos.issues, todos.tickets, todos.etapas[0]],
    [
      consumo(4, 151, 16, 1.5),
      { registradas: 2, concluidas: 0 },
      { criados: 5, concluidos: 4 },
      { etapa: "registro", ...consumo(3, 101, 11, 1.5), ...apoio(2, 0, 0, 40) },
    ],
  );
  assert.deepEqual(
    [loja?.issues, loja?.tickets],
    [
      { registradas: 1, concluidas: 0 },
      { criados: 4, concluidos: 4 },
    ],
  );
  assert.deepEqual(metricasPorMes(banco, { projeto: "nenhum", de: "2026-01", ate: "2026-01" }), [
    vazio("2026-01", "nenhum"),
  ]);
  banco.close();
});

test("visão por mês: a virada do ano e a média das notas do mês", () => {
  const banco = cenario();
  inserir(banco, "issue", {
    id: 4,
    projeto: "loja",
    titulo: "Outra",
    tipo: "problema",
    fase: "concluida",
    criada_em: local("2026-02-01 09:00"),
    concluida_em: local("2026-02-28 23:59"),
  });
  inserir(banco, "ticket", {
    id: 10,
    issue: 4,
    etapa: "encerramento",
    titulo: "T-10",
    status: "concluido",
    origem: "fabriquinha",
    criado_em: local("2026-02-01 09:00"),
    concluido_em: local("2026-02-01 09:00"),
  });
  // 23h59 de 28/02 no fuso do serviço já é março em UTC.
  inserir(banco, "decisao", {
    issue: 4,
    ticket: 10,
    gate: "pr",
    aprovado: 1,
    nota: 1,
    por: "auditor",
    em: local("2026-02-28 23:59"),
  });
  const meses = metricasPorMes(banco, { de: "2025-11", ate: "2026-02" });
  assert.deepEqual(
    meses.map((m) => m.mes),
    ["2025-11", "2025-12", "2026-01", "2026-02"],
  );
  assert.deepEqual(meses.at(-1)?.notaPR, { media: 2.5, notas: 2 });
  assert.deepEqual(meses.at(-1)?.prs, { abertos: 0, mergeados: 2 });
  banco.close();
});

test("visão por issue: só issues com execução iniciada no período; fase e nota são as atuais", () => {
  const banco = cenario();
  const i1 = { issue: 1, projeto: "loja", titulo: "Login lento", fase: "concluida", notaPR: 4 };
  assert.deepEqual(metricasPorIssue(banco, { de: "2026-01", ate: "2026-02" }), [
    // Inclui a consulta; a reprovação do PR é de fevereiro.
    { ...i1, consumo: consumo(5, 180, 18, 0.875), ...apoio(4, 1, 1, 30 + 40 + 5 + 60) },
    {
      issue: 2,
      projeto: "outro",
      titulo: null,
      fase: "registro",
      consumo: consumo(1, 1, 1, 1),
      ...apoio(1, 0, 0, 10),
      notaPR: null,
    },
  ]);
  // Só janeiro: a nota de fevereiro aparece (estado atual), mas a reprovação de fevereiro não conta.
  assert.deepEqual(metricasPorIssue(banco, { projeto: "loja", de: "2026-01", ate: "2026-01" }), [
    { ...i1, consumo: consumo(3, 150, 15, 0.5), ...apoio(2, 1, 0, 30 + 40) },
  ]);
  // A I-3 só executa em março.
  assert.deepEqual(
    metricasPorIssue(banco, { projeto: "loja", de: "2026-03", ate: "2026-03" }).map((l) => l.issue),
    [3],
  );
  banco.close();
});

/** Grava iterações do ticket nas datas dadas (F6 §5.6). */
const iteracoes = (banco: DatabaseSync, ticket: number, tipo: string, ...quando: string[]) => {
  for (const em of quando) inserir(banco, "iteracao", { ticket, tipo, em: local(em) });
};

test("iterações: etapa do ticket, mês do `em` no fuso do serviço, e 0 nas etapas sem iteração (CA-6)", () => {
  const banco = cenario();
  // 3 em janeiro (a última às 23h de 31/01, já fevereiro em UTC) e 1 em fevereiro, no registro (T-1).
  iteracoes(banco, 1, "mensagem", "2026-01-10 10:00", "2026-01-20 10:00", "2026-01-31 23:00");
  iteracoes(banco, 1, "mensagem", "2026-02-01 00:30");
  iteracoes(banco, 3, "reabertura", "2026-02-05 10:00"); // desenvolvimento
  const [jan, fev] = metricasPorMes(banco, { projeto: "loja", de: "2026-01", ate: "2026-02" });
  const por = (m: typeof jan) => Object.fromEntries((m?.etapas ?? []).map((e) => [e.etapa, e.iteracoes]));
  assert.deepEqual(por(jan), { registro: 3, desenho: 0, desenvolvimento: 0, revisao: 0, encerramento: 0, sessao: 0 });
  assert.deepEqual(por(fev), { registro: 1, desenho: 0, desenvolvimento: 1, revisao: 0, encerramento: 0, sessao: 0 });
  banco.close();
});

test("iterações: o filtro de projeto separa `loja` de todos (CA-7)", () => {
  const banco = cenario();
  iteracoes(banco, 1, "mensagem", "2026-01-10 10:00", "2026-01-11 10:00"); // loja
  iteracoes(banco, 9, "dialogo", "2026-01-12 10:00", "2026-01-13 10:00", "2026-01-14 10:00", "2026-01-15 10:00");
  iteracoes(banco, 9, "mensagem", "2026-01-16 10:00"); // outro
  const soma = (projeto?: string) =>
    metricasPorMes(banco, { projeto, de: "2026-01", ate: "2026-01" })[0]?.etapas.reduce((t, e) => t + e.iteracoes, 0);
  assert.equal(soma("loja"), 2);
  assert.equal(soma(), 7);
  banco.close();
});

test("iterações por issue: somam as etapas dentro do período e as de fora não contam (CA-8)", () => {
  const banco = cenario();
  iteracoes(banco, 1, "mensagem", "2026-01-10 10:00", "2026-01-11 10:00");
  iteracoes(banco, 3, "reabertura", "2026-01-31 23:30");
  iteracoes(banco, 3, "reabertura", "2026-02-10 10:00"); // fora de janeiro
  const [i1, i2] = metricasPorIssue(banco, { de: "2026-01", ate: "2026-01" });
  assert.deepEqual([i1?.issue, i1?.iteracoes, i2?.issue, i2?.iteracoes], [1, 3, 2, 0]);
  assert.equal(metricasPorIssue(banco, { projeto: "loja", de: "2026-01", ate: "2026-02" })[0]?.iteracoes, 4);
  banco.close();
});

test("issues arquivadas contam normalmente nas duas visões: arquivar só tira do board", () => {
  const banco = cenario();
  const periodo = { projeto: "loja", de: "2026-01", ate: "2026-03" };
  const antes = [metricasPorMes(banco, periodo), metricasPorIssue(banco, periodo)];
  assert.equal(arquivarConcluidas(banco, "loja", AUDITOR), 1); // a I-1
  assert.notEqual(banco.prepare("SELECT arquivada_em FROM issue WHERE id = 1").get()?.arquivada_em, null);
  assert.deepEqual([metricasPorMes(banco, periodo), metricasPorIssue(banco, periodo)], antes);
  banco.close();
});

test("período inválido: mês fora do formato ou `de` depois de `ate`", () => {
  const banco = cenario();
  for (const periodo of [
    { de: "2026-13", ate: "2026-13" },
    { de: "0050-01", ate: "0050-01" }, // o `Date` do JS leria 1950
    { de: "2026-02", ate: "2026-01" },
    { projeto: "Loja", de: "2026-01", ate: "2026-01" },
  ]) {
    assert.throws(() => metricasPorMes(banco, periodo), ZodError);
    assert.throws(() => metricasPorIssue(banco, periodo), ZodError);
  }
  banco.close();
});

test("mesPorExtenso: o mês em português com o ano", () => {
  assert.equal(mesPorExtenso("2026-09"), "setembro de 2026");
  assert.equal(mesPorExtenso("2026-03"), "março de 2026");
});
