// Responder e retomar com o histórico de outra sessão anexado (F7 §4.4, item 3; F4 §6.4, §6.8): o anexo vai com a
// instrução e chega ao prompt da próxima tentativa.
import type { Page } from "@playwright/test";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";

/** Issues em desenvolvimento, cada uma com um ticket aberto de mesmo número que o pi falso não conclui. */
const emDesenvolvimento = (...ids: number[]) =>
  ids
    .map(
      (id) =>
        `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
           VALUES (${String(id)}, 'loja', 'Issue ${String(id)}', 'problema', '', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
         INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
           VALUES (${String(id)}, ${String(id)}, 'desenvolvimento', 'Ticket ${String(id)}', 'aberto', 'fabriquinha', '2026-10-11T12:00:00.000Z');`,
    )
    .join("\n");

/** Executar agora até o ticket falhar na coleta (os testes do projeto reprovam); devolve a sessão. */
async function executarAteFalhar(pagina: Page, { base }: Fabriquinha, ticket: number): Promise<string> {
  const executar = await pagina.request.post(`${base}/api/tickets/${String(ticket)}/executar`, {
    headers: { "Sec-Fetch-Site": "same-origin" },
  });
  expect(executar.status()).toBe(204);
  let sessao = "";
  await expect(async () => {
    const ativas = (await (await pagina.request.get(`${base}/api/sessoes?escopo=ativas`)).json()) as {
      sessao: string;
      ticket: number;
      motivo?: string;
    }[];
    const falhou = ativas.find((s) => s.ticket === ticket && s.motivo === "falha");
    expect(falhou).toBeTruthy();
    sessao = String(falhou?.sessao);
  }).toPass();
  return sessao;
}

test("responde e retoma com o histórico de outra sessão anexado, que chega ao prompt da próxima tentativa", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz, emDesenvolvimento(1, 2));
  const sessao = await executarAteFalhar(pagina, fabriquinha, 1);
  const outra = await executarAteFalhar(pagina, fabriquinha, 2);
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);

  const retomar = pagina.locator("form[data-retomar]");
  await retomar.getByRole("button", { name: "+ Anexar histórico" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Anexar histórico" });
  await caixa.locator(`[data-anexar-sessao="${outra}"]`).click();
  await expect(caixa).toBeHidden();
  const anexo = retomar.locator(".anexo");
  await expect(anexo).toHaveText(`histórico de s-${outra.slice(0, 4)} · I-2 · T-2×`);
  await retomar.getByRole("textbox", { name: "Instrução" }).fill("veja como a outra falhou");
  await retomar.getByRole("button", { name: "Responder e retomar" }).click();
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("rodando");
  await expect(retomar).toHaveCount(0);

  // A próxima tentativa (E-3) leva a instrução com a linha do histórico anexado.
  expect(await executarAteFalhar(pagina, fabriquinha, 1)).toBe(sessao);
  const prompt = await (await pagina.request.get(`${fabriquinha.base}/api/execucoes/3/prompt`)).text();
  expect(prompt).toMatch(
    /# Instrução do Auditor\n\nveja como a outra falhou\nHistórico da sessão T-2 \(I-2, desenvolvimento\) em `[^`]+historico-T-2\.md`; leia antes de responder\./,
  );
});
