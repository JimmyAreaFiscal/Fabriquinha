// Trocar de página com uma leitura ainda em andamento (F7 §4.4): a resposta atrasada da página que o Auditor deixou
// não desenha por cima da nova nem troca o caminho de volta.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

test("sair da issue no gate do PR antes de o estado do PR chegar deixa o Histórico na tela", async ({
  page,
  pagina,
  fabriquinha,
}) => {
  const banco = abrir(fabriquinha.raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
      VALUES (1, 'loja', 'Busca lenta', 'problema', '', 'aprovacao_pr', '2026-10-11T12:00:00.000Z');
  `);
  banco.close();
  // O `gh pr view` lento: o estado do PR só chega quando o teste soltar.
  let soltar = (): void => undefined;
  const solto = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await page.route("**/api/issues/1/pr", async (rota) => {
    await solto;
    await rota.fulfill({ status: 502, json: { erro: "gh lento" } });
  });
  // Como terminou a leitura do PR no navegador: respondida, ou cancelada pela troca de página.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const marcar = (como: string): void => {
      document.documentElement.dataset.leituraPr = como;
    };
    window.fetch = (entrada, init) => {
      const resposta = original(entrada, init);
      if (typeof entrada === "string" && entrada.endsWith("/pr")) {
        resposta.then(
          () => {
            marcar("respondida");
          },
          (erro: unknown) => {
            marcar(erro instanceof Error ? erro.name : "erro");
          },
        );
      }
      return resposta;
    };
  });
  const lendoPR = page.waitForRequest("**/api/issues/1/pr");
  await pagina.goto(`${fabriquinha.base}/projects/outro/issues/1`);
  await lendoPR;

  await page.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Histórico" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Histórico");
  soltar();
  // A leitura da página deixada foi cancelada: a resposta não chega a quem já saiu.
  await expect(page.locator("html")).toHaveAttribute("data-leitura-pr", "AbortError");
  await expect(page).toHaveURL(`${fabriquinha.base}/history`);
  await expect(page).toHaveTitle("Histórico · Fabriquinha");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Histórico");
  await expect(page.locator(".pagina-issue")).toHaveCount(0);
  await expect(page.getByRole("alert")).toBeHidden();
});
