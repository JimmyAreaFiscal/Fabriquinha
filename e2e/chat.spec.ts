// Chat (F7 §4.4; F4 §5.4) da sessão de ticket da demanda com o pi falso: o campo Mensagem, os diálogos e as perguntas do
// agente. A sessão é a do planejamento da I-230, aberta pelo Executar agora (demandas-apoio.ts).
import type { Page } from "@playwright/test";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";
import { abrirOChatDoPlanejamento, semearPlanejamentoComPi } from "./demandas-apoio.ts";

/** O chat do planejamento da I-230, que respondeu ao prompt e aguarda o Auditor; devolve a sessão. */
async function abrirConversa(pagina: Page, fabriquinha: Fabriquinha): Promise<string> {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "Exportar pedidos em CSV");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);
  return decodeURIComponent(new URL(pagina.url()).pathname.slice("/sessions/".length));
}

test("o campo Mensagem: só espaços não envia, Shift+Enter quebra a linha e o texto do agente é Markdown seguro", async ({
  pagina,
  fabriquinha,
}) => {
  await abrirConversa(pagina, fabriquinha);
  const conversa = pagina.locator("[data-conversa]");
  const mensagem = pagina.locator("form[data-envio]").getByRole("textbox", { name: "Mensagem" });
  await expect(conversa.locator(".msg")).toHaveText(["pronto"]);
  const envios: string[] = [];
  pagina.on("request", (r) => {
    if (r.method() === "POST" && r.url().endsWith("/mensagens")) envios.push(r.url());
  });

  // CA-6
  await mensagem.fill("   ");
  await mensagem.press("Enter");
  await pagina.waitForTimeout(300);
  await expect(mensagem).toHaveValue("   ");
  await expect(conversa.locator(".msg")).toHaveCount(1);
  expect(envios).toHaveLength(0);

  // CA-7
  await mensagem.fill("linha 1");
  await mensagem.press("Shift+Enter");
  await expect(mensagem).toHaveValue("linha 1\n");
  await pagina.waitForTimeout(300);
  await expect(conversa.locator(".msg")).toHaveCount(1);
  expect(envios).toHaveLength(0);

  // CA-14
  await mensagem.fill("eco: **negrito** <script>window.invadido = 1</script>");
  await mensagem.press("Enter");
  const agente = conversa.locator(".msg.agente").last();
  await expect(agente).toHaveText("negrito <script>window.invadido = 1</script>");
  await expect(agente.locator("strong")).toHaveText("negrito");
  await expect(conversa.locator("script")).toHaveCount(0);
  expect(await pagina.evaluate(() => (window as { invadido?: number }).invadido)).toBeUndefined();
});

test("diálogo confirm cancelado; o mesmo diálogo respondido em outra aba avisa que não está pendente", async ({
  pagina,
  fabriquinha,
}) => {
  const sessao = await abrirConversa(pagina, fabriquinha);
  const conversa = pagina.locator("[data-conversa]");
  const mensagem = pagina.getByRole("textbox", { name: "Mensagem" });

  // CA-10
  await mensagem.fill("pergunte confirm");
  await mensagem.press("Enter");
  const dialogo = pagina.locator("form.dialogo-ext");
  await expect(dialogo).toContainText("Posso apagar o cache?");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(conversa.locator(".msg.agente").last()).toHaveText('Resposta do diálogo: {"cancelled":true}');

  // CA-11: a segunda aba só lê o retrato e depois ignora os eventos, como uma aba que ficou para trás.
  await mensagem.fill("pergunte select");
  await mensagem.press("Enter");
  await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
  const segunda = await pagina.context().newPage();
  await segunda.addInitScript(() => {
    const Original = window.EventSource;
    window.EventSource = class extends Original {
      constructor(url: string | URL, opcoes?: EventSourceInit) {
        super(url, opcoes);
        let lidas = 0;
        this.addEventListener("message", (evento) => {
          if (++lidas > 1) evento.stopImmediatePropagation();
        });
      }
    };
  });
  await segunda.goto(`${fabriquinha.base}/sessions/${sessao}`);
  const dialogoDaSegunda = segunda.locator("form.dialogo-ext");
  await expect(dialogoDaSegunda).toContainText("Qual ordem os cupons devem ter?");
  await dialogo.getByRole("button", { name: "Validade mais próxima" }).click();
  await expect(dialogo).toHaveCount(0);
  await dialogoDaSegunda.getByRole("button", { name: "Validade mais próxima" }).click();
  await expect(segunda.locator("[data-aviso]")).toContainText("não está pendente");
  await expect(segunda).toHaveURL(`${fabriquinha.base}/sessions/${sessao}`);
});

/** Abre no chat do planejamento o `select` da `perguntar` (única ou múltipla) e devolve o diálogo e a última resposta do agente. */
async function perguntarNoChat(pagina: Page, fabriquinha: Fabriquinha, tipo: "perguntar" | "multipla") {
  await abrirConversa(pagina, fabriquinha);
  await pagina.getByRole("textbox", { name: "Mensagem" }).fill(`pergunte ${tipo}`);
  await pagina.getByRole("textbox", { name: "Mensagem" }).press("Enter");
  const dialogo = pagina.locator("form.dialogo-ext");
  await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
  return { dialogo, resposta: pagina.locator("[data-conversa] .msg.agente").last() };
}

test("perguntar: itens clicáveis, nada pré-marcado, «Outros» no fim e Cancelar (CA-1)", async ({
  pagina,
  fabriquinha,
}) => {
  const { dialogo } = await perguntarNoChat(pagina, fabriquinha, "perguntar");
  const itens = dialogo.locator(".opcao");
  await expect(itens).toHaveText([
    "1. Maior desconto primeiroOrdem: Maior desconto primeiro",
    "2. Validade mais próximaOrdem: Validade mais próxima",
    "Outros",
  ]);
  await expect(dialogo.locator("[aria-checked=true], :checked")).toHaveCount(0);
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await expect(dialogo.getByRole("button", { name: "Responder" })).toBeHidden();
  await expect(dialogo.getByRole("textbox", { name: "Outros" })).toBeHidden();
});

test("perguntar: o clique numa opção responde na hora, sem Responder (CA-2)", async ({ pagina, fabriquinha }) => {
  const { dialogo, resposta } = await perguntarNoChat(pagina, fabriquinha, "perguntar");
  await dialogo.getByRole("button", { name: "Validade mais próxima" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(resposta).toHaveText('Resposta do diálogo: {"value":"Validade mais próxima"}');
});

test("perguntar: «Outros» abre o campo e Responder envia o texto, sem opção escolhida (CA-3)", async ({
  pagina,
  fabriquinha,
}) => {
  const { dialogo, resposta } = await perguntarNoChat(pagina, fabriquinha, "perguntar");
  await dialogo.getByRole("button", { name: "Outros" }).click();
  await dialogo.getByRole("textbox", { name: "Outros" }).fill("Por data de criação, só dos cupons ativos");
  await dialogo.getByRole("button", { name: "Responder" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(resposta).toHaveText('Resposta do diálogo: {"value":"Por data de criação, só dos cupons ativos"}');
});

test("perguntar: «Outros» com o campo vazio não envia e o diálogo continua aberto (CA-4)", async ({
  pagina,
  fabriquinha,
}) => {
  const { dialogo, resposta } = await perguntarNoChat(pagina, fabriquinha, "perguntar");
  await dialogo.getByRole("button", { name: "Outros" }).click();
  await dialogo.getByRole("button", { name: "Responder" }).click();
  await expect(dialogo.getByRole("textbox", { name: "Outros" })).toBeVisible();
  await expect(dialogo).toHaveCount(1);
  await expect(resposta).toHaveText("Preciso de uma resposta.");
});

test("perguntar: Cancelar fecha o diálogo e o agente recebe o cancelamento (CA-5)", async ({ pagina, fabriquinha }) => {
  const { dialogo, resposta } = await perguntarNoChat(pagina, fabriquinha, "perguntar");
  await dialogo.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialogo).toHaveCount(0);
  await expect(resposta).toHaveText('Resposta do diálogo: {"cancelled":true}');
});

test("perguntar de múltipla escolha: marcar, «Outros» e Responder enviam a lista (CA-6)", async ({
  pagina,
  fabriquinha,
}) => {
  const { dialogo, resposta } = await perguntarNoChat(pagina, fabriquinha, "multipla");
  await expect(dialogo.getByRole("checkbox", { checked: true })).toHaveCount(0);
  await expect(dialogo.getByRole("button", { name: "Responder" })).toBeVisible();
  await dialogo.getByRole("checkbox", { name: /Maior desconto primeiro/ }).check();
  await dialogo.getByRole("checkbox", { name: "Outros" }).check();
  await dialogo.getByRole("textbox", { name: "Outros" }).fill("e desempate pelo código");
  await dialogo.getByRole("button", { name: "Responder" }).click();
  await expect(dialogo).toHaveCount(0);
  // O Markdown da resposta tira as barras do JSON; o que chegou ao pi é a lista dos dois textos.
  await expect(resposta).toContainText('["Maior desconto primeiro","e desempate pelo código"]');
});
