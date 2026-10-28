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

for (const [caso, descricao] of [
  ["vazia", ""],
  ["só com espaços e quebras de linha", "   \n  \n "],
] as const) {
  test(`a descrição ${caso} é recusada no rodapé, sem sair do Início nem criar issue`, async ({
    pagina,
    fabriquinha,
  }) => {
    projeto(fabriquinha.raiz);
    await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
    const caixa = pagina.getByRole("dialog", { name: "Registrar necessidade" });
    await caixa.getByLabel("Descrição").fill(descricao);
    await caixa.getByRole("button", { name: "Registrar e abrir o chat" }).click();
    await expect(caixa.getByRole("alert")).toHaveText("a descrição é obrigatória (descreva a necessidade)");
    await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
    expect(await pagina.evaluate(async () => (await (await fetch("/api/board")).json()) as unknown)).toEqual([]);
    expect(
      await pagina.evaluate(async () => (await (await fetch("/api/sessoes?escopo=ativas")).json()) as unknown),
    ).toEqual([]);
  });
}

test("a recusa do registro aparece na caixa, sem sair do Início", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.reload();
  await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Registrar necessidade" });
  await caixa.getByRole("checkbox", { name: /I-2/ }).check();
  await caixa.getByLabel("Descrição").fill("Exportar pedidos em CSV");
  // O projeto do semear aponta para um repositório que não existe: o C1 grava, e a worktree falha em segundo plano.
  // Para ver a recusa, a dependência some do banco antes do envio.
  const banco = abrir(fabriquinha.raiz);
  banco.exec("DELETE FROM issue_dep; DELETE FROM ticket WHERE issue = 2; DELETE FROM issue WHERE id = 2");
  banco.close();
  await caixa.getByRole("button", { name: "Registrar e abrir o chat" }).click();
  await expect(caixa.getByRole("alert")).toHaveText("a issue I-2 não existe (confira o número da issue)");
  await expect(caixa.getByRole("checkbox", { name: /I-2/ })).toBeChecked();
  await expect(caixa.getByLabel("Descrição")).toHaveValue("Exportar pedidos em CSV");
  await expect(caixa.getByLabel("Projeto")).toHaveValue("loja");
  await expect(pagina).toHaveURL(`${fabriquinha.base}/home`);
  await caixa.getByRole("button", { name: "Cancelar" }).click();
  await expect(caixa).toBeHidden();
});
