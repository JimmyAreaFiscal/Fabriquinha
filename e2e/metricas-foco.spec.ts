// Métricas (F7 §4.4, item 2): o mês em foco escolhido com um clique continua o mesmo ao trocar só o projeto, e volta
// ao último mês quando o período novo não o contém mais.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

test("trocar o projeto mantém o mês em foco; um período que não o contém leva o foco ao último mês", async ({
  page,
  pagina,
  fabriquinha,
}) => {
  const banco = abrir(fabriquinha.raiz);
  banco.exec(
    ["loja", "site"]
      .map(
        (nome) => `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
          VALUES ('${nome}', '/nao/existe/${nome}', 'main', 'github', '["npm test"]', '${nome}', '[{"nome":"f","comando":"true","descricao":"d"}]');`,
      )
      .join("\n"),
  );
  banco.close();
  await pagina.goto(`${fabriquinha.base}/metrics`);
  const meses = page.locator(".mes-btn");
  await expect(meses).toHaveCount(12);
  const focado = page.locator('.mes-btn[aria-pressed="true"]');
  await expect(focado).toHaveAttribute("data-mes", String(await meses.last().getAttribute("data-mes")));

  const escolhido = String(await meses.nth(8).getAttribute("data-mes"));
  await meses.nth(8).click();
  await expect(focado).toHaveAttribute("data-mes", escolhido);

  // A régua de agora é marcada: some quando a página se redesenha com o projeto novo.
  await page.locator(".regua").evaluate((el) => {
    el.setAttribute("data-antes", "");
  });
  await page.getByLabel("Projeto").selectOption("site");
  await expect(page.locator(".regua[data-antes]")).toHaveCount(0);
  await expect(page.getByLabel("Projeto")).toHaveValue("site");
  await expect(focado).toHaveAttribute("data-mes", escolhido);

  // O fim do período antes do mês em foco: o foco vai para o último mês do período novo.
  const ate = String(await meses.nth(5).getAttribute("data-mes"));
  await page.getByLabel("Até").selectOption(ate);
  await expect(meses).toHaveCount(6);
  await expect(focado).toHaveAttribute("data-mes", ate);
});
