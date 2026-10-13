import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { ErroDeRegra } from "../dominio/erros.ts";
import { heatmapDo, lerLog, prsDos, type NoDoHeatmap } from "./heatmap.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-heatmap-")));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

const AGORA = new Date("2026-10-13T12:00:00Z");
/** O instante de `meses` meses antes de AGORA (ISO), mais `dias` dias. */
const atras = (meses: number, dias = 0): string => {
  const d = new Date(AGORA);
  d.setUTCMonth(d.getUTCMonth() - meses);
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString();
};

/** Um repositório com a base publicada em `refs/remotes/origin/main` e commits em datas fixas. */
function repositorio() {
  const repo = mkdtempSync(join(base, "repo-"));
  const git = (data: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: repo,
      stdio: "pipe",
      env: { ...process.env, GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data },
    })
      .toString()
      .trim();
  git(AGORA.toISOString(), "init", "-q", "-b", "main");
  /** Grava `arquivos` (caminho → conteúdo) e commita em `data`. */
  const commitar = (data: string, mensagem: string, arquivos: Record<string, string | null>) => {
    for (const [caminho, conteudo] of Object.entries(arquivos)) {
      if (conteudo === null) {
        git(data, "rm", "-q", caminho);
      } else {
        mkdirSync(dirname(join(repo, caminho)), { recursive: true });
        writeFileSync(join(repo, caminho), conteudo);
        git(data, "add", caminho);
      }
    }
    git(data, "commit", "-q", "-m", mensagem);
    return git(data, "rev-parse", "HEAD");
  };
  const publicar = () => git(AGORA.toISOString(), "update-ref", "refs/remotes/origin/main", "HEAD");
  return { repo, git, commitar, publicar };
}

/** Os nós por caminho (`src/a.ts`), para os testes lerem a árvore sem percorrê-la à mão. */
function porCaminho(no: NoDoHeatmap, prefixo = ""): Map<string, NoDoHeatmap> {
  const nos = new Map<string, NoDoHeatmap>();
  for (const filho of no.filhos ?? []) {
    const caminho = `${prefixo}${filho.nome}`;
    nos.set(caminho, filho);
    for (const [c, n] of porCaminho(filho, `${caminho}/`)) nos.set(c, n);
  }
  return nos;
}

/** Histórico completo: janela, PRs (merge do GitHub e do Azure), squash, commit direto e arquivo apagado. */
function historico() {
  const r = repositorio();
  r.commitar(atras(13), "inicial", {
    "velho.txt": "v",
    "dois.txt": "1",
    "src/a.ts": "0",
    "src/b.ts": "0",
    "acentuação.txt": "a",
    "apagado.txt": "x",
  });
  r.commitar(atras(11), "muda dois", { "dois.txt": "2" });
  for (let i = 1; i <= 5; i++) r.commitar(atras(10, i), `a${String(i)}`, { "src/a.ts": String(i) });
  r.commitar(atras(9), "b1", { "src/b.ts": "1" });
  r.commitar(atras(9, 1), "apaga", { "apagado.txt": null });

  r.git(atras(8), "checkout", "-q", "-b", "gh");
  const g1 = r.commitar(atras(8, 1), "pr gh 1", { "src/pr/x.ts": "1" });
  const g2 = r.commitar(atras(8, 2), "pr gh 2", { "src/pr/x.ts": "2", "src/pr/y.ts": "2" });
  r.git(atras(8, 3), "checkout", "-q", "main");
  r.git(atras(8, 3), "merge", "-q", "--no-ff", "gh", "-m", "Merge pull request #7 from fulano/gh");

  r.git(atras(7), "checkout", "-q", "-b", "az");
  const z1 = r.commitar(atras(7, 1), "pr az", { "docs/z.md": "1" });
  r.git(atras(7, 2), "checkout", "-q", "main");
  r.git(atras(7, 2), "merge", "-q", "--no-ff", "az", "-m", "Merged PR 12: azure");

  const squash = r.commitar(atras(6), "feat: squash (#9)", { "docs/s.md": "1" });
  const direto = r.commitar(atras(5), "direto na main", { "docs/d.md": "1" });
  r.publicar();
  return { ...r, g1, g2, z1, squash, direto };
}

test("12 meses: o arquivo só com commit de 13 meses fica com 0; o de 13 e de 11 conta só o de 11", async () => {
  const h = historico();
  const mapa = porCaminho((await heatmapDo({ repo: h.repo, branchBase: "main" }, AGORA)).raiz);
  assert.equal(mapa.get("velho.txt")?.alteracoes, 0);
  assert.deepEqual(mapa.get("velho.txt")?.commits, []);
  assert.equal(mapa.get("dois.txt")?.alteracoes, 1);
  assert.equal(mapa.get("dois.txt")?.commits?.length, 1);
  assert.equal(mapa.get("acentuação.txt")?.alteracoes, 0);
});

test("o cabeçalho traz a branch e a janela de 12 meses até agora", async () => {
  const h = historico();
  const heatmap = await heatmapDo({ repo: h.repo, branchBase: "main" }, AGORA);
  assert.equal(heatmap.branch, "main");
  assert.equal(heatmap.desde, "2025-10-13T12:00:00.000Z");
  assert.equal(heatmap.ate, "2026-10-13T12:00:00.000Z");
});

test("5 alterações pioram para 6 com mais um commit, e passam o arquivo de 1", async () => {
  const h = historico();
  const projeto = { repo: h.repo, branchBase: "main" };
  const antes = porCaminho((await heatmapDo(projeto, AGORA)).raiz);
  assert.equal(antes.get("src/a.ts")?.alteracoes, 5);
  assert.equal(antes.get("src/b.ts")?.alteracoes, 1);
  h.commitar(atras(4), "a6", { "src/a.ts": "6" });
  h.publicar();
  const depois = porCaminho((await heatmapDo(projeto, AGORA)).raiz);
  assert.equal(depois.get("src/a.ts")?.alteracoes, 6);
});

test("PR: merge do GitHub e do Azure dão o número aos commits trazidos; squash tem o seu; direto é null", async () => {
  const h = historico();
  const { commits } = await heatmapDo({ repo: h.repo, branchBase: "main" }, AGORA);
  assert.equal(commits[h.g1]?.pr, "7");
  assert.equal(commits[h.g2]?.pr, "7");
  assert.equal(commits[h.z1]?.pr, "12");
  assert.equal(commits[h.squash]?.pr, "9");
  assert.equal(commits[h.direto]?.pr, null);
  assert.equal(commits[h.direto]?.mensagem, "direto na main");
  assert.equal(commits[h.direto]?.data, atras(5).replace(".000Z", "Z").replace("Z", "+00:00"));
  // O merge em si não é alteração e não entra nos commits.
  assert.equal(
    Object.values(commits).some((c) => c.mensagem.startsWith("Merge pull request")),
    false,
  );
});

test("o total da raiz é a soma das linhas; pasta soma o que há abaixo; a ordem é por total e depois nome", async () => {
  const h = historico();
  const { raiz } = await heatmapDo({ repo: h.repo, branchBase: "main" }, AGORA);
  const soma = (raiz.filhos ?? []).reduce((total, f) => total + f.alteracoes, 0);
  assert.equal(raiz.alteracoes, soma);
  const mapa = porCaminho(raiz);
  // a.ts 5 + b.ts 1; pr: x.ts 2 + y.ts 1; docs: z.md 1 + s.md 1 + d.md 1; dois.txt 1.
  assert.equal(mapa.get("src")?.alteracoes, 9);
  assert.equal(mapa.get("src/pr")?.alteracoes, 3);
  assert.equal(mapa.get("docs")?.alteracoes, 3);
  assert.equal(raiz.alteracoes, 13);
  assert.deepEqual(
    raiz.filhos?.map((f) => f.nome),
    ["src", "docs", "dois.txt", "acentuação.txt", "velho.txt"],
  );
  assert.deepEqual(
    mapa.get("src")?.filhos?.map((f) => f.nome),
    ["a.ts", "pr", "b.ts"],
  );
});

test("arquivo apagado da base não aparece", async () => {
  const h = historico();
  const { raiz } = await heatmapDo({ repo: h.repo, branchBase: "main" }, AGORA);
  assert.equal(porCaminho(raiz).has("apagado.txt"), false);
});

test("base sem commits na janela: todos os totais em 0", async () => {
  const r = repositorio();
  r.commitar(atras(13), "inicial", { "a.txt": "a", "pasta/b.txt": "b" });
  r.publicar();
  const heatmap = await heatmapDo({ repo: r.repo, branchBase: "main" }, AGORA);
  assert.equal(heatmap.raiz.alteracoes, 0);
  assert.equal(porCaminho(heatmap.raiz).get("pasta")?.alteracoes, 0);
  assert.deepEqual(heatmap.commits, {});
});

test("repositório novo, com todo o histórico na janela, inclusive o commit raiz", async () => {
  const r = repositorio();
  r.commitar(atras(2), "inicial", { "a.txt": "a" });
  r.commitar(atras(1), "muda", { "a.txt": "b" });
  r.publicar();
  const { raiz, commits } = await heatmapDo({ repo: r.repo, branchBase: "main" }, AGORA);
  assert.equal(raiz.alteracoes, 2);
  assert.equal(Object.keys(commits).length, 2);
});

test("repositório inexistente: erro com o motivo e a correção", async () => {
  const repo = join(base, "nao-existe");
  await assert.rejects(
    heatmapDo({ repo, branchBase: "main" }, AGORA),
    new ErroDeRegra(
      `o repositório ${repo} não existe mais no disco`,
      "corrija o caminho do repositório do projeto na Configuração",
    ),
  );
});

test("branch base ausente: erro com o motivo e a correção", async () => {
  const r = repositorio();
  r.commitar(atras(1), "inicial", { "a.txt": "a" });
  r.publicar();
  await assert.rejects(
    heatmapDo({ repo: r.repo, branchBase: "develop" }, AGORA),
    new ErroDeRegra(
      `a branch base develop não existe em ${r.repo}`,
      "busque-a com git fetch origin develop ou corrija a branch base na Configuração",
    ),
  );
});

test("lerLog e prsDos: o merge de PR não leva o que um merge anterior já trouxe nem a linha principal", () => {
  const log = lerLog(
    [
      "\x1em3\x1fm2 f3\x1f2026-01-05T00:00:00+00:00\x1fMerge branch 'x'\0",
      "\x1ef3\x1fm0\x1f2026-01-04T12:00:00+00:00\x1ffora do PR\0\nf.txt\0",
      "\x1em2\x1fm1 f2\x1f2026-01-04T00:00:00+00:00\x1fMerge pull request #2 from x/y\0",
      "\x1ef2\x1ff1\x1f2026-01-03T00:00:00+00:00\x1fsegundo\0\nf.txt\0",
      "\x1em1\x1fm0 f1\x1f2026-01-02T00:00:00+00:00\x1fMerge pull request #1 from x/z\0",
      "\x1ef1\x1ffora\x1f2026-01-01T12:00:00+00:00\x1fprimeiro\0\nf.txt\0",
      "\x1em0\x1f\x1f2026-01-01T00:00:00+00:00\x1fraiz\0\nr.txt\0",
    ].join(""),
  );
  assert.deepEqual(log[1]?.arquivos, ["f.txt"]);
  assert.deepEqual(log.at(-1)?.pais, []);
  // f1 vem de um commit fora do log; f2 nasceu de f1, que já é do #1; o merge sem número de PR não dá PR a f3.
  assert.deepEqual(
    [...prsDos(log, "m3")],
    [
      ["f1", "1"],
      ["f2", "2"],
    ],
  );
});
