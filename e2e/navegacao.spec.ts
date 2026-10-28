// Entrada pelo link de `web.url` e navegação entre as páginas (F7 §4.1, §4.4, §7; I-247 CA-4): a página inicial é
// /demandas e o menu não tem Início, issue nem Auditoria.
import type { TestInfo } from "@playwright/test";
import { abrir } from "../src/persistencia/banco.ts";
import { expect, fotografar, test } from "./apoio.ts";

const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

test("entra pelo link de web.url e navega entre as páginas pela navegação fixa, sem recarregar", async ({
  page,
  fabriquinha,
}) => {
  await page.goto(fabriquinha.link);
  await expect(page).toHaveURL(`${fabriquinha.base}/demandas`);
  await expect(page).toHaveTitle("Demandas · Fabriquinha");
  const nav = page.getByRole("navigation", { name: "Páginas" });
  await expect(nav.getByRole("link", { name: "Demandas" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demandas");
  // As Demandas desenhadas com o que a API respondeu: o navegador entrou, e não há aviso.
  await expect(page.getByText("Nenhuma demanda em andamento.")).toBeVisible();
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
    ["Avaliações", "/evaluations", "Avaliações"],
    ["Configuração", "/config", "Configuração"],
    ["Demandas", "/demandas", "Demandas"],
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
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demandas");
  expect(await page.evaluate(() => "semRecarregar" in window)).toBe(true);
});

test("CA-4: / e /entrar levam a /demandas; o menu sem Início, issue nem Auditoria abre cada página sem erro no console, a 1440 e 375 px", async ({
  page,
  fabriquinha,
}, info: TestInfo) => {
  const erros: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") erros.push(m.text());
  });
  page.on("pageerror", (e) => erros.push(e.message));
  await page.goto(fabriquinha.link);
  await expect(page).toHaveURL(`${fabriquinha.base}/demandas`);
  await page.goto(`${fabriquinha.base}/`);
  await expect(page).toHaveURL(`${fabriquinha.base}/demandas`);
  const nav = page.getByRole("navigation", { name: "Páginas" });
  await expect(nav.getByRole("link")).toHaveText([
    "Projetos",
    "Demandas",
    "Simulação",
    "Métricas",
    "Histórico",
    "Avaliações",
    "Configuração",
  ]);
  for (const largura of [1440, 375]) {
    await page.setViewportSize({ width: largura, height: 900 });
    for (const item of ["Demandas", "Avaliações", "Métricas", "Histórico", "Projetos", "Configuração"]) {
      await nav.getByRole("link", { name: item }).click();
      await expect(nav.getByRole("link", { name: item })).toHaveAttribute("aria-current", "page");
      await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), item).toBe(true);
    }
    await nav.getByRole("link", { name: "Demandas" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Demandas");
    await fotografar(page, info, `navegacao-demandas-${String(largura)}`);
  }
  expect(erros).toEqual([]);
});

test("os links são de verdade: qualquer página abre direto numa aba nova", async ({ pagina, fabriquinha }) => {
  const aba = await pagina.context().newPage();
  await aba.goto(`${fabriquinha.base}/metrics`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("Métricas");
  await expect(aba.getByRole("link", { name: "Métricas" })).toHaveAttribute("aria-current", "page");

  // Sessão que não existe: o chat abre e o aviso diz o que o servidor respondeu.
  await aba.goto(`${fabriquinha.base}/sessions/${SESSAO}`);
  await expect(aba).toHaveTitle("Chat · Fabriquinha");
  await expect(aba.getByRole("alert")).toHaveText(`a sessão ${SESSAO} não existe (confira o endereço do chat)`);
  await expect(aba.locator('[aria-current="page"]')).toHaveCount(0);

  await aba.goto(`${fabriquinha.base}/`);
  await expect(aba).toHaveURL(`${fabriquinha.base}/demandas`);

  // As páginas do fluxo legado saíram: o Início, a issue e a Auditoria não existem mais.
  for (const legado of ["/nada/aqui", "/home", "/projects/loja/issues/I-1", "/audits/abc"]) {
    await aba.goto(`${fabriquinha.base}${legado}`);
    await expect(aba.getByRole("heading", { level: 1 })).toHaveText("Página não encontrada");
  }
  await aba.getByRole("link", { name: "Ir para as Demandas" }).click();
  await expect(aba).toHaveURL(`${fabriquinha.base}/demandas`);
});

/**
 * Duas sessões de demanda cujo ticket falhou: a da I-1, em execução, aguarda o Auditor; a da I-2, migrada de uma demanda
 * já concluída, terminou.
 */
function sessaoDeDemandaAguardando(raiz: string): void {
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO demanda VALUES
      ('I-1', 'loja', 'Busca', 'problema', 'd', 'execucao', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-1'),
      ('I-2', 'loja', 'Cache', 'problema', 'd', 'concluida', '2026-10-11T12:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em, motivo_falha) VALUES
      ('I-1', 1, 'implementar', 'falhou', '2026-10-11T12:05:00.000Z', 'testes falharam'),
      ('I-2', 1, 'implementar', 'falhou', '2026-10-11T12:05:00.000Z', 'testes falharam');
    INSERT INTO sessao VALUES ('${SESSAO}', 'I-1', 1, 'autonomo', 'c1'), ('s-i2', 'I-2', 1, 'autonomo', 'c2');
    INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES
      ('x1', '${SESSAO}', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z', 1),
      ('x2', 's-i2', '2026-10-11T12:00:00.000Z', '2026-10-11T12:05:00.000Z', 1);
  `);
  banco.close();
}

test("as Demandas da navegação contam as sessões de demanda que aguardam o Auditor", async ({
  pagina,
  fabriquinha,
}) => {
  const inicio = pagina.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: /^Demandas/ });
  await expect(inicio.locator(".contador")).toHaveCount(0);
  sessaoDeDemandaAguardando(fabriquinha.raiz);
  await pagina.getByRole("link", { name: "Métricas", exact: true }).click();
  await expect(inicio.locator(".contador")).toHaveText("1");
  await expect(inicio.locator(".contador")).toHaveAttribute("title", "sessões que aguardam você");
});

test("só o chat baixa o componente React da conversa", async ({ pagina, fabriquinha }) => {
  const pedidos: string[] = [];
  pagina.on("request", (pedido) => pedidos.push(new URL(pedido.url()).pathname));
  const conversa = "/static/telas/chat-conversa.tsx";
  const nav = pagina.getByRole("navigation", { name: "Páginas" });
  for (const [item, titulo] of [
    ["Demandas", "Demandas"],
    ["Histórico", "Histórico"],
    ["Configuração", "Configuração"],
  ] as const) {
    await nav.getByRole("link", { name: item }).click();
    await expect(pagina.getByRole("heading", { level: 1 })).toHaveText(titulo);
  }
  expect(pedidos).not.toContain(conversa);

  sessaoDeDemandaAguardando(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/sessions/${SESSAO}`);
  await expect(pagina.getByRole("link", { name: "Abrir a demanda" })).toBeVisible();
  expect(pedidos).toContain(conversa);
});

test("sem entrar, a página abre e o aviso manda rodar fabriquinha abrir", async ({ page, fabriquinha }) => {
  await page.goto(`${fabriquinha.base}/metrics`);
  await expect(page).toHaveTitle("Métricas · Fabriquinha");
  await expect(page.getByRole("alert")).toHaveText("o navegador não entrou nesta Fabriquinha (rode fabriquinha abrir)");

  // Um link velho, de antes de reiniciar o serviço, também não entra.
  await page.goto(`${fabriquinha.base}/entrar?token=antigo`);
  await expect(page).toHaveURL(`${fabriquinha.base}/demandas`);
  await expect(page.getByRole("alert")).toContainText("rode fabriquinha abrir");

  await page.goto(fabriquinha.link);
  await expect(page.getByText("Nenhuma demanda em andamento.")).toBeVisible();
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
