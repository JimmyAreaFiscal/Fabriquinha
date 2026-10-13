// Remover projeto (F7 §4.4, Configuração): confirmar apaga o projeto e tudo dele de todas as telas, cancelar não
// apaga nada, o outro projeto fica intacto e a execução em andamento recusa a remoção.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

/** O agora do navegador, fixo em outubro de 2026; os dados semeados são do mês corrente. */
const AGORA = new Date(2026, 9, 15, 12, 0);
const em = new Date(2026, 9, 1, 12, 0).toISOString();

const projeto = (nome: string) =>
  `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness, modelos)
    VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '["npm test"]', '${nome}', '[{"nome":"f","comando":"true","descricao":"d"}]', '{}');`;

/** Uma issue com um ticket concluído e uma execução de US$ 10; a de `fase` `registro` ainda não tem título. */
function issue(id: number, nome: string, fase: string, andamento = false): string {
  const registro = fase === "registro";
  const concluida = fase === "concluida";
  const resultado = andamento ? "em_andamento" : "sucesso";
  return `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em)
      VALUES (${String(id)}, '${nome}', ${registro ? "NULL, NULL" : `'Issue ${String(id)}', 'problema'`}, '${fase}', '${em}', ${concluida ? `'${em}'` : "NULL"});
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (${String(id)}, ${String(id)}, 'desenvolvimento', 'Ticket', '${andamento ? "em_execucao" : "concluido"}', 'fabriquinha', '${em}', ${andamento ? "NULL" : `'${em}'`});
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (${String(id)}, ${String(id)}, 'consulta', '${crypto.randomUUID()}', '${resultado}', '${em}', ${andamento ? "NULL" : `'${em}'`});
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
      VALUES (${String(id)}, 'anthropic', 'claude-sonnet-5-5', 10, 1000, 500, 0, 0, 10);`;
}

/** `demo`: 4 issues em fases diferentes (US$ 40); `outro`: 1 (US$ 10); `ocupado`: 1 com execução em andamento. */
function semear(raiz: string): void {
  const banco = abrir(raiz);
  banco.exec(`
    ${projeto("demo")} ${projeto("outro")} ${projeto("ocupado")}
    ${issue(1, "demo", "registro")} ${issue(2, "demo", "desenho")} ${issue(3, "demo", "desenvolvimento")}
    ${issue(4, "demo", "concluida")} ${issue(5, "outro", "desenvolvimento")} ${issue(6, "ocupado", "desenvolvimento", true)}
  `);
  banco.close();
}

test("remover: cancelar não apaga; confirmar tira o projeto de todas as telas e deixa o outro intacto", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/config?projeto=demo`);
  const menu = pagina.getByRole("navigation", { name: "Configuração" });
  const dialogo = pagina.getByRole("dialog", { name: "Remover o projeto demo" });

  // CA-1: o diálogo cita o nome e as 4 issues; CA-2: Cancelar fecha e o projeto continua.
  await pagina.getByRole("button", { name: "Remover o projeto demo" }).click();
  await expect(dialogo).toContainText("O projeto demo e 4 issues serão apagados");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toBeHidden();
  await expect(menu.getByRole("link", { name: /^demo/ })).toBeVisible();
  expect((await pagina.request.get(`${fabriquinha.base}/api/projetos/demo`)).status()).toBe(200);

  // CA-3: confirmar tira `demo` da Configuração e das telas.
  await pagina.getByRole("button", { name: "Remover o projeto demo" }).click();
  await dialogo.getByRole("button", { name: "Remover projeto" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/config`);
  await expect(menu.getByRole("link", { name: /^demo/ })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: /^outro/ })).toBeVisible();

  await pagina.goto(`${fabriquinha.base}/home`);
  await expect(pagina.locator(".tag", { hasText: "demo" })).toHaveCount(0);
  await pagina.goto(`${fabriquinha.base}/projects/demo`);
  await expect(pagina.getByRole("heading", { name: "Projeto não encontrado" })).toBeVisible();
  await pagina.goto(`${fabriquinha.base}/history`);
  await expect(pagina.locator('[data-f="projeto"] option[value="demo"]')).toHaveCount(0);
  await expect(pagina.locator('[data-f="projeto"] option[value="outro"]')).toHaveCount(1);
  await pagina.goto(`${fabriquinha.base}/metrics`);
  await expect(pagina.getByLabel("Projeto", { exact: true }).locator('option[value="demo"]')).toHaveCount(0);
  // CA-6: o custo de `outro` (US$ 10) e o de `ocupado` (US$ 10) ficam; o de `demo` (US$ 40) saiu.
  await expect(pagina.locator(".tabela-issues tfoot")).toContainText("US$ 20,00");
  expect((await pagina.request.get(`${fabriquinha.base}/api/projetos/demo`)).status()).toBe(404);
});

test("remover com execução em andamento: a tela avisa e o projeto continua", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/config?projeto=ocupado`);
  await pagina.getByRole("button", { name: "Remover o projeto ocupado" }).click();
  await pagina.getByRole("button", { name: "Remover projeto" }).click();
  await expect(pagina.locator("[data-aviso]")).toContainText("execução em andamento");
  await expect(
    pagina.getByRole("navigation", { name: "Configuração" }).getByRole("link", { name: /^ocupado/ }),
  ).toBeVisible();
  expect((await pagina.request.get(`${fabriquinha.base}/api/projetos/ocupado`)).status()).toBe(200);
});
