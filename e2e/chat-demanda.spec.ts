// Chat da sessão de ticket da demanda (I-239, CA-1 a CA-19) com o pi falso: o planejamento pergunta, o Auditor responde
// no chat e o agente segue; abortar, exportar e o link na página da demanda; prints a 1440 e 375 px sem rolagem
// horizontal. A demanda é semeada em planejamento, com o ticket `planejar` aberto (demandas-apoio.ts).
import { readdirSync, readFileSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import { abrir } from "../src/persistencia/banco.ts";
import { falharTicketDemanda } from "../src/execucao/fechamento_ticket.ts";
import { submeterPlanejamento } from "../src/execucao/planejamento.ts";
import { expect, fotografar, projeto, test } from "./apoio.ts";
import { abrirOChatDoPlanejamento, semearPlanejamentoComPi, semearTicketAberto } from "./demandas-apoio.ts";

/** Mata o pi cujo diretório de trabalho está na raiz (a execução da demanda não grava o pgid). */
function matarPiDaRaiz(raiz: string): void {
  for (const pid of readdirSync("/proc").filter((p) => /^\d+$/.test(p))) {
    try {
      if (readlinkSync(`/proc/${pid}/cwd`).startsWith(join(raiz, "worktrees"))) process.kill(Number(pid), "SIGKILL");
    } catch {
      // o processo saiu ou não é nosso
    }
  }
}

const semRolagemHorizontal = (pagina: Page) =>
  pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("o planejamento pergunta, o Auditor responde no chat e o agente segue; link na página e prints", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "pergunte perguntar");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);

  // CA-1 e CA-6: demanda, ticket, etapa e modo, modelo e execução na barra; sem log, prompt nem Conversar sobre.
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.getByRole("link", { name: "I-230" })).toHaveAttribute("href", "/demandas/I-230");
  await expect(barra).toContainText("I-230.T1");
  await expect(barra).toContainText("Planejamento · interativa");
  await expect(barra.locator(".modelo")).toHaveText("anthropic / claude-opus-5-5");
  await expect(barra.getByRole("link", { name: "log" })).toHaveCount(0);
  await expect(barra.getByRole("button", { name: "Conversar sobre" })).toHaveCount(0);

  // CA-10 e CA-15: o agente pergunta; o clique na opção responde e o agente segue com ela.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · diálogo");
  const dialogo = pagina.locator("form.dialogo-ext");
  await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
  await dialogo.getByRole("button", { name: "Validade mais próxima" }).click();
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".msg.agente").last()).toHaveText(
    'Resposta do diálogo: {"value":"Validade mais próxima"}',
  );
  await expect(dialogo).toHaveCount(0);

  // CA-3, CA-8: a conversa espera o Auditor; a mensagem entra e o agente a recebe.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");
  const envio = pagina.getByRole("textbox", { name: "Mensagem" });
  await expect(pagina.getByRole("button", { name: /Anexar histórico|Concluir sessão/ })).toHaveCount(0);
  // CA-9: vazio não entra na conversa.
  await envio.fill("   ");
  await envio.press("Enter");
  await expect(pagina.locator("[data-aviso]")).toHaveText("escreva a mensagem");
  await expect(conversa.locator(".msg.voce")).toHaveCount(0);
  await envio.fill("eco: então a validade vale");
  await envio.press("Enter");
  await expect(conversa.locator(".msg.voce").last()).toHaveText("eco: então a validade vale");
  await expect(conversa.locator(".msg.agente").last()).toHaveText("então a validade vale");

  // CA-18 e CA-19: barra, conversa e campo de envio inteiros, sem rolagem horizontal, a 1440 e a 375 px.
  for (const largura of [1440, 375]) {
    await pagina.setViewportSize({ width: largura, height: 900 });
    expect(await semRolagemHorizontal(pagina)).toBe(true);
    await expect(barra).toBeVisible();
    await expect(envio).toBeVisible();
    await fotografar(pagina, info, `chat-demanda-${String(largura)}`);
  }
});

test("abortar a execução em andamento e exportar o histórico em Markdown", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "[ao vivo]");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);

  // CA-2 e CA-11: rodando, o Abortar para a execução e a barra deixa de mostrar «rodando».
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.locator(".pill")).toHaveText("rodando");
  await pagina.getByRole("button", { name: "Abortar" }).click();
  await expect(barra.locator(".pill")).not.toHaveText("rodando");

  // CA-13: o histórico baixado é o Markdown da sessão, nas mensagens da conversa.
  const baixado = pagina.waitForEvent("download");
  await barra.getByRole("link", { name: "Exportar" }).click();
  const download = await baixado;
  expect(download.suggestedFilename()).toBe("historico-I-230.T1.md");
  const markdown = readFileSync(await download.path(), "utf8");
  expect(markdown).toContain("# Histórico da sessão I-230.T1");
  expect(markdown).toContain("Os testes esperam a");

  // CA-7 e CA-14: sessão que não existe.
  await pagina.goto(`${fabriquinha.base}/sessions/inexistente`);
  await expect(pagina.locator("body")).toContainText("a sessão inexistente não existe");
});

test("abortar uma implementação autônoma tira a barra de «rodando» sem recarregar", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearTicketAberto(fabriquinha.raiz);
  const banco = abrir(fabriquinha.raiz);
  banco.prepare("UPDATE demanda SET descricao = '[ao vivo]' WHERE id = 'I-216'").run();
  banco.close();
  await pagina.goto(`${fabriquinha.base}/demandas/I-216`);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  const ticket = pagina.locator(".dm-ticket", { hasText: "I-216.T1" });
  await expect(async () => {
    await pagina.reload();
    await expect(ticket.getByRole("link", { name: "chat →" })).toBeVisible();
  }).toPass();
  await ticket.getByRole("link", { name: "chat →" }).click();

  // CA-11: o fim da execução avisa o chat; a barra sai de «rodando» sem recarregar.
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.locator(".pill")).toHaveText("rodando");
  await pagina.getByRole("button", { name: "Abortar" }).click();
  await expect(barra.locator(".pill")).toHaveText("aguarda você · falha");
});

test("I-249: a reprovação do planejamento chega ao pi ocioso, na mesma sessão, sem erro no log", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "planeje");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);
  const chat = pagina.url();
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");

  // O agente submete o plano e fica ocioso, à espera do gate.
  const banco = abrir(fabriquinha.raiz);
  const plano = {
    demanda_id: "I-230",
    criterios: ["CA-1"],
    rodadas: [{ demanda_id: "I-230", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
    tickets: [{ demanda_id: "I-230", ticket_id: 1, rodada_id: 1, titulo: "t1", descricao: "d" }],
  };
  submeterPlanejamento(banco, "I-230", plano, { tipo: "agente", execucao: 1, ticket: 1 });
  banco.close();

  await pagina.goto(`${fabriquinha.base}/demandas/I-230`);
  await pagina.getByLabel(/Motivo/).fill("falta o caso de erro");
  await pagina.getByRole("button", { name: "Reprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Reprovar planejamento" })).toHaveCount(0);

  // CA-1: o motivo entra na mesma conversa e o agente volta a trabalhar.
  await pagina.goto(chat);
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".msg.voce").last()).toContainText("falta o caso de erro");
  await expect(conversa.locator(".msg.agente")).toHaveCount(2);

  // CA-2: uma única execução na sessão (o despacho não abre outra por cima do pi vivo).
  const leitura = abrir(fabriquinha.raiz);
  const { n } = leitura.prepare("SELECT COUNT(*) AS n FROM execucao_sessao").get() as { n: number };
  leitura.close();
  expect(n).toBe(1);
});

test("I-249: aprovar o planejamento encerra a execução e o pi da sessão", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "planeje");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("aguarda você · conversa");

  const banco = abrir(fabriquinha.raiz);
  const plano = {
    demanda_id: "I-230",
    criterios: ["CA-1"],
    rodadas: [{ demanda_id: "I-230", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
    tickets: [{ demanda_id: "I-230", ticket_id: 1, rodada_id: 1, titulo: "t1", descricao: "d" }],
  };
  submeterPlanejamento(banco, "I-230", plano, { tipo: "agente", execucao: 1, ticket: 1 });
  banco.close();

  await pagina.goto(`${fabriquinha.base}/demandas/I-230`);
  await pagina.getByRole("button", { name: "Aprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Aprovar planejamento" })).toHaveCount(0);

  // CA-4: a execução ganha o fim e nenhuma fica aberta.
  await expect(() => {
    const leitura = abrir(fabriquinha.raiz);
    const { n } = leitura.prepare("SELECT COUNT(*) AS n FROM execucao_sessao WHERE fim IS NULL").get() as { n: number };
    leitura.close();
    expect(n).toBe(0);
  }).toPass();
});

test("I-249: reprovar com o planejar Falhou o reabre e retoma a mesma sessão com o motivo", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  semearPlanejamentoComPi(fabriquinha.raiz, "planeje");
  await abrirOChatDoPlanejamento(pagina, fabriquinha);
  const chat = pagina.url();
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("aguarda você · conversa");

  const banco = abrir(fabriquinha.raiz);
  const plano = {
    demanda_id: "I-230",
    criterios: ["CA-1"],
    rodadas: [{ demanda_id: "I-230", rodada_id: 1, titulo: "r1", e2e: false, criterios: ["CA-1"], depende: [] }],
    tickets: [{ demanda_id: "I-230", ticket_id: 1, rodada_id: 1, titulo: "t1", descricao: "d" }],
  };
  submeterPlanejamento(banco, "I-230", plano, { tipo: "agente", execucao: 1, ticket: 1 });
  banco.close();

  // Sem pi vivo, como depois de um reinício: o pi morre e o planejar fica Falhou com o gate aberto.
  matarPiDaRaiz(fabriquinha.raiz);
  await expect(() => {
    const leitura = abrir(fabriquinha.raiz);
    const { n } = leitura.prepare("SELECT COUNT(*) AS n FROM execucao_sessao WHERE fim IS NULL").get() as { n: number };
    leitura.close();
    expect(n).toBe(0);
  }).toPass();
  const reinicio = abrir(fabriquinha.raiz);
  falharTicketDemanda(reinicio, { demanda_id: "I-230", ticket_id: 1 }, "serviço reiniciado");
  reinicio.close();

  await pagina.goto(`${fabriquinha.base}/demandas/I-230`);
  await pagina.getByLabel(/Motivo/).fill("falta o caso de erro");
  await pagina.getByRole("button", { name: "Reprovar planejamento" }).click();
  await expect(pagina.getByRole("button", { name: "Reprovar planejamento" })).toHaveCount(0);

  // O despacho (Executar agora) retoma a mesma sessão com o motivo.
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  await pagina.goto(chat);
  await expect(pagina.locator("[data-conversa] .msg.voce").last()).toContainText("falta o caso de erro");
  const leitura = abrir(fabriquinha.raiz);
  const { n } = leitura.prepare("SELECT COUNT(DISTINCT sessao_id) AS n FROM execucao_sessao").get() as { n: number };
  leitura.close();
  expect(n).toBe(1);
});
