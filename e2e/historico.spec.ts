// Histórico (F7 §4.4): filtrar as sessões terminadas das tabelas da demanda, selecionar uma, ler a prévia e abrir o
// chat dela.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, projeto, test } from "./apoio.ts";

const S1 = "9c2e0000-0000-4000-8000-000000000001";
const S2 = "55f00000-0000-4000-8000-000000000002";

/** O agora do navegador, fixo: 12/10/2026 às 15:00, no fuso local (o do serviço e o do navegador). */
const AGORA = new Date(2026, 9, 12, 15, 0);
const instante = (minutosAtras: number) => new Date(AGORA.getTime() - minutosAtras * 60_000).toISOString();

/** A conversa da sessão no JSONL do pi: o prompt, uma ferramenta e a última resposta do agente. */
function conversa(raiz: string, sessao: string, ultima: string): void {
  const dir = join(raiz, "sessoes");
  mkdirSync(dir, { recursive: true });
  const agente = { role: "assistant", provider: "anthropic", model: "claude-opus-5-5", stopReason: "stop" };
  const mensagens = [
    { role: "user", content: "desenhe a solução" },
    { ...agente, content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "npm test" } }] },
    {
      role: "toolResult",
      toolCallId: "t1",
      content: [{ type: "text", text: Array.from({ length: 12 }, (_, i) => `suite ${String(i + 1)}: ok`).join("\n") }],
    },
    { ...agente, content: [{ type: "text", text: ultima }] },
  ];
  writeFileSync(
    join(dir, `2026-10-12T00-00-00-000Z_${sessao}.jsonl`),
    mensagens.map((message, i) => JSON.stringify({ type: "message", timestamp: instante(30 - i), message })).join("\n"),
  );
}

/**
 * Duas sessões de planejamento terminadas: a da I-1, hoje às 14:55, que levou 22 min; e a da I-2, ontem às 13:00, que
 * falhou e foi refeita.
 */
function semear(raiz: string): void {
  const [fim1, fim2] = [instante(5), instante(26 * 60)];
  projeto(
    raiz,
    `INSERT INTO demanda VALUES
       ('I-1', 'loja', 'Board por fase', 'funcionalidade', 'd', 'planejamento', '${instante(3000)}', 'f', 's', 1, 'fabriquinha/I-1'),
       ('I-2', 'loja', 'Timeout no checkout', 'problema', 'd', 'planejamento', '${instante(3000)}', 'f', 's', 1, 'fabriquinha/I-2');
     INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES
       ('I-1', 1, 'planejar', 'concluido', '${fim1}'),
       ('I-2', 1, 'planejar', 'concluido', '${fim2}');
     INSERT INTO sessao VALUES ('${S1}', 'I-1', 1, 'autonomo', 'c1'), ('${S2}', 'I-2', 1, 'autonomo', 'c2');
     INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha, modelo_provedor, modelo_nome) VALUES
       ('x1', '${S1}', '${instante(27)}', '${fim1}', 0, 'anthropic', 'claude-opus-5-5'),
       ('x2', '${S2}', '${instante(26 * 60 + 30)}', '${fim2}', 1, NULL, NULL);`,
  );
  conversa(raiz, S1, "Planejamento submetido: **4 evidências**, 3 tickets propostos.");
  conversa(raiz, S2, "Tempo esgotado.");
}

test("filtra por demanda, seleciona uma sessão, lê a prévia e abre o chat dela", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/history`);
  await expect(pagina).toHaveTitle("Histórico · Fabriquinha");
  const contagem = pagina.locator("[data-contagem]");
  await expect(contagem).toHaveText("2 sessões");

  // Da mais recente para a mais antiga, por dia; a mais recente já vem selecionada.
  await expect(pagina.locator(".dia h3")).toHaveText(["Hoje", "Ontem"]);
  const linhas = pagina.locator("button.linha");
  await expect(linhas.nth(0)).toHaveText("14:55I-1.T1Board por fase · planejamento · autônomaconcluída");
  await expect(linhas.nth(1)).toHaveText("13:00I-2.T1Timeout no checkout · planejamento · autônomafalha");
  await expect(linhas.nth(0)).toHaveAttribute("aria-selected", "true");
  const previa = pagina.getByRole("complementary", { name: "Prévia da sessão" });
  await expect(previa.getByRole("heading")).toHaveText("Board por fase");

  // Filtrar pela demanda: só a da I-2, que fica selecionada.
  await pagina.getByRole("textbox", { name: "Demanda" }).fill("I-2");
  await expect(contagem).toHaveText("1 sessão");
  await expect(linhas).toHaveCount(1);
  await pagina.getByRole("textbox", { name: "Demanda" }).fill("");
  await expect(contagem).toHaveText("2 sessões");
  await pagina.getByRole("textbox", { name: "Demanda" }).fill("1");
  await expect(contagem).toHaveText("1 sessão");
  await expect(linhas).toHaveText([/Board por fase/]);

  // Selecionar mostra a prévia ao lado, sem sair da página.
  await pagina.getByRole("textbox", { name: "Demanda" }).fill("");
  await expect(linhas).toHaveCount(2);
  await linhas.nth(1).click();
  await expect(linhas.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(previa.getByRole("heading")).toHaveText("Timeout no checkout");
  await expect(previa.locator(".pill")).toHaveText("falha");
  await linhas.nth(0).click();
  await expect(previa.locator(".id").first()).toHaveText("I-1 · I-1.T1");
  await expect(previa.locator(".fatos dd")).toHaveText([
    "loja",
    "planejamento · autônoma",
    "concluída",
    "Hoje 14:55 · durou 22 min",
    "anthropic / claude-opus-5-5",
    "3",
  ]);
  const trecho = previa.locator(".trecho");
  // A chamada de ferramenta vem recolhida, como no chat; aberta, mostra a saída, e ver tudo a abre inteira na caixa.
  const ferramenta = trecho.locator("details.ferramenta");
  await expect(ferramenta.locator("summary")).toHaveText("bashnpm test✓ 12 linhas");
  await expect(ferramenta.locator("pre")).toBeHidden();
  await ferramenta.locator("summary").click();
  await expect(ferramenta.locator("pre")).toContainText("suite 1: ok");
  await ferramenta.getByRole("button", { name: "ver tudo" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Saída de bash" });
  await expect(caixa.locator("pre")).toContainText("suite 12: ok");
  await pagina.keyboard.press("Escape");
  await expect(caixa).toBeHidden();
  await expect(trecho).toContainText("agentePlanejamento submetido: 4 evidências, 3 tickets propostos.");
  await expect(trecho.locator("strong")).toHaveText("4 evidências");
  await expect(previa.getByRole("link", { name: "Abrir o chat" })).toHaveAttribute("href", `/sessions/${S1}`);
  await expect(previa.getByRole("link", { name: "Exportar" })).toHaveAttribute(
    "href",
    `/api/sessoes/${S1}/historico.md`,
  );
  await previa.getByRole("link", { name: "Abrir o chat" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/sessions/${S1}`);
  await expect(pagina).toHaveTitle("Chat · Fabriquinha");
});

test("o endereço do ticket fica inteiro, sem encostar no título, a 1440 e 375 px (CA-7)", async ({
  pagina,
  fabriquinha,
}, info) => {
  const fim = instante(5);
  projeto(
    fabriquinha.raiz,
    `INSERT INTO demanda VALUES
       ('I-1', 'loja', 'Board por fase', 'funcionalidade', 'd', 'concluida', '${fim}', 'f', 's', 1, 'fabriquinha/I-1'),
       ('I-247', 'loja', 'Remover o fluxo legado de issues, tickets e execuções da Fabriquinha', 'funcionalidade', 'd', 'concluida', '${fim}', 'f', 's', 1, 'fabriquinha/I-247');
     INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, status, status_alterado_em) VALUES
       ('I-1', 1, 'planejar', 'concluido', '${fim}'),
       ('I-247', 18, 'implementar', 'concluido', '${fim}');
     INSERT INTO sessao VALUES ('${S1}', 'I-1', 1, 'autonomo', 'c1'), ('${S2}', 'I-247', 18, 'autonomo', 'c2');
     INSERT INTO execucao_sessao (id, sessao_id, inicio, fim, falha) VALUES
       ('x1', '${S1}', '${instante(20)}', '${fim}', 0),
       ('x2', '${S2}', '${instante(10)}', '${fim}', 0);`,
  );
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/history`);
  const linhas = pagina.locator("button.linha");
  await expect(linhas).toHaveCount(2);
  // Só o endereço do ticket; a prévia segue com demanda · ticket.
  await expect(linhas.locator(".id")).toHaveText(["I-247.T18", "I-1.T1"]);
  await expect(pagina.locator(".previa .id").first()).toHaveText("I-247 · I-247.T18");

  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    const medidas = await linhas.evaluateAll((botoes) =>
      botoes.map((b) => {
        const [endereco, titulo] = [b.querySelector(".id"), b.querySelector(".meio")] as [HTMLElement, HTMLElement];
        return {
          enderecoDireita: endereco.getBoundingClientRect().right,
          enderecoVisivel: endereco.getBoundingClientRect().width > 0,
          enderecoCortado: endereco.scrollWidth > endereco.clientWidth,
          tituloEsquerda: titulo.getBoundingClientRect().left,
          tituloComReticencias: getComputedStyle(titulo).textOverflow === "ellipsis",
        };
      }),
    );
    for (const m of medidas) {
      expect(m.enderecoVisivel, `${String(largura)} px`).toBe(true);
      expect(m.enderecoCortado, `${String(largura)} px`).toBe(false);
      // Pelo menos o gap da linha entre o fim do endereço e o título.
      expect(m.tituloEsquerda - m.enderecoDireita, `${String(largura)} px`).toBeGreaterThanOrEqual(8);
      expect(m.tituloComReticencias).toBe(true);
    }
    // Os títulos começam na mesma coluna em todas as linhas.
    expect(new Set(medidas.map((m) => m.tituloEsquerda)).size, `${String(largura)} px`).toBe(1);
    expect(await pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await pagina.screenshot({ path: info.outputPath(`historico-${String(largura)}.png`), fullPage: true });
  }
});
