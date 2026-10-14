// Métricas da issue (F6 §5, §6.2, §10) contra banco real. As correções passam pelos comandos do F1 via `comIssue`,
// que gravam `comando`; os demais fatos (execuções, uso, commits, retrabalho) vão direto em SQL, já no estado que o
// teste pede, como nos testes do uso e do retrabalho.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { after, test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { iniciarExecucao } from "../dominio/execucao.ts";
import { decidirDesenho, decidirRegistro } from "../dominio/gates.ts";
import { adicionarDependencia, editarIssue } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento, removerTicket } from "../dominio/tickets.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { MetricasIssue, metricasDaIssue } from "./issue.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-metricas-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

/** Banco novo com os projetos `loja` e `outro`. */
function novoBanco(): { banco: DatabaseSync; raiz: string } {
  const raiz = mkdtempSync(join(base, "raiz-"));
  const banco = abrir(raiz);
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
  return { banco, raiz };
}

const inserir = (banco: DatabaseSync, tabela: string, linha: Record<string, SQLInputValue>) =>
  banco
    .prepare(
      `INSERT INTO ${tabela} (${Object.keys(linha).join(", ")}) VALUES (${Object.keys(linha)
        .map((c) => "$" + c)
        .join(", ")})`,
    )
    .run(linha);

const em = (dia: number, hora: string) => `2026-10-${String(dia).padStart(2, "0")}T${hora}.000Z`;

function issue(banco: DatabaseSync, id: number, campos: Record<string, SQLInputValue> = {}): void {
  inserir(banco, "issue", {
    id,
    projeto: "loja",
    titulo: `Issue ${String(id)}`,
    tipo: "problema",
    fase: "concluida",
    criada_em: em(1, "09:00:00"),
    concluida_em: em(2, "18:00:00"),
    ...campos,
  });
}

function ticket(banco: DatabaseSync, id: number, issue: number, etapa: string, campos = {}): void {
  inserir(banco, "ticket", {
    id,
    issue,
    etapa,
    titulo: `T-${String(id)}`,
    status: "concluido",
    origem: "fabriquinha",
    criado_em: em(1, "09:00:00"),
    concluido_em: em(1, "09:00:00"),
    ...campos,
  });
}

/** Execução terminada (ou em andamento, sem `fim`) na sessão `sessao`. */
function execucao(
  banco: DatabaseSync,
  id: number,
  ticket: number,
  modo: string,
  sessao: string,
  inicio: string,
  fim: string | null,
  erro: string | null = null,
): void {
  inserir(banco, "execucao", {
    id,
    ticket,
    modo,
    sessao_pi: sessao,
    resultado: fim === null ? "em_andamento" : erro === null ? "sucesso" : "falha",
    erro,
    iniciada_em: inicio,
    terminada_em: fim,
  });
}

/** O arquivo da sessão como o pi o grava; o conteúdo não importa aqui, só a existência. */
function sessao(raiz: string, id: string): void {
  mkdirSync(join(raiz, "sessoes"), { recursive: true });
  writeFileSync(join(raiz, "sessoes", `2026-10-01T10-00-00-000Z_${id}.jsonl`), "");
}

function uso(banco: DatabaseSync, execucao: number, modelo: string, n: number[], custo: number): void {
  const [provedor = "", nome = ""] = modelo.split("/");
  const [chamadas, input, output, cacheRead, cacheWrite] = n;
  inserir(banco, "uso", {
    execucao,
    provedor,
    modelo: nome,
    chamadas: Number(chamadas),
    input: Number(input),
    output: Number(output),
    cache_read: Number(cacheRead),
    cache_write: Number(cacheWrite),
    custo,
  });
}

/** As evidências do desenho que o F6 lê (§5.5): dois arquivos previstos, uma dependência nova e nenhum acoplamento. */
function evidenciasDoDesenho(banco: DatabaseSync, ticket: number): void {
  const evidencia = (tipo: string, dados: object) => {
    inserir(banco, "evidencia", {
      ticket,
      tipo,
      produtor: "agente",
      dados: JSON.stringify(dados),
      em: em(1, "12:00:00"),
    });
  };
  const previsto = (caminho: string) => ({ caminho, acao: "alterar", motivo: "m" });
  evidencia("desenho_solucao", { resumo: "r", arquivosPrevistos: [previsto("src/a.ts"), previsto("src/b.ts")] });
  evidencia("relatorio_impactos_arquitetura", {
    impacto: "baixo",
    novasDependencias: [{ nome: "zod", motivo: "m" }],
    novosAcoplamentos: [],
    riscos: [],
  });
}

const consumo = (
  chamadas: number,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
  custo: number,
) => ({
  chamadas,
  tokens: { input, output, cacheRead, cacheWrite },
  custo,
});
const deModelo = (modelo: string, ...n: Parameters<typeof consumo>) => {
  const [provedor = "", nome = ""] = modelo.split("/");
  return { provedor, modelo: nome, ...consumo(...n) };
};
const ZERO = consumo(0, 0, 0, 0, 0, 0);

const sha = (c: string) => c.repeat(40);

test("issue concluída: M1 e apoio por etapa, consultas à parte, M4 a M7, desenho, decisões e execuções sem sessão", () => {
  const { banco, raiz } = novoBanco();
  issue(banco, 1);
  ticket(banco, 1, 1, "registro");
  ticket(banco, 2, 1, "desenho");
  ticket(banco, 3, 1, "desenvolvimento", { origem: "agente", origem_ticket: 2 });
  ticket(banco, 4, 1, "revisao");
  ticket(banco, 5, 1, "desenvolvimento", { origem: "agente", origem_ticket: 4 }); // exigência da revisão (M5)
  ticket(banco, 6, 1, "encerramento");
  ticket(banco, 7, 1, "desenvolvimento", { origem: "auditor" }); // criado pelo Auditor no gate de desenho
  ticket(banco, 8, 1, "sessao"); // do pedido de mudanças (C16 reprovado), sem execução

  const s = Array.from({ length: 9 }, () => crypto.randomUUID());
  for (const id of [s[0], s[1], s[2], s[4], s[5], s[6], s[8]]) sessao(raiz, String(id));
  // A sessão do registro é compartilhada pelas duas execuções interativas (F4 §5.1); a E-5 não tem arquivo.
  execucao(banco, 1, 1, "interativo", String(s[0]), em(1, "10:00:00"), em(1, "10:30:00"));
  execucao(banco, 2, 1, "interativo", String(s[0]), em(1, "11:00:00"), em(1, "11:10:00"));
  execucao(banco, 3, 2, "autonomo", String(s[1]), em(1, "12:00:00"), em(1, "12:05:00"), "pi saiu com 1");
  execucao(banco, 4, 2, "autonomo", String(s[2]), em(1, "13:00:00"), em(1, "14:02:30"));
  execucao(banco, 5, 3, "autonomo", String(s[3]), em(1, "15:00:00"), em(1, "15:20:00"));
  execucao(banco, 6, 3, "consulta", String(s[4]), em(1, "15:30:00"), em(1, "15:35:00"));
  execucao(banco, 7, 4, "autonomo", String(s[5]), em(2, "10:00:00"), em(2, "10:10:00"));
  execucao(banco, 8, 6, "autonomo", String(s[6]), em(2, "11:00:00"), em(2, "11:05:00")); // sessão sem chamada
  // O relógio voltou: termina antes de começar, e a duração fica 0.
  execucao(banco, 9, 8, "interativo", String(s[8]), em(2, "12:00:00"), em(2, "11:59:00"));

  uso(banco, 1, "anthropic/claude-sonnet-5", [3, 100, 10, 1000, 50], 0.5);
  uso(banco, 2, "anthropic/claude-sonnet-5", [1, 20, 2, 0, 0], 0.25);
  uso(banco, 2, "openai/gpt-5", [2, 200, 20, 0, 0], 0.125);
  uso(banco, 3, "llamacpp/qwen", [4, 400, 40, 0, 0], 0);
  uso(banco, 4, "llamacpp/qwen", [1, 100, 10, 0, 0], 0);
  uso(banco, 6, "anthropic/claude-sonnet-5", [1, 5, 5, 0, 0], 0.0625);
  uso(banco, 7, "openai/gpt-5", [1, 10, 1, 0, 0], 0.03125);

  const decisao = (id: number, ticket: number, gate: string, aprovado: number, outros = {}) => {
    inserir(banco, "decisao", {
      id,
      issue: 1,
      ticket,
      gate,
      aprovado,
      por: gate === "revisao" ? "agente" : "auditor",
      em: em(1, `0${String(id)}:00:00`),
      ...outros,
    });
  };
  decisao(1, 1, "registro", 0, { motivo: "faltou o comportamento" });
  decisao(2, 1, "registro", 1);
  decisao(3, 2, "desenho", 1, { motivo: "ok" });
  decisao(4, 4, "revisao", 0, { motivo: "falta teste" });
  decisao(5, 6, "pr", 0, { motivo: "ajuste o título" });
  decisao(6, 6, "pr", 1, { nota: 4 });

  evidenciasDoDesenho(banco, 2);

  const arquivo = (caminho: string, adicionadas: number | null) => ({
    caminho,
    status: "M" as const,
    adicionadas,
    removidas: adicionadas,
  });
  const commit = (t: number, c: string, arquivos: ReturnType<typeof arquivo>[]) => {
    gravarCommit(banco, t, { sha: sha(c), mensagem: "m", em: em(1, "16:00:00"), arquivos });
  };
  commit(3, "a", [arquivo("src/a.ts", 10), arquivo("src/b.ts", 5)]);
  commit(5, "b", [arquivo("src/a.ts", 3)]);
  commit(7, "c", [arquivo("logo.png", null)]);
  const retrabalho = (alterador: string, ticket: number | null, origem: number, linhas: number) => {
    inserir(banco, "retrabalho", {
      commit_alterador: sha(alterador),
      ticket,
      autor: ticket === null ? "Ana <ana@exemplo.com>" : null,
      ticket_origem: origem,
      linhas,
    });
  };
  retrabalho("b", 5, 3, 2);
  retrabalho("d", null, 3, 1);
  retrabalho("e", null, 5, 1);

  // M6: um problema registrado depois do merge que toca src/b.ts.
  issue(banco, 2, { criada_em: em(3, "09:00:00"), concluida_em: em(4, "09:00:00") });
  ticket(banco, 9, 2, "desenvolvimento");
  commit(9, "f", [arquivo("src/b.ts", 1)]);

  const { geradoEm, ...m } = metricasDaIssue(banco, 1);
  assert.ok(Math.abs(Date.parse(geradoEm) - Date.now()) < 60_000);
  assert.deepEqual(m, {
    issue: 1,
    etapas: [
      {
        etapa: "registro",
        ...consumo(6, 320, 32, 1000, 50, 0.875),
        execucoes: 2,
        falhas: 0,
        duracaoMs: 40 * 60_000,
        reprovacoes: 1,
        modelos: [
          deModelo("anthropic/claude-sonnet-5", 4, 120, 12, 1000, 50, 0.75),
          deModelo("openai/gpt-5", 2, 200, 20, 0, 0, 0.125),
        ],
      },
      {
        etapa: "desenho",
        ...consumo(5, 500, 50, 0, 0, 0),
        execucoes: 2,
        falhas: 1,
        duracaoMs: 5 * 60_000 + 62.5 * 60_000,
        reprovacoes: 0,
        modelos: [deModelo("llamacpp/qwen", 5, 500, 50, 0, 0, 0)],
      },
      {
        etapa: "desenvolvimento",
        ...ZERO,
        execucoes: 1,
        falhas: 0,
        duracaoMs: 20 * 60_000,
        reprovacoes: 0,
        modelos: [],
      },
      {
        etapa: "revisao",
        ...consumo(1, 10, 1, 0, 0, 0.03125),
        execucoes: 1,
        falhas: 0,
        duracaoMs: 10 * 60_000,
        reprovacoes: 1,
        modelos: [deModelo("openai/gpt-5", 1, 10, 1, 0, 0, 0.03125)],
      },
      { etapa: "encerramento", ...ZERO, execucoes: 1, falhas: 0, duracaoMs: 5 * 60_000, reprovacoes: 1, modelos: [] },
      { etapa: "sessao", ...ZERO, execucoes: 1, falhas: 0, duracaoMs: 0, reprovacoes: 0, modelos: [] },
    ],
    consultas: {
      ...consumo(1, 5, 5, 0, 0, 0.0625),
      execucoes: 1,
      modelos: [deModelo("anthropic/claude-sonnet-5", 1, 5, 5, 0, 0, 0.0625)],
    },
    correcoesRegistro: { devolucoes: 1, ajustesAuditor: 0 },
    correcoesDesenho: { devolucoes: 0, ajustesAuditor: 0 },
    desenho: { arquivosPrevistos: 2, ticketsPropostos: 1, novasDependencias: 1, novosAcoplamentos: 0 },
    retrabalho: [
      { ticket: 3, linhasAdicionadas: 15, linhasAlteradasDepois: 3, linhasAlteradasPorHumanos: 1 },
      { ticket: 5, linhasAdicionadas: 3, linhasAlteradasDepois: 1, linhasAlteradasPorHumanos: 1 },
      { ticket: 7, linhasAdicionadas: 0, linhasAlteradasDepois: 0, linhasAlteradasPorHumanos: 0 },
    ],
    arquivosAlterados: 3, // a.ts, b.ts e logo.png
    exigenciasRevisao: 1,
    bugsEmArquivosRevisados: 1,
    notaPR: 4,
    decisoes: [
      { gate: "registro", aprovado: false, motivo: "faltou o comportamento", em: em(1, "01:00:00") },
      { gate: "registro", aprovado: true, em: em(1, "02:00:00") },
      { gate: "desenho", aprovado: true, motivo: "ok", em: em(1, "03:00:00") },
      { gate: "revisao", aprovado: false, motivo: "falta teste", em: em(1, "04:00:00") },
      { gate: "pr", aprovado: false, motivo: "ajuste o título", em: em(1, "05:00:00") },
      { gate: "pr", aprovado: true, nota: 4, em: em(1, "06:00:00") },
    ],
    execucoesSemSessao: [5],
  });
  banco.close();
});

test("issue no registro: só a etapa de registro, sem desenho nem nota; execução em andamento não conta duração", () => {
  const { banco } = novoBanco();
  const { issue: i, tickets } = registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  comIssue(banco, i.id, "iniciarExecucao", FABRIQUINHA, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: tickets[0]?.id, modo: "interativo", sessaoPi: crypto.randomUUID() },
      FABRIQUINHA,
      ctx,
    ),
  );

  const m = metricasDaIssue(banco, i.id);
  assert.deepEqual(MetricasIssue.parse(m), m);
  assert.deepEqual(m.etapas, [
    { etapa: "registro", ...ZERO, execucoes: 1, falhas: 0, duracaoMs: 0, reprovacoes: 0, modelos: [] },
  ]);
  assert.deepEqual(
    { ...m, etapas: [], geradoEm: "" },
    {
      issue: i.id,
      geradoEm: "",
      etapas: [],
      consultas: { ...ZERO, execucoes: 0, modelos: [] },
      correcoesRegistro: { devolucoes: 0, ajustesAuditor: 0 },
      correcoesDesenho: { devolucoes: 0, ajustesAuditor: 0 },
      desenho: null,
      retrabalho: [],
      arquivosAlterados: null,
      exigenciasRevisao: 0,
      bugsEmArquivosRevisados: 0,
      notaPR: null,
      decisoes: [],
      execucoesSemSessao: [],
    },
  );
  assert.throws(
    () => metricasDaIssue(banco, 99),
    (e) => e instanceof ErroDeRegra && e.message === "a issue I-99 não existe (confira o número da issue)",
  );
  banco.close();
});

test("correções: o Auditor ajusta e devolve no registro e no desenho; só os ajustes dele na fase do gate contam", () => {
  const { banco } = novoBanco();
  const dep = registrarIssue(banco, { projeto: "outro" }, AUDITOR).issue.id;
  const id = registrarIssue(banco, { projeto: "loja" }, AUDITOR).issue.id;
  // M2: dois ajustes do Auditor no registro e uma devolução.
  comIssue(banco, id, "editarIssue", AUDITOR, (ag) =>
    editarIssue(ag, { titulo: "Login lento", tipo: "problema" }, AUDITOR),
  );
  comIssue(banco, id, "adicionarDependencia", AUDITOR, (ag, ctx) => adicionarDependencia(ag, dep, AUDITOR, ctx));
  comIssue(banco, id, "decidirRegistro", AUDITOR, (ag, ctx) =>
    decidirRegistro(ag, { aprovado: false, motivo: "faltou o comportamento" }, AUDITOR, ctx),
  );

  // O desenho concluído com um ticket proposto pelo agente leva a issue à aprovação do desenho.
  banco.prepare("UPDATE ticket SET status = 'concluido', concluido_em = ? WHERE issue = ?").run(em(1, "10:00:00"), id);
  banco.prepare("UPDATE issue SET fase = 'aprovacao_desenho' WHERE id = ?").run(id);
  ticket(banco, 10, id, "desenho");
  evidenciasDoDesenho(banco, 10);
  ticket(banco, 11, id, "desenvolvimento", {
    status: "aberto",
    concluido_em: null,
    origem: "agente",
    origem_ticket: 10,
  });

  // §10: o Auditor cria um ticket, remove outro e reprova o desenho uma vez.
  comIssue(banco, id, "adicionarTicketDesenvolvimento", AUDITOR, (ag, ctx) =>
    adicionarTicketDesenvolvimento(ag, { titulo: "Índice" }, AUDITOR, ctx),
  );
  comIssue(banco, id, "removerTicket", AUDITOR, (ag) => removerTicket(ag, { ticket: 11 }, AUDITOR));
  comIssue(banco, id, "decidirDesenho", AUDITOR, (ag, ctx) =>
    decidirDesenho(ag, { aprovado: false, motivo: "faltou o índice" }, AUDITOR, ctx),
  );

  const m = metricasDaIssue(banco, id);
  assert.deepEqual(m.correcoesRegistro, { devolucoes: 1, ajustesAuditor: 2 });
  assert.deepEqual(m.correcoesDesenho, { devolucoes: 1, ajustesAuditor: 2 });
  assert.deepEqual(
    [
      m.etapas.find((e) => e.etapa === "registro")?.reprovacoes,
      m.etapas.find((e) => e.etapa === "desenho")?.reprovacoes,
    ],
    [1, 1],
  );
  assert.deepEqual(metricasDaIssue(banco, dep).correcoesRegistro, { devolucoes: 0, ajustesAuditor: 0 });
  banco.close();
});

test("bugs em arquivos revisados: só problemas do mesmo projeto, registrados depois da conclusão, concluídos e no mesmo arquivo", () => {
  const { banco } = novoBanco();
  let proximo = 0;
  /** Issue com um ticket de desenvolvimento cujo commit alterou `arquivos` ([caminho, caminho anterior?]). */
  const comArquivos = (campos: Record<string, SQLInputValue>, arquivos: [string, string?][]) => {
    const id = ++proximo;
    issue(banco, id, campos);
    ticket(banco, id, id, "desenvolvimento");
    gravarCommit(banco, id, {
      sha: String(id).padStart(40, "0"),
      mensagem: "m",
      em: em(1, "10:00:00"),
      arquivos: arquivos.map(([caminho, anterior]) => ({
        caminho,
        status: anterior === undefined ? ("M" as const) : ("R" as const),
        ...(anterior !== undefined && { caminhoAnterior: anterior }),
        adicionadas: 1,
        removidas: 0,
      })),
    });
    return id;
  };
  const depois = { criada_em: em(3, "09:00:00"), concluida_em: em(4, "09:00:00") };

  const x = comArquivos({ tipo: "funcionalidade" }, [["src/a.ts"], ["src/b.ts", "src/velho.ts"]]);
  const problema = comArquivos(depois, [["src/a.ts"]]); // conta
  comArquivos({ ...depois, tipo: "funcionalidade" }, [["src/a.ts"]]); // funcionalidade não conta
  comArquivos({ criada_em: em(2, "17:00:00"), concluida_em: em(4, "09:00:00") }, [["src/a.ts"]]); // registrada antes
  comArquivos({ criada_em: em(3, "09:00:00"), fase: "desenvolvimento", concluida_em: null }, [["src/a.ts"]]); // aberta
  comArquivos(depois, [["src/c.ts"]]); // outro arquivo
  comArquivos({ ...depois, projeto: "outro" }, [["src/a.ts"]]); // outro projeto
  comArquivos(depois, [["src/d.ts", "src/b.ts"]]); // renomeou um arquivo de X: conta
  comArquivos(depois, [["src/velho.ts"]]); // tocou o caminho antigo de uma renomeação de X: conta
  const aberta = comArquivos({ fase: "revisao", concluida_em: null }, [["src/a.ts"]]);

  assert.equal(metricasDaIssue(banco, x).bugsEmArquivosRevisados, 3);
  assert.equal(metricasDaIssue(banco, problema).bugsEmArquivosRevisados, 0);
  assert.equal(metricasDaIssue(banco, aberta).bugsEmArquivosRevisados, 0, "0 antes do merge");
  banco.close();
});

test("erro de E/S ao procurar a sessão não vira aviso: propaga", () => {
  const { banco, raiz } = novoBanco();
  const { issue: i, tickets } = registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  execucao(banco, 1, Number(tickets[0]?.id), "interativo", crypto.randomUUID(), em(1, "10:00:00"), em(1, "10:05:00"));
  writeFileSync(join(raiz, "sessoes"), ""); // um arquivo no lugar do diretório das sessões

  assert.throws(() => metricasDaIssue(banco, i.id), { code: "ENOTDIR" });
  banco.close();
});

test("arquivos alterados: caminhos distintos dos commits da issue, e null sem commit", () => {
  const { banco } = novoBanco();
  /** Commit do ticket `t` com `n` arquivos a partir de `inicio` (`src/<i>.ts`). */
  const commitar = (t: number, sha: string, inicio: number, n: number) => {
    gravarCommit(banco, t, {
      sha: sha.padStart(40, "0"),
      mensagem: "m",
      em: em(1, "10:00:00"),
      arquivos: Array.from({ length: n }, (_, i) => ({
        caminho: `src/${String(inicio + i)}.ts`,
        status: "M" as const,
        adicionadas: 1,
        removidas: 0,
      })),
    });
  };

  issue(banco, 1);
  ticket(banco, 1, 1, "desenvolvimento");
  commitar(1, "a", 0, 12);
  assert.equal(metricasDaIssue(banco, 1).arquivosAlterados, 12);

  issue(banco, 2);
  ticket(banco, 2, 2, "desenvolvimento");
  ticket(banco, 3, 2, "desenvolvimento");
  commitar(2, "b", 0, 20);
  commitar(3, "c", 19, 12); // repete o caminho src/19.ts
  assert.equal(metricasDaIssue(banco, 2).arquivosAlterados, 31);

  issue(banco, 3);
  ticket(banco, 4, 3, "desenvolvimento");
  assert.equal(metricasDaIssue(banco, 3).arquivosAlterados, null);
  banco.close();
});
