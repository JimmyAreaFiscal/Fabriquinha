import assert from "node:assert/strict";
import { test } from "node:test";
import type { Agregado, Evidencia, Ticket } from "../dominio/agregado.ts";
import { montarPrompt } from "./prompt.ts";

const AGORA = "2026-10-11T12:00:00.000Z";

const evidencia = (id: number, tipo: Evidencia["tipo"], dados: Evidencia["dados"]): Evidencia => ({
  id,
  ticket: 1,
  tipo,
  produtor: "agente",
  dados,
  arquivos: [],
  em: AGORA,
});

const desenho: Ticket = {
  id: 2,
  issue: 1,
  etapa: "desenho",
  titulo: "Desenhar a solução",
  descricao: "Reprovado antes: faltou cache.",
  status: "aberto",
  origem: "fabriquinha",
  criadoEm: AGORA,
};

const agregado = (evidencias: Evidencia[]): Agregado => ({
  issue: {
    id: 1,
    projeto: "loja",
    titulo: "Busca lenta",
    tipo: "problema",
    descricao: "A busca demora 8 s.",
    fase: "desenho",
    deps: [],
    criadaEm: AGORA,
  },
  tickets: [desenho],
  execucoes: [],
  decisoes: [],
  evidencias,
});

const comum = {
  projeto: { nome: "loja", branchBase: "main" },
  worktree: "/r/worktrees/loja/I-1",
  saida: "/r/execucoes/E-2/saida",
};

test("desenho autônomo: instrução primeiro, contexto, registro, modo de trabalhar, CLI, skills e o aviso", () => {
  const ag = agregado([
    evidencia(1, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }),
    evidencia(2, "criterios_aceite", {
      criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }],
    }),
  ]);
  const prompt = montarPrompt({ ...comum, ag, ticket: desenho, instrucao: "  Use o índice.  ", modo: "autonomo" });

  assert.ok(prompt.startsWith("# Instrução do Auditor\n\nUse o índice.\n\n# Contexto\n"));
  const ordem = [
    "- Projeto: loja (branch base main)",
    "- Issue: I-1, Busca lenta (problema)",
    "- Seu ticket: T-2, Desenhar a solução (etapa desenho)",
    "- Worktree (diretório de trabalho): /r/worktrees/loja/I-1",
    "- Diretório de saída (`$FABRIQUINHA_SAIDA`): /r/execucoes/E-2/saida",
    "## Descrição da issue\n\nA busca demora 8 s.",
    "## Descrição do ticket\n\nReprovado antes: faltou cache.",
    "## Comportamento registrado\n\na busca varre tudo",
    "## Critérios de aceite\n\n- **CA-1**: dado mil itens, quando busco, então responde em 1 s.",
    "## Modo de trabalhar: desenho",
    "**O que não fazer:** não implemente a solução, não crie PR, não faça commit nem push",
    "## CLI da Fabriquinha",
    "## Submissão de evidências",
    "`fabriquinha evidencia add <tipo>",
    "$FABRIQUINHA_SAIDA",
    "## Skills de artefato",
    "- `artefato-desenho-solucao`\n- `artefato-prototipo`\n- `artefato-complexidade`\n- `artefato-impactos-arquitetura`",
    "## Execução autônoma\n\nNinguém acompanha esta execução para responder perguntas.",
  ];
  let desde = 0;
  for (const trecho of ordem) {
    const em = prompt.indexOf(trecho, desde);
    assert.ok(em >= 0, `falta, ou está fora de ordem: ${trecho}`);
    desde = em + trecho.length;
  }
  assert.doesNotMatch(prompt, /continuar trabalhando/i);
});

test("sem instrução nem registro: o desenho mostra as seções vazias, sem inventar critério", () => {
  const prompt = montarPrompt({ ...comum, ag: agregado([]), ticket: desenho, instrucao: undefined, modo: "autonomo" });
  assert.ok(prompt.startsWith("# Contexto\n"));
  assert.match(prompt, /## Comportamento registrado\n\n\(vazio\)\n/);
  assert.match(prompt, /## Critérios de aceite\n\n\(vazio\)\n/);
});

test("etapa sem contexto próprio nem skill, interativa e com a issue ainda sem título e tipo", () => {
  const ag = agregado([]);
  const sessao: Ticket = { ...desenho, etapa: "sessao", descricao: "" };
  const prompt = montarPrompt({
    ...comum,
    ag: { ...ag, issue: { ...ag.issue, titulo: null, tipo: null } },
    ticket: sessao,
    instrucao: undefined,
    modo: "interativo",
  });
  assert.match(prompt, /- Issue: I-1, sem título \(tipo ainda não definido\)/);
  assert.match(prompt, /## Descrição do ticket\n\n\(vazio\)\n/);
  assert.match(prompt, /## Modo de trabalhar: sessão em aberto/);
  assert.doesNotMatch(prompt, /Comportamento registrado|Skills de artefato|Execução autônoma/);
});

test("há um texto de modo de trabalhar para cada etapa", () => {
  for (const etapa of ["registro", "desenho", "desenvolvimento", "revisao", "encerramento", "sessao"] as const) {
    const prompt = montarPrompt({
      ...comum,
      ag: agregado([]),
      ticket: { ...desenho, etapa },
      instrucao: undefined,
      modo: "interativo",
    });
    assert.match(prompt, /## Modo de trabalhar: .*\n[\s\S]*\*\*Objetivo:\*\*[\s\S]*\*\*Quando parar:\*\*/);
    assert.match(prompt, /não crie (nem altere )?PR, não faça commit nem push/);
  }
});

test("registro: as dependências informadas pelo Auditor", () => {
  const ag = agregado([]);
  const registro: Ticket = { ...desenho, etapa: "registro" };
  const prompt = (deps: number[]) =>
    montarPrompt({
      ...comum,
      ag: { ...ag, issue: { ...ag.issue, deps } },
      ticket: registro,
      instrucao: undefined,
      modo: "interativo",
    });
  assert.match(prompt([3, 5]), /## Dependências informadas\n\n- I-3\n- I-5\n/);
  assert.match(prompt([]), /## Dependências informadas\n\n\(vazio\)\n/);
});
