// Projeto numa janela estreita (F7 §4.4, ticket 29): o trilho rola na horizontal, e o cabeçalho das colunas continua
// fixo no topo ao rolar a página e acompanha a rolagem horizontal do trilho.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

test.use({ viewport: { width: 1000, height: 700 } });

test("abaixo de 1100px o cabeçalho das colunas fica fixo ao rolar a página e acompanha a rolagem do trilho", async ({
  page,
  pagina,
  fabriquinha,
}) => {
  const banco = abrir(fabriquinha.raiz);
  const issues = Array.from(
    { length: 20 },
    (_, i) =>
      `(${String(i + 1)}, 'loja', 'Issue ${String(i + 1)}', 'problema', 'desenvolvimento', '2026-10-11T12:00:00.000Z')`,
  );
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES ${issues.join(",")};
  `);
  banco.close();
  await pagina.goto(`${fabriquinha.base}/projects/loja`);
  await expect(page.locator(".pista-item")).toHaveCount(20);
  const desenvolvimento = page.locator(".pista-fase", { hasText: "Desenvolvimento" });
  const nav = await page.locator(".nav").boundingBox();

  // A página rola para baixo: o cabeçalho fica logo abaixo da navegação.
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(300);
  await expect.poll(async () => (await desenvolvimento.boundingBox())?.y).toBeGreaterThan(nav?.height ?? 0);
  await expect.poll(async () => (await desenvolvimento.boundingBox())?.y).toBeLessThan((nav?.height ?? 0) + 60);

  // O trilho rola na horizontal, e a coluna do cabeçalho continua sobre a mesma coluna das linhas.
  const marco = page.locator(".pista-item").first().locator(".trilho-fases .passo").nth(3);
  const distancia = async () => {
    const [cabeca, linha] = await Promise.all([desenvolvimento.boundingBox(), marco.boundingBox()]);
    return Math.round((cabeca?.x ?? 0) - (linha?.x ?? 0));
  };
  const antes = await distancia();
  const rola = page.locator(".pista-rola");
  await rola.evaluate((el) => {
    el.scrollLeft = 100;
  });
  await expect.poll(() => rola.evaluate((el) => el.scrollLeft)).toBe(100);
  await expect.poll(async () => (await desenvolvimento.boundingBox())?.x).toBeLessThan(450);
  expect(await distancia()).toBe(antes);
});
