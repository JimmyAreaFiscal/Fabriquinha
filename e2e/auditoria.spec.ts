// Auditoria do Histórico (F4; F7 §4.4) com o pi falso: o botão Auditar e o mês no cabeçalho, o chat da auditoria com a
// chamada a `subagent` e as seções, a pergunta de acompanhamento, o mês sem sessões e o pi que não sobe.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, projeto, test } from "./apoio.ts";

const S1 = "9c2e0000-0000-4000-8000-000000000001";
const S2 = "55f00000-0000-4000-8000-000000000002";

/** O mês `AAAA-MM` de hoje e por extenso, no fuso desta máquina, que é o do serviço e o do navegador. */
const agora = new Date();
const MES = `${String(agora.getFullYear())}-${String(agora.getMonth() + 1).padStart(2, "0")}`;
const POR_EXTENSO = agora.toLocaleString("pt-BR", { month: "long", year: "numeric" });

/** Duas sessões de desenho terminadas no meio do mês corrente: a da I-1 na `loja` e a da I-2 no `site`. */
function semear(raiz: string): void {
  const fim = new Date(agora.getFullYear(), agora.getMonth(), 15, 12).toISOString();
  projeto(
    raiz,
    `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('site', '/r/site', 'main', 'github', '["t"]', 'site', '[{"nome":"f","comando":"c","descricao":"d"}]');
     INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em) VALUES
       (1, 'loja', 'Board por fase', 'funcionalidade', '', 'desenvolvimento', '${fim}'),
       (2, 'site', 'Menu do rodapé', 'funcionalidade', '', 'desenvolvimento', '${fim}');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
       (1, 1, 'desenho', 'Desenhar o board', 'concluido', 'fabriquinha', '${fim}', '${fim}'),
       (2, 2, 'desenho', 'Desenhar o menu', 'concluido', 'fabriquinha', '${fim}', '${fim}');
     INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em) VALUES
       (1, 1, 'autonomo', '${S1}', 'sucesso', '${fim}', '${fim}'),
       (2, 2, 'autonomo', '${S2}', 'sucesso', '${fim}', '${fim}');
     INSERT INTO sequencia (nome, valor) VALUES ('execucao', 2) ON CONFLICT (nome) DO UPDATE SET valor = 2;`,
  );
  const dir = join(raiz, "sessoes");
  mkdirSync(dir, { recursive: true });
  for (const sessao of [S1, S2]) {
    const mensagens = [
      { role: "user", content: "desenhe a solução" },
      { role: "assistant", content: [{ type: "text", text: "Desenho submetido." }], stopReason: "stop" },
    ];
    writeFileSync(
      join(dir, `2026-10-12T00-00-00-000Z_${sessao}.jsonl`),
      mensagens.map((message) => JSON.stringify({ type: "message", timestamp: fim, message })).join("\n"),
    );
  }
}

test("o cabeçalho do Histórico tem Auditar e o mês corrente escolhido", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/history`);
  await expect(pagina.getByRole("button", { name: "Auditar" })).toBeVisible();
  const mes = pagina.getByLabel("Mês");
  await expect(mes).toHaveValue(MES);
  await expect(mes.locator("option")).toHaveCount(12);
  await expect(mes.locator("option:checked")).toHaveText(POR_EXTENSO);
  await expect(mes).not.toHaveAttribute("data-f");
});

test("Auditar abre o chat da auditoria com as sessões de todos os projetos, mesmo com o filtro de projeto", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/history`);
  await pagina.getByLabel("Projeto").selectOption("loja");
  await expect(pagina.locator("[data-contagem]")).toHaveText("1 sessão");
  await pagina.getByRole("button", { name: "Auditar" }).click();

  await expect(pagina).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  await expect(pagina).toHaveTitle("Auditoria · Fabriquinha");
  const barra = pagina.locator(".estado-sessao");
  await expect(barra).toContainText(`Auditoria ${POR_EXTENSO}`);
  await expect(barra).toContainText("todos os projetos · 2 sessões");
  await expect(barra.getByRole("link", { name: "índice do mês" })).toHaveAttribute("target", "_blank");
  await expect(pagina.getByRole("link", { name: "Histórico" })).toHaveAttribute("aria-current", "page");
  const lado = pagina.getByRole("complementary");
  await expect(lado).toContainText("2 terminadas");
  await expect(lado).toContainText("loja (1) · site (1)");
  await expect(lado).toContainText("O agente só propõe melhorias");

  // A conversa: a linha do início no lugar do prompt, a chamada a subagent e as seções.
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".sistema").first()).toHaveText(`Auditoria de ${POR_EXTENSO} iniciada`);
  await expect(conversa).not.toContainText("Pasta da auditoria");
  const chamada = conversa.locator("details.ferramenta");
  await expect(chamada.locator("summary .nome-f")).toHaveText("subagent");
  await expect(chamada.locator("summary .args")).toContainText('"agent":"scout"');
  for (const secao of ["Oportunidades de melhoria", "Custos", "Qualidade", "Melhorias propostas"]) {
    await expect(conversa.getByRole("heading", { name: secao })).toBeVisible();
  }

  // Uma pergunta de acompanhamento é respondida na mesma página.
  const url = pagina.url();
  await pagina.getByLabel("Mensagem").fill("Detalhe a melhoria 1");
  await pagina.getByLabel("Mensagem").press("Enter");
  await expect(conversa.locator(".msg.voce").last()).toContainText("Detalhe a melhoria 1");
  await expect(conversa.locator(".msg.agente").last()).toContainText("pronto");
  await expect(pagina.getByLabel("Mensagem")).toBeEnabled();
  expect(pagina.url()).toBe(url);
});

test("Auditar sobe o pi com o modelo da Auditoria configurado; sem ele, com o padrão do pi", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const barra = pagina.locator(".estado-sessao");
  const logDaAuditoria = () => {
    const sessao = /\/audits\/([0-9a-f-]{36})$/.exec(pagina.url())?.[1] ?? "";
    return readFileSync(join(fabriquinha.raiz, "auditorias", sessao, "log"), "utf8").split("\n")[0] ?? "";
  };
  const auditar = async () => {
    await pagina.goto(`${fabriquinha.base}/history`);
    await pagina.getByRole("button", { name: "Auditar" }).click();
    await expect(pagina).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);
  };

  await auditar();
  expect(logDaAuditoria()).not.toMatch(/--provider|--model/);
  await expect(barra).toContainText("anthropic / claude-opus-5-5"); // o padrão do pi falso
  await expect(pagina.locator("[data-conversa]").getByRole("heading", { name: "Custos" })).toBeVisible();

  const resposta = await pagina.request.post(`${fabriquinha.base}/api/configuracao`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
    data: { modeloAuditoria: { provedor: "anthropic", modelo: "claude-sonnet-5-5" } },
  });
  expect(resposta.ok()).toBe(true);
  await auditar();
  expect(logDaAuditoria()).toContain("--provider anthropic --model claude-sonnet-5-5");
  await expect(barra).toContainText("anthropic / claude-sonnet-5-5");
});

test("Auditar com pedido põe o texto no prompt.md e o balão na conversa, também depois de recarregar", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const pedido = "Verifique se os agentes repetem perguntas que o prompt já responde";
  await pagina.goto(`${fabriquinha.base}/history`);
  await pagina.getByLabel("Pedido").fill(pedido);
  await pagina.getByRole("button", { name: "Auditar" }).click();
  await expect(pagina).toHaveURL(/\/audits\/[0-9a-f-]{36}$/);

  const sessao = /\/audits\/([0-9a-f-]{36})$/.exec(pagina.url())?.[1] ?? "";
  expect(readFileSync(join(fabriquinha.raiz, "auditorias", sessao, "prompt.md"), "utf8")).toContain(pedido);
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".msg.voce").first()).toContainText(pedido);
  await pagina.reload();
  await expect(conversa.locator(".sistema").first()).toHaveText(`Auditoria de ${POR_EXTENSO} iniciada`);
  await expect(conversa.locator(".msg.voce").first()).toContainText(pedido);
});

test("um mês sem sessões terminadas deixa a tela no Histórico com o aviso", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/history`);
  const anterior = pagina.getByLabel("Mês").locator("option").nth(1);
  const rotulo = String(await anterior.textContent());
  await pagina.getByLabel("Mês").selectOption({ index: 1 });
  await pagina.getByRole("button", { name: "Auditar" }).click();
  await expect(pagina.locator("[data-aviso]")).toHaveText(`Nenhuma sessão terminada em ${rotulo} para auditar.`);
  await expect(pagina).toHaveURL(/\/history$/);
  await expect(pagina.getByRole("button", { name: "Auditar" })).toBeEnabled();
});

test("um mês vazio com pedido avisa, mantém o pedido no campo e não cria pasta", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/history`);
  const rotulo = String(await pagina.getByLabel("Mês").locator("option").nth(1).textContent());
  await pagina.getByLabel("Mês").selectOption({ index: 1 });
  await pagina.getByLabel("Pedido").fill("Explore a métrica de custos");
  await pagina.getByRole("button", { name: "Auditar" }).click();
  await expect(pagina.locator("[data-aviso]")).toHaveText(`Nenhuma sessão terminada em ${rotulo} para auditar.`);
  await expect(pagina.getByLabel("Pedido")).toHaveValue("Explore a métrica de custos");
  const pasta = join(fabriquinha.raiz, "auditorias");
  expect(existsSync(pasta) ? readdirSync(pasta) : []).toEqual([]);
});

test.describe("com o pi fora do ar", () => {
  test.use({ pi: "/nao/existe/pi" });

  test("o erro da falha vai ao aviso e a tela fica no Histórico", async ({ pagina, fabriquinha }) => {
    semear(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/history`);
    await pagina.getByRole("button", { name: "Auditar" }).click();
    await expect(pagina.locator("[data-aviso]")).toContainText("o agente da auditoria não subiu");
    await expect(pagina.locator("[data-aviso]")).toContainText("spawn /nao/existe/pi ENOENT");
    await expect(pagina.locator("[data-aviso]")).not.toContainText("auditorias/");
    await expect(pagina).toHaveURL(/\/history$/);
    await expect(pagina.getByRole("button", { name: "Auditar" })).toBeEnabled();
  });
});
