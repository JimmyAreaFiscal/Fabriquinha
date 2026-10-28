// Simulação (I-10): o Link do produto no Projeto (CA-1 e CA-2), os Usuários Simulados da Configuração (CA-3 a CA-6),
// as Tarefas da página Simulação (CA-7 a CA-9) e o Executar com o relatório (CA-10 a CA-14).
import { execFileSync } from "node:child_process";
import { mkdirSync, realpathSync } from "node:fs";
import { createServer } from "node:http";
import { createServer as servidorTcp } from "node:net";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import { criarTarefa, criarUsuarioSimulado } from "../src/persistencia/simulacao.ts";
import type { Page } from "@playwright/test";
import { expect, test } from "./apoio.ts";

const DESCRICAO = "Contadora de 60 anos, pouca familiaridade com sistemas web";

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/**
 * O projeto `fabriquinha`, sem link do produto, com um clone de remoto GitHub: o `insteadOf` desvia o acesso para um
 * bare local, e salvar passa pela conferência do repositório (F5 §2).
 */
function semear(raiz: string, linkProduto?: string, usuarios: string[] = [], tarefa?: { n: number }): void {
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
    sonar: { projectKey: "Fabriquinha" },
    linkProduto,
  });
  const alocados = usuarios.map((nome) => criarUsuarioSimulado(banco, "fabriquinha", { nome, descricao: DESCRICAO }));
  if (tarefa) criarTarefa(banco, "fabriquinha", { texto: TAREFA, n: tarefa.n, usuarios: alocados.map((u) => u.id) });
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

const TAREFA = "Registrar uma necessidade";

/** O formulário de nova Tarefa, na página Simulação. */
const novaTarefa = (pagina: Page) => pagina.locator("[data-nova-tarefa]");

test("CA-7: a Tarefa criada aparece em Simulação com N e o usuário alocado, também depois de recarregar", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com", ["Dona Maria"]);
  await pagina.goto(`${fabriquinha.base}/simulation`);
  await expect(pagina).toHaveURL(`${fabriquinha.base}/simulation/fabriquinha`);
  await expect(pagina.getByText("Nenhuma tarefa neste projeto.")).toBeVisible();

  await novaTarefa(pagina).getByLabel("Tarefa", { exact: true }).fill(TAREFA);
  await novaTarefa(pagina).getByLabel("Execuções por usuário (N)").fill("3");
  await novaTarefa(pagina).getByLabel("Dona Maria").check();
  await pagina.getByRole("button", { name: "Criar tarefa" }).click();

  const cartao = pagina.locator("[data-tarefa]", { hasText: TAREFA });
  await expect(cartao).toContainText("N = 3");
  await expect(cartao).toContainText("alocada a Dona Maria");
  await expect(novaTarefa(pagina).getByLabel("Tarefa", { exact: true })).toHaveValue("");
  await pagina.reload();
  await expect(cartao).toContainText("N = 3");
});

test("CA-8: com N = 0 a Tarefa não é criada e o campo N mostra o erro", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com", ["Dona Maria"]);
  await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
  await novaTarefa(pagina).getByLabel("Tarefa", { exact: true }).fill(TAREFA);
  await novaTarefa(pagina).getByLabel("Execuções por usuário (N)").fill("0");
  await novaTarefa(pagina).getByLabel("Dona Maria").check();
  await pagina.getByRole("button", { name: "Criar tarefa" }).click();

  await expect(novaTarefa(pagina).getByLabel("Execuções por usuário (N)")).toHaveAttribute("aria-invalid", "true");
  await expect(pagina.locator("#campo-tarefa-n-erro")).toHaveText("N deve ser um inteiro maior que zero");
  await expect(novaTarefa(pagina).getByLabel("Tarefa", { exact: true })).toHaveValue(TAREFA);
  await expect(novaTarefa(pagina).getByLabel("Dona Maria")).toBeChecked();
  await pagina.reload();
  await expect(pagina.getByText("Nenhuma tarefa neste projeto.")).toBeVisible();
});

test("CA-9: sem Usuário Simulado alocado a Tarefa não é criada e o formulário mostra o erro", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, "https://demo.exemplo.com", ["Dona Maria"]);
  await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
  await novaTarefa(pagina).getByLabel("Tarefa", { exact: true }).fill(TAREFA);
  await pagina.getByRole("button", { name: "Criar tarefa" }).click();

  await expect(pagina.locator("#campo-tarefa-usuarios-erro")).toHaveText("Aloque ao menos um usuário simulado");
  await pagina.reload();
  await expect(pagina.getByText("Nenhuma tarefa neste projeto.")).toBeVisible();
});

test("a Tarefa sem texto mostra o erro no campo, e o projeto sem link avisa na página", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, undefined, ["Dona Maria"]);
  await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
  await expect(pagina.getByText("sem link do produto")).toBeVisible();
  await pagina.getByRole("button", { name: "Criar tarefa" }).click();
  await expect(pagina.locator("#campo-tarefa-texto-erro")).toHaveText("Tarefa obrigatória");
});

/** O produto no ar: um servidor HTTP local que responde qualquer página. Devolve o link e quem o desliga. */
async function produtoNoAr(): Promise<{ link: string; desligar: () => Promise<void> }> {
  const servidor = createServer((_, resposta) => {
    resposta.end("<!doctype html><title>Produto</title><button>Enviar</button>");
  });
  await new Promise<void>((pronto) => servidor.listen(0, "127.0.0.1", pronto));
  const { port } = servidor.address() as { port: number };
  return {
    link: `http://127.0.0.1:${String(port)}`,
    desligar: () =>
      new Promise<void>((pronto) => {
        servidor.close(() => {
          pronto();
        });
      }),
  };
}

/** As linhas da tabela de execuções do cartão da Tarefa. */
const linhasDeExecucao = (pagina: Page) => pagina.locator("[data-tarefa] tbody tr");
const ESPERA = { timeout: 20_000 };

test("CA-10: Executar sem link do produto não inicia nada e o cartão mostra o erro", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz, undefined, ["Dona Maria"], { n: 1 });
  await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
  await pagina.getByRole("button", { name: "Executar", exact: true }).click();

  const cartao = pagina.locator("[data-tarefa]", { hasText: TAREFA });
  await expect(cartao.getByRole("alert")).toHaveText("Informe o link do produto na Configuração do projeto");
  await expect(cartao).toContainText("Nenhuma execução ainda.");
  await pagina.reload();
  await expect(pagina.locator("[data-tarefa]")).toContainText("Nenhuma execução ainda.");
});

test("CA-11 e CA-13: as 3 execuções de Dona Maria terminam concluídas e o relatório tem Usabilidade e Bugs", async ({
  pagina,
  fabriquinha,
}) => {
  const produto = await produtoNoAr();
  try {
    semear(fabriquinha.raiz, produto.link, ["Dona Maria"], { n: 3 });
    await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
    await pagina.getByRole("button", { name: "Executar", exact: true }).click();
    await expect(pagina.getByRole("button", { name: "Executando…" })).toBeDisabled();

    await expect(linhasDeExecucao(pagina)).toHaveCount(3);
    await expect(linhasDeExecucao(pagina).locator(".pill-ok")).toHaveText(
      ["concluído", "concluído", "concluído"],
      ESPERA,
    );
    await expect(linhasDeExecucao(pagina).locator("td:nth-child(2)")).toHaveText([
      "Dona Maria",
      "Dona Maria",
      "Dona Maria",
    ]);
    await expect(pagina.getByRole("button", { name: "Executar", exact: true })).toBeEnabled();

    await linhasDeExecucao(pagina).first().getByRole("button", { name: "Ver relatório" }).click();
    const caixa = pagina.locator("[data-caixa]");
    await expect(caixa.getByRole("heading", { name: "Usabilidade" })).toBeVisible();
    await expect(caixa.getByRole("heading", { name: "Bugs" })).toBeVisible();
    await expect(caixa).toContainText("O botão Enviar tem pouco contraste e fica no fim da página");
    await expect(caixa.getByText("Nenhum achado")).toHaveCount(1); // Bugs vem vazia
  } finally {
    await produto.desligar();
  }
});

test("CA-12: N = 2 com Dona Maria e Seu João dá 4 execuções, 2 de cada", async ({ pagina, fabriquinha }) => {
  const produto = await produtoNoAr();
  try {
    semear(fabriquinha.raiz, produto.link, ["Dona Maria", "Seu João"], { n: 2 });
    await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
    await pagina.getByRole("button", { name: "Executar", exact: true }).click();

    await expect(linhasDeExecucao(pagina)).toHaveCount(4);
    await expect(linhasDeExecucao(pagina).locator(".pill-ok")).toHaveCount(4, ESPERA);
    await expect(linhasDeExecucao(pagina).locator("td:nth-child(2)")).toHaveText([
      "Dona Maria",
      "Dona Maria",
      "Seu João",
      "Seu João",
    ]);
  } finally {
    await produto.desligar();
  }
});

test("CA-14: com o link fora do ar cada execução termina falhou com a mensagem", async ({ pagina, fabriquinha }) => {
  const fechado = servidorTcp();
  await new Promise<void>((pronto) => fechado.listen(0, "127.0.0.1", pronto));
  const { port } = fechado.address() as { port: number };
  await new Promise((pronto) => fechado.close(pronto));
  semear(fabriquinha.raiz, `http://127.0.0.1:${String(port)}`, ["Dona Maria"], { n: 2 });
  await pagina.goto(`${fabriquinha.base}/simulation/fabriquinha`);
  await pagina.getByRole("button", { name: "Executar", exact: true }).click();

  await expect(linhasDeExecucao(pagina).locator(".pill-falha")).toHaveText(["falhou", "falhou"], ESPERA);
  await expect(linhasDeExecucao(pagina).locator(".msg-erro")).toHaveText([
    "Não foi possível abrir o link do produto",
    "Não foi possível abrir o link do produto",
  ]);
  await pagina.reload();
  await expect(linhasDeExecucao(pagina).locator(".pill-falha")).toHaveCount(2);
});
