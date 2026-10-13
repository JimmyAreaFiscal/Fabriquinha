// Simulação (I-10): o Link do produto no Projeto (CA-1 e CA-2) e os Usuários Simulados da Configuração (CA-3 a CA-6).
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import type { Page } from "@playwright/test";
import { expect, test } from "./apoio.ts";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * O projeto `fabriquinha`, sem link do produto, com um clone de remoto GitHub: o `insteadOf` desvia o acesso para um
 * bare local, e salvar passa pela conferência do repositório (F5 §2).
 */
function semear(raiz: string, linkProduto?: string): void {
  const bare = join(raiz, "origin.git");
  const repo = join(raiz, "fabriquinha");
  mkdirSync(bare);
  mkdirSync(repo);
  git(bare, "init", "--bare", "-q");
  git(repo, "init", "-q", "-b", "main");
  git(repo, "-c", "user.name=x", "-c", "user.email=x@x", "commit", "-q", "--allow-empty", "-m", "início");
  git(repo, "push", "-q", bare, "HEAD:refs/heads/main");
  git(repo, "remote", "add", "origin", "https://github.com/dono/fabriquinha.git");
  git(repo, "config", `url.${bare}.insteadOf`, "https://github.com/dono/fabriquinha.git");
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "fabriquinha",
    repo: realpathSync(repo),
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "Fabriquinha" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linkProduto,
  });
  banco.close();
}

test("CA-1 e CA-2: o link do produto é salvo e relido; um link inválido dá erro no campo e o anterior fica", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const url = `${fabriquinha.base}/config?projeto=fabriquinha`;
  await pagina.goto(url);
  const campo = pagina.getByLabel("Link do produto");
  await expect(campo).toHaveValue("");

  await campo.fill("https://demo.exemplo.com");
  await pagina.getByRole("button", { name: "Salvar projeto" }).click();
  await pagina.goto(url);
  await expect(campo).toHaveValue("https://demo.exemplo.com");

  await campo.fill("isso nao e um link");
  await pagina.getByRole("button", { name: "Salvar projeto" }).click();
  await expect(campo).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator(".campo", { has: campo }).locator(".msg-erro")).toHaveText(
    "Informe um link http(s) válido, como https://produto.exemplo.com",
  );
  await pagina.goto(url);
  await expect(campo).toHaveValue("https://demo.exemplo.com");
});

/** O formulário de novo Usuário Simulado, abaixo do formulário do projeto. */
const novoUsuario = (pagina: Page) => pagina.locator("[data-usuario-simulado]");

const DESCRICAO = "Contadora de 60 anos, pouca familiaridade com sistemas web";

/** O cartão do Usuário Simulado `nome`, no bloco abaixo do formulário do projeto. */
const cartao = (pagina: Page, nome: string) =>
  pagina.locator(".cartao-usuario", { has: pagina.getByRole("heading", { name: nome }) });

async function criarDonaMaria(pagina: Page): Promise<void> {
  await novoUsuario(pagina).getByLabel("Nome do usuário").fill("Dona Maria");
  await novoUsuario(pagina).getByLabel("Descrição do usuário").fill(DESCRICAO);
  await pagina.getByRole("button", { name: "Criar usuário simulado" }).click();
}

test("CA-3: o Usuário Simulado criado aparece na lista do projeto, também depois de recarregar", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com");
  await pagina.goto(`${fabriquinha.base}/config?projeto=fabriquinha`);
  await expect(pagina.getByText("Nenhum usuário simulado neste projeto ainda.")).toBeVisible();

  await criarDonaMaria(pagina);
  await expect(cartao(pagina, "Dona Maria")).toContainText(DESCRICAO);
  await expect(novoUsuario(pagina).getByLabel("Descrição do usuário")).toHaveValue("");

  await pagina.reload();
  await expect(cartao(pagina, "Dona Maria")).toContainText(DESCRICAO);
});

test("CA-4: sem a descrição o Usuário Simulado não é criado e o campo mostra o erro", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com");
  await pagina.goto(`${fabriquinha.base}/config?projeto=fabriquinha`);
  await novoUsuario(pagina).getByLabel("Nome do usuário").fill("Seu João");
  await pagina.getByRole("button", { name: "Criar usuário simulado" }).click();

  const descricao = novoUsuario(pagina).getByLabel("Descrição do usuário");
  await expect(descricao).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator("#campo-usuario-descricao-erro")).toHaveText("Descrição obrigatória");
  await expect(novoUsuario(pagina).getByLabel("Nome do usuário")).toHaveValue("Seu João");
  await pagina.reload();
  await expect(pagina.getByText("Nenhum usuário simulado neste projeto ainda.")).toBeVisible();
});

test("CA-5 e CA-6: o anexo aparece com o tamanho em bytes e some quando removido", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com");
  await pagina.goto(`${fabriquinha.base}/config?projeto=fabriquinha`);
  await criarDonaMaria(pagina);
  const maria = cartao(pagina, "Dona Maria");

  await maria.locator("[data-anexar]").setInputFiles({
    name: "manual.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.alloc(248731, "%"),
  });
  await expect(maria.locator(".anexo-usuario")).toHaveText(/^manual\.pdf\s+248\.731 bytes\s*×$/);
  await pagina.reload();
  await expect(maria.locator(".anexo-usuario")).toContainText("manual.pdf 248.731 bytes");

  await maria.getByRole("button", { name: "Remover o anexo manual.pdf" }).click();
  await expect(maria.locator(".anexo-usuario")).toHaveCount(0);
  await pagina.reload();
  await expect(maria.getByText("manual.pdf")).toHaveCount(0);
});

test("um formato que a IA não lê é recusado no cartão, sem anexo", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com");
  await pagina.goto(`${fabriquinha.base}/config?projeto=fabriquinha`);
  await criarDonaMaria(pagina);
  const maria = cartao(pagina, "Dona Maria");

  await maria.locator("[data-anexar]").setInputFiles({
    name: "planilha.xlsx",
    mimeType: "application/vnd.ms-excel",
    buffer: Buffer.from("x"),
  });
  await expect(maria.getByRole("alert")).toHaveText("formato não suportado: envie PDF, texto ou imagem");
  await expect(maria.locator(".anexo-usuario")).toHaveCount(0);
});
