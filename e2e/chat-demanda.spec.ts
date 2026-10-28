// Chat da sessão de ticket da demanda (I-239, CA-1 a CA-19) com o pi falso: o planejamento pergunta, o Auditor responde
// no chat e o agente segue; abortar, exportar e o link na página da demanda; prints a 1440 e 375 px sem rolagem
// horizontal. A demanda é semeada aqui mesmo, em planejamento, com o ticket `planejar` aberto.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page, TestInfo } from "@playwright/test";
import type { AgregadoDemanda } from "../src/dominio/agregado_demanda.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../src/persistencia/configuracao_projeto.ts";
import { criarDemanda } from "../src/persistencia/demandas.ts";
import { submeterPlanejamento } from "../src/execucao/planejamento.ts";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";
import { semearTicketAberto } from "./demandas-apoio.ts";

const em = "2026-10-11T12:00:00.000Z";

/** A I-230 em planejamento, com o ticket `planejar` aberto e a `descricao` que dirige o pi falso. */
function semear(raiz: string, descricao: string): void {
  // A execução parte da worktree da demanda, que precisa existir e ser da Fabriquinha.
  const caminho = join(raiz, "worktrees/loja/I-230/demanda");
  const repo = join(raiz, "loja");
  execFileSync("git", ["worktree", "add", "-q", "-b", "fabriquinha/I-230", caminho, "main"], { cwd: repo });
  execFileSync("git", ["config", "branch.fabriquinha/I-230.fabriquinha", `demanda:${caminho}`], { cwd: repo });
  const banco = abrir(raiz);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: repo,
    hospedagem: "github",
    etapas: [],
    preparacao: [{ ordem: 1, comando: "true" }],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-230",
      projeto: "loja",
      titulo: "Cupons com prioridade",
      tipo: "funcionalidade",
      descricao,
      fase: "planejamento",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "I-230",
      enviada: true,
      branch: "fabriquinha/I-230",
    },
    tickets: [
      { demanda_id: "I-230", ticket_id: 1, etapa: "planejar", status: "aberto", status_alterado_em: em, devolucoes: 0 },
    ],
    decisoes: [],
    evidencias: [
      {
        demanda_id: "I-230",
        tipo: "criterios_aceite",
        dados: { criterios: [{ id: "CA-1", dado: "d", quando: "q", entao: "e" }] },
        em,
      },
    ],
    rodadas: [],
    dependencias_rodada: [],
    criterios_citados: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
  } as unknown as AgregadoDemanda);
  banco.close();
}

/** Executar agora, como o Auditor na página da demanda; devolve o chat da sessão assim que o ticket ganha o link. */
async function abrirOChat(pagina: Page, { base }: Fabriquinha): Promise<void> {
  await pagina.goto(`${base}/demandas/I-230`);
  const ticket = pagina.locator(".dm-ticket", { hasText: "I-230.T1" });
  // CA-17: sem sessão, sem link para o chat.
  await expect(ticket.getByRole("link", { name: "chat →" })).toHaveCount(0);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  // CA-16: com a sessão, o ticket leva ao chat dela.
  await expect(async () => {
    await pagina.reload();
    await expect(ticket.getByRole("link", { name: "chat →" })).toBeVisible();
  }).toPass();
  await ticket.getByRole("link", { name: "chat →" }).click();
  await expect(pagina).toHaveTitle("Chat · Fabriquinha");
}

const semRolagemHorizontal = (pagina: Page) =>
  pagina.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

test("o planejamento pergunta, o Auditor responde no chat e o agente segue; link na página e prints", async ({
  pagina,
  fabriquinha,
}, info: TestInfo) => {
  projeto(fabriquinha.raiz);
  semear(fabriquinha.raiz, "pergunte perguntar");
  await abrirOChat(pagina, fabriquinha);

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
    await info.attach(`chat-demanda-${String(largura)}`, {
      body: await pagina.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
});

test("abortar a execução em andamento e exportar o histórico em Markdown", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  semear(fabriquinha.raiz, "[ao vivo]");
  await abrirOChat(pagina, fabriquinha);

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
  semear(fabriquinha.raiz, "planeje");
  await abrirOChat(pagina, fabriquinha);
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
