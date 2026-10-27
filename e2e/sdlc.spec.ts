// Configuração SDLC do projeto (seção 7.1): abrir, editar, salvar e recarregar; erros no campo certo; Adicionar e
// Remover; projeto sem configuração; celular de 375 px; e a branch base compartilhada com a tela legada.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { expect, projeto, test } from "./apoio.ts";

/** A configuração SDLC do projeto `loja`, com todos os grupos e duas linguagens; a segunda não tem E2E. */
function configurar(raiz: string): void {
  const banco = abrir(raiz);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "develop",
    chave_sonarqube: "loja",
    raiz_git: realpathSync(join(raiz, "loja")),
    hospedagem: "github",
    etapas: [{ etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude-opus-5-5", effort: "high" }],
    preparacao: [{ ordem: 1, comando: "npm ci" }],
    fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Rotas novas com cobertura mínima." }],
    linguagens: [
      { caminho: ".", linguagem: "typescript", comando_teste: "npm test" },
      { caminho: "web", linguagem: "typescript", comando_teste: "npm run test:web" },
    ],
    e2e: [{ caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 }],
    globs: [{ caminho_linguagem: ".", glob: "e2e/**/*.spec.ts" }],
  });
  banco.close();
}

test("abre a configuração, adiciona e remove linhas, salva a branch base e vê o que salvou ao recarregar", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  await expect(pagina).toHaveTitle("Configuração SDLC · Fabriquinha");
  for (const grupo of ["Projeto", "Etapas", "Preparação", "Fitness", "Linguagens", "E2E", "Globs"])
    await expect(pagina.getByRole("region", { name: grupo })).toBeVisible();
  await expect(pagina.getByLabel("Branch base")).toHaveValue("develop");
  await expect(pagina.getByLabel("Nome do modelo da etapa planejar")).toHaveValue("claude-opus-5-5");
  await expect(pagina.getByLabel("Effort da etapa planejar")).toHaveValue("high");
  await expect(pagina.getByLabel("Comando", { exact: true }).first()).toHaveValue("npm ci");
  await expect(pagina.getByLabel("Código de falha")).toHaveValue("1");
  await expect(pagina.getByLabel("Glob", { exact: true })).toHaveValue("e2e/**/*.spec.ts");

  const fitness = pagina.getByRole("region", { name: "Fitness" });
  await fitness.getByRole("button", { name: "Adicionar" }).click();
  await expect(fitness.locator("[data-linha]")).toHaveCount(2);
  await expect(fitness.locator("[data-linha]").last().getByLabel("Nome", { exact: true })).toHaveValue("");
  await fitness.locator("[data-linha]").last().getByRole("button", { name: "Remover" }).click();
  await expect(fitness.locator("[data-linha]")).toHaveCount(1);

  const linguagens = pagina.getByRole("region", { name: "Linguagens" });
  await expect(linguagens.locator("[data-linha]")).toHaveCount(2);
  await linguagens.locator("[data-linha]").nth(1).getByRole("button", { name: "Remover" }).click();
  await expect(linguagens.locator("[data-linha]")).toHaveCount(1);

  await pagina.getByLabel("Branch base").fill("release");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByText("Configuração salva.")).toBeVisible();
  await pagina.reload();
  await expect(pagina.getByLabel("Branch base")).toHaveValue("release");
  await expect(pagina.getByRole("region", { name: "Linguagens" }).locator("[data-linha]")).toHaveCount(1);
  await expect(pagina.getByRole("region", { name: "Linguagens" }).getByLabel("Caminho")).toHaveValue(".");
});

test("a configuração inválida não grava e mostra o erro no campo ou no grupo certo", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  const salvar = pagina.getByRole("button", { name: "Salvar" });

  await pagina.getByLabel("Nome do modelo da etapa planejar").fill("");
  await salvar.click();
  const nome = pagina.getByLabel("Nome do modelo da etapa planejar");
  await expect(nome).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator("#campo-etapas\\[planejar\\]\\.modelo_nome-erro")).toHaveText(
    "informe provedor e nome do modelo juntos ou nenhum",
  );
  await nome.fill("claude-opus-5-5");

  await pagina.getByLabel("Código de falha").fill("0");
  await salvar.click();
  await expect(pagina.getByLabel("Código de falha")).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.getByText("use um valor de 1 a 255")).toBeVisible();
  await expect(nome).not.toHaveAttribute("aria-invalid", "true");
  await pagina.getByLabel("Código de falha").fill("1");

  const globs = pagina.getByRole("region", { name: "Globs" });
  await globs.getByRole("button", { name: "Remover" }).click();
  await salvar.click();
  await expect(pagina.getByRole("region", { name: "E2E" }).getByText("E2E exige ao menos um glob")).toBeVisible();

  await pagina.reload();
  await expect(pagina.getByLabel("Código de falha")).toHaveValue("1");
  await expect(pagina.getByLabel("Glob", { exact: true })).toHaveValue("e2e/**/*.spec.ts");

  const preparacao = pagina.getByRole("region", { name: "Preparação" });
  await preparacao.getByRole("button", { name: "Adicionar" }).click();
  const nova = preparacao.locator("[data-linha]").last();
  await nova.getByLabel("Ordem").fill("1");
  await nova.getByLabel("Comando").fill("npm run build");
  await salvar.click();
  await expect(preparacao.getByText("ordem repetida")).toBeVisible();
});

test("um POST direto com effort inexistente responde 422 no campo da etapa e não grava", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  const url = `${fabriquinha.base}/api/projetos/loja/configuracao-sdlc`;
  const lerEtapa = async () =>
    ((await (await pagina.request.get(url)).json()) as { configuracao: { etapas: { effort: string }[] } }).configuracao;
  const configuracao = await lerEtapa();
  configuracao.etapas[0] = { ...configuracao.etapas[0], effort: "inexistente" };
  const resposta = await pagina.request.post(url, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: configuracao,
  });
  expect(resposta.status()).toBe(422);
  const corpo = await resposta.text();
  expect(corpo).toContain("etapas");
  expect(corpo).toContain("effort");
  expect(corpo).toContain("use um valor do domínio");
  expect((await lerEtapa()).etapas[0]?.effort).toBe("high");
});

test("o erro aparece sob o controle sem deslocar a linha", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  const remover = pagina.getByRole("region", { name: "E2E" }).getByRole("button", { name: "Remover" });
  const codigo = pagina.getByLabel("Código de falha");
  // Distância entre o botão e o controle da mesma linha: a rolagem da página não a altera.
  const distancia = async () => ((await remover.boundingBox())?.y ?? 0) - ((await codigo.boundingBox())?.y ?? 0);
  const antes = await distancia();
  await codigo.fill("0");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByText("use um valor de 1 a 255")).toBeVisible();
  expect(await distancia()).toBe(antes);
  expect(await codigo.evaluate((el) => el.getBoundingClientRect().height)).toBe(34);
});

test("o projeto sem configuração SDLC mostra a mensagem e o botão que abre os grupos", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  await expect(pagina.getByText("O projeto loja ainda não tem configuração SDLC.")).toBeVisible();
  await expect(pagina.getByRole("region")).toHaveCount(0);
  await pagina.getByRole("button", { name: "Criar configuração" }).click();
  await expect(pagina.getByLabel("Branch base")).toHaveValue("main");
  await pagina.getByRole("region", { name: "Fitness" }).getByLabel("Nome", { exact: true }).fill("cobertura");
  await pagina.getByRole("region", { name: "Fitness" }).getByLabel("Comando").fill("npm run cobertura");
  await pagina.getByRole("region", { name: "Fitness" }).getByLabel("Descrição").fill("Cobertura mínima.");
  const linguagens = pagina.getByRole("region", { name: "Linguagens" });
  await linguagens.getByLabel("Caminho").fill(".");
  await linguagens.getByLabel("Linguagem").fill("typescript");
  await linguagens.getByLabel("Comando de teste").fill("npm test");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByText("Configuração salva.")).toBeVisible();
  await pagina.reload();
  await expect(pagina.getByText("ainda não tem configuração SDLC")).toHaveCount(0);
  await expect(pagina.getByRole("region", { name: "Fitness" }).getByLabel("Nome", { exact: true })).toHaveValue(
    "cobertura",
  );
});

test.describe("celular", () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test("com todos os grupos preenchidos, nenhum campo ou botão é cortado e a página não rola na horizontal", async ({
    pagina,
    fabriquinha,
  }) => {
    projeto(fabriquinha.raiz);
    configurar(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
    await expect(pagina.getByLabel("Branch base")).toHaveValue("develop");
    await pagina.getByLabel("Código de falha").fill("0");
    await pagina.getByRole("button", { name: "Salvar" }).click();
    await expect(pagina.getByText("use um valor de 1 a 255")).toBeVisible();
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
    const cortados = await pagina.locator("main input, main select, main button").evaluateAll(
      (els) =>
        els.filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && (r.left < 0 || r.right > innerWidth);
        }).length,
    );
    expect(cortados).toBe(0);
  });
});

test("a branch base é a mesma na configuração SDLC e na tela legada, nos dois sentidos", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  const repo = join(fabriquinha.raiz, "loja");
  for (const branch of ["release", "main"]) {
    execFileSync("git", ["push", "-q", "origin", `main:refs/heads/${branch}`], { cwd: repo, stdio: "pipe" });
  }
  // O cadastro legado confere o remoto: um `origin` de cara GitHub, desviado para o bare local por `insteadOf`.
  const bare = join(fabriquinha.raiz, "origin.git");
  const github = "https://github.com/dono/loja.git";
  execFileSync("git", ["remote", "set-url", "origin", github], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["config", `url.${bare}.insteadOf`, github], { cwd: repo, stdio: "pipe" });

  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  await pagina.getByLabel("Branch base").fill("release");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByText("Configuração salva.")).toBeVisible();
  await pagina.getByRole("link", { name: "Cadastro do projeto" }).click();
  await expect(pagina.getByRole("heading", { name: /loja 0 issues/ })).toBeVisible();
  await expect(pagina.getByLabel("Branch base")).toHaveValue("release");

  await pagina.getByLabel("Branch base").fill("main");
  await Promise.all([
    pagina.waitForResponse((r) => r.url().endsWith("/api/projetos/loja") && r.request().method() === "POST"),
    pagina.getByRole("button", { name: "Salvar projeto" }).click(),
  ]);
  await pagina.getByRole("link", { name: "Configuração SDLC do projeto" }).click();
  await expect(pagina.getByRole("heading", { name: /Configuração SDLC/ })).toBeVisible();
  await expect(pagina.getByLabel("Branch base")).toHaveValue("main");
});
