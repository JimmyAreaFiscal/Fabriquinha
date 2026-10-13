// Entrada pelo link de `web.url` e navegação entre as páginas (F7 §4.1, §4.4, §7).
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

/** Uma sessão autônoma que falhou: aguarda o Auditor (F4 §5.2). */
function sessaoAguardando(raiz: string): void {
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (1, 'loja', 'Busca', 'problema', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, erro, criado_em)
      VALUES (1, 1, 'desenvolvimento', 'Cache', 'falhou', 'fabriquinha', 'testes falharam', '2026-10-11T12:00:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '${SESSAO}', 'falha', 'testes falharam', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z');
  `);
  banco.close();
}

test("entra pelo link de web.url e navega entre as páginas pela navegação fixa, sem recarregar", async ({
  page,
  fabriquinha,
}) => {
  await page.goto(fabriquinha.link);
  await expect(page).toHaveURL(`${fabriquinha.base}/home`);
  await expect(page).toHaveTitle("Início · Fabriquinha");
  const nav = page.getByRole("navigation", { name: "Páginas" });
  await expect(nav.getByRole("link", { name: "Início" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Início");
  // O Início desenhado com o que a API respondeu: o navegador entrou, e não há aviso.
  await expect(page.getByText("Nada aguarda você agora.")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();

  // Uma marca na janela some se a página recarregar.
  await page.evaluate(() => {
    Object.assign(window, { semRecarregar: true });
  });
  const paginas = [
    ["Projetos", "/projects", "Projetos"],
    ["Simulação", "/simulation", "Simulação"],
    ["Métricas", "/metrics", "Métricas"],
    ["Histórico", "/history", "Histórico"],
    ["Configuração", "/config", "Configuração"],
    ["Início", "/home", "Início"],
  ] as const;
  for (const [item, caminho, titulo] of paginas) {
    await nav.getByRole("link", { name: item }).click();
    await expect(page).toHaveURL(`${fabriquinha.base}${caminho}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(titulo);
    await expect(nav.getByRole("link", { name: item })).toHaveAttribute("aria-current", "page");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);
    await expect(page).toHaveTitle(`${titulo} · Fabriquinha`);
  }
  expect(await page.evaluate(() => "semRecarregar" in window)).toBe(true);

  // Voltar e avançar do navegador trocam a página pelo caminho.
  await page.goBack();
  await expect(page).toHaveURL(`${fabriquinha.base}/config`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Configuração");
  await page.goForward();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Início");
  expect(await page.evaluate(() => "semRecarregar" in window)).toBe(true);
});

test("os links são de verdade: qualquer página abre direto numa aba nova", async ({ pagina, fabriquinha }) => {
  const aba = await pagina.context().newPage();
  await aba.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("Issue");
  await expect(aba.getByRole("link", { name: "Projetos" })).toHaveAttribute("aria-current", "page");

  // Sessão que não existe: o chat abre e o aviso diz o que o servidor respondeu.
  await aba.goto(`${fabriquinha.base}/sessions/${SESSAO}`);
  await expect(aba).toHaveTitle("Chat · Fabriquinha");
  await expect(aba.getByRole("alert")).toHaveText(`a sessão ${SESSAO} não existe (confira o endereço do chat)`);
  await expect(aba.locator('[aria-current="page"]')).toHaveCount(0);

  await aba.goto(`${fabriquinha.base}/`);
  await expect(aba).toHaveURL(`${fabriquinha.base}/home`);

  await aba.goto(`${fabriquinha.base}/nada/aqui`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
  await aba.getByRole("link", { name: "Ir para o Início" }).click();
  await expect(aba).toHaveURL(`${fabriquinha.base}/home`);
});

test("o Início da navegação conta as sessões que aguardam o Auditor", async ({ pagina, fabriquinha }) => {
  const inicio = pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: /^Início/ });
  await expect(inicio.locator(".contador")).toHaveCount(0);
  sessaoAguardando(fabriquinha.raiz);
  await pagina.getByRole("link", { name: "Métricas", exact: true }).click();
  await expect(inicio.locator(".contador")).toHaveText("1");
  await expect(inicio.locator(".contador")).toHaveAttribute("title", "sessões que aguardam você");
});

test("sem entrar, a página abre e o aviso manda rodar fabriquinha abrir", async ({ page, fabriquinha }) => {
  await page.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Issue");
  await expect(page.getByRole("alert")).toHaveText("o navegador não entrou nesta Fabriquinha (rode fabriquinha abrir)");

  // Um link velho, de antes de reiniciar o serviço, também não entra.
  await page.goto(`${fabriquinha.base}/entrar?token=antigo`);
  await expect(page).toHaveURL(`${fabriquinha.base}/home`);
  await expect(page.getByRole("alert")).toContainText("rode fabriquinha abrir");

  await page.goto(fabriquinha.link);
  await expect(page.getByText("Nada aguarda você agora.")).toBeVisible();
  await expect(page.getByRole("alert")).toBeHidden();
});

test("a caixa abre sobre a página e fecha com Esc, com o ✕ e clicando fora", async ({ pagina }) => {
  const abrirCaixa = () =>
    pagina.evaluate(async () => {
      // O módulo é o mesmo que o app.ts carregou: o navegador guarda um por endereço.
      const modulo = "/static/dom.ts";
      const dom = (await import(modulo)) as typeof import("../src/web/cliente/dom.ts");
      dom.abrirCaixa({
        titulo: "Desenho da solução",
        meta: "desenho_solucao · desenho · T-109",
        corpo: "<pre>conteúdo</pre>",
        aba: "/arquivos/abc",
      });
    });
  const caixa = pagina.getByRole("dialog", { name: "Desenho da solução" });

  await abrirCaixa();
  await expect(caixa).toBeVisible();
  await expect(caixa.getByText("desenho_solucao · desenho · T-109")).toBeVisible();
  await expect(caixa.getByRole("link", { name: "abrir em nova aba ↗" })).toHaveAttribute("href", "/arquivos/abc");
  await expect(caixa.getByRole("link", { name: "baixar" })).toBeHidden();
  await pagina.keyboard.press("Escape");
  await expect(caixa).toBeHidden();

  await abrirCaixa();
  await caixa.getByRole("button", { name: "Fechar" }).click();
  await expect(caixa).toBeHidden();

  await abrirCaixa();
  await expect(caixa).toBeVisible();
  await pagina.mouse.click(10, 10);
  await expect(caixa).toBeHidden();
});
