// Histórico (F7 §4.4; F4 §5.3): filtrar as sessões terminadas por issue, selecionar uma, ler a prévia e abrir uma
// consulta a partir dela.
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
    { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "214 passed" }] },
    { ...agente, content: [{ type: "text", text: ultima }] },
  ];
  writeFileSync(
    join(dir, `2026-10-12T00-00-00-000Z_${sessao}.jsonl`),
    mensagens.map((message, i) => JSON.stringify({ type: "message", timestamp: instante(30 - i), message })).join("\n"),
  );
}

/**
 * Duas sessões de desenho terminadas: a da I-1, hoje às 14:55, que levou 22 min e custou US$ 1,86; e a da I-2, ontem
 * às 13:00, que falhou e foi refeita. O projeto tem um clone de verdade, para a consulta subir o pi falso.
 */
function semear(raiz: string): void {
  const [fim1, fim2] = [instante(5), instante(26 * 60)];
  projeto(
    raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em) VALUES
       (1, 'loja', 'Board por fase', 'funcionalidade', '', 'desenvolvimento', '${instante(3000)}'),
       (2, 'loja', 'Timeout no checkout', 'problema', '', 'desenvolvimento', '${instante(3000)}');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
       (1, 1, 'desenho', 'Desenhar o board', 'concluido', 'fabriquinha', '${instante(3000)}', '${fim1}'),
       (2, 2, 'desenho', 'Desenhar a busca', 'concluido', 'fabriquinha', '${instante(3000)}', '${fim2}');
     INSERT INTO execucao (id, ticket, modo, sessao_pi, modelo_provedor, modelo_nome, resultado, erro, iniciada_em, terminada_em) VALUES
       (1, 1, 'autonomo', '${S1}', 'anthropic', 'claude-opus-5-5', 'sucesso', NULL, '${instante(27)}', '${fim1}'),
       (2, 2, 'autonomo', '${S2}', NULL, NULL, 'falha', 'tempo limite de 30 min', '${instante(26 * 60 + 30)}', '${fim2}');
     INSERT INTO sequencia (nome, valor) VALUES ('execucao', 2) ON CONFLICT (nome) DO UPDATE SET valor = 2;
     INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
       VALUES (1, 'anthropic', 'claude-opus-5-5', 3, 10, 2, 0, 0, 1.86);`,
  );
  conversa(raiz, S1, "Desenho submetido: **4 evidências**, 3 tickets propostos.");
  conversa(raiz, S2, "Tempo esgotado.");
}

test("filtra por issue, seleciona uma sessão, lê a prévia e abre uma consulta a partir dela", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.clock.setFixedTime(AGORA);
  await pagina.goto(`${fabriquinha.base}/history`);
  await expect(pagina).toHaveTitle("Histórico · Fabriquinha");
  const contagem = pagina.locator("[data-contagem]");
  await expect(contagem).toHaveText("2 sessões");

  // Da mais recente para a mais antiga, por dia; a mais recente já vem selecionada.
  await expect(pagina.locator(".dia h3")).toHaveText(["Hoje", "Ontem"]);
  const linhas = pagina.locator("button.linha");
  await expect(linhas.nth(0)).toHaveText("14:55I-1T-1Board por fase · desenho · autônomaconcluídaUS$ 1,86");
  await expect(linhas.nth(1)).toHaveText("13:00I-2T-2Timeout no checkout · desenho · autônomafalhaUS$ 0,00");
  await expect(linhas.nth(0)).toHaveAttribute("aria-selected", "true");
  const previa = pagina.getByRole("complementary", { name: "Prévia da sessão" });
  await expect(previa.getByRole("heading")).toHaveText("Board por fase");

  // Filtrar pela issue: só a da I-2, que fica selecionada.
  await pagina.getByLabel("Issue").fill("I-2");
  await expect(contagem).toHaveText("1 sessão");
  await expect(linhas).toHaveCount(1);
  await pagina.getByLabel("Issue").fill("");
  await expect(contagem).toHaveText("2 sessões");
  await pagina.getByLabel("Issue").fill("1");
  await expect(contagem).toHaveText("1 sessão");
  await expect(linhas).toHaveText([/Board por fase/]);

  // Selecionar mostra a prévia ao lado, sem sair da página.
  await pagina.getByLabel("Issue").fill("");
  await expect(linhas).toHaveCount(2);
  await linhas.nth(1).click();
  await expect(linhas.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(previa.getByRole("heading")).toHaveText("Timeout no checkout");
  await expect(previa.locator(".pill")).toHaveText("falha");
  await linhas.nth(0).click();
  await expect(previa.locator(".id").first()).toHaveText("I-1 · T-1");
  await expect(previa.locator(".fatos dd")).toHaveText([
    "loja",
    "desenho · autônoma",
    "concluída",
    "Hoje 14:55 · durou 22 min",
    "US$ 1,86 · anthropic / claude-opus-5-5",
    "3",
  ]);
  const trecho = previa.locator(".trecho");
  await expect(trecho.locator(".ferr")).toHaveText("▸ bash npm test ✓ 1 linha");
  await expect(trecho).toContainText("agenteDesenho submetido: 4 evidências, 3 tickets propostos.");
  await expect(trecho.locator("strong")).toHaveText("4 evidências");
  await expect(previa.getByRole("link", { name: "Abrir o chat" })).toHaveAttribute("href", `/sessions/${S1}`);
  await expect(previa.getByRole("link", { name: "Exportar" })).toHaveAttribute(
    "href",
    `/api/sessoes/${S1}/historico.md`,
  );

  // Conversar sobre abre o chat da consulta, que começa com a conversa da sessão.
  await previa.getByRole("button", { name: "Conversar sobre" }).click();
  await expect(pagina).toHaveURL(/\/sessions\//);
  await expect(pagina).not.toHaveURL(new RegExp(S1));
  const barra = pagina.locator(".estado-sessao");
  await expect(barra).toContainText("I-1 Board por fase");
  await expect(barra).toContainText("desenho · consulta");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");
  await expect(pagina.locator("[data-conversa] .msg.agente").last()).toContainText("Desenho submetido");
});
