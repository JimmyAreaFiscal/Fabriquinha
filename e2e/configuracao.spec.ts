// Configuração (F7 §4.4): cadastrar um projeto com um campo inválido, corrigir, salvar e ligar o agendador.
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "./apoio.ts";

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

test("cadastra um projeto com um campo inválido, corrige, salva e liga o agendador", async ({
  pagina,
  fabriquinha,
}) => {
  const repo = clone(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/config`);
  await expect(pagina).toHaveTitle("Configuração · Fabriquinha");
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  await expect(menu.getByRole("link", { name: "Agendador" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("desligado");

  await menu.getByRole("link", { name: "+ Novo projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?novo`);
  await expect(pagina.getByRole("heading", { name: "Novo projeto" })).toBeVisible();
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("deduzida do remoto ao salvar");
  await pagina.getByLabel("Nome", { exact: true }).fill("Loja X");
  await pagina.getByLabel("Caminho do repositório").fill(repo);
  await pagina.getByLabel("Projeto no SonarQube").fill("loja");
  await pagina.getByLabel("Testes: comando 1").fill("npm test");
  await pagina.getByRole("button", { name: "+ comando" }).first().click();
  await pagina.getByLabel("Preparação da worktree: comando 1").fill("npm ci");
  await pagina.getByLabel("Fitness function 1: nome").fill("cobertura");
  await pagina.getByLabel("Fitness function 1: comando").fill("npm run cobertura");
  await pagina.getByLabel("Fitness function 1: descrição").fill("Rotas novas com cobertura mínima.");
  // O seletor vem de GET /api/modelos (o pi falso lista dois); vazio é o padrão do pi, apagado.
  const desenho = pagina.getByLabel("Desenho", { exact: true });
  await expect(desenho.locator("option")).toHaveText([
    "padrão do pi",
    "anthropic / claude-opus-5-5",
    "anthropic / claude-sonnet-5-5",
  ]);
  await expect(desenho).toHaveClass("padrao");
  await desenho.selectOption("anthropic/claude-opus-5-5");
  await expect(desenho).not.toHaveClass("padrao");

  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  const nome = pagina.getByLabel("Nome", { exact: true });
  await expect(nome).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator(".campo", { has: nome }).locator(".msg-erro")).toHaveText(
    "use letras minúsculas, números e hífen, começando por letra ou número (até 64)",
  );
  await expect(pagina.locator(".rodape-form")).toContainText("1 campo com erro");
  await expect(pagina.getByLabel("Preparação da worktree: comando 1")).toHaveValue("npm ci");
  await expect(desenho).toHaveValue("anthropic/claude-opus-5-5");

  await nome.fill("loja");
  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config?projeto=loja`);
  await expect(pagina.getByRole("heading", { name: "loja 0 issues" })).toBeVisible();
  await expect(menu.getByRole("link", { name: "loja" })).toHaveAttribute("aria-current", "page");
  await expect(menu.getByRole("link", { name: "loja" })).toContainText("GitHub");
  await expect(pagina.getByLabel("Nome", { exact: true })).toHaveAttribute("readonly", "");
  await expect(pagina.getByLabel("Hospedagem")).toHaveValue("GitHub");
  await expect(pagina.getByLabel("Desenho", { exact: true })).toHaveValue("anthropic/claude-opus-5-5");
  await expect(pagina.getByRole("button", { name: "Salvar projeto" })).toBeVisible();

  await menu.getByRole("link", { name: "Agendador" }).click();
  await expect(pagina.getByText("Desligado: não procura tickets")).toBeVisible();
  await pagina.getByText("procura tickets abertos e executa um por vez").click();
  await pagina.getByRole("spinbutton", { name: "Procurar a cada" }).fill("10");
  await pagina.getByRole("button", { name: "Salvar" }).click();
  await expect(menu.getByRole("link", { name: "Agendador" })).toContainText("ligado");
  await expect(pagina.getByText(/^Próxima busca às \d\d:\d\d$/)).toBeVisible();
  await expect(pagina.getByText("Nenhuma execução autônoma em andamento")).toBeVisible();
  await expect(pagina.getByRole("spinbutton", { name: "Procurar a cada" })).toHaveValue("10");
  await expect(pagina.getByRole("checkbox", { name: /Agendador/ })).toBeChecked();
});
