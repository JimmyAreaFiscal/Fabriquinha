// Heatmap (F7 §4.4, issue I-7): a aba Heatmap da página Projetos, lida do git da base de repositórios com commits
// datados em relação a hoje (a janela é de 12 meses). CA-1 a CA-15.
import type { Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import { expect, test } from "./apoio.ts";

/** O instante de `meses` meses antes de hoje (ISO). */
const atras = (meses: number): string => {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - meses);
  return d.toISOString();
};
const dia = (instante: string | Date): string =>
  new Date(instante).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

/** Um repositório do projeto `nome`; `publicar` leva a main ao `origin` (bare), de onde vem `refs/remotes/origin/main`. */
function repositorio(raiz: string, nome: string) {
  const repo = join(raiz, nome);
  const bare = join(raiz, `${nome}-origin.git`);
  const git = (data: string, ...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "commit.gpgsign=false", "-c", "user.name=Auditor", "-c", "user.email=a@e.com", ...args],
      {
        cwd: repo,
        stdio: "pipe",
        env: { ...process.env, GIT_AUTHOR_DATE: data, GIT_COMMITTER_DATE: data },
      },
    )
      .toString()
      .trim();
  mkdirSync(repo);
  git(new Date().toISOString(), "init", "-q", "-b", "main");
  /** Grava os arquivos e commita na `data`; devolve o hash. */
  const commitar = (data: string, mensagem: string, ...arquivos: string[]): string => {
    for (const arquivo of arquivos) {
      mkdirSync(dirname(join(repo, arquivo)), { recursive: true });
      writeFileSync(join(repo, arquivo), `${mensagem}\n`);
      git(data, "add", arquivo);
    }
    git(data, "commit", "-q", "-m", mensagem);
    return git(data, "rev-parse", "HEAD");
  };
  const publicar = (): void => {
    mkdirSync(bare, { recursive: true });
    git(new Date().toISOString(), "-C", bare, "init", "-q", "--bare");
    git(new Date().toISOString(), "push", "-q", bare, "main:main");
    git(new Date().toISOString(), "fetch", "-q", bare, "+main:refs/remotes/origin/main");
  };
  const cadastrar = (): void => {
    const banco = abrir(raiz);
    registrarProjeto(banco, {
      nome,
      repo,
      branchBase: "main",
      hospedagem: "github",
      preparacao: [],
      sonar: { projectKey: nome },
    });
    banco.close();
  };
  return { repo, git, commitar, publicar, cadastrar };
}

/**
 * `fabriquinha`: a.ts com 5 alterações na janela (uma delas o commit do PR #7, aos 11 meses) e uma de 13 meses atrás,
 * b.ts com 1, sub/c.ts com 2, LEIAME com 1 e docs/antigo.md só com o commit de 13 meses (0 na janela). Total 9.
 */
function fabriquinhaComHistorico(raiz: string) {
  const r = repositorio(raiz, "fabriquinha");
  r.commitar(atras(13), "início", "docs/antigo.md", "src/a.ts", "src/b.ts", "src/sub/c.ts", "LEIAME");
  r.git(atras(11), "checkout", "-q", "-b", "ajuste");
  const doPR = r.commitar(atras(11), "feat: ajuste vindo do PR", "src/a.ts");
  r.git(atras(11), "checkout", "-q", "main");
  r.git(atras(11), "merge", "--no-ff", "-m", "Merge pull request #7 from origem/ajuste", "ajuste");
  const diretos = [
    r.commitar(atras(10), "ajusta a.ts 1", "src/a.ts"),
    r.commitar(atras(8), "ajusta a.ts e b.ts", "src/a.ts", "src/b.ts"),
    r.commitar(atras(6), "ajusta a.ts 3", "src/a.ts"),
    r.commitar(atras(4), "ajusta a.ts 4", "src/a.ts"),
  ];
  r.commitar(atras(3), "c.ts 1", "src/sub/c.ts");
  r.commitar(atras(2), "c.ts 2", "src/sub/c.ts");
  r.commitar(atras(1), "leiame", "LEIAME");
  r.publicar();
  r.cadastrar();
  return { ...r, doPR, diretos };
}

const linha = (pagina: Page, caminho: string) => pagina.locator(`details[data-caminho="${caminho}"]`);
const matiz = async (pagina: Page, caminho: string): Promise<number> => {
  const estilo = await linha(pagina, caminho).locator("> summary .hm-cor").getAttribute("style");
  return Number(/hsl\((\d+(?:\.\d+)?)/.exec(estilo ?? "")?.[1]);
};

test("CA-1 e CA-2: a página Projetos tem as abas Demandas (ativa) e Heatmap, que leva a /projects/fabriquinha/heatmap", async ({
  pagina,
  fabriquinha,
}) => {
  fabriquinhaComHistorico(fabriquinha.raiz);
  await pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Projetos" }).click();
  const abas = pagina.getByRole("navigation", { name: "Abas do projeto" });
  await expect(abas.getByRole("link", { name: "Demandas" })).toHaveAttribute("aria-current", "page");
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveCount(6);

  await abas.getByRole("link", { name: "Heatmap" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/fabriquinha/heatmap`);
  await expect(abas.getByRole("link", { name: "Heatmap" })).toHaveAttribute("aria-current", "page");
  await expect(pagina.locator("[data-arvore] > details")).toHaveCount(3);
  await expect(
    pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Projetos" }),
  ).toHaveAttribute("aria-current", "page");
});

test("CA-3, CA-4 e CA-11: linhas com nome, total e cor proporcional; o cabeçalho com a janela, a branch e o total", async ({
  pagina,
  fabriquinha,
}) => {
  fabriquinhaComHistorico(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/fabriquinha/heatmap`);

  const cabeca = pagina.locator(".hm-cabeca");
  await expect(cabeca).toContainText(`Janela ${dia(atras(12))} a ${dia(new Date())}`);
  await expect(cabeca).toContainText("branch main");
  await expect(cabeca).toContainText("9 alterações no projeto");

  const raiz = pagina.locator("[data-arvore] > details");
  // Mais alterações primeiro: src (8), LEIAME (1), docs (0); a soma da raiz é o total do cabeçalho.
  await expect(raiz.locator("> summary .hm-nome")).toHaveText(["src/", "LEIAME", "docs/"]);
  await expect(raiz.locator("> summary .hm-total")).toHaveText(["8", "1", "0"]);
  // Mais alterações, cor mais quente (matiz menor); sem alterações, a mais fria (220).
  expect(await matiz(pagina, "src")).toBeLessThan(await matiz(pagina, "LEIAME"));
  expect(await matiz(pagina, "docs")).toBe(220);
});

test("CA-5, CA-6, CA-7, CA-8 e CA-9: abrir e fechar a pasta, o detalhe do arquivo e a janela de 12 meses", async ({
  pagina,
  fabriquinha,
}) => {
  const { doPR, diretos } = fabriquinhaComHistorico(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/fabriquinha/heatmap`);

  const src = linha(pagina, "src");
  await expect(src.locator(".hm-filhos")).toHaveCount(0);
  await src.locator("> summary").click();
  const filhos = src.locator("> .hm-filhos > details");
  await expect(filhos.locator("> summary .hm-nome")).toHaveText(["a.ts", "sub/", "b.ts"]);
  await expect(filhos.locator("> summary .hm-total")).toHaveText(["5", "2", "1"]);
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/fabriquinha/heatmap`);

  // CA-7 e CA-9: só os 5 commits da janela; o de 13 meses atrás fica de fora; o do PR mostra o número do PR.
  await linha(pagina, "src/a.ts").locator("> summary").click();
  const detalhe = linha(pagina, "src/a.ts").locator(".hm-detalhe");
  await expect(detalhe.locator(".hm-metrica")).toHaveText("Código alterado: 5 alterações · quanto maior, pior");
  const commits = detalhe.locator("tbody tr");
  await expect(commits).toHaveCount(5);
  await expect(detalhe).not.toContainText("início");
  const doPr = commits.filter({ hasText: "feat: ajuste vindo do PR" });
  await expect(doPr.locator(".hm-hash")).toHaveText(doPR.slice(0, 7));
  await expect(doPr.locator(".hm-data")).toHaveText(dia(atras(11)));
  await expect(doPr.locator(".hm-pr")).toHaveText("PR #7");
  const direto = commits.filter({ hasText: "ajusta a.ts 1" });
  await expect(direto.locator(".hm-hash")).toHaveText(diretos[0]?.slice(0, 7) ?? "");
  await expect(direto.locator(".hm-pr")).toHaveText("sem PR");

  // CA-6: de novo em src, ele fecha e o conteúdo some.
  await src.locator("> summary").click();
  await expect(src.locator("> .hm-filhos")).toBeHidden();

  // CA-8: o arquivo só com commit de 13 meses atrás aparece com 0, na cor mais fria e sem commits.
  await linha(pagina, "docs").locator("> summary").click();
  await linha(pagina, "docs/antigo.md").locator("> summary").click();
  await expect(linha(pagina, "docs/antigo.md").locator("> summary .hm-total")).toHaveText("0");
  expect(await matiz(pagina, "docs/antigo.md")).toBe(220);
  await expect(linha(pagina, "docs/antigo.md").locator(".hm-metrica")).toHaveText(
    "Código alterado: 0 alterações · quanto maior, pior",
  );
  await expect(linha(pagina, "docs/antigo.md").locator("tbody tr")).toHaveCount(0);
});

test("CA-10: mais alterações dão uma métrica pior, e ela piora com mais um commit", async ({ pagina, fabriquinha }) => {
  const r = fabriquinhaComHistorico(fabriquinha.raiz);
  const metrica = async (arquivo: string): Promise<number> => {
    const aberto = linha(pagina, `src/${arquivo}`);
    await aberto.locator("> summary").click();
    const texto = await aberto.locator(".hm-metrica").innerText();
    return Number(/(\d+) alteraç(?:ão|ões)/.exec(texto)?.[1]);
  };
  const medir = async () => {
    await pagina.goto(`${fabriquinha.base}/projects/fabriquinha/heatmap`);
    await linha(pagina, "src").locator("> summary").click();
    return [await metrica("a.ts"), await metrica("b.ts")] as const;
  };

  const [a, b] = await medir();
  expect([a, b]).toEqual([5, 1]);
  expect(a).toBeGreaterThan(b);

  r.commitar(new Date().toISOString(), "ajusta a.ts 6", "src/a.ts");
  r.publicar();
  const [a6] = await medir();
  expect(a6).toBe(6);
  expect(a6).toBeGreaterThan(a);
});

test("CA-12: a URL do heatmap digitada direto abre a aba Heatmap com a raiz listada", async ({
  pagina,
  fabriquinha,
}) => {
  fabriquinhaComHistorico(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/fabriquinha/heatmap`);
  await expect(pagina.getByRole("link", { name: "Heatmap" })).toHaveAttribute("aria-current", "page");
  await expect(pagina.getByLabel("Projeto", { exact: true })).toHaveValue("fabriquinha");
  await expect(pagina.locator("[data-arvore] > details")).toHaveCount(3);
});

test("CA-13: projeto inexistente mostra Projeto não encontrado com o link Ver os projetos", async ({
  pagina,
  fabriquinha,
}) => {
  await pagina.goto(`${fabriquinha.base}/projects/inexistente/heatmap`);
  await expect(pagina.getByRole("heading", { name: "Projeto não encontrado" })).toBeVisible();
  await expect(pagina.getByRole("link", { name: "Ver os projetos" })).toHaveAttribute("href", "/projects");
});

test("CA-14: repositório sumido ou sem a branch base mostra o erro com o motivo, e a aba Demandas segue funcionando", async ({
  pagina,
  fabriquinha,
}) => {
  const sumido = repositorio(fabriquinha.raiz, "sumido");
  sumido.commitar(atras(1), "início", "a.ts");
  sumido.publicar();
  sumido.cadastrar();
  rmSync(sumido.repo, { recursive: true });
  const semBase = repositorio(fabriquinha.raiz, "sem-base");
  semBase.commitar(atras(1), "início", "a.ts");
  semBase.cadastrar();

  await pagina.goto(`${fabriquinha.base}/projects/sumido/heatmap`);
  const erro = pagina.getByRole("alert");
  await expect(erro).toContainText("Não foi possível montar o heatmap.");
  await expect(erro).toContainText(`o repositório ${sumido.repo} não existe mais no disco`);
  await expect(erro).toContainText("corrija o caminho do repositório do projeto na Configuração");
  await expect(pagina.locator("[data-arvore]")).toHaveCount(0);

  await pagina.getByRole("navigation", { name: "Abas do projeto" }).getByRole("link", { name: "Demandas" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/sumido`);
  await expect(pagina.locator(".kpis-mes .kpi")).toHaveCount(6);

  // O seletor leva ao heatmap do outro projeto, que não tem a branch base publicada.
  await pagina.goto(`${fabriquinha.base}/projects/sumido/heatmap`);
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("sem-base");
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/sem-base/heatmap`);
  await expect(pagina.getByRole("alert")).toContainText("a branch base main não existe");
});

test("CA-15: sem commits nos últimos 12 meses, a mensagem de janela vazia e todos os totais em 0", async ({
  pagina,
  fabriquinha,
}) => {
  const parado = repositorio(fabriquinha.raiz, "parado");
  parado.commitar(atras(13), "início", "src/a.ts", "LEIAME");
  parado.publicar();
  parado.cadastrar();

  await pagina.goto(`${fabriquinha.base}/projects/parado/heatmap`);
  await expect(pagina.getByText("Nenhuma alteração nos últimos 12 meses")).toBeVisible();
  await expect(pagina.locator(".hm-cabeca")).toContainText("0 alterações no projeto");
  await expect(pagina.locator("[data-arvore] > details > summary .hm-total")).toHaveText(["0", "0"]);
});
