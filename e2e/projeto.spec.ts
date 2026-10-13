// Projeto (F7 §4.4, §7): /projects abre o primeiro projeto e depois o último visto; arquivar as concluídas de um
// projeto as tira da lista, elas voltam com Mostrar arquivadas, e as do outro projeto não mudam; a gaveta de tickets.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

/** loja: I-1 em desenvolvimento, com o ticket que falhou, e I-2 e I-3 concluídas; site: I-4 concluída. */
function semear(raiz: string): void {
  const banco = abrir(raiz);
  const projeto = (nome: string) =>
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness, modelos)
      VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '["npm test"]', '${nome}', '[{"nome":"f","comando":"true","descricao":"d"}]',
      '{"desenvolvimento":{"provedor":"anthropic","modelo":"claude-sonnet-5-5"}}');`;
  const concluida = (id: number, nome: string, titulo: string) =>
    `INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em)
      VALUES (${String(id)}, '${nome}', '${titulo}', 'funcionalidade', 'concluida', '2026-09-20T12:00:00.000Z', '2026-10-03T12:00:00.000Z');`;
  banco.exec(`
    ${projeto("site")}
    ${projeto("loja")}
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'Busca por SKU', 'problema', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
    ${concluida(2, "loja", "Frete grátis")}
    ${concluida(3, "loja", "Login com Google")}
    ${concluida(4, "site", "Página de contato")}
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (1, 1, 'registro', 'Registrar a necessidade', 'concluido', 'fabriquinha', '2026-10-11T12:00:00.000Z', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em, modelo_provedor, modelo_nome)
      VALUES (2, 1, 'desenvolvimento', 'Cache', 'falhou', 'fabriquinha', '3 testes falharam', '2026-10-11T12:00:00.000Z', 'llamacpp', 'qwen3-coder-30b');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'falha', '3 testes falharam', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z');
  `);
  banco.close();
}

test("arquivar as concluídas de um projeto: somem, voltam com Mostrar arquivadas, e as do outro projeto não mudam", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const nav = pagina.getByRole("navigation", { name: "Páginas" });
  await nav.getByRole("link", { name: "Projetos" }).click();

  // Sem projeto visto ainda: o primeiro em ordem alfabética.
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja`);
  await expect(pagina.getByLabel("Projeto", { exact: true })).toHaveValue("loja");
  const contagem = pagina.locator(".contagem");
  await expect(contagem).toHaveText("1 em andamento · 2 concluídas · 0 arquivadas · 0 canceladas");
  const linhas = pagina.locator(".pista-item");
  await expect(linhas).toHaveCount(1);

  await pagina.getByLabel("Mostrar concluídas").check();
  await expect(linhas).toHaveCount(3);
  await expect(linhas.nth(1)).toContainText("concluída em 03/10");

  await pagina.getByRole("button", { name: "Arquivar concluídas" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Arquivar concluídas" });
  await expect(caixa).toContainText(
    '2 issues concluídas de loja serão arquivadas. Elas saem desta lista e continuam acessíveis em "Mostrar arquivadas". Nada é apagado.',
  );
  await caixa.getByRole("button", { name: "Arquivar" }).click();
  await expect(caixa).toBeHidden();
  await expect(contagem).toHaveText("1 em andamento · 0 concluídas · 2 arquivadas · 0 canceladas");
  await expect(linhas).toHaveCount(1);
  await expect(pagina.getByRole("button", { name: "Arquivar concluídas" })).toBeDisabled();

  await pagina.getByLabel("Mostrar arquivadas").check();
  await expect(linhas).toHaveCount(3);
  await expect(linhas.first()).toContainText("Login com Google");
  await expect(linhas.first()).toContainText(/arquivada em \d\d\/\d\d/);

  // O outro projeto continua como estava. O Auditor escolhe com o seletor em foco, como no clique.
  await pagina.getByLabel("Projeto", { exact: true }).focus();
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("site");
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
  await expect(contagem).toHaveText("0 em andamento · 1 concluída · 0 arquivadas · 0 canceladas");
  await expect(linhas).toHaveCount(1);
  await expect(linhas.first()).toContainText("Página de contato");
  await expect(linhas.first()).toContainText("concluída em 03/10");
  await expect(pagina.getByRole("button", { name: "Arquivar concluídas" })).toBeEnabled();

  // /projects volta ao último projeto visto neste navegador.
  await nav.getByRole("link", { name: /^Início/ }).click();
  await nav.getByRole("link", { name: "Projetos" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/site`);
});

test("a linha da issue com o trilho e a sessão; a gaveta de tickets vem aberta na falha e abre e fecha", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  // O relógio do navegador na mão do teste: os 5 s do redesenho passam sem esperar de verdade.
  await pagina.clock.install();
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  const item = pagina.locator(".pista-item").first();
  await expect(item).toHaveClass("pista-item falha");
  await expect(item.locator(".pista-issue")).toContainText("Busca por SKU");
  await expect(item.locator(".sub")).toHaveText(/^I-1\s*problema\s*1\/2$/);
  await expect(item.getByRole("list", { name: "Fases da issue" }).locator('[aria-current="step"]')).toContainText(
    "Desenvolvimento",
  );
  await expect(pagina.getByRole("link", { name: "Editar na Configuração" })).toHaveAttribute(
    "href",
    "/config?projeto=loja",
  );

  const gaveta = item.locator(".gaveta");
  await expect(gaveta).toBeVisible();
  const cache = gaveta.locator("tr", { hasText: "T-2" });
  await expect(cache).toContainText("desenvolvimento");
  await expect(cache).toContainText("falhou");
  await expect(cache.locator(".modelo")).toHaveText("llamacpp / qwen3-coder-30b ★");
  await expect(cache.getByRole("link", { name: /Falhou/ })).toHaveAttribute("href", `/sessions/${SESSAO}`);
  await expect(gaveta.locator("tr", { hasText: "T-1" }).locator(".modelo")).toHaveText("padrão do pi");

  // Fechada pelo Auditor, continua fechada depois do redesenho de 5 s, e a sessão aparece à direita.
  await pagina.getByRole("button", { name: "Tickets de I-1" }).click();
  await expect(gaveta).toBeHidden();
  await expect(item.locator(".pista-estado")).toContainText("Falhou");
  const banco = abrir(fabriquinha.raiz);
  banco.exec("UPDATE issue SET titulo = 'Busca por SKU e EAN' WHERE id = 1");
  banco.close();
  await pagina.clock.runFor(5000);
  await expect(item.locator(".pista-issue")).toContainText("Busca por SKU e EAN");
  await expect(gaveta).toBeHidden();
  await item.locator(".pista-linha").click({ position: { x: 600, y: 20 } });
  await expect(gaveta).toBeVisible();

  // Registrar necessidade já com o projeto escolhido.
  await pagina.getByLabel("Projeto", { exact: true }).selectOption("site");
  // A página do site desenhada, e não o botão da do loja que ainda está na tela.
  await expect(pagina.getByRole("link", { name: "Editar na Configuração" })).toHaveAttribute(
    "href",
    "/config?projeto=site",
  );
  await pagina.getByRole("button", { name: "+ Registrar necessidade" }).click();
  await expect(pagina.getByRole("dialog", { name: "Registrar necessidade" }).getByLabel("Projeto")).toHaveValue("site");
});
