// Configuração SDLC do projeto (seção 7.1): abrir, editar, salvar e recarregar sem apagar as etapas, que são do
// cadastro; erros no campo certo; Adicionar e Remover; projeto sem configuração; celular de 375 px; e a branch base
// compartilhada com o cadastro do projeto na Configuração.
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto, substituirEtapasDoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { expect, projeto, test } from "./apoio.ts";

const PLANEJAR = { etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude-opus-5-5", effort: "high" };

/**
 * A configuração SDLC do projeto `loja`, com todos os grupos e duas linguagens; a segunda não tem E2E. A etapa
 * `planejar`, gravada pelo cadastro do projeto, tem modelo e effort.
 */
function configurar(raiz: string): void {
  const banco = abrir(raiz);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "develop",
    chave_sonarqube: "loja",
    raiz_git: realpathSync(join(raiz, "loja")),
    hospedagem: "github",
    preparacao: [{ ordem: 1, comando: "npm ci" }],
    fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Rotas novas com cobertura mínima." }],
    linguagens: [
      { caminho: ".", linguagem: "typescript", comando_teste: "npm test" },
      { caminho: "web", linguagem: "typescript", comando_teste: "npm run test:web" },
    ],
    e2e: [{ caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 }],
    globs: [{ caminho_linguagem: ".", glob: "e2e/**/*.spec.ts" }],
  });
  substituirEtapasDoProjeto(banco, "loja", [PLANEJAR]);
  banco.close();
}

/** As etapas gravadas do projeto `loja`. */
function etapasGravadas(raiz: string): unknown[] {
  const banco = abrir(raiz);
  const etapas = banco
    .prepare(
      "SELECT etapa, modelo_provedor, modelo_nome, effort FROM configuracao_etapa_projeto WHERE projeto = 'loja'",
    )
    .all()
    .map((l) => ({ ...l }));
  banco.close();
  return etapas;
}

test("abre a configuração sem as etapas, adiciona e remove linhas, salva a branch base e vê o que salvou ao recarregar; as etapas do cadastro ficam", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  await expect(pagina).toHaveTitle("Configuração SDLC · Fabriquinha");
  for (const grupo of ["Projeto", "Preparação", "Fitness", "Linguagens", "E2E", "Globs"])
    await expect(pagina.getByRole("region", { name: grupo })).toBeVisible();
  // O modelo e o effort de cada etapa se editam só no cadastro do projeto, na Configuração.
  await expect(pagina.getByRole("region")).toHaveCount(6);
  await expect(pagina.locator("main")).not.toContainText(/Etapas|tela legada/);
  await expect(pagina.locator("main select")).toHaveCount(0);
  await expect(pagina.getByRole("region", { name: "Projeto" })).toContainText(
    "A branch base é a do cadastro do projeto, na Configuração: mudar aqui muda lá. O repositório, a hospedagem e o modelo e o effort de cada etapa só se editam no cadastro.",
  );
  await expect(pagina.getByLabel("Branch base")).toHaveValue("develop");
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
  expect(etapasGravadas(fabriquinha.raiz)).toEqual([PLANEJAR]);
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

  await pagina.getByLabel("Código de falha").fill("0");
  await salvar.click();
  await expect(pagina.getByLabel("Código de falha")).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.getByText("use um valor de 1 a 255")).toBeVisible();
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

test("a branch base é a mesma na configuração SDLC e no cadastro do projeto, nos dois sentidos", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  configurar(fabriquinha.raiz);
  const repo = join(fabriquinha.raiz, "loja");
  for (const branch of ["release", "main"]) {
    execFileSync("git", ["push", "-q", "origin", `main:refs/heads/${branch}`], { cwd: repo, stdio: "pipe" });
  }
  // O cadastro do projeto confere o remoto: um `origin` de cara GitHub, desviado para o bare local por `insteadOf`.
  const bare = join(fabriquinha.raiz, "origin.git");
  const github = "https://github.com/dono/loja.git";
  execFileSync("git", ["remote", "set-url", "origin", github], { cwd: repo, stdio: "pipe" });
  execFileSync("git", ["config", `url.${bare}.insteadOf`, github], { cwd: repo, stdio: "pipe" });

  await pagina.goto(`${fabriquinha.base}/projects/loja/sdlc`);
  await pagina.getByLabel("Branch base").fill("release");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByText("Configuração salva.")).toBeVisible();
  await pagina.getByRole("link", { name: "Cadastro do projeto" }).click();
  await expect(pagina.getByRole("heading", { level: 2, name: /^loja/ })).toBeVisible();
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
