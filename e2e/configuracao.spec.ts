// Configuração (F7 §4.4; I-247 CA-13): cadastrar um projeto com um campo inválido, corrigir, salvar e ligar o
// agendador; o cadastro grava o projeto sem colunas do fluxo legado, com a chave do SonarQube no nome dele.
import type { TestInfo } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { expect, fotografar, test } from "./apoio.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** Clone com `origin` de cara GitHub; um `insteadOf` local desvia o acesso para um bare no disco, com `main`. */
function clone(raiz: string): string {
  const bare = join(raiz, "origin.git");
  const repo = join(raiz, "loja");
  mkdirSync(bare);
  mkdirSync(repo);
  git(bare, "init", "--bare", "-q");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "início");
  git(repo, "push", "-q", bare, "HEAD:refs/heads/main");
  git(repo, "remote", "add", "origin", "https://github.com/dono/loja.git");
  git(repo, "config", `url.${bare}.insteadOf`, "https://github.com/dono/loja.git");
  return realpathSync(repo);
}

test("cadastra um projeto com um campo inválido, corrige, salva e liga o agendador; sem os campos legados (CA-13)", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  const repo = clone(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/config`);
  await expect(pagina).toHaveTitle("Configuração · Fabriquinha");
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await expect(menu.getByRole("link", { name: "Agendador" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("desligado");
  await expect(pagina.locator(".status-ag")).toHaveText("Desligado: não procura tickets");

  await menu.getByRole("link", { name: "+ Novo projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?novo`);
  await expect(pagina.getByRole("heading", { name: "Novo projeto" })).toBeVisible();
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("deduzida do remoto ao salvar");
  const formulario = pagina.locator("form[data-projeto]");
  await expect(formulario.locator("h3")).toHaveText(["Repositório", "Preparação"]);
  await expect(formulario).not.toContainText(/Testes|SonarQube|Fitness|Modelo|Effort/);
  await pagina.getByLabel("Nome", { exact: true }).fill("Loja X");
  await pagina.getByLabel("Caminho do repositório").fill(repo);
  await pagina.getByRole("button", { name: "+ comando" }).click();
  await pagina.getByLabel("Preparação da worktree: comando 1").fill("npm ci");

  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  const nome = pagina.getByLabel("Nome", { exact: true });
  await expect(nome).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator(".campo", { has: nome }).locator(".msg-erro")).toHaveText(
    "use letras minúsculas, números e hífen, começando por letra ou número (até 64)",
  );
  await expect(pagina.locator(".rodape-form")).toContainText("1 campo com erro");
  await expect(pagina.getByLabel("Preparação da worktree: comando 1")).toHaveValue("npm ci");

  await nome.fill("loja");
  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?projeto=loja`);
  await expect(pagina.getByRole("heading", { level: 2, name: /^loja/ })).toBeVisible();
  await expect(menu.getByRole("link", { name: "loja" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "loja" })).toContainText("GitHub");
  await expect(pagina.getByLabel("Nome", { exact: true })).toHaveAttribute("readonly", "");
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("GitHub");
  await expect(pagina.getByLabel("Preparação da worktree: comando 1")).toHaveValue("npm ci");
  await expect(pagina.getByRole("button", { name: "Salvar projeto" })).toBeVisible();
  const banco = abrir(fabriquinha.raiz);
  expect({ ...banco.prepare("SELECT * FROM projeto WHERE nome = 'loja'").get() }).toEqual({
    nome: "loja",
    repo: expect.any(String),
    branch_base: "main",
    hospedagem: "github",
    preparacao: '["npm ci"]',
    sonar_project_key: "loja",
    link_produto: null,
    cursor_commit_humano: null,
  });
  banco.close();
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-projeto-${String(largura)}`);
  }
  await pagina.setViewportSize({ width: 1440, height: 900 });

  await menu.getByRole("link", { name: "Agendador" }).click();
  await expect(pagina.getByText("Desligado: não procura tickets")).toBeVisible();
  await pagina.getByText("procura tickets abertos das demandas e os executa").click();
  await pagina.getByRole("spinbutton", { name: "Procurar a cada" }).fill("10");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("ligado");
  await expect(pagina.locator(".status-ag")).toHaveText(/^Próxima busca às \d\d:\d\d$/);
  await expect(pagina.getByRole("spinbutton", { name: "Procurar a cada" })).toHaveValue("10");
  await expect(pagina.getByRole("checkbox", { name: /Agendador/ })).toBeChecked();
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await fotografar(pagina, info, `configuracao-agendador-${String(largura)}`);
  }
});

test("escolhe o modelo das avaliações, salva, recarrega e vê o mesmo; salvar o Agendador não o apaga", async ({
  pagina,
  fabriquinha,
}) => {
  await pagina.goto(`${fabriquinha.base}/config?avaliacoes`);
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await expect(menu.getByRole("link", { name: "Avaliações" })).toHaveAttribute("aria-current", "page");
  const modelo = pagina.getByLabel("Modelo das avaliações");
  await expect(modelo).toHaveValue("");
  await expect(modelo).toHaveClass("padrao");
  await modelo.selectOption("anthropic/claude-sonnet-5-5");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByRole("button", { name: "Salvar" })).toBeEnabled();

  await pagina.reload();
  await expect(pagina.getByLabel("Modelo das avaliações")).toHaveValue("anthropic/claude-sonnet-5-5");
  const gravada = await pagina.request.get(`${fabriquinha.base}/api/configuracao`);
  expect(((await gravada.json()) as { modeloAuditoria: unknown }).modeloAuditoria).toEqual({
    provedor: "anthropic",
    modelo: "claude-sonnet-5-5",
  });

  await menu.getByRole("link", { name: "Agendador" }).click();
  await pagina.getByRole("spinbutton", { name: "Procurar a cada" }).fill("7");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(pagina.getByRole("spinbutton", { name: "Procurar a cada" })).toHaveValue("7");
  await menu.getByRole("link", { name: "Avaliações" }).click();
  await expect(pagina.getByLabel("Modelo das avaliações")).toHaveValue("anthropic/claude-sonnet-5-5");
});
