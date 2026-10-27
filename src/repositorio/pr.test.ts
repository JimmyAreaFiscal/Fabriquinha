import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { setTimeout as esperar } from "node:timers/promises";
import { ErroDeRegra, ErroExterno } from "../dominio/erros.ts";
import type { Hospedagem } from "../dominio/projeto.ts";
import { hospedagemFalsa } from "./hospedagem-falsa.test.ts";
import { estadoPR, integrarPR, lerPR, publicarPR, publicarPRDe, verificarPR } from "./pr.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-pr-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";
// A credencial do serviço, que os comandos de PR precisam ver (F5 §5.0).
process.env.GH_TOKEN = "token-do-servico";

const hospedagem = hospedagemFalsa(base);
beforeEach(() => {
  hospedagem.zerar();
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const MARCA = "<!-- fabriquinha I-1/T-6 -->";
const BRANCH = "fabriquinha/I-1";
const URL_GH = "https://github.com/org/loja/pull/";
const URL_AZ = "https://dev.azure.com/org/loja/_git/loja/pullrequest/";

let n = 0;
/** Clone com `origin` bare, `main` publicada e a branch da issue com um commit só local. */
function cenario(tipo: Hospedagem = "github") {
  const dir = join(base, `c${String(++n)}`);
  const bare = join(dir, "origin.git");
  const repo = join(dir, "repo");
  mkdirSync(dir);
  git(base, "init", "-q", "--bare", bare);
  git(base, "clone", "-q", bare, repo);
  git(repo, "checkout", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "1\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "push", "-q", "origin", "main");
  git(repo, "checkout", "-q", "-b", BRANCH);
  writeFileSync(join(repo, "a.ts"), "2\n");
  git(repo, "commit", "-q", "-am", "feat: a [I-1/T-3]");
  const head = git(repo, "rev-parse", "HEAD");
  const log = join(dir, "log");
  let varreduras = 0;
  /** Os commits que um ticket de desenvolvimento registrou. */
  const registrados = new Set([head]);
  return {
    bare,
    repo,
    head,
    log,
    registrados,
    varreduras: () => varreduras,
    publicar: (corpo: string, conhecidos: string[] = [], varrer = () => Promise.resolve()) =>
      publicarPR(
        join(dir, "raiz"),
        { nome: "loja", repo, branchBase: "main", hospedagem: tipo },
        1,
        {
          titulo: "feat: A [I-1]",
          corpo: `${MARCA}\n${corpo}`,
          conhecidos,
          marca: MARCA,
          registrado: (sha) => registrados.has(sha),
        },
        () => {
          varreduras++;
          return varrer();
        },
        log,
      ),
    /** O commit da branch da issue no `origin`, ou "" se ela não foi publicada. */
    publicado: () => git(bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${BRANCH}`),
  };
}

const recusa = async (promessa: Promise<unknown>, msg: string, tipo = ErroDeRegra) => {
  await assert.rejects(promessa, (e) => e instanceof tipo && e.message === msg);
};

test("GitHub: sem PR, publica a branch, varre a base e cria o PR com o corpo por arquivo, no ambiente do serviço", async () => {
  const c = cenario();
  const pr = await c.publicar("## Por quê\n\n`$(rm -rf /)`");

  assert.deepEqual(pr, { id: "1", url: `${URL_GH}1`, branch: BRANCH, head: c.head });
  assert.equal(c.publicado(), c.head);
  assert.equal(git(c.repo, "rev-parse", "--abbrev-ref", `${BRANCH}@{upstream}`), `origin/${BRANCH}`);
  assert.equal(c.varreduras(), 1);
  assert.deepEqual(hospedagem.prs(), [
    {
      id: 1,
      head: BRANCH,
      base: "main",
      titulo: "feat: A [I-1]",
      corpo: `${MARCA}\n## Por quê\n\n\`$(rm -rf /)\``,
      estado: "aberto",
    },
  ]);
  const chamadas = hospedagem.chamadas();
  assert.deepEqual(
    chamadas.map((ch) => [ch.cli, ...ch.args.slice(0, 2), ch.cwd, ch.token]),
    [
      ["gh", "pr", "list", c.repo, "token-do-servico"],
      ["gh", "pr", "create", c.repo, "token-do-servico"],
    ],
  );
  assert.deepEqual(chamadas[0]?.args, [
    "pr",
    "list",
    "--head",
    BRANCH,
    "--state",
    "all",
    "--json",
    "number,url,state,body,baseRefName,isCrossRepository",
  ]);
  assert.deepEqual(chamadas[1]?.args.slice(0, 8), [
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    BRANCH,
    "--title",
    "feat: A [I-1]",
  ]);
  assert.equal(chamadas[1].args[8], "--body-file");
  assert.ok(!existsSync(String(chamadas[1].args[9])), "o arquivo do corpo foi apagado");
});

test("GitHub: PR já publicado e fechado é reaberto antes de ter título e corpo trocados inteiros", async () => {
  const c = cenario();
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "feat: velho [I-1]", corpo: "velho", estado: "fechado" });

  const pr = await c.publicar("novo", ["1"]);

  assert.deepEqual(pr, { id: "1", url: `${URL_GH}1`, branch: BRANCH, head: c.head });
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.id, p.titulo, p.corpo, p.estado]),
    [[1, "feat: A [I-1]", `${MARCA}\nnovo`, "aberto"]],
  );
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args.slice(0, 3)),
    [
      ["pr", "list", "--head"],
      ["pr", "reopen", "1"],
      ["api", "repos/{owner}/{repo}/pulls/1", "--method"],
    ],
  );
});

test("conferência: PR da branch fora das evidências barra antes do push; fechado, não barra mais", async () => {
  const c = cenario();
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "pelo agente", corpo: "", estado: "aberto" });
  hospedagem.abrir({ head: "outra", base: "main", titulo: "de outra branch", corpo: "", estado: "aberto" });

  await recusa(c.publicar("x"), `PR criado fora da Fabriquinha: ${URL_GH}1 (feche-o e reabra o ticket)`);
  assert.equal(c.publicado(), "", "nada foi publicado");
  assert.equal(c.varreduras(), 0);

  // Mergeado fora também barra, com o que o Auditor pode fazer: fechar não é mais possível.
  hospedagem.mudar(1, { estado: "mergeado" });
  await recusa(
    c.publicar("x"),
    `PR criado fora da Fabriquinha e já mergeado: ${URL_GH}1 (a Fabriquinha não publica sobre ele; o Auditor ` +
      "resolve na plataforma, revertendo o merge se o código não devia ter entrado, e decide o destino da issue)",
  );

  hospedagem.mudar(1, { estado: "fechado" });
  const pr = await c.publicar("x");
  assert.equal(pr.id, "3", "cria um novo; o fechado de fora fica como está");
  assert.equal(hospedagem.prs()[0]?.estado, "fechado");
});

test("a marca só adota PR deste repositório e para a base; fechado com a marca e base errada nunca é reaberto", async () => {
  const c = cenario();
  // Um agente com o token forja a marca num PR para outra base, e um fork abre o seu com a mesma branch.
  hospedagem.abrir({ head: BRANCH, base: "producao", titulo: "x", corpo: `${MARCA}\nforjado`, estado: "fechado" });
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "x", corpo: `${MARCA}\nfork`, estado: "fechado", fork: true });

  const pr = await c.publicar("nosso");

  assert.equal(pr.id, "3", "nenhum dos dois foi adotado");
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.id, p.base, p.estado]),
    [
      [1, "producao", "fechado"],
      [2, "main", "fechado"],
      [3, "main", "aberto"],
    ],
  );
  assert.ok(!hospedagem.chamadas().some((ch) => ch.args[1] === "reopen"));

  // Abertos, eles são de fora: barram.
  hospedagem.mudar(2, { estado: "aberto" });
  await recusa(c.publicar("x", ["3"]), `PR criado fora da Fabriquinha: ${URL_GH}2 (feche-o e reabra o ticket)`);
});

test("PR com a marca já mergeado não é adotado: cai na mensagem do PR de fora mergeado", async () => {
  const c = cenario();
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "x", corpo: `${MARCA}\nmergeado`, estado: "mergeado" });

  await recusa(
    c.publicar("x"),
    `PR criado fora da Fabriquinha e já mergeado: ${URL_GH}1 (a Fabriquinha não publica sobre ele; o Auditor ` +
      "resolve na plataforma, revertendo o merge se o código não devia ter entrado, e decide o destino da issue)",
  );
  assert.equal(c.publicado(), "");
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args[1]),
    ["list"],
  );
});

test("o PR conhecido vence um mais novo com a marca", async () => {
  const c = cenario();
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "x", corpo: "conhecido", estado: "aberto" });
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "x", corpo: `${MARCA}\nmais novo`, estado: "aberto" });

  const pr = await c.publicar("atual", ["1"]);

  assert.equal(pr.id, "1");
  assert.deepEqual(
    hospedagem.prs().map((p) => p.corpo),
    [`${MARCA}\natual`, `${MARCA}\nmais novo`],
  );
});

test("commit que nenhum ticket de desenvolvimento registrou na branch: falha antes do push, com como desfazer", async () => {
  const c = cenario();
  writeFileSync(join(c.repo, "a.ts"), "do agente\n");
  git(c.repo, "commit", "-q", "-am", "agente commitou na revisão");
  const sha = git(c.repo, "rev-parse", "HEAD");

  await recusa(
    c.publicar("x"),
    `a branch ${BRANCH} está no commit ${sha.slice(0, 12)}, que nenhum ticket de desenvolvimento da I-1 registrou: ` +
      "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR (desfaça com git -C " +
      `${join(dirname(c.repo), "raiz", "worktrees", "loja", "I-1")} reset --hard HEAD~1, repetindo até a HEAD ser ` +
      "um commit [I-1/T-<m>] da Fabriquinha, e reabra o ticket)",
  );
  assert.equal(c.publicado(), "");
  assert.deepEqual(hospedagem.prs(), []);
});

test("retomada: o PR com a marca deste ticket, criado por uma execução que não o registrou, é adotado", async () => {
  const c = cenario();
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "feat: A [I-1]", corpo: `${MARCA}\nantes`, estado: "aberto" });

  const pr = await c.publicar("depois");

  assert.equal(pr.id, "1");
  assert.deepEqual(
    hospedagem.prs().map((p) => p.corpo),
    [`${MARCA}\ndepois`],
  );
});

test("Azure DevOps: cria pelo az com --detect e a URL da página; depois reabre e atualiza o mesmo PR", async () => {
  const c = cenario("azure-devops");
  // Um PR de fora, abandonado e sem descrição, não barra; um de fork com a marca não é adotado.
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "pelo agente", corpo: "", estado: "fechado" });
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "fork", corpo: MARCA, estado: "fechado", fork: true });

  const criado = await c.publicar("corpo");
  assert.deepEqual(criado, { id: "3", url: `${URL_AZ}3`, branch: BRANCH, head: c.head });
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args),
    [
      ["repos", "pr", "list", "--detect", "true", "--source-branch", BRANCH, "--status", "all", "--output", "json"],
      [
        "repos",
        "pr",
        "create",
        "--detect",
        "true",
        "--source-branch",
        BRANCH,
        "--target-branch",
        "main",
        "--title",
        "feat: A [I-1]",
        "--description",
        `${MARCA}\ncorpo`,
        "--output",
        "json",
      ],
    ],
  );

  hospedagem.mudar(3, { estado: "fechado" });
  const atualizado = await c.publicar("corpo 2", ["3"]);
  assert.deepEqual(atualizado, { id: "3", url: `${URL_AZ}3`, branch: BRANCH, head: c.head });
  assert.deepEqual(
    hospedagem
      .chamadas()
      .slice(3)
      .map((ch) => ch.args),
    [
      ["repos", "pr", "update", "--id", "3", "--status", "active"],
      [
        "repos",
        "pr",
        "update",
        "--id",
        "3",
        "--title",
        "feat: A [I-1]",
        "--description",
        `${MARCA}\ncorpo 2`,
        "--output",
        "json",
      ],
    ],
  );
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.id, p.estado, p.corpo]),
    [
      [1, "fechado", ""],
      [2, "fechado", MARCA],
      [3, "aberto", `${MARCA}\ncorpo 2`],
    ],
  );
  // Aberto, é só atualizado.
  await c.publicar("corpo 3", ["3"]);
  assert.deepEqual(
    hospedagem
      .chamadas()
      .slice(5)
      .map((ch) => ch.args.slice(0, 3)),
    [
      ["repos", "pr", "list"],
      ["repos", "pr", "update"],
    ],
  );
});

test("falhas: do gh e do az com a saída do comando, do push com o stderr; a da varredura só vai para o log", async () => {
  const c = cenario();
  hospedagem.falhar("pr create", "HTTP 401: Bad credentials");
  await recusa(
    c.publicar("x", [], () => Promise.reject(new Error("fetch caiu"))),
    "gh pr create saiu com código 1: HTTP 401: Bad credentials (confira o acesso do gh à hospedagem e execute o ticket de novo)",
  );
  assert.equal(c.publicado(), c.head, "o push veio antes");
  assert.match(readFileSync(c.log, "utf8"), / varrerBase falhou: fetch caiu\n/);

  const az = cenario("azure-devops");
  hospedagem.falhar("repos pr list", "ERROR: TF401019");
  await recusa(
    az.publicar("x"),
    "az repos pr list saiu com código 1: ERROR: TF401019 (confira o acesso do az à hospedagem e execute o ticket de novo)",
  );

  const semOrigin = cenario();
  git(semOrigin.repo, "remote", "set-url", "origin", join(base, "nao-existe.git"));
  await assert.rejects(
    semOrigin.publicar("x"),
    (e) =>
      e instanceof ErroDeRegra &&
      e.message.startsWith(`git push -u origin refs/heads/${BRANCH}:refs/heads/${BRANCH} falhou`),
  );
});

test("saída inesperada do CLI vira ErroDeRegra com o que veio", async () => {
  const c = cenario();
  hospedagem.responder("pr list", "não é JSON");
  await recusa(
    c.publicar("x"),
    "saída inesperada de gh pr list: não é JSON (confira a versão do CLI e execute o ticket de novo)",
  );
  hospedagem.zerar();
  hospedagem.responder("pr create", "Warning: 1 uncommitted change\nhttps://github.com/org/loja/issues/9\n");
  await recusa(
    c.publicar("x"),
    "saída inesperada de gh pr create: https://github.com/org/loja/issues/9 (confira a versão do gh)",
  );
  hospedagem.zerar();
  hospedagem.responder("pr create", "Warning: 1 uncommitted change\nhttps://github.com/org/loja/pull/9\n");
  assert.equal((await c.publicar("x")).url, `${URL_GH}9`, "a URL é a última linha");
  const az = cenario("azure-devops");
  hospedagem.responder("repos pr create", JSON.stringify({ pullRequestId: "7" }));
  await assert.rejects(
    az.publicar("x"),
    (e) => e instanceof ErroDeRegra && e.message.startsWith("saída inesperada de az repos pr create: {"),
  );
});

/** A issue com a evidência `pr_aberto` do PR `id`, como o encerramento a registra. */
const comPR = (id: string) => ({ issue: { id: 1 }, evidencias: [{ tipo: "pr_aberto" as const, dados: { id } }] });

test("estadoPR (F5 §5.2): aberto, mergeado com a data e fechado, no GitHub e no Azure DevOps, lido agora", async () => {
  for (const [tipo, url, comando] of [
    ["github", URL_GH, ["pr", "view", "1", "--json", "state,url,mergedAt,mergeCommit"]],
    ["azure-devops", URL_AZ, ["repos", "pr", "show", "--id", "1", "--output", "json"]],
  ] as const) {
    const c = cenario(tipo);
    const projeto = { repo: c.repo, hospedagem: tipo };
    hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });
    const ler = async () => {
      const { lidoEm, ...resto } = await estadoPR(projeto, comPR("1"));
      assert.ok(Math.abs(Date.parse(lidoEm) - Date.now()) < 60_000, "lidoEm é agora");
      return resto;
    };
    assert.deepEqual(await ler(), { estado: "aberto", url: `${url}1` });
    assert.deepEqual(hospedagem.chamadas().at(-1), {
      cli: comando[0] === "pr" ? "gh" : "az",
      args: [...comando],
      cwd: c.repo,
      token: "token-do-servico",
    });
    hospedagem.mudar(1, { estado: "mergeado" });
    const quando = tipo === "github" ? "2026-10-11T13:00:00.000Z" : "2026-10-11T13:00:00.123Z";
    assert.deepEqual(await ler(), { estado: "mergeado", url: `${url}1`, mergeadoEm: quando, mergeSha: "abc" });
    hospedagem.mudar(1, { estado: "fechado" });
    assert.deepEqual(await ler(), { estado: "fechado", url: `${url}1` });
    hospedagem.zerar();
  }
});

test("estadoPR: falha e saída inesperada do CLI viram ErroExterno com a saída; issue sem PR é ErroDeRegra", async () => {
  const c = cenario();
  const projeto = { repo: c.repo, hospedagem: "github" as const };
  hospedagem.falhar("pr view", "HTTP 401: Bad credentials");
  await recusa(
    estadoPR(projeto, comPR("1")),
    "gh pr view saiu com código 1: HTTP 401: Bad credentials (confira o acesso do gh à hospedagem e leia o estado do PR de novo)",
    ErroExterno,
  );
  hospedagem.zerar();
  hospedagem.responder("pr view", JSON.stringify({ state: "MERGED", url: `${URL_GH}1`, mergedAt: "ontem" }));
  await recusa(
    estadoPR(projeto, comPR("1")),
    `saída inesperada de gh pr view: {"state":"MERGED","url":"${URL_GH}1","mergedAt":"ontem"} (confira a versão do CLI e leia o estado do PR de novo)`,
    ErroExterno,
  );
  hospedagem.responder("pr view", JSON.stringify({ state: "MERGED", url: `${URL_GH}1`, mergedAt: null }));
  assert.equal((await estadoPR(projeto, comPR("1"))).mergeadoEm, undefined, "mergeado sem data");
  await recusa(
    estadoPR(projeto, { issue: { id: 1 }, evidencias: [] }),
    "a I-1 ainda não tem PR (o encerramento publica o PR)",
  );
});

test("estado de PR desconhecido do gh ou do az é erro, na leitura e na publicação, nunca aberto por padrão", async () => {
  const c = cenario();
  hospedagem.responder("pr view", JSON.stringify({ state: "DRAFT", url: `${URL_GH}1`, mergedAt: null }));
  await recusa(
    estadoPR({ repo: c.repo, hospedagem: "github" }, comPR("1")),
    "o gh devolveu um estado de PR que a Fabriquinha não conhece: DRAFT " +
      "(confira a versão do gh; os estados conhecidos são OPEN, CLOSED, MERGED)",
    ErroExterno,
  );
  const az = cenario("azure-devops");
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });
  const lista = JSON.parse(execFileSync("az", ["repos", "pr", "list", "--source-branch", BRANCH]).toString()) as {
    status: string;
  }[];
  hospedagem.responder("repos pr list", JSON.stringify(lista.map((p) => ({ ...p, status: "notSet" }))));
  await recusa(
    az.publicar("x"),
    "o az devolveu um estado de PR que a Fabriquinha não conhece: notSet " +
      "(confira a versão do az; os estados conhecidos são active, abandoned, completed)",
  );
  assert.equal(az.publicado(), "", "nada foi publicado");
});

const HOSPEDAGENS = ["github", "azure-devops"] as const;
const RAPIDO = { intervaloMs: 10, carenciaMs: 0 };
/** Um PR aberto na hospedagem falsa, verificado com o `repo` do cenário. */
function verificar(tipo: Hospedagem, pr: Partial<Parameters<typeof hospedagem.abrir>[0]>, opcoes = RAPIDO) {
  const c = cenario(tipo);
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto", ...pr });
  return { c, resultado: verificarPR({ repo: c.repo, hospedagem: tipo }, "1", c.log, opcoes) };
}

test("verificarPR (F5 §5.1, passo 4): com conflito devolve na hora, sem olhar os checks", async () => {
  for (const tipo of HOSPEDAGENS) {
    const { resultado } = verificar(tipo, { conflito: true, checks: [{ nome: "ci", estado: "falho" }] });
    assert.deepEqual(await resultado, { conflito: true, checksFalhos: [] });
    hospedagem.zerar();
  }
});

test("verificarPR: sem conflito e com a CI aprovada não há problema; o gh e o az são chamados com os comandos do F5", async () => {
  const gh = verificar("github", {});
  assert.deepEqual(await gh.resultado, { conflito: false, checksFalhos: [] });
  assert.deepEqual(hospedagem.chamadas().at(-1)?.args, ["pr", "view", "1", "--json", "mergeable,statusCheckRollup"]);
  hospedagem.zerar();
  const az = verificar("azure-devops", {});
  assert.deepEqual(await az.resultado, { conflito: false, checksFalhos: [] });
  assert.deepEqual(
    hospedagem.chamadas().map((ch) => ch.args.join(" ")),
    ["repos pr show --id 1 --output json", "repos pr policy list --id 1 --detect true --output json"],
  );
  assert.equal(existsSync(az.c.log), false, "nada a esperar, nada no log");
});

test("verificarPR: o check falho volta com o nome (e a URL, quando a plataforma a dá), ignorando as políticas que não são de CI", async () => {
  const checks = [
    { nome: "build", estado: "falho" as const },
    { nome: "ci/lint", estado: "falho" as const },
    { nome: "testes", estado: "aprovado" as const },
  ];
  const gh = verificar("github", { checks });
  assert.deepEqual(await gh.resultado, {
    conflito: false,
    checksFalhos: [
      { nome: "build", url: "https://ci.exemplo.com/build" },
      { nome: "ci/lint", url: "https://ci.exemplo.com/ci/lint" },
    ],
  });
  hospedagem.zerar();
  // No Azure DevOps o revisor mínimo está rejeitado e há um build que não se aplica: nenhum dos dois é check.
  const az = verificar("azure-devops", { checks });
  assert.deepEqual(await az.resultado, {
    conflito: false,
    checksFalhos: [{ nome: "build" }, { nome: "ci/lint" }],
  });
});

test("verificarPR: check em andamento e conflito ainda calculado esperam, anotam no log e depois decidem", async () => {
  for (const tipo of HOSPEDAGENS) {
    const { c, resultado } = verificar(
      tipo,
      { conflito: "calculando", checks: [{ nome: "ci", estado: "andamento" }] },
      { ...RAPIDO, intervaloMs: 300 },
    );
    while (!existsSync(c.log)) await esperar(5);
    hospedagem.mudar(1, { conflito: false });
    while (readFileSync(c.log, "utf8").split("\n").filter(Boolean).length < 2) await esperar(5);
    hospedagem.mudar(1, { checks: [{ nome: "ci", estado: "aprovado" }] });
    assert.deepEqual(await resultado, { conflito: false, checksFalhos: [] });
    const anotacoes = readFileSync(c.log, "utf8");
    assert.match(anotacoes, /PR 1: espera a plataforma ainda calcula o PR/);
    assert.match(anotacoes, /PR 1: espera os checks em andamento: ci/);
    hospedagem.zerar();
  }
});

test("verificarPR: a lista vazia só vale depois da carência, e então é um PR sem CI", async () => {
  for (const tipo of HOSPEDAGENS) {
    const inicio = Date.now();
    const { c, resultado } = verificar(tipo, { checks: [] }, { intervaloMs: 10, carenciaMs: 300 });
    assert.deepEqual(await resultado, { conflito: false, checksFalhos: [] });
    assert.ok(Date.now() - inicio >= 300, "esperou a carência");
    assert.match(readFileSync(c.log, "utf8"), /PR 1: espera a plataforma ainda calcula o PR/);
    hospedagem.zerar();
  }
});

test("verificarPR: passado o limite, ErroExterno com o que ainda espera", async () => {
  const limite = { limiteMs: 0, intervaloMs: 10, carenciaMs: 0 };
  const dica = "acompanhe o PR na plataforma e execute o ticket de novo";
  for (const tipo of HOSPEDAGENS) {
    await recusa(
      verificar(
        tipo,
        {
          checks: [
            { nome: "build", estado: "andamento" },
            { nome: "lint", estado: "andamento" },
          ],
        },
        limite,
      ).resultado,
      `o PR 1 não ficou decidido em 0 min, ainda espera os checks em andamento: build, lint (${dica})`,
      ErroExterno,
    );
    hospedagem.zerar();
    await recusa(
      verificar(tipo, { conflito: "calculando" }, limite).resultado,
      `o PR 1 não ficou decidido em 0 min, ainda espera a plataforma ainda calcula o PR (${dica})`,
      ErroExterno,
    );
    hospedagem.zerar();
  }
});

test("verificarPR: a falha do CLI sai com a saída do comando; nada é devolvido", async () => {
  const c = cenario();
  const projeto = { repo: c.repo, hospedagem: "github" as const };
  hospedagem.falhar("pr view", "HTTP 401: Bad credentials");
  await recusa(
    verificarPR(projeto, "1", c.log),
    "gh pr view saiu com código 1: HTTP 401: Bad credentials (confira o acesso do gh à hospedagem e execute o ticket de novo)",
    ErroExterno,
  );
  const az = cenario("azure-devops");
  const projetoAz = { repo: az.repo, hospedagem: "azure-devops" as const };
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });
  hospedagem.falhar("repos pr policy list", "Please run 'az login'");
  await recusa(
    verificarPR(projetoAz, "1", az.log),
    "az repos pr policy list saiu com código 1: Please run 'az login' (confira o acesso do az à hospedagem e execute o ticket de novo)",
    ErroExterno,
  );
});

test("verificarPR: os estados do gh e do az viram aprovado, falho ou andamento; o desconhecido é erro", async () => {
  const c = cenario();
  const projeto = { repo: c.repo, hospedagem: "github" as const };
  const rollup = (...checks: object[]) => JSON.stringify({ mergeable: "MERGEABLE", statusCheckRollup: checks });
  const run = (nome: string, status: string, conclusion: string) => ({
    __typename: "CheckRun",
    name: nome,
    status,
    conclusion,
  });
  const contexto = (nome: string, state: string) => ({ __typename: "StatusContext", context: nome, state });
  hospedagem.responder(
    "pr view",
    rollup(
      run("a", "COMPLETED", "SUCCESS"),
      run("b", "COMPLETED", "NEUTRAL"),
      run("c", "COMPLETED", "SKIPPED"),
      run("d", "COMPLETED", "CANCELLED"),
      run("e", "COMPLETED", "TIMED_OUT"),
      contexto("f", "SUCCESS"),
      contexto("g", "ERROR"),
      contexto("h", "FAILURE"),
    ),
  );
  assert.deepEqual(await verificarPR(projeto, "1", c.log), {
    conflito: false,
    checksFalhos: [{ nome: "d" }, { nome: "e" }, { nome: "g" }, { nome: "h" }],
  });
  for (const [estado, nome] of [
    [contexto("p", "PENDING"), "p"],
    [contexto("x", "EXPECTED"), "x"],
    [run("q", "QUEUED", ""), "q"],
  ] as const) {
    hospedagem.responder("pr view", rollup(estado));
    await recusa(
      verificarPR(projeto, "1", c.log, { limiteMs: 0 }),
      `o PR 1 não ficou decidido em 0 min, ainda espera os checks em andamento: ${nome} (acompanhe o PR na plataforma e execute o ticket de novo)`,
      ErroExterno,
    );
  }
  hospedagem.responder("pr view", JSON.stringify({ mergeable: "TALVEZ", statusCheckRollup: [] }));
  await recusa(
    verificarPR(projeto, "1", c.log),
    "o gh devolveu um estado de conflito que a Fabriquinha não conhece: TALVEZ " +
      "(confira a versão do gh; os estados conhecidos são CONFLICTING, MERGEABLE, UNKNOWN)",
    ErroExterno,
  );
  hospedagem.responder("pr view", "não é json");
  await assert.rejects(verificarPR(projeto, "1", c.log), /saída inesperada de gh pr view: não é json/);

  const az = cenario("azure-devops");
  const projetoAz = { repo: az.repo, hospedagem: "azure-devops" as const };
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });
  const politica = (status: string, tipo: string, settings?: object) => ({
    status,
    configuration: { type: { displayName: tipo }, ...(settings && { settings }) },
  });
  hospedagem.responder(
    "repos pr policy list",
    JSON.stringify([
      politica("broken", "Status", {}),
      politica("approved", "Build", { displayName: "ok" }),
      politica("queued", "Build"),
    ]),
  );
  await recusa(
    verificarPR(projetoAz, "1", az.log, { limiteMs: 0 }),
    "o PR 1 não ficou decidido em 0 min, ainda espera os checks em andamento: Build (acompanhe o PR na plataforma e execute o ticket de novo)",
    ErroExterno,
  );
  hospedagem.responder("repos pr policy list", JSON.stringify([politica("broken", "Status", {})]));
  assert.deepEqual(await verificarPR(projetoAz, "1", az.log), { conflito: false, checksFalhos: [{ nome: "Status" }] });
  hospedagem.responder("repos pr policy list", JSON.stringify([politica("pausado", "Build")]));
  await recusa(
    verificarPR(projetoAz, "1", az.log),
    "o az devolveu um estado de política que a Fabriquinha não conhece: pausado " +
      "(confira a versão do az; os estados conhecidos são approved, queued, running, rejected, broken)",
    ErroExterno,
  );
  hospedagem.responder("repos pr policy list", "[]");
  hospedagem.responder("repos pr show", JSON.stringify({ mergeStatus: "failure" }));
  await recusa(
    verificarPR(projetoAz, "1", az.log),
    "o az devolveu um estado de conflito que a Fabriquinha não conhece: failure " +
      "(confira a versão do az; os estados conhecidos são conflicts, succeeded, queued, notSet)",
    ErroExterno,
  );
});

const RODADA = "fabriquinha/I-206-2";
const DEMANDA = "fabriquinha/I-206";
const MARCA_RODADA = "<!-- fabriquinha I-206.T7 -->";

/** A rodada com um commit sobre a branch da demanda, que só existe localmente. */
function cenarioRodada() {
  const c = cenario();
  git(c.repo, "branch", DEMANDA, "main");
  git(c.repo, "branch", "-m", BRANCH, RODADA);
  const publicar = (conferir: (head: string) => void, publicarBase = true) =>
    publicarPRDe(
      join(dirname(c.repo), "raiz"),
      { nome: "loja", repo: c.repo, hospedagem: "github" },
      { branch: RODADA, base: DEMANDA, publicarBase },
      { titulo: "feat: R [I-206.R2]", corpo: `${MARCA_RODADA}\ncorpo`, conhecidos: [], marca: MARCA_RODADA },
      conferir,
      () => Promise.resolve(),
      c.log,
    );
  const noRemoto = (ref: string) => git(c.bare, "for-each-ref", "--format=%(objectname)", `refs/heads/${ref}`);
  return { ...c, publicar, noRemoto };
}

test("alvo da rodada: PR da branch da rodada para a da demanda, que sobe antes, nunca para a base do projeto", async () => {
  const c = cenarioRodada();
  const vistos: string[] = [];

  const pr = await c.publicar((head) => {
    vistos.push(head);
  });

  assert.deepEqual(pr, { id: "1", url: `${URL_GH}1`, branch: RODADA, head: c.head });
  assert.deepEqual(vistos, [c.head]);
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.head, p.base]),
    [[RODADA, DEMANDA]],
  );
  assert.equal(c.noRemoto(RODADA), c.head);
  assert.equal(c.noRemoto(DEMANDA), git(c.repo, "rev-parse", "main"));
});

test("alvo da rodada: sem publicarBase, a demanda não sobe; o PR com a marca e a base da demanda é adotado", async () => {
  const c = cenarioRodada();
  hospedagem.abrir({ head: RODADA, base: DEMANDA, titulo: "x", corpo: `${MARCA_RODADA}\nantes`, estado: "aberto" });

  const pr = await c.publicar(() => undefined, false);

  assert.equal(pr.id, "1");
  assert.equal(c.noRemoto(DEMANDA), "");
  assert.deepEqual(
    hospedagem.prs().map((p) => [p.titulo, p.corpo]),
    [["feat: R [I-206.R2]", `${MARCA_RODADA}\ncorpo`]],
  );
});

test("alvo da rodada: o gancho de commits recusa antes do push e de qualquer PR", async () => {
  const c = cenarioRodada();

  await recusa(
    c.publicar(() => {
      throw new ErroDeRegra("commit solto", "desfaça");
    }),
    "commit solto (desfaça)",
  );
  assert.equal(c.noRemoto(RODADA), "");
  assert.equal(c.noRemoto(DEMANDA), "");
  assert.deepEqual(hospedagem.prs(), []);
});

test("lerPR: o estado do PR pelo id", async () => {
  hospedagem.abrir({ head: RODADA, base: DEMANDA, titulo: "x", corpo: "", estado: "aberto" });

  const leitura = await lerPR({ repo: base, hospedagem: "github" }, "1");

  assert.equal(leitura.estado, "aberto");
  assert.equal(leitura.url, `${URL_GH}1`);
});

test("integrarPR: merge commit pela hospedagem no GitHub e no Azure DevOps, e o SHA vem da releitura", async () => {
  for (const tipo of ["github", "azure-devops"] as const) {
    const c = cenario(tipo);
    git(c.repo, "push", "-q", "origin", BRANCH);
    hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });

    const sha = await integrarPR({ repo: c.repo, hospedagem: tipo }, "1");

    assert.equal(git(c.bare, "rev-parse", "refs/heads/main"), sha);
    assert.deepEqual(git(c.bare, "rev-list", "--parents", "-n", "1", sha).split(" ").slice(1), [
      git(c.repo, "rev-parse", "main"),
      c.head,
    ]);
    const pedidos = () =>
      hospedagem.chamadas().filter((ch) => ch.args.includes("merge") || ch.args.includes("completed"));
    assert.deepEqual(
      pedidos().map((ch) => ch.args),
      [
        tipo === "github"
          ? ["pr", "merge", "1", "--merge"]
          : ["repos", "pr", "update", "--id", "1", "--status", "completed"],
      ],
    );

    // Já mergeado: devolve o SHA sem pedir outro merge.
    assert.equal(await integrarPR({ repo: c.repo, hospedagem: tipo }, "1"), sha);
    assert.equal(pedidos().length, 1);
    hospedagem.zerar();
  }
});

test("integrarPR: a recusa da hospedagem é ErroExterno e o merge não confirmado também", async () => {
  const c = cenario();
  const projeto = { repo: c.repo, hospedagem: "github" as const };
  hospedagem.abrir({ head: BRANCH, base: "main", titulo: "t", corpo: "", estado: "aberto" });
  hospedagem.falhar("pr merge", "not mergeable");
  await recusa(
    integrarPR(projeto, "1"),
    "gh pr merge saiu com código 1: not mergeable (confira o acesso do gh à hospedagem e execute o ticket de novo)",
    ErroExterno,
  );
  hospedagem.zerar();
  hospedagem.responder("pr view", JSON.stringify({ state: "MERGED", url: `${URL_GH}1`, mergedAt: null }));
  await recusa(
    integrarPR(projeto, "1"),
    "a hospedagem não confirmou o merge do PR 1 (confira o PR na plataforma e tente de novo)",
    ErroExterno,
  );
});
