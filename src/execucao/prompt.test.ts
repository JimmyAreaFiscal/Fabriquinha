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

test("desenho interativo: instrução primeiro, contexto, registro, modo de trabalhar, CLI e skills, sem o aviso", () => {
  const ag = agregado([
    evidencia(1, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }),
    evidencia(2, "criterios_aceite", {
      criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }],
    }),
  ]);
  const prompt = montarPrompt({ ...comum, ag, ticket: desenho, instrucao: "  Use o índice.  ", modo: "interativo" });

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
    "**O que não fazer:** não envie sem a confirmação do Auditor na conversa",
    "## CLI da Fabriquinha",
    "`fabriquinha ticket enviar T-<n>`",
    "## Submissão de evidências",
    "`fabriquinha evidencia add <tipo>",
    "$FABRIQUINHA_SAIDA",
    "## Skills de artefato",
    "- `artefato-desenho-solucao`\n- `artefato-prototipo`\n- `artefato-complexidade`\n- `artefato-impactos-arquitetura`",
  ];
  let desde = 0;
  for (const trecho of ordem) {
    const em = prompt.indexOf(trecho, desde);
    assert.ok(em >= 0, `falta, ou está fora de ordem: ${trecho}`);
    desde = em + trecho.length;
  }
  assert.doesNotMatch(prompt, /continuar trabalhando|Execução autônoma/i);
});

test("sem instrução nem registro: o desenho mostra as seções vazias, sem inventar critério", () => {
  const prompt = montarPrompt({
    ...comum,
    ag: agregado([]),
    ticket: desenho,
    instrucao: undefined,
    modo: "interativo",
  });
  assert.ok(prompt.startsWith("# Contexto\n"));
  assert.match(prompt, /## Comportamento registrado\n\n\(vazio\)\n/);
  assert.match(prompt, /## Critérios de aceite\n\n\(vazio\)\n/);
});

test("etapa sem skill, interativa e com a issue ainda sem título e tipo; sessão sem PR mostra a seção vazia", () => {
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
  assert.match(prompt, /## PR\n\n\(vazio\)\n/);
  assert.match(prompt, /## Modo de trabalhar: sessão em aberto/);
  assert.doesNotMatch(prompt, /Comportamento registrado|Skills de artefato|Execução autônoma/);
});

test("sessão em aberto: o motivo do pedido de mudanças na descrição do ticket e a URL do PR (F4 §6.3)", () => {
  const ag = agregado([evidencia(1, "pr_aberto", { url: "https://github.com/dono/loja/pull/7" })]);
  const sessao: Ticket = { ...desenho, etapa: "sessao", descricao: "Falta o índice." };
  const prompt = montarPrompt({ ...comum, ag, ticket: sessao, instrucao: undefined, modo: "interativo" });
  assert.match(
    prompt,
    /## Descrição do ticket\n\nFalta o índice\.\n\n## PR\n\nhttps:\/\/github\.com\/dono\/loja\/pull\/7\n/,
  );
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

test("desenvolvimento: o desenho aprovado (o mais recente), arquivos previstos, fora do escopo, critérios e os concluídos", () => {
  const desenhoSolucao = (id: number, resumo: string) =>
    evidencia(id, "desenho_solucao", {
      resumo,
      arquivosPrevistos: [
        { caminho: "src/busca.ts", acao: "alterar", motivo: "lê do cache" },
        { caminho: "src/cache/*.ts", acao: "criar", motivo: "o cache" },
      ],
      foraDeEscopo: ["paginação"],
    });
  const ag = agregado([
    evidencia(1, "criterios_aceite", {
      criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }],
    }),
    desenhoSolucao(2, "varre tudo"),
    desenhoSolucao(3, "cache na busca"),
  ]);
  const dev = (id: number, titulo: string, status: Ticket["status"]): Ticket => ({
    ...desenho,
    id,
    etapa: "desenvolvimento",
    titulo,
    status,
  });
  const ticket = dev(5, "Invalidar o cache", "em_execucao");
  const prompt = montarPrompt({
    ...comum,
    ag: { ...ag, tickets: [desenho, dev(4, "Criar o cache", "concluido"), ticket, dev(6, "Métrica", "aberto")] },
    ticket,
    instrucao: undefined,
    modo: "autonomo",
  });
  assert.ok(
    prompt.includes(
      [
        "## Desenho aprovado\n\ncache na busca\n",
        "## Arquivos previstos\n\n- `src/busca.ts` (alterar): lê do cache\n- `src/cache/*.ts` (criar): o cache\n",
        "## Fora do escopo\n\n- paginação\n",
        "## Critérios de aceite\n\n- **CA-1**: dado mil itens, quando busco, então responde em 1 s.\n",
        "## Tickets de desenvolvimento já concluídos\n\n- T-4, Criar o cache\n",
        "## Modo de trabalhar: desenvolvimento",
      ].join("\n"),
    ),
    prompt,
  );

  const vazio = montarPrompt({ ...comum, ag: agregado([]), ticket, instrucao: undefined, modo: "autonomo" });
  for (const titulo of [
    "Desenho aprovado",
    "Arquivos previstos",
    "Fora do escopo",
    "Tickets de desenvolvimento já concluídos",
  ]) {
    assert.match(vazio, new RegExp(`## ${titulo}\\n\\n\\(vazio\\)\\n`));
  }
});

test("revisão: o contexto do desenvolvimento, os arquivos alterados × desenho e a matriz de fitness coletados", () => {
  const rodado = { comando: "c", duracaoMs: 1, log: "x.log" };
  const ag = agregado([
    evidencia(1, "arquivos_alterados", {
      base: "a".repeat(40),
      head: "b".repeat(40),
      arquivos: [
        { caminho: "busca.ts", status: "M", adicionadas: 1, removidas: 1, previsto: "busca.ts" },
        { caminho: "logo.png", status: "A", adicionadas: null, removidas: null, previsto: null },
      ],
      previstosNaoTocados: ["docs/**"],
    }),
    evidencia(2, "matriz_fitness", {
      linhas: [
        { nome: "complexidade", descricao: "ciclomática", codigoSaida: 0, estourou: false, ...rodado },
        { nome: "camadas", descricao: "domínio sem I/O", codigoSaida: 1, estourou: false, ...rodado },
        { nome: "mutacao", descricao: "Stryker", codigoSaida: null, estourou: true, ...rodado },
      ],
    }),
  ]);
  const revisao: Ticket = { ...desenho, id: 5, etapa: "revisao", titulo: "Revisar o desenvolvimento" };
  const prompt = montarPrompt({ ...comum, ag, ticket: revisao, instrucao: undefined, modo: "autonomo" });
  assert.ok(
    prompt.includes(
      [
        "## Tickets de desenvolvimento já concluídos\n\n(vazio)\n",
        "## Arquivos alterados × desenho\n\n- `busca.ts` (M, +1 −1): previsto por `busca.ts`\n" +
          "- `logo.png` (A, binário): não previsto\n",
        "## Previstos e não tocados\n\n- `docs/**`\n",
        "## Fitness functions\n\n- **complexidade** (ciclomática): passou\n" +
          "- **camadas** (domínio sem I/O): reprovou (código 1)\n- **mutacao** (Stryker): estourou o tempo\n",
        "## Modo de trabalhar: revisão",
      ].join("\n"),
    ),
    prompt,
  );
  assert.match(prompt, /## Execução autônoma\n\nNinguém acompanha esta execução para responder perguntas\./);
  const vazio = montarPrompt({ ...comum, ag: agregado([]), ticket: revisao, instrucao: undefined, modo: "autonomo" });
  for (const titulo of ["Arquivos alterados × desenho", "Previstos e não tocados", "Fitness functions"]) {
    assert.match(vazio, new RegExp(`## ${titulo}\\n\\n\\(vazio\\)\\n`));
  }
});

test("encerramento: o contexto do desenvolvimento, o impacto, as revisões, os não previstos e a última reprovação do PR", () => {
  const ag = agregado([
    evidencia(1, "relatorio_impactos_arquitetura", { impacto: "medio" }),
    evidencia(2, "arquivos_alterados", {
      arquivos: [
        { caminho: "busca.ts", previsto: "busca.ts" },
        { caminho: "logo.png", previsto: null },
      ],
    }),
    evidencia(3, "pr_aberto", { url: "https://github.com/org/loja/pull/4" }),
  ]);
  const decisao = (id: number, gate: "revisao" | "pr", aprovado: boolean, motivo?: string) => ({
    id,
    issue: 1,
    ticket: id,
    gate,
    aprovado,
    ...(motivo !== undefined && { motivo }),
    por: "auditor" as const,
    em: AGORA,
  });
  const encerramento: Ticket = { ...desenho, id: 9, etapa: "encerramento", titulo: "Publicar o PR" };
  const prompt = (decisoes: Agregado["decisoes"]) =>
    montarPrompt({ ...comum, ag: { ...ag, decisoes }, ticket: encerramento, instrucao: undefined, modo: "autonomo" });

  const primeira = prompt([decisao(5, "revisao", false, "falta o cache"), decisao(7, "revisao", true)]);
  assert.ok(
    primeira.includes(
      [
        "## Tickets de desenvolvimento já concluídos\n\n(vazio)\n",
        "## Impacto na arquitetura\n\nmedio\n",
        "## Revisões\n\n- T-5, reprovada: falta o cache\n- T-7, aprovada: sem motivo\n",
        "## Arquivos não previstos\n\n- `logo.png`\n",
        "## Modo de trabalhar: encerramento",
      ].join("\n"),
    ),
    primeira,
  );
  const novaVolta = prompt([decisao(7, "revisao", true), decisao(8, "pr", false, "renomeie a função")]);
  assert.match(
    novaVolta,
    /## Última reprovação do PR\n\nrenomeie a função\n\nPR: https:\/\/github\.com\/org\/loja\/pull\/4\n/,
  );
  const vazio = montarPrompt({
    ...comum,
    ag: agregado([]),
    ticket: encerramento,
    instrucao: undefined,
    modo: "autonomo",
  });
  for (const titulo of ["Impacto na arquitetura", "Revisões", "Arquivos não previstos"]) {
    assert.match(vazio, new RegExp(`## ${titulo}\\n\\n\\(vazio\\)\\n`));
  }
  assert.doesNotMatch(vazio, /Última reprovação do PR/);
});
