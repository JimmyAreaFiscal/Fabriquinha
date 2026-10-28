// Configuração (F7 §4.4, itens 4 e 5): a conferência do repositório que falha ao cadastrar aparece no rodapé junto da
// nota "Ao salvar…", que fica, e o que o Auditor preencheu continua no formulário.
import { join } from "node:path";
import { expect, test } from "./apoio.ts";

test("a conferência que falha ao cadastrar fica no rodapé, sem apagar a nota nem o formulário", async ({
  pagina,
  fabriquinha,
}) => {
  await pagina.goto(`${fabriquinha.base}/config?novo`);
  await pagina.getByLabel("Nome", { exact: true }).fill("loja");
  await pagina.getByLabel("Caminho do repositório").fill(join(fabriquinha.raiz, "nao-existe"));
  await pagina.getByRole("button", { name: "Cadastrar projeto" }).click();

  const rodape = pagina.locator(".rodape-form");
  await expect(rodape.getByRole("alert")).toContainText("nao-existe");
  await expect(rodape).toContainText("Ao salvar, a Fabriquinha confere o repositório, a branch e o remoto.");
  await expect(rodape.getByRole("button", { name: "Cadastrar projeto" })).toBeEnabled();
  await expect(pagina.getByLabel("Caminho do repositório")).toHaveValue(join(fabriquinha.raiz, "nao-existe"));
});
