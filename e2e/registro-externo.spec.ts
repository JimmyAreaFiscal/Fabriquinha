// Registro pela IA externa (`fabriquinha necessidade`): ela registra, submete as evidências e envia pelo CLI de verdade,
// sem sessão do pi; o Auditor vê o gate em Aguarda você e na página da issue, devolve (o motivo ela lê pelo CLI) e aprova.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";

const CLI = join(import.meta.dirname, "..", "src", "cli", "fabriquinha.ts");

/** `fabriquinha <args>` como a IA externa o roda: na pasta dela, sem FABRIQUINHA_EXECUCAO; devolve o JSON da saída. */
function necessidade({ raiz }: Fabriquinha, pasta: string, ...args: string[]): Record<string, unknown> {
  const { FABRIQUINHA_EXECUCAO: _, ...env } = process.env;
  const saida = execFileSync(CLI, ["necessidade", ...args], { cwd: pasta, env: { ...env, FABRIQUINHA_ROOT: raiz } });
  return JSON.parse(saida.toString()) as Record<string, unknown>;
}

test("a IA externa registra pelo CLI e o Auditor devolve e aprova pela página da issue", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  const pasta = mkdtempSync(join(fabriquinha.raiz, "ia-externa-"));
  writeFileSync(join(pasta, "desc.md"), "A busca de pedidos demora 10 s com mil pedidos.");
  writeFileSync(
    join(pasta, "comp.json"),
    JSON.stringify({ descricao: "a busca demora 10 s", comoReproduzir: ["abrir pedidos", "buscar por cliente"] }),
  );
  writeFileSync(
    join(pasta, "ca.json"),
    JSON.stringify({
      criterios: [
        { id: "CA-1", dado: "mil pedidos", quando: "o Auditor busca por cliente", entao: "a lista vem em até 2 s" },
      ],
    }),
  );
  writeFileSync(join(pasta, "tela.webm"), Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02]));

  const registrar = ["--projeto", "loja", "--titulo", "Busca de pedidos lenta", "--tipo", "problema"];
  expect(necessidade(fabriquinha, pasta, "registrar", ...registrar, "--descricao", "desc.md").id).toBe(1);
  necessidade(
    fabriquinha,
    pasta,
    "evidencia",
    "I-1",
    "comportamento",
    "--dados",
    "comp.json",
    "--arquivo",
    "tela.webm",
  );
  necessidade(fabriquinha, pasta, "evidencia", "I-1", "criterios_aceite", "--dados", "ca.json");
  necessidade(fabriquinha, pasta, "enviar", "I-1");

  // Aguarda você: o card leva à página da issue, onde o gate se decide.
  await pagina.goto(`${fabriquinha.base}/home`);
  const card = pagina.locator(".bloco-aguarda .decisao");
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("Registro enviado por uma IA externa; falta aprovar");
  await expect(pagina.locator(".cartao .pill-aguarda")).toHaveText("aguarda você · gate do registro");
  await pagina.screenshot({ path: test.info().outputPath("inicio.png"), fullPage: true });
  await card.click();
  await expect(pagina).toHaveURL(/\/projects\/loja\/issues\/I-1$/);

  const gate = pagina
    .getByRole("region", { name: "Ação do Auditor" })
    .getByRole("region", { name: "Gate do registro" });
  await expect(gate.locator(".gate-cabeca")).toHaveText(
    "Gate do registroaguarda você há menos de 1 minregistrado por uma IA externa, sem chat",
  );
  await expect(gate.locator(".fatos dd")).toHaveText([
    "Busca de pedidos lenta",
    "problema",
    "A busca de pedidos demora 10 s com mil pedidos.",
    "a busca demora 10 s",
  ]);
  await expect(gate.locator("tbody tr")).toHaveCount(1);
  await expect(gate).toContainText("Nenhuma evidência faltando.");
  await pagina.screenshot({ path: test.info().outputPath("issue.png"), fullPage: true });

  // Devolver: nenhuma sessão abre; a IA externa lê o motivo pelo CLI e envia de novo.
  await gate.getByLabel("Motivo (obrigatório para devolver)").fill("Falta o caminho de erro: busca sem resultado");
  await gate.getByRole("button", { name: "Devolver" }).click();
  await expect(gate).toBeHidden();
  await expect(pagina.getByRole("alert")).toBeHidden();
  const vista = necessidade(fabriquinha, pasta, "ver", "I-1");
  expect(vista.decisoes).toEqual([
    expect.objectContaining({
      gate: "registro",
      aprovado: false,
      motivo: "Falta o caminho de erro: busca sem resultado",
    }),
  ]);
  necessidade(fabriquinha, pasta, "enviar", "I-1");

  await pagina.reload();
  await gate.getByRole("button", { name: "Aprovar registro" }).click();
  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenho");
});
