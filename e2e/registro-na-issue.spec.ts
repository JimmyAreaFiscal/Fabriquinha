// Gate do registro também na página da issue (F7 §4.4, painéis de gate): o mesmo painel do chat, Devolver só com o
// motivo, que vai ao agente como mensagem (F4 §6.6), e Aprovar registro, que leva a issue ao desenho (C10).
import type { Page } from "@playwright/test";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";

/** Uma chamada da própria página, com o cookie e a origem dela. */
const postar = (pagina: Page, caminho: string, corpo: object) =>
  pagina.evaluate(
    async ({ caminho, corpo }) => {
      const r = await fetch(caminho, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      return r.status === 204 ? undefined : ((await r.json()) as unknown);
    },
    { caminho, corpo },
  );

/** Espera a sessão aguardar o Auditor pelo `motivo`. */
async function aguardar(pagina: Page, { base }: Fabriquinha, sessao: string, motivo: string): Promise<void> {
  await expect(async () => {
    const info = (await (await pagina.request.get(`${base}/api/sessoes/${sessao}`)).json()) as {
      sessao: { motivo?: string };
    };
    expect(info.sessao.motivo).toBe(motivo);
  }).toPass();
}

test("devolver e aprovar o registro pela página da issue", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/home`);
  const { sessao } = (await postar(pagina, "/api/registros", {
    projeto: "loja",
    descricao: "Exportar pedidos em CSV",
  })) as { sessao: string };
  await aguardar(pagina, fabriquinha, sessao, "conversa");
  await postar(pagina, `/api/sessoes/${sessao}/mensagens`, { texto: "registre", modo: "prompt" });
  await aguardar(pagina, fabriquinha, sessao, "gate_registro");

  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina
    .getByRole("region", { name: "Ação do Auditor" })
    .getByRole("region", { name: "Gate do registro" });
  await expect(gate.locator(".gate-cabeca")).toContainText("Gate do registroaguarda você há menos de 1 min");
  await expect(gate.getByRole("link", { name: "abrir o chat da sessão →" })).toHaveAttribute(
    "href",
    `/sessions/${sessao}`,
  );
  await expect(gate.locator(".fatos dd")).toHaveText([
    "Exportar pedidos em CSV",
    "funcionalidade",
    "Exportar pedidos em CSV",
    "hoje a contabilidade copia os pedidos à mão",
  ]);
  await expect(gate.locator("th")).toHaveText(["ID", "Dado", "Quando", "Então"]);
  await expect(gate.locator("tbody tr")).toHaveCount(2);
  await expect(gate).toContainText("Nenhuma evidência faltando.");

  // Devolver só com o motivo; o motivo vai ao agente, que registra de novo.
  const devolver = gate.getByRole("button", { name: "Devolver" });
  const motivo = gate.getByLabel("Motivo (obrigatório para devolver)");
  await expect(devolver).toBeDisabled();
  await motivo.fill(" ");
  await expect(devolver).toBeDisabled();
  await motivo.fill("faltou o formato do arquivo; **registre** de novo");
  await expect(devolver).toBeEnabled();
  await devolver.click();
  await expect(gate).toBeHidden();
  await expect(pagina.getByRole("alert")).toBeHidden();
  await expect(async () => {
    const chat = JSON.stringify(await (await pagina.request.get(`${fabriquinha.base}/api/sessoes/${sessao}`)).json());
    expect(chat).toContain("faltou o formato do arquivo");
  }).toPass();

  // De volta ao gate, aprovar leva a issue ao desenho.
  await aguardar(pagina, fabriquinha, sessao, "gate_registro");
  await pagina.reload();
  await gate.getByRole("button", { name: "Aprovar registro" }).click();
  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenho");
});
