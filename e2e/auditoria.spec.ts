// Auditoria do Histórico (F4; F7 §4.4) com o pi falso: o botão Auditar e o mês no cabeçalho, o chat da auditoria com a
// chamada a `subagent` e as seções, a pergunta de acompanhamento, o mês sem sessões e o pi que não sobe.
import { mkdirSync, writeFileSync } from "node:fs";
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

test.describe("com o pi fora do ar", () => {
  test.use({ pi: "/nao/existe/pi" });

  test("o erro da falha vai ao aviso e a tela fica no Histórico", async ({ pagina, fabriquinha }) => {
    semear(fabriquinha.raiz);
    await pagina.goto(`${fabriquinha.base}/history`);
    await pagina.getByRole("button", { name: "Auditar" }).click();
    await expect(pagina.locator("[data-aviso]")).toContainText("o agente da auditoria não subiu");
    await expect(pagina).toHaveURL(/\/history$/);
    await expect(pagina.getByRole("button", { name: "Auditar" })).toBeEnabled();
  });
});
