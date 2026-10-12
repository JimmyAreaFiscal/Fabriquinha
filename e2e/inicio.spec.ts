// Início (F7 §4.4): o que aguarda o Auditor no card certo, com o botão que abre o chat; o board com as marcas; a
// atualização sozinha; e o Registrar necessidade, que abre o chat da sessão criada (F4 §6.6) com o pi falso.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { abrir } from "../src/persistencia/banco.ts";
import { registrarProjeto } from "../src/persistencia/projetos.ts";
import { expect, test } from "./apoio.ts";

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

/** I-1 com o ticket autônomo que falhou (aguarda o Auditor) e I-2, no registro, que depende dela. */
function semear(raiz: string): void {
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'Busca por SKU', 'problema', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
    INSERT INTO issue (id, projeto, fase, criada_em) VALUES (2, 'loja', 'registro', '2026-10-11T13:00:00.000Z');
    INSERT INTO issue_dep (issue, dep) VALUES (2, 1);
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em)
      VALUES (1, 1, 'desenvolvimento', 'Cache', 'falhou', 'fabriquinha', '3 testes falharam em busca.spec.ts', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (2, 2, 'registro', 'Registrar a necessidade', 'aberto', 'fabriquinha', '2026-10-11T13:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '${SESSAO}', 'falha', '3 testes falharam', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z');
  `);
  banco.close();
}

test("uma sessão que aguarda aparece sozinha no card certo, com a marca no board, e o botão leva ao chat", async ({
  pagina,
  fabriquinha,
}) => {
  await expect(pagina.getByText("Nada aguarda você agora.")).toBeVisible();
  await expect(pagina.getByText("0 issues em andamento")).toBeVisible();
  semear(fabriquinha.raiz);

  // Sem recarregar: a página se redesenha a cada 5 s.
  const card = pagina.locator(".decisao");
  await expect(card).toHaveCount(1, { timeout: 8000 });
  await expect(card).toHaveClass(/falha/);
  await expect(card.locator(".decisao-motivo")).toHaveText("Falhou");
  await expect(card.locator(".decisao-titulo")).toHaveText("I-1 Busca por SKU");
  await expect(card.locator(".decisao-texto")).toHaveText("3 testes falharam em busca.spec.ts");
  await expect(card.locator(".decisao-pe")).toHaveText(/^loja\s*T-1 · desenvolvimento · autônoma · há \d.*$/);
  const secao = pagina.getByRole("region", { name: "Aguarda você" });
  await expect(secao.locator(".secao-titulo .contador")).toHaveText("1");
  const nav = pagina.getByRole("navigation", { name: "Páginas" });
  await expect(nav.getByRole("link", { name: /^Início/ }).locator(".contador")).toHaveText("1");
  await expect(pagina.getByRole("region", { name: "Rodando" })).toContainText("Nenhuma sessão rodando.");

  const board = pagina.getByRole("region", { name: "Board" });
  await expect(board).toContainText("2 issues em andamento");
  const coluna = (nome: string) =>
    board.locator(".coluna", { has: pagina.locator(`.coluna-cabeca:text-is("${nome}")`) });
  await expect(coluna("Desenvolvimento").locator(".coluna-cabeca")).toHaveText("Desenvolvimento1");
  const i1 = coluna("Desenvolvimento").locator(".cartao");
  await expect(i1).toHaveClass("cartao aguarda");
  await expect(i1.locator(".cartao-ticket")).toHaveText("T-1 desenvolvimento · falhou");
  await expect(i1.locator(".pill-falha")).toHaveText("aguarda você · falha");
  const i2 = coluna("Registro").locator(".cartao");
  await expect(i2.locator(".cartao-titulo")).toHaveText("sem título");
  await expect(i2).toHaveClass("cartao bloqueada");
  await expect(i2.locator(".pill-neutro")).toHaveText("bloqueada por I-1");
  await expect(i2).toHaveAttribute("href", "/projects/loja/issues/I-2");
  await expect(board.locator(".coluna-gate")).toHaveCount(2);

  await card.getByText("Responder e retomar →").click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/sessions/${SESSAO}`);
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" });

/** O projeto `loja`, com um clone de verdade cujo `origin` é um bare no disco, para a worktree do registro. */
function projeto(raiz: string): void {
  const bare = join(raiz, "origin.git");
  const repo = join(raiz, "loja");
  mkdirSync(bare);
  mkdirSync(repo);
  git(bare, "init", "--bare", "-q");
  git(repo, "init", "-q", "-b", "main");
  writeFileSync(join(repo, "LEIAME"), "loja\n");
  git(repo, "add", "LEIAME");
  git(repo, "commit", "-q", "-m", "início");
  git(repo, "remote", "add", "origin", bare);
  git(repo, "push", "-q", "origin", "main");
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo,
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "loja" },
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
  });
  banco.close();
}

test("registrar uma necessidade pede projeto e dependências e abre o chat da sessão criada", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Registrar necessidade" });
  await expect(caixa.getByLabel("Projeto")).toHaveValue("loja");
  await expect(caixa.getByRole("group", { name: /Dependências/ })).toContainText("Nenhuma issue em andamento.");
  await caixa.getByRole("button", { name: "Registrar e abrir o chat" }).click();

  await expect(caixa).toBeHidden();
  await expect(pagina).toHaveURL(new RegExp(`^${fabriquinha.base}/sessions/[0-9a-f-]{36}$`));
  const chat = new URL(pagina.url()).pathname;

  // De volta ao Início: o pi falso respondeu, e a sessão espera a próxima mensagem do Auditor.
  await pagina
    .getByRole("navigation", { name: "Páginas" })
    .getByRole("link", { name: /^Início/ })
    .click();
  const card = pagina.locator(".decisao");
  await expect(card).toHaveAttribute("href", chat, { timeout: 8000 });
  await expect(card.locator(".decisao-motivo")).toHaveText("Conversa");
  await expect(card.locator(".decisao-titulo")).toHaveText("I-1 sem título");
  await expect(card.locator(".decisao-pe")).toContainText("T-1 · registro · interativa · há");

  // A segunda necessidade pode depender da primeira.
  await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
  await caixa.getByRole("checkbox", { name: /I-1/ }).check();
  await caixa.getByRole("button", { name: "Registrar e abrir o chat" }).click();
  await expect(pagina).not.toHaveURL(`${fabriquinha.base}${chat}`);
  await expect(pagina).toHaveURL(/\/sessions\/[0-9a-f-]{36}$/);
  await pagina
    .getByRole("navigation", { name: "Páginas" })
    .getByRole("link", { name: /^Início/ })
    .click();
  await expect(pagina.locator(".cartao", { hasText: "I-2" }).locator(".pill-neutro")).toHaveText("bloqueada por I-1");
});

test("a recusa do registro aparece na caixa, sem sair do Início", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.reload();
  await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Registrar necessidade" });
  await caixa.getByRole("checkbox", { name: /I-2/ }).check();
  // O projeto do semear aponta para um repositório que não existe: o C1 grava, e a worktree falha em segundo plano.
  // Para ver a recusa, a dependência some do banco antes do envio.
  const banco = abrir(fabriquinha.raiz);
  banco.exec("DELETE FROM issue_dep; DELETE FROM ticket WHERE issue = 2; DELETE FROM issue WHERE id = 2");
  banco.close();
  await caixa.getByRole("button", { name: "Registrar e abrir o chat" }).click();
  await expect(caixa.getByRole("alert")).toHaveText("a issue I-2 não existe (confira o número da issue)");
  await expect(caixa.getByRole("checkbox", { name: /I-2/ })).toBeChecked();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  await caixa.getByRole("button", { name: "Cancelar" }).click();
  await expect(caixa).toBeHidden();
});
