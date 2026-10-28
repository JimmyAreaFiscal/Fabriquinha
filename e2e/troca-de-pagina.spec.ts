// Trocar de página com uma leitura ainda em andamento (F7 §4.4): a resposta atrasada da página que o Auditor deixou
// não desenha por cima da nova nem troca o caminho de volta.
import { expect, test } from "./apoio.ts";

test("sair da demanda antes de a leitura dela chegar deixa o Histórico na tela", async ({
  page,
  pagina,
  fabriquinha,
}) => {
  // A leitura da demanda lenta: só chega quando o teste soltar.
  let soltar = (): void => undefined;
  const solto = new Promise<void>((resolver) => {
    soltar = resolver;
  });
  await page.route("**/api/demandas/I-1", async (rota) => {
    await solto;
    await rota.fulfill({ status: 502, json: { erro: "leitura lenta" } });
  });
  // Como terminou a leitura da demanda no navegador: respondida, ou cancelada pela troca de página.
  await page.addInitScript(() => {
    const original = window.fetch.bind(window);
    const marcar = (como: string): void => {
      document.documentElement.dataset.leituraDemanda = como;
    };
    window.fetch = (entrada, init) => {
      const resposta = original(entrada, init);
      if (typeof entrada === "string" && entrada.endsWith("/api/demandas/I-1")) {
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
  const lendo = page.waitForRequest("**/api/demandas/I-1");
  await pagina.goto(`${fabriquinha.base}/demandas/I-1`);
  await lendo;

  await page.getByRole("navigation", { name: "Páginas" }).getByRole("link", { name: "Histórico" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Histórico");
  soltar();
  // A leitura da página deixada foi cancelada: a resposta não chega a quem já saiu.
  await expect(page.locator("html")).toHaveAttribute("data-leitura-demanda", "AbortError");
  await expect(page).toHaveURL(`${fabriquinha.base}/history`);
  await expect(page).toHaveTitle("Histórico · Fabriquinha");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Histórico");
  await expect(page.getByRole("alert")).toBeHidden();
});
