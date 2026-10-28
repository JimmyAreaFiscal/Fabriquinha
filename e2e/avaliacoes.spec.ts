// Avaliação do SDLC (D12; I-240) com o pi falso: o disparo em /evaluations com as recusas, a lista, o detalhe com os
// achados e a conversa, o encaminhamento como demanda e o celular de 375 px com vinte achados.
import { expect, projeto, test } from "./apoio.ts";

const FIM = "2026-10-12T12:00:00.000Z";
const SEMEAR_PROJETO = (nome: string) =>
  `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
     VALUES ('${nome}', '/r/${nome}', 'main', 'github', '["t"]', '${nome}', '[{"nome":"f","comando":"c","descricao":"d"}]');`;
const SEMEAR_DEMANDA = (id: string, projeto_: string) =>
  `INSERT INTO demanda VALUES ('${id}', '${projeto_}', 'Demanda ${id}', 'problema', 'd', 'execucao', '${FIM}', 'f', 's', 1, 'fabriquinha/${id}');
   INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES ('${id}', 1, 'implementar', 'aberto', '${FIM}');
   INSERT INTO sessao VALUES ('s-${id}', '${id}', 1, 'autonomo', 'c');
   INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES ('e-${id}', 's-${id}', '${FIM}', '${FIM}', 0);`;

/** `loja` com I-10, I-11 e I-12; `site` e `api` com uma demanda cada, todas com sessão terminada em outubro de 2026. */
function semear(raiz: string): void {
  projeto(
    raiz,
    [
      SEMEAR_PROJETO("site"),
      SEMEAR_PROJETO("api"),
      ...[
        ["I-10", "loja"],
        ["I-11", "loja"],
        ["I-12", "loja"],
        ["I-20", "site"],
        ["I-30", "api"],
      ].map(([i, p]) => SEMEAR_DEMANDA(i ?? "", p ?? "")),
    ].join("\n"),
  );
}

const PERIODO = { de: "2026-10-01", ate: "2026-10-31" };
const MESMA_ORIGEM = { "Sec-Fetch-Site": "same-origin" };

test("dispara em /evaluations, escolhe só a I-10, vê os achados, conversa e encaminha um (CA-1, 3, 4, 8 a 12, 14)", async ({
  pagina,
  fabriquinha,
  context,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/evaluations`);
  await expect(pagina.getByRole("link", { name: "Avaliações", exact: true })).toHaveAttribute("aria-current", "page");
  await pagina.getByLabel("Projeto").selectOption("loja");
  await pagina.getByLabel("De", { exact: true }).fill(PERIODO.de);
  await pagina.getByLabel("Até", { exact: true }).fill(PERIODO.ate);
  await expect(pagina.locator("[data-demanda]")).toHaveCount(3);
  await pagina.getByRole("checkbox", { name: /I-10/ }).check();
  await pagina.getByRole("button", { name: "Avaliar" }).click(); // pedido em branco

  // O escopo é só a I-10 e os três achados chegam, cada um com título, descrição e evidência.
  await expect(pagina).toHaveURL(/\/evaluations\/[0-9a-f-]{36}$/);
  await expect(pagina).toHaveTitle("Avaliação · Fabriquinha");
  await expect(pagina.getByRole("link", { name: "Avaliações", exact: true })).toHaveAttribute("aria-current", "page");
  const escopo = pagina.locator(".escopo");
  await expect(escopo.locator("a.id")).toHaveText(["I-10"]);
  const cartoes = pagina.locator(".achado");
  await expect(cartoes).toHaveCount(3);
  await expect(cartoes.first()).toContainText("Achado 1: o prompt repete o desenho");
  await expect(cartoes.first()).toContainText("traz o desenho inteiro em cada ticket (1)");
  await expect(cartoes.first()).toContainText("sessoes/I-10-s1.md: o desenho aparece de novo");
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("concluída");

  // A pergunta é respondida na mesma avaliação.
  const url = pagina.url();
  await pagina.getByLabel("Mensagem").fill("Detalhe o achado 1");
  await pagina.getByLabel("Mensagem").press("Enter");
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa).toContainText(/Avaliação de loja .* iniciada/);
  await expect(conversa).not.toContainText("Modo de trabalhar");
  await expect(conversa.locator(".msg.voce").last()).toContainText("Detalhe o achado 1");
  await expect(conversa.locator(".msg.agente").last()).toContainText("pronto");
  expect(pagina.url()).toBe(url);

  // Encaminhar: o link da demanda criada troca o botão; a segunda aba ainda tem o botão, e a recusa vai ao aviso.
  const outra = await context.newPage();
  await outra.goto(url);
  await expect(outra.locator(".achado")).toHaveCount(3);
  const botao = cartoes.first().getByRole("button", { name: "Encaminhar como demanda" });
  await botao.click();
  const link = cartoes.first().getByRole("link", { name: /Demanda/ });
  await expect(link).toHaveAttribute("href", /^\/demandas\/I-\d+$/);
  await expect(botao).toHaveCount(0);
  const demanda = String(await link.getAttribute("href")).replace("/demandas/", "");
  const lida = await pagina.request.get(`${fabriquinha.base}/api/demandas/${demanda}`);
  const { origem, demanda: criada } = (await lida.json()) as {
    origem: { avaliacao: string; achado: number };
    demanda: { titulo: string };
  };
  expect(origem).toMatchObject({ avaliacao: url.split("/").pop(), achado: 1 });
  expect(criada.titulo).toBe("Achado 1: o prompt repete o desenho");

  await outra.locator(".achado").first().getByRole("button", { name: "Encaminhar como demanda" }).click();
  await expect(outra.locator("[data-aviso]")).toContainText("já foi encaminhado");
  await outra.close();
});

test("a lista mostra período, projeto, estado e achados de cada avaliação (CA-1, 16)", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  for (const projetoDaAvaliacao of ["loja", "site", "api"]) {
    const resposta = await pagina.request.post(`${fabriquinha.base}/api/avaliacoes`, {
      headers: MESMA_ORIGEM,
      data: { projeto: projetoDaAvaliacao, ...PERIODO, pedido: "" },
    });
    expect(resposta.ok()).toBe(true);
  }
  await pagina.goto(`${fabriquinha.base}/evaluations`);
  const linhas = pagina.locator(".linha-avaliacao");
  await expect(linhas).toHaveCount(3);
  await expect(linhas).toHaveText(
    [/01\/10\/2026 a 31\/10\/2026.*api.*3 achados/, /site.*3 achados/, /loja.*3 achados/],
    {
      timeout: 10_000,
    },
  );
  await expect(linhas.first()).toContainText("concluída");
});

test("recusas: período sem demanda cita período e projeto; demanda de outro projeto cita a demanda (CA-2, 5)", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/evaluations`);
  await pagina.getByLabel("Projeto").selectOption("loja");
  await pagina.getByLabel("De", { exact: true }).fill("2025-01-01");
  await pagina.getByLabel("Até", { exact: true }).fill("2025-01-31");
  await pagina.getByRole("button", { name: "Avaliar" }).click();
  await expect(pagina.locator("[data-aviso]")).toContainText("loja");
  await expect(pagina.locator("[data-aviso]")).toContainText("2025-01-01 e 2025-01-31");
  await expect(pagina).toHaveURL(/\/evaluations$/);
  await expect(pagina.getByRole("button", { name: "Avaliar" })).toBeEnabled();

  const resposta = await pagina.request.post(`${fabriquinha.base}/api/avaliacoes`, {
    headers: MESMA_ORIGEM,
    data: { projeto: "loja", ...PERIODO, demandas: ["I-20"] },
  });
  expect(resposta.status()).toBe(409);
  expect(((await resposta.json()) as { erro: string }).erro).toContain("I-20");
});

test("com vinte achados, a 375 px a tela cabe na largura, sem rolagem horizontal (CA-18)", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.setViewportSize({ width: 375, height: 800 });
  await pagina.goto(`${fabriquinha.base}/evaluations`);
  await pagina.getByLabel("Projeto").selectOption("loja");
  await pagina.getByLabel("De", { exact: true }).fill(PERIODO.de);
  await pagina.getByLabel("Até", { exact: true }).fill(PERIODO.ate);
  await pagina.getByLabel("Pedido").fill("[20 achados]");
  await pagina.getByRole("button", { name: "Avaliar" }).click();
  await expect(pagina.locator(".achado")).toHaveCount(20, { timeout: 15_000 });
  const medidas = await pagina.evaluate(() => ({
    rolagem: document.documentElement.scrollWidth,
    largura: document.documentElement.clientWidth,
    cortados: [...document.querySelectorAll(".achado, .achado button")].filter(
      (e) => e.getBoundingClientRect().right > document.documentElement.clientWidth,
    ).length,
  }));
  expect(medidas.rolagem).toBe(medidas.largura);
  expect(medidas.cortados).toBe(0);
});

test.describe("com o pi fora do ar", () => {
  test.use({ pi: "/nao/existe/pi" });

  test("a recusa mostra a causa e a tela fica em /evaluations (CA-17)", async ({ pagina, fabriquinha }) => {
    semear(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/evaluations`);
    await pagina.getByLabel("Projeto").selectOption("loja");
    await pagina.getByLabel("De", { exact: true }).fill(PERIODO.de);
    await pagina.getByLabel("Até", { exact: true }).fill(PERIODO.ate);
    await pagina.getByRole("button", { name: "Avaliar" }).click();
    await expect(pagina.locator("[data-aviso]")).toContainText("o agente da avaliação não subiu");
    await expect(pagina.locator("[data-aviso]")).toContainText("spawn /nao/existe/pi ENOENT");
    await expect(pagina).toHaveURL(/\/evaluations$/);
    await expect(pagina.getByRole("button", { name: "Avaliar" })).toBeEnabled();
  });
});
