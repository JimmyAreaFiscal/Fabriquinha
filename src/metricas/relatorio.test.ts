// Relatório de produtividade (F6 §6, §10) contra banco real, git real e sessões JSONL no formato do pi: recoleta uso e
// retrabalho, sai mesmo quando a recoleta falha, e o HTML é autocontido e escapa o texto que vem do banco.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import { after, test } from "node:test";
import { AUDITOR } from "../dominio/agregado.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommit } from "../persistencia/commits.ts";
import { registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { MetricasIssue } from "./issue.ts";
import { relatorio } from "./relatorio.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-relatorio-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// git sem a configuração do usuário da máquina.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();

let n = 0;
function novoBanco(): { banco: DatabaseSync; raiz: string; repo: string } {
  const dir = join(base, `c${String(++n)}`);
  const repo = join(dir, "repo");
  git(base, "init", "-q", "-b", "main", repo);
  const raiz = join(dir, "raiz");
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    testes: ["true"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  return { banco, raiz, repo };
}

const inserir = (banco: DatabaseSync, tabela: string, linha: Record<string, SQLInputValue>) =>
  banco
    .prepare(
      `INSERT INTO ${tabela} (${Object.keys(linha).join(", ")}) VALUES (${Object.keys(linha)
        .map((c) => "$" + c)
        .join(", ")})`,
    )
    .run(linha);

const em = (hora: string) => `2026-10-01T${hora}.000Z`;
const SECOES = /<h2>([^<]*)<\/h2>/g;
/** Qualquer atributo `src` ou `href` numa tag: o HTML de evidência é autocontido (F3 §3.3). */
const EXTERNO = /<[^>]*\s(?:src|href)\s*=/i;

test("relatorio recoleta uso e retrabalho, segue quando a recoleta falha e gera o HTML autocontido com o texto escapado", async (t) => {
  const { banco, raiz, repo } = novoBanco();
  const titulo = `<script>alert("x")</script> & 'aspas'`;
  inserir(banco, "issue", {
    id: 1,
    projeto: "loja",
    titulo,
    tipo: "problema",
    fase: "concluida",
    criada_em: em("09:00:00"),
    concluida_em: em("15:00:00"),
  });
  const ticket = (id: number, etapa: string, campos: Record<string, SQLInputValue> = {}) => {
    inserir(banco, "ticket", {
      id,
      issue: 1,
      etapa,
      titulo: `T-${String(id)}`,
      status: "concluido",
      origem: "fabriquinha",
      criado_em: em("09:00:00"),
      concluido_em: em("09:00:00"),
      ...campos,
    });
  };
  ticket(1, "registro");
  // O desenho concluído tem um desenho_solucao malformado e nenhum relatório de impactos: desenho nulo, com aviso.
  ticket(2, "desenho");
  inserir(banco, "evidencia", {
    ticket: 2,
    tipo: "desenho_solucao",
    produtor: "agente",
    dados: JSON.stringify({ arquivosPrevistos: "src/a.ts" }),
    em: em("09:30:00"),
  });
  ticket(3, "desenvolvimento");
  ticket(4, "revisao");
  ticket(5, "desenvolvimento", { origem: "agente", origem_ticket: 4 });
  ticket(6, "encerramento");
  ticket(7, "desenvolvimento");

  // T-3 escreve dez linhas, T-5 reescreve três delas; o commit de T-7 não está no repositório e o retrabalho dele falha.
  const commitar = (ticket: number, conteudo: string) => {
    writeFileSync(join(repo, "a.txt"), conteudo);
    git(repo, "add", "-A");
    git(repo, "commit", "-qm", `T-${String(ticket)}`);
    const sha = git(repo, "rev-parse", "HEAD");
    gravarCommit(banco, ticket, {
      sha,
      mensagem: "m",
      em: em("12:00:00"),
      arquivos: [{ caminho: "a.txt", status: "M", adicionadas: 10, removidas: 0 }],
    });
  };
  commitar(3, "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
  commitar(5, "1\nB\n3\nB\n5\nB\n7\n8\n9\n10\n");
  gravarCommit(banco, 7, { sha: "f".repeat(40), mensagem: "m", em: em("12:00:00"), arquivos: [] });

  const [s1, s2, s3, s4] = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const execucao = (id: number, ticket: number, sessao: string, inicio: string, fim: string, modo = "autonomo") => {
    inserir(banco, "execucao", {
      id,
      ticket,
      modo,
      sessao_pi: sessao,
      resultado: "sucesso",
      iniciada_em: em(inicio),
      terminada_em: em(fim),
    });
  };
  execucao(1, 1, s1, "10:00:00", "11:05:00");
  execucao(2, 3, s2, "12:00:00", "12:03:07");
  execucao(3, 5, s3, "13:00:00", "13:00:12");
  execucao(4, 3, s4, "14:00:00", "14:05:00", "consulta");
  mkdirSync(join(raiz, "sessoes"));
  /** A sessão `sessao` com uma resposta do assistente às `hora`. */
  const sessao = (sessao: string, hora: string, provider: string, model: string, input: number, custo: number) => {
    const usage = { input, output: input / 10, cacheRead: 0, cacheWrite: 0, cost: { total: custo } };
    const linha = { type: "message", timestamp: em(hora), message: { role: "assistant", provider, model, usage } };
    writeFileSync(join(raiz, "sessoes", `x_${sessao}.jsonl`), JSON.stringify(linha) + "\n");
  };
  sessao(s1, "10:01:00", "anthropic", "claude-sonnet-5", 100, 0.5);
  sessao(s4, "14:01:00", "openai", "gpt-5<b>", 20, 0.25); // o nome do modelo também vem de fora
  // Dois arquivos para a mesma sessão: a coleta da E-2 falha (F6 §3.1), mas a sessão existe.
  for (const prefixo of ["a", "b"]) writeFileSync(join(raiz, "sessoes", `${prefixo}_${s2}.jsonl`), "");

  inserir(banco, "decisao", {
    id: 1,
    issue: 1,
    ticket: 4,
    gate: "revisao",
    aprovado: 0,
    motivo: `<img src=x onerror=alert(1)>`,
    por: "agente",
    em: em("14:00:00"),
  });
  inserir(banco, "decisao", {
    id: 2,
    issue: 1,
    ticket: 6,
    gate: "pr",
    aprovado: 1,
    nota: 5,
    por: "auditor",
    em: em("15:00:00"),
  });

  const log = t.mock.method(console, "error", () => undefined);
  const { dados, html } = await relatorio(banco, 1);
  const logado = log.mock.calls.map((c) => c.arguments.join(" ")).join("\n");
  assert.match(logado, /E-2: coleta de uso falhou: .*a sessão .* tem 2 arquivos/);
  assert.match(logado, /I-1: retrabalho de T-7 falhou no relatório: /);
  assert.match(logado, /I-1: evidências do desenho de T-2 faltando ou malformadas/);
  assert.equal(dados.desenho, null);

  assert.deepEqual(MetricasIssue.parse(dados), dados);
  assert.deepEqual(
    dados.etapas.map((e) => [e.etapa, e.chamadas, e.custo, e.duracaoMs]),
    [
      ["registro", 1, 0.5, 65 * 60_000],
      ["desenho", 0, 0, 0],
      ["desenvolvimento", 0, 0, 199_000],
      ["revisao", 0, 0, 0],
      ["encerramento", 0, 0, 0],
    ],
  );
  assert.deepEqual(dados.retrabalho, [
    { ticket: 3, linhasAdicionadas: 10, linhasAlteradasDepois: 3, linhasAlteradasPorHumanos: 0 },
    { ticket: 5, linhasAdicionadas: 10, linhasAlteradasDepois: 0, linhasAlteradasPorHumanos: 0 },
    { ticket: 7, linhasAdicionadas: 0, linhasAlteradasDepois: 0, linhasAlteradasPorHumanos: 0 },
  ]);
  assert.deepEqual([dados.consultas.execucoes, dados.consultas.custo], [1, 0.25]);
  assert.deepEqual(dados.execucoesSemSessao, [2, 3], "a E-2 tem a sessão repetida, e a E-3 não tem sessão");

  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, EXTERNO);
  assert.deepEqual(
    [...html.matchAll(SECOES)].map((m) => m[1]),
    ["Resumo", "Por etapa", "Por modelo", "Métricas do diagrama", "Decisões", "Avisos"],
  );
  assert.ok(
    html.includes("I-1: &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;aspas&#39;</h1>"),
    "título escapado",
  );
  assert.ok(html.includes("<td>&lt;img src=x onerror=alert(1)&gt;</td>"), "motivo escapado");
  assert.doesNotMatch(html, /<script|<img/);
  assert.ok(html.includes("<td>US$ 0,7500</td><td>132</td><td>1h 08min</td><td>3</td><td>0</td>"), "resumo");
  assert.ok(html.includes("<td>desenvolvimento</td><td>2</td><td>0</td><td>3min 19s</td>"), "por etapa");
  assert.ok(html.includes("<td>registro</td><td>anthropic/claude-sonnet-5</td><td>1</td><td>100</td>"), "por modelo");
  assert.ok(html.includes("<td>consultas</td><td>openai/gpt-5&lt;b&gt;</td><td>1</td><td>20</td>"), "consulta");
  assert.ok(html.includes("<td>3 de 20 linhas (0 por humanos)</td>"), "M4");
  assert.ok(html.includes("<td>M5</td><td>Exigências de alteração</td><td>1</td>"), "M5");
  assert.ok(html.includes("<td>M7</td><td>Feedback humano da qualidade</td><td>5 de 5</td>"), "M7");
  assert.ok(html.includes("<td>pr</td><td>aprovado</td><td>—</td><td>5</td>"), "decisão com nota");
  assert.ok(
    html.includes("Execuções com a sessão do pi ausente ou repetida, fora das contas de tokens e custo: E-2, E-3."),
    "avisos",
  );
  banco.close();
});

test("relatorio de uma issue recém-registrada: sem título, chamadas, decisões nem avisos; issue inexistente é erro", async () => {
  const { banco } = novoBanco();
  const id = registrarIssue(banco, { projeto: "loja" }, AUDITOR).issue.id;

  const { dados, html } = await relatorio(banco, id);
  assert.deepEqual(MetricasIssue.parse(dados), dados);
  assert.doesNotMatch(html, EXTERNO);
  assert.ok(html.includes(`<h1>Produtividade da I-${String(id)}</h1>`));
  assert.ok(html.includes("<td>US$ 0,0000</td><td>0</td><td>0s</td><td>0</td><td>0</td>"), "resumo zerado");
  assert.ok(html.includes("<p>Nenhuma chamada de modelo registrada.</p>"));
  assert.ok(html.includes("<p>Nenhuma decisão registrada.</p>"));
  assert.ok(html.includes("<p>Nenhum aviso.</p>"));
  assert.ok(html.includes("<td>M7</td><td>Feedback humano da qualidade</td><td>—</td>"));

  await assert.rejects(
    relatorio(banco, 99),
    (e) => e instanceof ErroDeRegra && e.message === "a issue I-99 não existe (confira o número da issue)",
  );
  banco.close();
});
