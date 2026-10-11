import assert from "node:assert/strict";
import { test } from "node:test";
import { ZodError } from "zod";
import { type Agregado, type Ator, type Contexto, type Evidencia, type Ticket, TipoEvidencia } from "./agregado.ts";
import { ErroDeEscopo, ErroDeRegra } from "./erros.ts";
import { CATALOGO, registrarEvidencia } from "./evidencia.ts";
import type { Etapa } from "./primitivos.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const ANTES = "2026-10-11T11:00:00.000Z";
const SESSAO = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";
const SHA = "a".repeat(64);

const contexto = (): Contexto => ({
  agora: AGORA,
  novoId: () => 50,
  projeto: () => undefined,
  issueExiste: () => true,
  alcancaveis: () => [],
  depsConcluidas: () => true,
  execucaoAutonomaEmAndamento: () => false,
});

const ticket = (id: number, etapa: Etapa, status: Ticket["status"] = "em_execucao"): Ticket => ({
  id,
  issue: 1,
  etapa,
  titulo: `Ticket ${String(id)}`,
  descricao: "",
  status,
  origem: "fabriquinha",
  criadoEm: ANTES,
});

/** I-1 com um ticket por etapa; T-1 (registro) roda na E-1, T-3 (desenvolvimento) na E-3 e T-6 (sessao) na E-6. */
const base = (): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: null,
    tipo: null,
    descricao: "",
    fase: "registro",
    deps: [],
    criadaEm: ANTES,
  },
  tickets: [ticket(1, "registro"), ticket(2, "desenho", "aberto"), ticket(3, "desenvolvimento"), ticket(6, "sessao")],
  execucoes: [
    { id: 1, ticket: 1, modo: "interativo", sessaoPi: SESSAO, resultado: "em_andamento", iniciadaEm: ANTES },
    { id: 3, ticket: 3, modo: "autonomo", sessaoPi: SESSAO, resultado: "em_andamento", iniciadaEm: ANTES },
    { id: 6, ticket: 6, modo: "interativo", sessaoPi: SESSAO, resultado: "em_andamento", iniciadaEm: ANTES },
  ],
  decisoes: [],
  evidencias: [],
});

const agente = (ticket: number, execucao = ticket): Ator => ({ tipo: "agente", execucao, ticket });
const fabriquinha: Ator = { tipo: "fabriquinha" };
const DADOS = { descricao: "lento" };
const ARQUIVO = { nome: "video.webm", sha256: SHA, mime: "video/webm", bytes: 10 };

const registrar = (ag: Agregado, ator: Ator, entrada: Record<string, unknown>) =>
  registrarEvidencia(ag, { dados: {}, arquivos: [], ...entrada }, ator, contexto());

const falha = (trabalho: () => unknown, classe: typeof ErroDeRegra | typeof ErroDeEscopo, mensagem: string) => {
  assert.throws(trabalho, (e) => e instanceof classe && e.message === mensagem);
};

test("o catálogo do F1 §3.9: tipos por etapa, produtor e obrigatoriedade", () => {
  const porEtapa = (etapa: Etapa) =>
    CATALOGO.filter((i) => i.etapa === etapa).map((i) => [i.tipo, i.produtor, i.obrigatoria]);
  assert.deepEqual(porEtapa("registro"), [
    ["comportamento", "agente", "sim"],
    ["criterios_aceite", "agente", "sim"],
  ]);
  assert.deepEqual(porEtapa("desenho"), [
    ["desenho_solucao", "agente", "sim"],
    ["prototipo", "agente", "funcionalidade"],
    ["relatorio_complexidade", "agente", "sim"],
    ["relatorio_impactos_arquitetura", "agente", "sim"],
  ]);
  assert.deepEqual(porEtapa("desenvolvimento"), [
    ["execucao_testes", "fabriquinha", "aprovada"],
    ["matriz_fitness", "fabriquinha", "aprovada"],
    ["relatorio_sonar", "fabriquinha", "aprovada"],
  ]);
  assert.deepEqual(porEtapa("revisao"), [
    ["arquivos_alterados", "fabriquinha", "sim"],
    ["matriz_fitness", "fabriquinha", "sim"],
    ["explicacao_fitness", "agente", "sim"],
    ["comprovacao_criterios", "agente", "sim"],
  ]);
  assert.deepEqual(porEtapa("encerramento"), [
    ["mensagem_pr", "agente", "sim"],
    ["video_explicativo", "agente", "sim"],
    ["relatorio_produtividade", "fabriquinha", "sim"],
    ["pr_aberto", "fabriquinha", "sim"],
  ]);
  assert.deepEqual(porEtapa("sessao"), []);
  assert.deepEqual(new Set(CATALOGO.map((i) => i.tipo)), new Set(TipoEvidencia.options));
});

test("C17 grava a evidência do agente com o produtor do catálogo, sem aprovada", () => {
  const ag = registrar(base(), agente(1), { ticket: 1, tipo: "comportamento", dados: DADOS, arquivos: [ARQUIVO] });
  assert.deepEqual(ag.evidencias, [
    { id: 50, ticket: 1, tipo: "comportamento", produtor: "agente", dados: DADOS, arquivos: [ARQUIVO], em: AGORA },
  ]);
  assert.deepEqual({ ...ag, evidencias: [] }, base());
});

test("C17: o mesmo tipo no mesmo ticket substitui; os outros ficam", () => {
  const antiga = (id: number, tipo: TipoEvidencia, de = 1): Evidencia => ({
    id,
    ticket: de,
    tipo,
    produtor: "agente",
    dados: {},
    arquivos: [],
    em: ANTES,
  });
  const outras = [antiga(7, "criterios_aceite"), antiga(8, "comportamento", 2)];
  const ag = { ...base(), evidencias: [antiga(6, "comportamento"), ...outras] };
  const depois = registrar(ag, agente(1), { ticket: 1, tipo: "comportamento", dados: DADOS });
  assert.deepEqual(
    depois.evidencias.map((e) => [e.id, e.ticket, e.tipo]),
    [
      [7, 1, "criterios_aceite"],
      [8, 2, "comportamento"],
      [50, 1, "comportamento"],
    ],
  );
});

test("C17 da Fabriquinha grava a aprovada calculada pelo F3", () => {
  const ag = registrar(base(), fabriquinha, { ticket: 3, tipo: "execucao_testes", aprovada: false });
  assert.deepEqual(
    ag.evidencias.map((e) => [e.produtor, e.aprovada]),
    [["fabriquinha", false]],
  );
});

test("C17 recusa quem não pode registrar", () => {
  const ag = base();
  const entrada = { ticket: 1, tipo: "comportamento" };
  falha(
    () => registrar(ag, { tipo: "auditor" }, entrada),
    ErroDeEscopo,
    "o Auditor não pode registrar evidência em T-1 (quem registra é o agente do ticket ou a própria Fabriquinha)",
  );
  falha(
    () => registrar(ag, agente(3), entrada),
    ErroDeEscopo,
    "o agente de T-3 não pode registrar evidência em T-1 (cada agente registra só no próprio ticket)",
  );
  const terminada = {
    ...ag,
    execucoes: ag.execucoes.map((e) => ({ ...e, resultado: "sucesso" as const, terminadaEm: AGORA })),
  };
  falha(
    () => registrar(terminada, agente(1), entrada),
    ErroDeEscopo,
    "a execução E-1 já terminou (peça ao Auditor uma nova execução)",
  );
  const consulta = { ...ag, execucoes: ag.execucoes.map((e) => ({ ...e, modo: "consulta" as const })) };
  assert.throws(() => registrar(consulta, agente(1), entrada), ErroDeEscopo);
  falha(
    () => registrar(ag, agente(3), { ticket: 3, tipo: "execucao_testes" }),
    ErroDeEscopo,
    "o agente não pode submeter execucao_testes (quem a produz é a Fabriquinha, ao fim da execução)",
  );
  falha(
    () => registrar(ag, fabriquinha, entrada),
    ErroDeEscopo,
    "a Fabriquinha não produz comportamento (quem a submete é o agente de T-1)",
  );
});

test("C17 exige ticket desta issue, em execução, e tipo da etapa dele", () => {
  const ag = base();
  falha(
    () => registrar(ag, fabriquinha, { ticket: 9, tipo: "comportamento" }),
    ErroDeRegra,
    "o ticket T-9 não é da I-1 (confira o número do ticket)",
  );
  falha(
    () => registrar(ag, fabriquinha, { ticket: 2, tipo: "desenho_solucao" }),
    ErroDeRegra,
    "T-2 está aberto, não em execução (só se registra evidência de ticket em execução)",
  );
  falha(
    () => registrar(ag, agente(1), { ticket: 1, tipo: "desenho_solucao" }),
    ErroDeRegra,
    "desenho_solucao não é evidência da etapa registro (a etapa registro aceita: comportamento, criterios_aceite)",
  );
  falha(
    () => registrar(ag, agente(6), { ticket: 6, tipo: "comportamento" }),
    ErroDeRegra,
    "comportamento não é evidência da etapa sessao (a etapa sessao aceita: nenhuma)",
  );
});

test("C17 valida a entrada: tipo, ticket e anexos de nome único", () => {
  const ag = base();
  assert.throws(() => registrar(ag, agente(1), { ticket: 1, tipo: "video" }), ZodError);
  assert.throws(() => registrar(ag, agente(1), { ticket: "T-1", tipo: "comportamento" }), ZodError);
  assert.throws(
    () => registrar(ag, agente(1), { ticket: 1, tipo: "comportamento", arquivos: [ARQUIVO, ARQUIVO] }),
    ZodError,
  );
});
