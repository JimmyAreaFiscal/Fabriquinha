// Ponta a ponta do ciclo do desenvolvimento, da revisão e do encerramento (F3 §7, F5 §4, §5, F1 §5.1) por
// `executarAutonomo`, contra banco real e git real, com falsos só para os binários externos: o pi, o sonar-scanner,
// o servidor do SonarQube e o gh.
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
import { pathToFileURL } from "node:url";
import { after, beforeEach, test } from "node:test";
import type { Ator } from "../dominio/agregado.ts";
import { iniciarExecucao, reabrirTicket, terminarExecucao } from "../dominio/execucao.ts";
import { decidirDesenho, decidirRegistro, enviarParaAprovacao } from "../dominio/gates.ts";
import { editarIssue } from "../dominio/issue.ts";
import { adicionarTicketDesenvolvimento } from "../dominio/tickets.ts";
import { submeter } from "../evidencias/submissao.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { hospedagemFalsa } from "../repositorio/hospedagem-falsa.test.ts";
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

/**
 * pi falso: no prompt, escreve na worktree os arquivos de $FALSO_PI_ESCREVE (JSON caminho → conteúdo, ou null para
 * apagar), roda o agente de $FALSO_PI_AGENTE, se houver, e assenta.
 */
const pi = join(base, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
import { rmSync, writeFileSync } from "node:fs";
if (process.argv.includes("--version")) {
  console.log("0.84.4-falso");
  process.exit(0);
}
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", async (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  if (!linhas.some((l) => JSON.parse(l).type === "prompt")) return;
  for (const [caminho, conteudo] of Object.entries(JSON.parse(process.env.FALSO_PI_ESCREVE))) {
    if (conteudo === null) rmSync(caminho);
    else writeFileSync(caminho, conteudo);
  }
  if (process.env.FALSO_PI_AGENTE) await (await import(process.env.FALSO_PI_AGENTE)).default();
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "message_end", message: { role: "assistant", content: [], stopReason: "stop" } });
  emitir({ type: "agent_settled" });
});
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

/**
 * Agente revisor falso: faz, pelos mesmos módulos que o CLI do agente chama (F7), o que a revisão pede ao agente.
 * Explica cada linha da matriz, comprova o CA-1 com um print (atendido conforme $FALSO_REVISAO), cria os tickets
 * pedidos e registra a decisão (C14).
 */
const src = (modulo: string) => pathToFileURL(join(import.meta.dirname, "..", modulo)).href;
const revisor = join(base, "revisor.mjs");
writeFileSync(
  revisor,
  `import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { abrir } = await import(${JSON.stringify(src("persistencia/banco.ts"))});
const { agregadoDoTicket, comIssue } = await import(${JSON.stringify(src("persistencia/issues.ts"))});
const { submeter } = await import(${JSON.stringify(src("evidencias/submissao.ts"))});
const { registrarDecisaoRevisao } = await import(${JSON.stringify(src("dominio/gates.ts"))});
const { adicionarTicketDesenvolvimento } = await import(${JSON.stringify(src("dominio/tickets.ts"))});
export default async function () {
  const plano = JSON.parse(process.env.FALSO_REVISAO);
  const banco = abrir(process.env.FABRIQUINHA_ROOT);
  const execucao = Number(process.env.FABRIQUINHA_EXECUCAO);
  const { ticket } = banco.prepare("SELECT ticket FROM execucao WHERE id = ?").get(execucao);
  const ator = { tipo: "agente", execucao, ticket };
  const ag = agregadoDoTicket(banco, ticket);
  const matriz = ag.evidencias.find((e) => e.ticket === ticket && e.tipo === "matriz_fitness");
  const explicacoes = matriz.dados.linhas.map((l) => ({ nome: l.nome, explicacao: "mede a busca" }));
  await submeter(banco, ator, "explicacao_fitness", { explicacoes }, []);
  const print = join(process.env.FABRIQUINHA_SAIDA, "ca-1.png");
  writeFileSync(print, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const criterio = { id: "CA-1", atendido: plano.atendido, comoVerificado: "busquei mil itens", arquivos: ["ca-1.png"] };
  await submeter(banco, ator, "comprovacao_criterios", { criterios: [criterio] }, [print]);
  for (const titulo of plano.tickets) {
    comIssue(banco, ag.issue.id, "adicionarTicketDesenvolvimento", ator, (a, ctx) =>
      adicionarTicketDesenvolvimento(a, { titulo }, ator, ctx),
    );
  }
  comIssue(banco, ag.issue.id, "registrarDecisaoRevisao", ator, (a, ctx) =>
    registrarDecisaoRevisao(a, { ticket, ...plano.decisao }, ator, ctx),
  );
  banco.close();
}
`,
);

/**
 * Agente do encerramento falso: submete a mensagem do PR, explicando os arquivos não previstos da última revisão, a
 * aula do código, com um trecho do busca.ts que a issue alterou, e o vídeo de demonstração.
 */
const encerrador = join(base, "encerrador.mjs");
writeFileSync(
  encerrador,
  `import { writeFileSync } from "node:fs";
import { join } from "node:path";
const { abrir } = await import(${JSON.stringify(src("persistencia/banco.ts"))});
const { agregadoDoTicket } = await import(${JSON.stringify(src("persistencia/issues.ts"))});
const { submeter } = await import(${JSON.stringify(src("evidencias/submissao.ts"))});
export default async function () {
  const banco = abrir(process.env.FABRIQUINHA_ROOT);
  const execucao = Number(process.env.FABRIQUINHA_EXECUCAO);
  const { ticket } = banco.prepare("SELECT ticket FROM execucao WHERE id = ?").get(execucao);
  const ator = { tipo: "agente", execucao, ticket };
  const alterados = agregadoDoTicket(banco, ticket).evidencias.findLast((e) => e.tipo === "arquivos_alterados");
  await submeter(banco, ator, "mensagem_pr", {
    titulo: "Responder a busca pelo cache",
    oQueMudou: "A busca lê do cache antes de varrer a tabela.",
    decisoesNaoObvias: [],
    naoFeito: ["invalidação por evento"],
    naoPrevistos: alterados.dados.arquivos
      .filter((a) => a.previsto === null)
      .map((a) => ({ caminho: a.caminho, motivo: "mede o cache" })),
    comoRevisar: ["Comece por busca.ts."],
    naoVerificado: [],
  }, []);
  await submeter(banco, ator, "aula_codigo", {
    trechos: [{
      arquivo: "busca.ts",
      inicio: 1,
      fim: 1,
      oQueFaz: "a busca lê do cache",
      porQue: "a tabela é grande, e a mesma busca se repete",
      decisaoDoDesenho: "cache na busca",
    }],
  }, []);
  const video = join(process.env.FABRIQUINHA_SAIDA, "demonstracao.webm");
  writeFileSync(video, Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01]));
  await submeter(banco, ator, "video_demonstracao", { roteiro: "mostro a busca" }, [video]);
  banco.close();
}
`,
);

// sonar-scanner falso no PATH: só informa a tarefa do Compute Engine.
mkdirSync(join(base, "bin"));
writeFileSync(
  join(base, "bin", "sonar-scanner"),
  `#!/bin/sh
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; esac; done
printf 'ceTaskId=AX1\\n' > "$w/report-task.txt"
`,
);
chmodSync(join(base, "bin", "sonar-scanner"), 0o755);
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

const hospedagem = hospedagemFalsa(base);

beforeEach(() => {
  hospedagem.zerar();
  issuesSonar = [];
  analises = 0;
  delete process.env.SAIDA_TESTES;
  delete process.env.SAIDA_FITNESS;
  delete process.env.HOOK_REPROVA;
  delete process.env.FALSO_PI_AGENTE;
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "busca.ts": "export const busca = cache;\n", "cache.ts": "1\n" });
});

const auditor: Ator = { tipo: "auditor" };
const fabriquinha: Ator = { tipo: "fabriquinha" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const OPCOES = { timeoutMin: 1 };

let n = 0;
/**
 * Projeto `loja` com `origin` bare real, testes e fitness falsos que saem com $SAIDA_TESTES e $SAIDA_FITNESS, e um
 * pre-commit que guarda o ambiente e reprova com $HOOK_REPROVA. A I-1 (problema) chega ao desenvolvimento pelos
 * comandos reais: registro aprovado, desenho T-2 concluído com os tickets T-3 e T-4, desenho aprovado.
 */
async function cenario() {
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
  await submeter(banco, registrador, "comportamento", { descricao: "a busca varre tudo", comoReproduzir: ["buscar"] }, [
    saida(1, "busca.log", "8 s\n"),
  ]);
  await submeter(
    banco,
    registrador,
    "criterios_aceite",
    { criterios: [{ id: "CA-1", dado: "mil itens", quando: "busco", entao: "responde em 1 s" }] },
    [],
  );
  comIssue(banco, 1, "editarIssue", auditor, (ag) =>
    editarIssue(ag, { titulo: "Busca lenta", tipo: "problema" }, auditor),
  );
  comIssue(banco, 1, "enviarParaAprovacao", registrador, (ag, ctx) =>
    enviarParaAprovacao(ag, { ticket: 1 }, registrador, ctx),
  );
  terminar(1);
  comIssue(banco, 1, "decidirRegistro", auditor, (ag, ctx) => decidirRegistro(ag, { aprovado: true }, auditor, ctx));

  executar(2, "interativo");
  const desenhista: Ator = { tipo: "agente", execucao: 2, ticket: 2 };
  const html = (nome: string) => [saida(2, nome, `<!DOCTYPE html><html><body>${nome}</body></html>`)];
  await submeter(
    banco,
    desenhista,
    "desenho_solucao",
    {
      resumo: "cache na busca",
      arquivosPrevistos: [
        { caminho: "busca.ts", acao: "alterar", motivo: "lê do cache" },
        { caminho: "cache*.ts", acao: "criar", motivo: "o cache" },
        { caminho: "docs/**", acao: "alterar", motivo: "documenta o cache" },
      ],
    },
    html("desenho.html"),
  );
  await submeter(
    banco,
    desenhista,
    "relatorio_complexidade",
    {
      variaveis: [{ simbolo: "n", significado: "itens" }],
      fluxos: [{ nome: "Busca", gatilho: "GET /busca", situacao: "novo", depois: { tempo: "O(1)", espaco: "O(n)" } }],
    },
    html("fluxos.html"),
  );
  await submeter(
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
  comIssue(banco, 1, "enviarParaAprovacao", desenhista, (ag, ctx) =>
    enviarParaAprovacao(ag, { ticket: 2 }, desenhista, ctx),
  );
  terminar(2);
  comIssue(banco, 1, "decidirDesenho", auditor, (ag, ctx) => decidirDesenho(ag, { aprovado: true }, auditor, ctx));

  return {
    raiz,
    banco,
    repo,
    bare,
    worktree: caminhoDaWorktree(raiz, "loja", 1),
    ambienteDoHook,
    /** O ticket e a fase da issue, lidos do banco. */
    estado(ticket: number) {
      const ag = agregado(banco, 1);
      assert.ok(ag);
      return { ag, ticket: ag.tickets.find((t) => t.id === ticket) };
    },
    commits: () => banco.prepare("SELECT * FROM commit_ticket ORDER BY ticket").all(),
    retrabalho: () =>
      banco
        .prepare("SELECT * FROM retrabalho")
        .all()
        .map((l) => ({ ...l })),
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
  const c = await cenario();
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
  // A worktree nasceu buscando a base, e a varredura de commits humanos fixou o cursor nela (F6 §4.4).
  assert.deepEqual(
    { ...c.banco.prepare("SELECT projeto, ultimo_sha FROM varredura_base").get() },
    { projeto: "loja", ultimo_sha: base },
  );
  // O hook rodou, sem credenciais.
  const ambiente = readFileSync(c.ambienteDoHook, "utf8");
  assert.match(ambiente, /^GH_CONFIG_DIR=/m);
  assert.doesNotMatch(ambiente, /segredo/);
  // O agente recebeu o contexto do desenvolvimento.
  const prompt = readFileSync(join(c.raiz, "execucoes", "E-3", "prompt.md"), "utf8");
  assert.match(prompt, /## Desenho aprovado\n\ncache na busca\n/);
  assert.match(prompt, /## Arquivos previstos\n\n- `busca\.ts` \(alterar\): lê do cache\n/);

  // O último ticket de desenvolvimento leva a issue à revisão, com o ticket de revisão novo; ele reescreve a linha
  // de cache.ts que T-3 escreveu, e o retrabalho é registrado depois do commit (F5 §4, passo 5).
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n", "cache.ts": "3\n" });
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
    { caminho: "cache.ts", caminho_anterior: null, status: "M", adicionadas: 1, removidas: 1 },
    { caminho: "metrica.ts", caminho_anterior: null, status: "A", adicionadas: 1, removidas: 0 },
  ]);
  assert.deepEqual(c.retrabalho(), [
    { commit_alterador: commit4.sha, ticket: 4, autor: null, ticket_origem: 3, linhas: 1 },
  ]);
  c.banco.close();
});

test("a cadeia para no primeiro reprovado e devolve o ticket ao agente, sem commit; na terceira reprovação seguida, falha", async () => {
  const c = await cenario();
  const reprovou = (tipo: string) =>
    `a evidência ${tipo} de T-3 reprovou (veja o que reprovou com fabriquinha evidencia ver T-3 ${tipo} e execute o ticket de novo)`;
  const semCommit = (tipos: string[]) => {
    assert.deepEqual(
      c
        .estado(3)
        .ag.evidencias.filter((e) => e.ticket === 3)
        .map((e) => e.tipo),
      tipos,
    );
    assert.deepEqual(c.commits(), []);
    assert.equal(git(c.worktree, "rev-parse", "HEAD"), git(c.repo, "rev-parse", "main"), "nada foi commitado");
  };
  const devolveu = async (execucao: number, motivo: string, tipos: string[]) => {
    await executarAutonomo(c.banco, 3, OPCOES);
    const { ticket } = c.estado(3);
    assert.equal(ticket?.status, "aberto");
    assert.equal(ticket.devolucoes, execucao);
    assert.equal(
      ticket.instrucao,
      `A Fabriquinha devolveu T-3 pela ${String(execucao)}ª vez de 2: ${motivo}. ` +
        "Corrija o código na worktree e termine de novo; não faça commit.",
    );
    semCommit(tipos);
  };
  const falhou = async (motivo: string, tipos: string[]) => {
    await executarAutonomo(c.banco, 3, OPCOES);
    const { ticket } = c.estado(3);
    assert.equal(ticket?.status, "falhou");
    assert.equal(ticket.erro, motivo);
    semCommit(tipos);
    c.reabrir(3);
  };

  process.env.SAIDA_TESTES = "1";
  await devolveu(1, reprovou("execucao_testes"), ["execucao_testes"]);
  assert.equal(analises, 0);

  delete process.env.SAIDA_TESTES;
  process.env.SAIDA_FITNESS = "1";
  await devolveu(2, reprovou("matriz_fitness"), ["execucao_testes", "matriz_fitness"]);
  assert.equal(analises, 0, "o SonarQube não roda depois da fitness reprovada");

  delete process.env.SAIDA_FITNESS;
  issuesSonar = [{ component: "loja:cache.ts", rule: "ts:S1", severity: "MAJOR", message: "ruim" }];
  await falhou(reprovou("relatorio_sonar"), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);

  issuesSonar = [];
  process.env.HOOK_REPROVA = "1";
  // O C9 do Auditor zerou as devoluções: o hook que reprova devolve de novo.
  await devolveu(
    1,
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

test("T-4 não executa com T-3 devolvido: o trabalho de T-3 sem commit não vai para o commit de outro ticket", async () => {
  const c = await cenario();
  issuesSonar = [{ component: "loja:cache.ts", rule: "ts:S1", severity: "MAJOR", message: "ruim" }];
  await executarAutonomo(c.banco, 3, OPCOES);
  assert.equal(c.estado(3).ticket?.status, "aberto");
  issuesSonar = [];

  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n" });
  await assert.rejects(executarAutonomo(c.banco, 4, OPCOES), {
    message:
      "T-4 só executa depois dos tickets de desenvolvimento anteriores da I-1, e T-3 está aberto " +
      "(conclua T-3 antes)",
  });
  assert.equal(c.estado(4).ticket?.status, "aberto");

  process.env.FALSO_PI_ESCREVE = "{}";
  await executarAutonomo(c.banco, 3, OPCOES);
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n" });
  await executarAutonomo(c.banco, 4, OPCOES);
  const [t3, t4] = c.commits();
  assert.deepEqual(
    [c.arquivos(t3?.sha).map((a) => a.caminho), c.arquivos(t4?.sha).map((a) => a.caminho)],
    [["busca.ts", "cache.ts"], ["metrica.ts"]],
  );
  c.banco.close();
});

test("falha em registrarRetrabalho só vai para o log: o ticket conclui", async () => {
  const c = await cenario();
  c.banco.exec("CREATE TRIGGER falha BEFORE INSERT ON retrabalho BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;");
  await executarAutonomo(c.banco, 3, OPCOES);
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "cache.ts": "3\n" });
  await executarAutonomo(c.banco, 4, OPCOES);

  assert.equal(c.estado(4).ticket?.status, "concluido", c.estado(4).ticket?.erro);
  assert.equal(c.estado(4).ag.issue.fase, "revisao");
  assert.deepEqual(c.retrabalho(), []);
  assert.match(
    readFileSync(join(c.raiz, "execucoes", "E-4", "log"), "utf8"),
    / registrarRetrabalho falhou: disco cheio\n/,
  );
  c.banco.close();
});

test("ticket de desenvolvimento cujo trabalho já estava na branch conclui com um commit vazio", async () => {
  const c = await cenario();
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "cache.ts": "1\n", "metrica.ts": "2\n" });
  await executarAutonomo(c.banco, 3, OPCOES);
  process.env.FALSO_PI_ESCREVE = "{}";
  await executarAutonomo(c.banco, 4, OPCOES);

  const { ag, ticket } = c.estado(4);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "revisao");
  const head = git(c.worktree, "rev-parse", "HEAD");
  assert.equal(git(c.worktree, "log", "-1", "--format=%s"), "fix: Métrica do cache [I-1/T-4]");
  assert.deepEqual(
    c.commits().map((l) => [l.ticket, l.sha === head]),
    [
      [3, false],
      [4, true],
    ],
  );
  assert.deepEqual(c.arquivos(head), []);
  c.banco.close();
});

test("retomada: o commit saiu, mas a transação do C7 falhou; a próxima execução emenda o commit e conclui", async () => {
  const c = await cenario();
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

/**
 * Leva a I-1 do cenário à revisão pelos dois tickets de desenvolvimento reais; o T-5 é a revisão. `escreveT3`: o que
 * o pi do T-3 muda na worktree, no formato de $FALSO_PI_ESCREVE.
 */
async function naRevisao(escreveT3?: Record<string, string | null>) {
  const c = await cenario();
  if (escreveT3) process.env.FALSO_PI_ESCREVE = JSON.stringify(escreveT3);
  await executarAutonomo(c.banco, 3, OPCOES);
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "metrica.ts": "2\n" });
  await executarAutonomo(c.banco, 4, OPCOES);
  assert.equal(c.estado(4).ag.issue.fase, "revisao");
  // O revisor mexe na worktree (o que o descarte desfaz) e age pelo agente falso.
  process.env.FALSO_PI_ESCREVE = JSON.stringify({
    "busca.ts": "export const busca = gambiarra;\n",
    "rascunho.txt": "x",
  });
  process.env.FALSO_PI_AGENTE = revisor;
  const planejar = (plano: { atendido: boolean; tickets: string[]; decisao: object }) => {
    process.env.FALSO_REVISAO = JSON.stringify(plano);
  };
  const daRevisao = () => c.estado(5).ag.evidencias.filter((e) => e.ticket === 5);
  return { ...c, planejar, daRevisao };
}

test("revisão aprovada: arquivos alterados × desenho e fitness antes do pi, evidências do agente, descarte e encerramento", async () => {
  const c = await naRevisao();
  c.planejar({ atendido: true, tickets: [], decisao: { aprovado: true } });

  await executarAutonomo(c.banco, 5, OPCOES);

  const { ag, ticket } = c.estado(5);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "encerramento");
  assert.deepEqual(
    ag.tickets.filter((t) => t.etapa === "encerramento").map((t) => [t.id, t.status, t.titulo]),
    [[6, "aberto", "Publicar o PR"]],
  );
  assert.deepEqual(
    ag.decisoes.filter((d) => d.gate === "revisao").map((d) => [d.ticket, d.aprovado, d.por]),
    [[5, true, "agente"]],
  );
  assert.deepEqual(
    c.daRevisao().map((e) => [e.tipo, e.produtor, e.aprovada]),
    [
      ["arquivos_alterados", "fabriquinha", undefined],
      ["matriz_fitness", "fabriquinha", true],
      ["explicacao_fitness", "agente", undefined],
      ["comprovacao_criterios", "agente", true],
    ],
  );
  // O diff vai do merge-base com origin/main até a HEAD, cruzado com os padrões do desenho por path.matchesGlob.
  assert.deepEqual(c.daRevisao()[0]?.dados, {
    base: git(c.repo, "rev-parse", "main"),
    head: git(c.worktree, "rev-parse", "HEAD"),
    arquivos: [
      { caminho: "busca.ts", status: "M", adicionadas: 1, removidas: 1, previsto: "busca.ts" },
      { caminho: "cache.ts", status: "A", adicionadas: 1, removidas: 0, previsto: "cache*.ts" },
      { caminho: "metrica.ts", status: "A", adicionadas: 1, removidas: 0, previsto: null },
    ],
    previstosNaoTocados: ["docs/**"],
  });
  // O agente recebeu o que foi coletado antes do pi.
  const prompt = readFileSync(join(c.raiz, "execucoes", "E-5", "prompt.md"), "utf8");
  assert.match(
    prompt,
    /## Arquivos alterados × desenho\n\n- `busca\.ts` \(M, \+1 −1\): previsto por `busca\.ts`\n[\s\S]*- `metrica\.ts` \(A, \+1 −0\): não previsto\n/,
  );
  assert.match(prompt, /## Previstos e não tocados\n\n- `docs\/\*\*`\n/);
  assert.match(prompt, /## Fitness functions\n\n- \*\*complexidade\*\* \(d\): passou\n/);
  // A revisão não muda código: o que o agente alterou foi descartado depois das evidências guardadas.
  assert.equal(git(c.worktree, "status", "--porcelain"), "");
  assert.equal(readFileSync(join(c.worktree, "busca.ts"), "utf8"), "export const busca = cache;\n");
  const log = readFileSync(join(c.raiz, "execucoes", "E-5", "log"), "utf8");
  assert.match(log, /descarte removeu: rascunho\.txt/);
  assert.match(
    log,
    /coleta antes do pi: arquivos_alterados\n.*coleta antes do pi: arquivos_alterados registrada\n.*coleta antes do pi: matriz_fitness\n[\s\S]*coleta antes do pi: matriz_fitness registrada\n/,
  );
  c.banco.close();
});

test("arquivos alterados: a renomeação casa também pelo caminho anterior, que deixa de ser previsto e não tocado", async () => {
  const c = await naRevisao({ "busca.ts": null, "procura.ts": "export const busca = varrer;\n", "cache.ts": "1\n" });
  c.planejar({ atendido: true, tickets: [], decisao: { aprovado: true } });

  await executarAutonomo(c.banco, 5, OPCOES);

  assert.equal(c.estado(5).ticket?.status, "concluido", c.estado(5).ticket?.erro);
  const dados = c.daRevisao().find((e) => e.tipo === "arquivos_alterados")?.dados as {
    arquivos: { caminho: string }[];
    previstosNaoTocados: string[];
  };
  assert.deepEqual(
    dados.arquivos.find((a) => a.caminho === "procura.ts"),
    {
      caminho: "procura.ts",
      status: "R",
      adicionadas: 0,
      removidas: 0,
      previsto: "busca.ts",
    },
  );
  assert.deepEqual(dados.previstosNaoTocados, ["docs/**"]);
  c.banco.close();
});

test("revisão que aprova com fitness reprovada falha e perde a decisão (C8); reaberta, reprova criando ticket", async () => {
  const c = await naRevisao();
  process.env.SAIDA_FITNESS = "1";
  c.planejar({ atendido: true, tickets: [], decisao: { aprovado: true } });

  await executarAutonomo(c.banco, 5, OPCOES);

  let { ag, ticket } = c.estado(5);
  assert.equal(ticket?.status, "falhou");
  assert.equal(
    ticket.erro,
    "T-5 não pode concluir: a revisão aprovou com fitness function reprovada " +
      "(o agente de T-5 reprova a revisão e cria um ticket de desenvolvimento para cada exigência)",
  );
  assert.equal(c.daRevisao().find((e) => e.tipo === "matriz_fitness")?.aprovada, false);
  assert.deepEqual(
    ag.decisoes.filter((d) => d.gate === "revisao"),
    [],
    "C8 removeu a decisão da revisão que falhou",
  );
  assert.equal(git(c.worktree, "status", "--porcelain"), "", "o descarte rodou antes do C7");

  c.reabrir(5);
  c.planejar({
    atendido: true,
    tickets: ["Reduzir a complexidade da busca"],
    decisao: { aprovado: false, motivo: "a fitness complexidade reprovou" },
  });
  await executarAutonomo(c.banco, 5, OPCOES);

  ({ ag, ticket } = c.estado(5));
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "desenvolvimento");
  assert.deepEqual(
    ag.tickets.filter((t) => t.id > 5).map((t) => [t.id, t.etapa, t.status, t.origem, t.origemTicket, t.titulo]),
    [[6, "desenvolvimento", "aberto", "agente", 5, "Reduzir a complexidade da busca"]],
  );
  assert.deepEqual(
    ag.decisoes.filter((d) => d.gate === "revisao").map((d) => [d.ticket, d.aprovado, d.motivo]),
    [[5, false, "a fitness complexidade reprovou"]],
  );
  c.banco.close();
});

test("falha antes do pi da revisão: execução e ticket falham, sem execução órfã nem pi; reaberta, conclui", async () => {
  const c = await naRevisao();
  c.planejar({ atendido: true, tickets: [], decisao: { aprovado: true } });
  c.banco.exec(
    `CREATE TRIGGER falha BEFORE INSERT ON evidencia WHEN NEW.tipo = 'arquivos_alterados'
     BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;`,
  );

  await executarAutonomo(c.banco, 5, OPCOES);

  const { ag, ticket } = c.estado(5);
  assert.equal(ticket?.status, "falhou");
  assert.equal(ticket.erro, "disco cheio");
  assert.deepEqual(
    ag.execucoes.filter((e) => e.ticket === 5).map((e) => [e.resultado, e.erro]),
    [["falha", "disco cheio"]],
  );
  assert.ok(!existsSync(join(c.raiz, "execucoes", "E-5", "prompt.md")), "o pi não foi lançado");
  assert.deepEqual(c.daRevisao(), []);

  c.banco.exec("DROP TRIGGER falha");
  c.reabrir(5);
  await executarAutonomo(c.banco, 5, OPCOES);
  assert.equal(c.estado(5).ticket?.status, "concluido", c.estado(5).ticket?.erro);
  c.banco.close();
});

/** Leva a I-1 ao encerramento pela revisão aprovada; o T-6 é o encerramento, com o agente falso do encerramento. */
async function noEncerramento() {
  const c = await naRevisao();
  c.planejar({ atendido: true, tickets: [], decisao: { aprovado: true } });
  await executarAutonomo(c.banco, 5, OPCOES);
  assert.equal(c.estado(5).ag.issue.fase, "encerramento");
  // O encerrador deixa lixo na worktree, que não pode subir no PR.
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "lixo.txt": "x", "busca.ts": "quebrado\n" });
  process.env.FALSO_PI_AGENTE = encerrador;
  const doEncerramento = () => c.estado(6).ag.evidencias.filter((e) => e.ticket === 6);
  const anexo = (tipo: string) => {
    const a = doEncerramento().find((e) => e.tipo === tipo)?.arquivos[0];
    assert.ok(a);
    return { ...a, conteudo: readFileSync(caminhoArquivo(c.banco, a.sha256), "utf8") };
  };
  const publicado = () => git(c.bare, "for-each-ref", "--format=%(objectname)", "refs/heads/fabriquinha/I-1");
  return { ...c, doEncerramento, anexo, publicado };
}

test("encerramento: descarte, relatório de produtividade, push, PR padronizado no GitHub, pr_aberto e aprovacao_pr", async () => {
  const c = await noEncerramento();
  const head = git(c.worktree, "rev-parse", "HEAD");

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "aprovacao_pr");
  assert.deepEqual(
    c.doEncerramento().map((e) => [e.tipo, e.produtor]),
    [
      ["mensagem_pr", "agente"],
      ["aula_codigo", "agente"],
      ["video_demonstracao", "agente"],
      ["relatorio_produtividade", "fabriquinha"],
      ["pr_aberto", "fabriquinha"],
    ],
  );
  // O lixo do agente foi descartado: a branch publicada é a do último commit do desenvolvimento.
  assert.equal(git(c.worktree, "status", "--porcelain"), "");
  assert.equal(c.publicado(), head);

  const [pr] = hospedagem.prs();
  assert.ok(pr);
  assert.deepEqual(
    { ...pr, corpo: undefined },
    {
      id: 1,
      head: "fabriquinha/I-1",
      base: "main",
      titulo: "fix: Responder a busca pelo cache [I-1]",
      corpo: undefined,
      estado: "aberto",
    },
  );
  assert.deepEqual(c.doEncerramento().find((e) => e.tipo === "pr_aberto")?.dados, {
    hospedagem: "github",
    id: "1",
    url: "https://github.com/org/loja/pull/1",
    branch: "fabriquinha/I-1",
    base: "main",
    head,
    condensado: false,
  });
  // O corpo completo fica anexado ao pr_aberto; aqui, abaixo do limite do GitHub, é o mesmo publicado.
  const corpo = c.anexo("pr_aberto");
  assert.equal(corpo.nome, "pr.md");
  assert.equal(corpo.mime, "text/plain; charset=utf-8");
  assert.equal(corpo.conteudo, pr.corpo);
  assert.deepEqual(
    [...pr.corpo.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
    [
      "Por quê",
      "O que mudou",
      "Decisões não óbvias",
      "Fora do escopo",
      "Arquivos alterados × desenho",
      "Como revisar",
      "Evidências",
      "Não verificado",
      "Riscos e reversão",
      "Autoria e custo",
    ],
  );
  assert.ok(pr.corpo.startsWith("<!-- fabriquinha I-1/T-6 -->\n\n## Por quê\n\n**Problema:** Busca lenta\n"));
  assert.match(pr.corpo, /\| `metrica\.ts` \| A \| \+1 −0 \| não previsto: mede o cache \|/);
  assert.match(
    pr.corpo,
    /- I-1 · aula_codigo · aula\.html\n- I-1 · video_demonstracao · demonstracao\.webm\n- I-1 · relatorio_produtividade · relatorio\.html/,
  );
  // A aula: o código lido do git, com a linha alterada marcada, e a explicação do agente.
  const aula = c.anexo("aula_codigo");
  assert.equal(aula.mime, "text/html; charset=utf-8");
  assert.match(aula.conteudo, /^<!doctype html>/);
  assert.match(
    aula.conteudo,
    /<tr class="mudou"><td class="n">1<\/td><td class="m">\+<\/td><td class="c">export const busca = cache;<\/td><\/tr>/,
  );
  assert.match(aula.conteudo, /<dt>Por que assim<\/dt><dd>a tabela é grande, e a mesma busca se repete<\/dd>/);

  const relatorio = c.anexo("relatorio_produtividade");
  assert.equal(relatorio.mime, "text/html; charset=utf-8");
  assert.match(relatorio.conteudo, /^<!doctype html>/);
  assert.equal(c.doEncerramento().find((e) => e.tipo === "relatorio_produtividade")?.dados.issue, 1);
  // O gh rodou com a credencial do serviço.
  assert.ok(hospedagem.chamadas().every((ch) => ch.cli === "gh" && ch.token === "segredo-gh"));
  const log = readFileSync(join(c.raiz, "execucoes", "E-6", "log"), "utf8");
  assert.match(log, /descarte removeu: lixo\.txt/);
  assert.match(
    log,
    /relatorio_produtividade registrado\n.*PR publicado: https:\/\/github\.com\/org\/loja\/pull\/1\n.*pr_aberto registrado\n/,
  );
  c.banco.close();
});

test("encerramento: o PR saiu, mas o registro de pr_aberto falhou; reaberto, o ticket adota o próprio PR e conclui", async () => {
  const c = await noEncerramento();
  c.banco.exec(
    `CREATE TRIGGER falha BEFORE INSERT ON evidencia WHEN NEW.tipo = 'pr_aberto'
     BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;`,
  );
  await executarAutonomo(c.banco, 6, OPCOES);
  assert.equal(c.estado(6).ticket?.erro, "disco cheio");
  assert.equal(hospedagem.prs().length, 1, "o PR saiu");

  c.banco.exec("DROP TRIGGER falha");
  c.reabrir(6);
  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "aprovacao_pr");
  assert.equal(hospedagem.prs().length, 1, "nenhum PR novo");
  assert.equal(c.doEncerramento().find((e) => e.tipo === "pr_aberto")?.dados.id, "1");
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args.slice(0, 2).join(" ")),
    ["pr list", "pr create", "pr list", "api repos/{owner}/{repo}/pulls/1", "pr view"],
  );
  c.banco.close();
});

test("encerramento: PR da branch criado fora da Fabriquinha faz o ticket falhar sem publicar nada", async () => {
  const c = await noEncerramento();
  hospedagem.abrir({ head: "fabriquinha/I-1", base: "main", titulo: "pelo agente", corpo: "", estado: "aberto" });

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "falhou");
  assert.equal(
    ticket.erro,
    "PR criado fora da Fabriquinha: https://github.com/org/loja/pull/1 (feche-o e reabra o ticket)",
  );
  assert.equal(ag.issue.fase, "encerramento");
  assert.equal(c.publicado(), "");
  c.banco.close();
});

test("encerramento: o C7 falhou depois do pr_aberto; reaberto, o ticket atualiza o mesmo PR, já conhecido", async () => {
  const c = await noEncerramento();
  c.banco.exec(
    `CREATE TRIGGER falha BEFORE UPDATE OF status ON ticket WHEN NEW.id = 6 AND NEW.status = 'concluido'
     BEGIN SELECT RAISE(ABORT, 'disco cheio'); END;`,
  );
  await executarAutonomo(c.banco, 6, OPCOES);
  assert.equal(c.estado(6).ticket?.erro, "disco cheio");
  assert.equal(c.doEncerramento().find((e) => e.tipo === "pr_aberto")?.dados.id, "1");
  // O Auditor fechou o PR na plataforma enquanto isso.
  hospedagem.mudar(1, { estado: "fechado", corpo: "editado à mão" });

  c.banco.exec("DROP TRIGGER falha");
  c.reabrir(6);
  await executarAutonomo(c.banco, 6, OPCOES);

  assert.equal(c.estado(6).ticket?.status, "concluido", c.estado(6).ticket?.erro);
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.id, p.estado, p.corpo.startsWith("<!-- fabriquinha I-1/T-6 -->")]),
    [[1, "aberto", true]],
  );
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args.slice(0, 2).join(" ")),
    ["pr list", "pr create", "pr view", "pr list", "pr reopen", "api repos/{owner}/{repo}/pulls/1", "pr view"],
  );
  c.banco.close();
});

test("encerramento: commit de agente fora do desenvolvimento na branch faz o ticket falhar sem publicar nada", async () => {
  const c = await noEncerramento();
  // O revisor commitou por conta própria; o descarte não desfaz commit.
  writeFileSync(join(c.worktree, "busca.ts"), "export const busca = gambiarra;\n");
  git(c.worktree, "commit", "-q", "-am", "ajuste do revisor");
  const sha = git(c.worktree, "rev-parse", "HEAD");

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ticket } = c.estado(6);
  assert.equal(ticket?.status, "falhou");
  assert.equal(
    ticket.erro,
    `a branch fabriquinha/I-1 está no commit ${sha.slice(0, 12)}, que nenhum ticket de desenvolvimento da I-1 ` +
      "registrou: um agente commitou fora do desenvolvimento, e esse commit não sobe no PR " +
      `(desfaça com git -C ${c.worktree} reset --hard HEAD~1, repetindo até a HEAD ser um commit [I-1/T-<m>] ` +
      "da Fabriquinha, e reabra o ticket)",
  );
  assert.equal(c.publicado(), "");
  assert.deepEqual(hospedagem.prs(), []);

  git(c.worktree, "reset", "-q", "--hard", "HEAD~1");
  c.reabrir(6);
  await executarAutonomo(c.banco, 6, OPCOES);
  assert.equal(c.estado(6).ticket?.status, "concluido", c.estado(6).ticket?.erro);
  assert.equal(c.publicado(), git(c.worktree, "rev-parse", "HEAD"));
  c.banco.close();
});

/** O que o `gh pr view --json mergeable,statusCheckRollup` responde; o PR do teste ainda não existe quando o gh é programado. */
const situacaoGh = (mergeable: string, checks: { name: string; conclusion: string }[]) =>
  JSON.stringify({
    mergeable,
    statusCheckRollup: checks.map((c) => ({ __typename: "CheckRun", status: "COMPLETED", ...c })),
  });
const LIMPO = situacaoGh("MERGEABLE", [{ name: "ci", conclusion: "SUCCESS" }]);

test("encerramento: PR com conflito com a base volta a desenvolvimento com o ticket novo, sem o gate", async () => {
  const c = await noEncerramento();
  hospedagem.responder("pr view", situacaoGh("CONFLICTING", []));

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "desenvolvimento");
  const novo = ag.tickets.find((t) => t.id === 7);
  assert.deepEqual([novo?.etapa, novo?.status, novo?.origem], ["desenvolvimento", "aberto", "fabriquinha"]);
  assert.equal(novo?.titulo, "Resolver o conflito do PR com a branch base main");
  assert.match(novo.descricao, /https:\/\/github\.com\/org\/loja\/pull\/1 tem conflito com a branch base main/);
  assert.match(novo.descricao, /`git fetch origin main` e `git merge --no-commit origin\/main`/);
  assert.match(readFileSync(join(c.raiz, "execucoes", "E-6", "log"), "utf8"), /PR verificado: com conflito/);
  c.banco.close();
});

test("encerramento: check de CI falho volta a desenvolvimento com o ticket que lista o check e o link", async () => {
  const c = await noEncerramento();
  hospedagem.responder("pr view", situacaoGh("MERGEABLE", [{ name: "build", conclusion: "FAILURE" }]));

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "desenvolvimento");
  const novo = ag.tickets.find((t) => t.id === 7);
  assert.deepEqual([novo?.etapa, novo?.origem], ["desenvolvimento", "fabriquinha"]);
  assert.equal(novo?.titulo, "Corrigir os checks de CI falhos do PR: build");
  assert.match(novo.descricao, /https:\/\/github\.com\/org\/loja\/pull\/1/);
  assert.match(novo.descricao, /- build$/m);
  assert.match(readFileSync(join(c.raiz, "execucoes", "E-6", "log"), "utf8"), /PR verificado: 1 check\(s\) falho\(s\)/);
  c.banco.close();
});

test("encerramento: o gh falhando ao consultar o PR deixa o ticket falhou com a saída, sem o gate", async () => {
  const c = await noEncerramento();
  hospedagem.falhar("pr view", "gh: não autenticado");

  await executarAutonomo(c.banco, 6, OPCOES);

  const { ag, ticket } = c.estado(6);
  assert.equal(ticket?.status, "falhou");
  assert.match(ticket.erro ?? "", /gh pr view saiu com código 1: gh: não autenticado/);
  assert.match(ticket.erro ?? "", /execute o ticket de novo/);
  assert.equal(ag.issue.fase, "encerramento");
  c.banco.close();
});

test("a volta por conflito: desenvolvimento, revisão e encerramento chegam ao gate sem decisão do Auditor", async () => {
  const c = await noEncerramento();
  hospedagem.responder("pr view", situacaoGh("CONFLICTING", []));
  await executarAutonomo(c.banco, 6, OPCOES);
  assert.equal(c.estado(7).ag.issue.fase, "desenvolvimento");

  // O desenvolvimento resolve o conflito; a revisão aprova; o encerramento atualiza o PR, agora limpo.
  delete process.env.FALSO_PI_AGENTE;
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "merge.ts": "2\n" });
  await executarAutonomo(c.banco, 7, OPCOES);
  assert.equal(c.estado(7).ticket?.status, "concluido", c.estado(7).ticket?.erro);
  assert.equal(c.estado(7).ag.issue.fase, "revisao");
  process.env.FALSO_PI_ESCREVE = JSON.stringify({ "rascunho.txt": "x" });
  process.env.FALSO_PI_AGENTE = revisor;
  process.env.FALSO_REVISAO = JSON.stringify({ atendido: true, tickets: [], decisao: { aprovado: true } });
  await executarAutonomo(c.banco, 8, OPCOES);
  assert.equal(c.estado(8).ticket?.status, "concluido", c.estado(8).ticket?.erro);
  assert.equal(c.estado(8).ag.issue.fase, "encerramento");
  process.env.FALSO_PI_AGENTE = encerrador;
  hospedagem.responder("pr view", LIMPO);
  await executarAutonomo(c.banco, 9, OPCOES);

  const { ag, ticket } = c.estado(9);
  assert.equal(ticket?.status, "concluido", ticket?.erro);
  assert.equal(ag.issue.fase, "aprovacao_pr");
  assert.equal(hospedagem.prs().length, 1, "o mesmo PR, atualizado");
  assert.deepEqual(
    ag.decisoes.filter((d) => d.gate === "pr"),
    [],
  );
  c.banco.close();
});
