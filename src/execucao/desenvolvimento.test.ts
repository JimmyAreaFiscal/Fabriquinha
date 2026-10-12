// Ponta a ponta do ciclo do desenvolvimento (F3 §7, F5 §4, F1 §5.1) por `executarAutonomo`, contra banco real e git
// real, com falsos só para os binários externos: o pi, o docker do sonar-scanner e o servidor do SonarQube.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import type { Ator } from "../dominio/agregado.ts";
import { concluirTicket } from "../dominio/conclusao.ts";
import { iniciarExecucao, reabrirTicket, terminarExecucao } from "../dominio/execucao.ts";
import { decidirDesenho, decidirRegistro } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento } from "../dominio/tickets.ts";
import { submeter } from "../evidencias/submissao.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { caminhoDaWorktree } from "../repositorio/worktree.ts";
import { executarAutonomo } from "./autonoma.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-desenvolvimento-")));

// git sem a configuração do usuário da máquina; pi sem a confiança do Auditor.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
mkdirSync(join(base, "pi-agent"));
process.env.PI_CODING_AGENT_DIR = join(base, "pi-agent");
// Credenciais que nem o agente nem o hook podem ver.
process.env.GH_TOKEN = "segredo-gh";
process.env.SONAR_TOKEN = "segredo-sonar";

/** pi falso: no prompt, escreve na worktree os arquivos de $FALSO_PI_ESCREVE (JSON caminho → conteúdo) e assenta. */
const pi = join(base, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
import { writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("0.84.4-falso");
  process.exit(0);
}
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  if (!linhas.some((l) => JSON.parse(l).type === "prompt")) return;
  for (const [caminho, conteudo] of Object.entries(JSON.parse(process.env.FALSO_PI_ESCREVE))) writeFileSync(caminho, conteudo);
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } });
  emitir({ type: "agent_settled" });
});
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

// docker falso no PATH: o "scanner" só informa a tarefa do Compute Engine.
mkdirSync(join(base, "bin"));
writeFileSync(
  join(base, "bin", "docker"),
  `#!/bin/sh
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; esac; done
printf 'ceTaskId=AX1\\n' > "$w/report-task.txt"
`,
);
chmodSync(join(base, "bin", "docker"), 0o755);
process.env.PATH = `${join(base, "bin")}${delimiter}${String(process.env.PATH)}`;

// SonarQube falso: no ar, tarefa pronta e as issues de `issuesSonar`; conta as análises pedidas.
let issuesSonar: { component: string; rule: string; severity: string; message: string }[] = [];
let analises = 0;
const servidor = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "", "http://sonar");
  if (pathname === "/api/ce/task") analises++;
  const corpo =
    pathname === "/api/system/status"
      ? { status: "UP" }
      : pathname === "/api/ce/task"
        ? { task: { status: "SUCCESS" } }
        : { paging: { total: issuesSonar.length }, issues: issuesSonar };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
});
servidor.listen(0, "127.0.0.1");
await once(servidor, "listening");
process.env.SONAR_HOST_URL = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;

after(() => {
  servidor.close();
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  issuesSonar = [];
  analises = 0;
  delete process.env.SAIDA_TESTES;
  delete process.env.SAIDA_FITNESS;
  delete process.env.HOOK_REPROVA;
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "busca.ts": "export const busca = cache;\n", "cache.ts": "1\n" });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const OPCOES = { pacote: "/opt/pi-fabriquinha", timeoutMin: 1 };

let n = 0;
/**
 * Projeto `loja` com `origin` bare real, testes e fitness falsos que saem com $SAIDA_TESTES e $SAIDA_FITNESS, e um
 * pre-commit que guarda o ambiente e reprova com $HOOK_REPROVA. A I-1 (problema) chega ao desenvolvimento pelos
 * comandos reais: registro aprovado, desenho T-2 concluído com os tickets T-3 e T-4, desenho aprovado.
 */
function cenario() {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  const raiz = join(dir, "raiz");
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "busca.ts"), "export const busca = varrer;\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "push", "-q", "origin", "main");
  const ambienteDoHook = join(dir, "ambiente-do-hook");
  writeFileSync(
    join(repo, ".git", "hooks", "pre-commit"),
    `#!/bin/sh\nenv > "${ambienteDoHook}"\nif [ -n "$HOOK_REPROVA" ]; then echo "lint: 2 erros em cache.ts"; exit 1; fi\n`,
  );
  chmodSync(join(repo, ".git", "hooks", "pre-commit"), 0o755);

  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    testes: ['exit "${SAIDA_TESTES:-0}"'],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "complexidade", comando: 'exit "${SAIDA_FITNESS:-0}"', descricao: "d" }],
  });
  registrarIssue(banco, { projeto: "loja" }, auditor);
  const saida = (execucao: number, nome: string, conteudo: string) => {
    const pasta = join(raiz, "execucoes", `E-${String(execucao)}`, "saida");
    mkdirSync(pasta, { recursive: true });
    writeFileSync(join(pasta, nome), conteudo);
    return join(pasta, nome);
  };
  const executar = (ticket: number, modo: "interativo" | "autonomo") =>
    comIssue(banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
      iniciarExecucao(ag, { ticket, modo, sessaoPi: randomUUID() }, fabriquinha, ctx),
    );
  const terminar = (execucao: number) =>
    comIssue(banco, 1, "terminarExecucao", fabriquinha, (ag, ctx) =>
      terminarExecucao(ag, { execucao, resultado: "sucesso" }, fabriquinha, ctx),
    );

  executar(1, "interativo");
  const registrador: Ator = { tipo: "agente", execucao: 1, ticket: 1 };
  submeter(banco, registrador, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }, [
    saida(1, "busca.log", "8 s\n"),
  ]);
  submeter(
    banco,
    registrador,
    "criterios_aceite",
    { criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }] },
    [],
  );
  comIssue(banco, 1, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "Busca lenta", tipo: "problema" }, auditor),
  );
  terminar(1);
  comIssue(banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, { aprovado: true }, auditor, ctx));

  executar(2, "autonomo");
  const desenhista: Ator = { tipo: "agente", execucao: 2, ticket: 2 };
  const html = (nome: string) => [saida(2, nome, `<!DOCTYPE html><html><body>${nome}</body></html>`)];
  submeter(
    banco,
    desenhista,
    "desenho_solucao",
    {
      resumo: "cache na busca",
      arquivosPrevistos: [{ caminho: "busca.ts", acao: "alterar", motivo: "lê do cache" }],
    },
    html("desenho.html"),
  );
  submeter(
    banco,
    desenhista,
    "relatorio_complexidade",
    {
      variaveis: [{ simbolo: "n", significado: "itens" }],
      fluxos: [{ nome: "Busca", gatilho: "GET /busca", situacao: "novo", depois: { tempo: "O(1)", espaco: "O(n)" } }],
    },
    html("fluxos.html"),
  );
  submeter(
    banco,
    desenhista,
    "relatorio_impactos_arquitetura",
    { impacto: "baixo", novasDependencias: [], novosAcoplamentos: [], riscos: [] },
    html("impactos.html"),
  );
  for (const [titulo, descricao] of [
    ["Cache na busca", `Lê do cache antes de varrer a tabela, que tem ${"muitas ".repeat(12)}linhas.`],
    ["Métrica do cache", ""],
  ]) {
    comIssue(banco, 1, "adicionarTicketDesenvolvimento", desenhista, (ag, ctx) =>
      adicionarTicketDesenvolvimento(ag, { titulo, descricao }, desenhista, ctx),
    );
  }
  terminar(2);
  comIssue(banco, 1, "concluirTicket", fabriquinha, (ag, ctx) => concluirTicket(ag, { ticket: 2 }, fabriquinha, ctx));
  comIssue(banco, 1, "decidirDesenho", auditor, (ag, ctx) => decidirDesenho(ag, { aprovado: true }, auditor, ctx));

  return {
    raiz,
    banco,
    repo,
    worktree: caminhoDaWorktree(raiz, "loja", 1),
    ambienteDoHook,
    /** O ticket e a fase da issue, lidos do banco. */
    estado(ticket: number) {
      const ag = agregado(banco, 1);
      assert.ok(ag);
      return { ag, ticket: ag.tickets.find((t) => t.id === ticket) };
    },
    commits: () => banco.prepare("SELECT * FROM commit_ticket ORDER BY ticket").all(),
    arquivos: (sha: unknown) =>
      banco
        .prepare("SELECT caminho, caminho_anterior, status, adicionadas, removidas FROM arquivo_commit WHERE sha = ?")
        .all(sha as string)
        .map((l) => ({ ...l })),
    reabrir(ticket: number) {
      comIssue(banco, 1, "reabrirTicket", auditor, (ag) => reabrirTicket(ag, { ticket }, auditor));
    },
  };
}

test("desenvolvimento: testes, fitness e SonarQube aprovam, commit com os hooks e sem credenciais, C7; o último leva à revisão", async () => {
  const c = cenario();
  const base = git(c.repo, "rev-parse", "main");

  await executarAutonomo(c.banco, 3, OPCOES);

  let { ag, ticket } = c.estado(3);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "desenvolvimento", "T-4 ainda não concluiu");
  assert.deepEqual(
    ag.evidencias.filter((e) => e.ticket === 3).map((e) => [e.tipo, e.produtor, e.aprovada]),
    [
      ["execucao_testes", "fabriquinha", true],
      ["matriz_fitness", "fabriquinha", true],
      ["relatorio_sonar", "fabriquinha", true],
    ],
  );
  assert.equal(analises, 1);

  // O commit está na branch da issue, filho da base, com a mensagem do F5 §4 e a descrição em 72 colunas.
  const [commit3] = c.commits();
  const head = git(c.worktree, "rev-parse", "HEAD");
  assert.equal(git(c.worktree, "rev-parse", "fabriquinha/I-1"), head);
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1"), base);
  const mensagem = [
    "fix: Cache na busca [I-1/T-3]",
    "",
    "Lê do cache antes de varrer a tabela, que tem muitas muitas muitas",
    "muitas muitas muitas muitas muitas muitas muitas muitas muitas linhas.",
  ].join("\n");
  assert.deepEqual({ ...commit3, em: undefined }, { sha: head, ticket: 3, mensagem, em: undefined });
  assert.equal(git(c.worktree, "log", "-1", "--format=%B"), mensagem);
  assert.deepEqual(c.arquivos(head), [
    { caminho: "busca.ts", caminho_anterior: null, status: "M", adicionadas: 1, removidas: 1 },
    { caminho: "cache.ts", caminho_anterior: null, status: "A", adicionadas: 1, removidas: 0 },
  ]);
  assert.equal(git(c.worktree, "status", "--porcelain"), "", "nada ficou de fora do commit");
  // O hook rodou, sem credenciais.
  const ambiente = readFileSync(c.ambienteDoHook, "utf8");
  assert.match(ambiente, /^GH_CONFIG_DIR=/m);
  assert.doesNotMatch(ambiente, /segredo/);
  // O agente recebeu o contexto do desenvolvimento.
  const prompt = readFileSync(join(c.raiz, "execucoes", "E-3", "prompt.md"), "utf8");
  assert.match(prompt, /## Desenho aprovado\n\ncache na busca\n/);
  assert.match(prompt, /## Arquivos previstos\n\n- `busca\.ts` \(alterar\): lê do cache\n/);

  // O último ticket de desenvolvimento leva a issue à revisão, com o ticket de revisão novo.
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n" });
  await executarAutonomo(c.banco, 4, OPCOES);

  ({ ag, ticket } = c.estado(4));
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "revisao");
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "revisao").map((t) => [t.id, t.status, t.origem, t.titulo]),
    [[5, "aberto", "fabriquinha", "Revisar o desenvolvimento"]],
  );
  const commit4 = c.commits()[1];
  assert.ok(commit4);
  assert.equal(commit4.mensagem, "fix: Métrica do cache [I-1/T-4]");
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1"), head);
  assert.deepEqual(c.arquivos(commit4.sha), [
    { caminho: "metrica.ts", caminho_anterior: null, status: "A", adicionadas: 1, removidas: 0 },
  ]);
  c.banco.close();
});

test("a cadeia para no primeiro reprovado, e o ticket falha com o motivo, sem commit; reaberto, segue até concluir", async () => {
  const c = cenario();
  const falhou = async (motivo: string, tipos: string[]) => {
    await executarAutonomo(c.banco, 3, OPCOES);
    const { ag, ticket } = c.estado(3);
    assert.equal(ticket?.status, "falhou");
    assert.equal(ticket.erro, motivo);
    assert.deepEqual(
      ag.evidencias.filter((e) => e.ticket === 3).map((e) => e.tipo),
      tipos,
    );
    assert.deepEqual(c.commits(), []);
    assert.equal(git(c.worktree, "rev-parse", "HEAD"), git(c.repo, "rev-parse", "main"), "nada foi commitado");
    c.reabrir(3);
  };
  const reprovou = (tipo: string) =>
    `a evidência ${tipo} de T-3 reprovou (veja o que reprovou com fabriquinha evidencia ver T-3 ${tipo} e execute o ticket de novo)`;

  process.env.SAIDA_TESTES = "1";
  await falhou(reprovou("execucao_testes"), ["execucao_testes"]);
  assert.equal(analises, 0);

  delete process.env.SAIDA_TESTES;
  process.env.SAIDA_FITNESS = "1";
  await falhou(reprovou("matriz_fitness"), ["execucao_testes", "matriz_fitness"]);
  assert.equal(analises, 0, "o SonarQube não roda depois da fitness reprovada");

  delete process.env.SAIDA_FITNESS;
  issuesSonar = [{ component: "loja:cache.ts", rule: "ts:S1", severity: "MAJOR", message: "ruim" }];
  await falhou(reprovou("relatorio_sonar"), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);

  issuesSonar = [];
  process.env.HOOK_REPROVA = "1";
  await falhou(
    "o git commit saiu com código 1, com os hooks do repositório: lint: 2 erros em cache.ts " +
      "(corrija o que a saída aponta e execute o ticket de novo; a Fabriquinha nunca pula os hooks)",
    ["execucao_testes", "matriz_fitness", "relatorio_sonar"],
  );

  delete process.env.HOOK_REPROVA;
  await executarAutonomo(c.banco, 3, OPCOES);
  assert.equal(c.estado(3).ticket?.status, "concluido");
  assert.equal(c.commits().length, 1);
  c.banco.close();
});

test("ticket de desenvolvimento que não alterou nada falha, sem commit", async () => {
  const c = cenario();
  process.env.FALSO_PI_ESCREVE = "{}";
  await executarAutonomo(c.banco, 3, OPCOES);
  const { ticket } = c.estado(3);
  assert.equal(ticket?.status, "falhou");
  assert.equal(
    ticket.erro,
    "o ticket de desenvolvimento não alterou nenhum arquivo (reabra o ticket com uma instrução do que o agente deve mudar)",
  );
  assert.deepEqual(c.commits(), []);
  assert.ok(existsSync(c.worktree));
  c.banco.close();
});

test("retomada: o commit saiu, mas a transação do C7 falhou; a próxima execução emenda o commit e conclui", async () => {
  const c = cenario();
  const base = git(c.repo, "rev-parse", "main");
  c.banco.exec("CREATE TRIGGER falha BEFORE INSERT ON commit_ticket BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
  await executarAutonomo(c.banco, 3, OPCOES);
  assert.equal(c.estado(3).ticket?.erro, "disco cheio");
  assert.equal(git(c.worktree, "log", "-1", "--format=%s"), "fix: Cache na busca [I-1/T-3]");
  assert.deepEqual(c.commits(), [], "o commit não foi registrado: a transação do C7 voltou inteira");
  assert.equal(c.estado(3).ag.issue.fase, "desenvolvimento");

  c.banco.exec("DROP TRIGGER falha");
  c.reabrir(3);
  // O agente vê o trabalho pronto e não muda nada.
  process.env.FALSO_PI_ESCREVE = "{}";
  await executarAutonomo(c.banco, 3, OPCOES);

  assert.equal(c.estado(3).ticket?.status, "concluido", c.estado(3).ticket?.erro);
  const head = git(c.worktree, "rev-parse", "HEAD");
  assert.equal(git(c.worktree, "rev-parse", "HEAD~1"), base, "emendou o commit, não empilhou outro");
  assert.deepEqual(
    c.commits().map((l) => [l.sha, l.ticket]),
    [[head, 3]],
  );
  assert.deepEqual(
    c.arquivos(head).map((a) => a.caminho),
    ["busca.ts", "cache.ts"],
  );
  c.banco.close();
});

test("retomada com outro ticket por cima: T-4 conclui sobre o órfão de T-3, e T-3, reaberto, o adota", async () => {
  const c = cenario();
  c.banco.exec("CREATE TRIGGER falha BEFORE INSERT ON commit_ticket BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
  await executarAutonomo(c.banco, 3, OPCOES);
  const orfao = git(c.worktree, "rev-parse", "HEAD");
  c.banco.exec("DROP TRIGGER falha");

  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n" });
  await executarAutonomo(c.banco, 4, OPCOES);
  assert.equal(c.estado(4).ticket?.status, "concluido", c.estado(4).ticket?.erro);
  assert.equal(c.estado(4).ag.issue.fase, "desenvolvimento", "T-3 ainda falhou");

  c.reabrir(3);
  process.env.FALSO_PI_ESCREVE = "{}";
  await executarAutonomo(c.banco, 3, OPCOES);

  const { ag, ticket } = c.estado(3);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "revisao");
  assert.deepEqual(
    c.commits().map((l) => [l.ticket, l.sha === orfao]),
    [
      [3, true],
      [4, false],
    ],
  );
  assert.deepEqual(
    c.arquivos(orfao).map((a) => a.caminho),
    ["busca.ts", "cache.ts"],
  );
  assert.equal(git(c.worktree, "rev-list", "--count", "main..HEAD"), "2", "nenhum commit novo");
  c.banco.close();
});
