// Chat (F7 §4.4; F4 §5.4, §6.4 a §6.8) com o pi falso: acompanhar uma sessão autônoma ao vivo, redirecioná-la e
// responder a um diálogo; registrar pelo chat, corrigir o registro ao lado e aprovar o registro; responder e retomar
// um ticket que falhou; abrir uma consulta com o histórico de outra sessão anexado.
import type { Page } from "@playwright/test";
import { expect, type Fabriquinha, projeto, test } from "./apoio.ts";

/** A primeira sessão ativa, assim que ela aparece. */
async function sessaoAtiva(pagina: Page, { base }: Fabriquinha): Promise<string> {
  let sessao: string | undefined;
  await expect(async () => {
    const ativas = (await (await pagina.request.get(`${base}/api/sessoes?escopo=ativas`)).json()) as {
      sessao: string;
    }[];
    sessao = ativas[0]?.sessao;
    expect(sessao).toBeTruthy();
  }).toPass();
  return String(sessao);
}

test("acompanha uma sessão autônoma ao vivo, a redireciona e responde a um diálogo", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
       VALUES (1, 'loja', 'Timeout no checkout com cupom', 'problema', '[ao vivo]', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
       VALUES (1, 1, 'desenvolvimento', 'Buscar cupons sem N+1', 'aberto', 'fabriquinha', '2026-10-11T12:00:00.000Z');`,
  );
  // Executar agora, como o Auditor faria na página da issue, sem esperar o agendador.
  expect(
    (
      await pagina.request.post(`${fabriquinha.base}/api/tickets/1/executar`, {
        headers: { "Sec-Fetch-Site": "same-origin" },
      })
    ).status(),
  ).toBe(204);
  const sessao = await sessaoAtiva(pagina, fabriquinha);
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);
  await expect(pagina).toHaveTitle("Chat · Fabriquinha");

  // Barra de estado: issue, ticket, etapa e modo, estado, modelo e a execução com log e prompt.
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.getByRole("link", { name: "I-1 Timeout no checkout com cupom" })).toHaveAttribute(
    "href",
    "/projects/loja/issues/I-1",
  );
  await expect(barra).toContainText("T-1");
  await expect(barra).toContainText("desenvolvimento · autônoma");
  await expect(barra.locator(".pill")).toHaveText("rodando");
  await expect(barra.locator(".modelo")).toHaveText("anthropic / claude-opus-5-5");
  await expect(barra.getByRole("link", { name: "log" })).toHaveAttribute("href", "/api/execucoes/1/log");
  await expect(barra.getByRole("link", { name: "prompt" })).toHaveAttribute("href", "/api/execucoes/1/prompt");

  // A conversa: a linha da execução no lugar do prompt da etapa, raciocínio recolhido, a ferramenta com o resumo e o
  // texto chegando em fluxo, com o cursor.
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".sistema").first()).toHaveText("Execução E-1 iniciada · autônoma · prompt da etapa");
  await expect(conversa).not.toContainText("# Contexto");
  const raciocinio = conversa.locator(".pensando");
  await expect(raciocinio.locator("summary")).toHaveText("raciocínio");
  await expect(raciocinio.locator("p")).toBeHidden();
  const ferramenta = conversa.locator(".ferramenta");
  await expect(ferramenta.locator("summary")).toHaveText("bashnpm test✗ 42 linhas");
  await ferramenta.locator("summary").click();
  await expect(ferramenta.locator("pre")).toContainText("ok 1 - caso 1");
  await ferramenta.getByRole("button", { name: "ver tudo" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Saída de bash" });
  await expect(caixa.locator("pre")).toContainText("3 failed");
  await pagina.keyboard.press("Escape");
  const fluxo = conversa.locator(".fluxo");
  await expect(fluxo).toContainText("Os testes esperam a ordem antiga");
  await expect(fluxo.locator("strong")).toHaveText("ordem antiga");
  await expect(fluxo.locator(".cursor")).toBeVisible();

  // Redirecionar (steer) é o padrão enquanto roda; Enter envia.
  const envio = pagina.locator("form[data-envio]");
  await expect(envio.getByRole("button", { name: "Redirecionar" })).toHaveAttribute("aria-pressed", "true");
  await expect(envio.getByRole("button", { name: "Enfileirar" })).toHaveAttribute("aria-pressed", "false");
  await expect(envio.getByRole("button", { name: "Abortar" })).toBeVisible();
  await expect(envio.getByText("Enter envia · Shift+Enter quebra linha")).toBeVisible();
  const mensagem = envio.getByRole("textbox", { name: "Mensagem" });
  await expect(mensagem).toHaveAttribute("placeholder", "Mensagem para o agente enquanto ele trabalha");
  await mensagem.fill("use a validade");
  await mensagem.press("Enter");
  await expect(conversa.locator(".msg.voce").last()).toHaveText("vocêuse a validade");
  await expect(conversa.locator(".msg.agente").last()).toHaveText("agenteRedirecionado: use a validade");
  await expect(fluxo).toHaveCount(0);
  await expect(conversa.locator(".msg.agente", { hasText: "Os testes esperam a ordem antiga" })).toHaveCount(1);

  // O diálogo da extensão toma o lugar do envio até o Auditor responder.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · diálogo");
  await expect(conversa.locator(".sistema").last()).toHaveText(
    "o agente abriu um diálogo: Qual ordem os cupons devem ter?",
  );
  const dialogo = pagina.locator("form.dialogo-ext");
  await expect(dialogo).toContainText("O agente pergunta");
  await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
  await expect(dialogo.getByRole("radio", { name: "Maior desconto primeiro" })).toBeChecked();
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await dialogo.getByText("Validade mais próxima").click();
  await dialogo.getByRole("button", { name: "Responder" }).click();
  await expect(conversa.locator(".msg.agente").last()).toHaveText(
    'agenteResposta do diálogo: {"value":"Validade mais próxima"}',
  );
  await expect(dialogo).toHaveCount(0);
});

test("registra pelo chat, corrige o registro ao lado e aprova o registro", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz);
  const { sessao } = await pagina.evaluate(async () => {
    const r = await fetch("/api/registros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projeto: "loja" }),
    });
    return (await r.json()) as { sessao: string };
  });
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);

  const barra = pagina.locator(".estado-sessao");
  await expect(barra.getByRole("link", { name: "I-1 sem título" })).toBeVisible();
  await expect(barra).toContainText("registro · interativa");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".sistema").first()).toHaveText("Execução E-1 iniciada · interativa · prompt da etapa");
  await expect(conversa.locator(".msg")).toHaveText(["agentepronto"]);

  // O Auditor corrige direto o que vai no registro.
  const registro = pagina.locator("form[data-registro]");
  await expect(registro.getByRole("heading")).toHaveText("Registro · você pode corrigir direto");
  await expect(registro.getByLabel("Título")).toHaveValue("");
  await expect(registro.getByLabel("Tipo")).toHaveValue("");
  await registro.getByLabel("Descrição").fill("Botão no painel de pedidos que baixa o CSV do mês.");
  const salvo = pagina.waitForResponse((r) => r.url().endsWith("/api/issues/1") && r.ok());
  await registro.getByRole("button", { name: "Salvar" }).click();
  await salvo;

  // Conversa com Markdown: o HTML que alguém escreve sai como texto.
  const envio = pagina.locator("form[data-envio]");
  const mensagem = envio.getByRole("textbox", { name: "Mensagem" });
  await expect(mensagem).toHaveAttribute("placeholder", "Responda ao agente");
  await expect(envio.getByRole("button", { name: "Abortar" })).toHaveCount(0);
  await mensagem.fill("<b>sem html</b> e **registre** agora");
  await envio.getByRole("button", { name: "Enviar" }).click();
  const minha = conversa.locator(".msg.voce").last();
  await expect(minha).toHaveText("você<b>sem html</b> e registre agora");
  await expect(minha.locator("b")).toHaveCount(0);
  await expect(minha.locator("strong")).toHaveText("registre");
  await expect(conversa.locator(".msg.agente").last()).toHaveText(
    "agenteRegistrei o título, o tipo, o comportamento e os critérios de aceite.",
  );

  // Registro completo: o gate no lugar do formulário, e o envio só avisa.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · gate do registro");
  await expect(barra.getByRole("link", { name: "I-1 Exportar pedidos em CSV" })).toBeVisible();
  await expect(pagina.locator(".fim")).toHaveText(
    "A sessão de registro terminou. Decida no painel do gate; devolver envia o motivo ao agente e reabre a conversa.",
  );
  const gate = pagina.getByRole("region", { name: "Gate do registro" });
  await expect(gate).toContainText("aguarda você há menos de 1 min");
  await expect(gate.locator(".fatos dd")).toHaveText([
    "Exportar pedidos em CSV",
    "funcionalidade",
    "Botão no painel de pedidos que baixa o CSV do mês.",
    "hoje a contabilidade copia os pedidos à mão",
  ]);
  await expect(gate.locator("td")).toHaveText([
    "CA-1",
    "o CSV traz número, data, cliente e total",
    "CA-2",
    "só os do mês escolhido entram",
  ]);
  await expect(gate).toContainText("Nenhuma evidência faltando.");
  const devolver = gate.getByRole("button", { name: "Devolver" });
  await expect(devolver).toBeDisabled();
  await gate.getByLabel("Motivo (obrigatório para devolver)").fill("faltou o formato");
  await expect(devolver).toBeEnabled();
  await gate.getByLabel("Motivo (obrigatório para devolver)").fill(" ");
  await expect(devolver).toBeDisabled();

  await gate.getByRole("button", { name: "Aprovar registro" }).click();
  await expect(barra.locator(".pill")).toHaveText("terminada");
  await expect(pagina.locator(".fim")).toHaveText(
    "Sessão terminada; a conversa fica só para leitura.Exportar históricoConversar sobre esta sessão",
  );
  await expect(pagina.locator("[data-lateral]")).toBeEmpty();
  await expect(conversa.locator(".sistema").last()).toHaveText("Execução E-1 encerrada");
});

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

/**
 * Executar agora, como na página da issue, até o ticket falhar: os testes do projeto reprovam na coleta depois do pi.
 * Devolve a sessão.
 */
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

test("responde e retoma um ticket que falhou, trocando o modelo", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz, emDesenvolvimento(1));
  const sessao = await executarAteFalhar(pagina, fabriquinha, 1);
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);

  // O erro em destaque no fim da conversa, e o envio vira a instrução com o modelo.
  const barra = pagina.locator(".estado-sessao");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · falha");
  const erro = pagina.locator("[data-conversa] .erro-bloco");
  await expect(erro).toContainText("Execução E-1 falhou:");
  await expect(erro).toContainText("O ticket T-1 ficou falhou; o trabalho na worktree foi mantido.");
  const retomar = pagina.locator("form[data-retomar]");
  const instrucao = retomar.getByRole("textbox", { name: "Instrução" });
  await expect(instrucao).toHaveAttribute(
    "placeholder",
    "Instrução para a próxima tentativa (vai antes do prompt da etapa)",
  );
  const modelo = retomar.getByRole("combobox", { name: "Modelo de T-1" });
  await expect(modelo.locator("option")).toHaveText([
    "padrão do pi",
    "anthropic / claude-opus-5-5",
    "anthropic / claude-sonnet-5-5",
  ]);
  await expect(modelo).toHaveValue("");

  // Ao lado, o contexto da issue com o ticket desta sessão marcado.
  const contexto = pagina.getByRole("region", { name: "Contexto da issue" });
  await expect(contexto.getByRole("heading")).toHaveText("I-1 · loja");
  await expect(contexto.locator(".trilho-mini")).toHaveAttribute("aria-label", "Fase: Desenvolvimento");
  await expect(contexto.locator("li.atual")).toHaveText("T-1Ticket 1esta");
  await expect(contexto.getByRole("link", { name: "Abrir a issue →" })).toHaveAttribute(
    "href",
    "/projects/loja/issues/I-1",
  );

  await modelo.selectOption("anthropic/claude-sonnet-5-5");
  await instrucao.fill("ordene pela validade");
  await retomar.getByRole("button", { name: "Responder e retomar" }).click();
  // Reaberto, o ticket espera o agendador; o chat sai da falha sozinho, pelo SSE.
  await expect(barra.locator(".pill")).toHaveText("rodando");
  await expect(retomar).toHaveCount(0);

  // A próxima execução, na mesma sessão, leva a instrução e roda com o modelo escolhido.
  expect(await executarAteFalhar(pagina, fabriquinha, 1)).toBe(sessao);
  await expect(pagina.locator("[data-conversa] .sistema", { hasText: "Execução E-2 iniciada" })).toBeVisible();
  await expect(pagina.locator("[data-conversa] .erro-bloco").last()).toContainText("Execução E-2 falhou:");
  await expect(barra.locator(".modelo")).toHaveText("anthropic / claude-sonnet-5-5");
  const prompt = await pagina.request.get(`${fabriquinha.base}/api/execucoes/2/prompt`);
  expect(await prompt.text()).toContain("# Instrução do Auditor\n\nordene pela validade");
  await expect(pagina.getByRole("combobox", { name: "Modelo de T-1" })).toHaveValue("anthropic/claude-sonnet-5-5");
});

test("abre uma consulta com o histórico de outra sessão anexado", async ({ pagina, fabriquinha }) => {
  projeto(fabriquinha.raiz, emDesenvolvimento(1, 2));
  const sessao = await executarAteFalhar(pagina, fabriquinha, 1);
  const outra = await executarAteFalhar(pagina, fabriquinha, 2);
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);

  // Exportar baixa o Markdown da sessão.
  const barra = pagina.locator(".estado-sessao");
  const baixado = pagina.waitForEvent("download");
  await barra.getByRole("link", { name: "Exportar" }).click();
  expect((await baixado).suggestedFilename()).toBe("historico-T-1.md");

  // Conversar sobre abre o chat da consulta, que começa com a conversa da principal.
  await barra.getByRole("button", { name: "Conversar sobre" }).click();
  await expect(pagina).not.toHaveURL(new RegExp(sessao));
  await expect(barra).toContainText("desenvolvimento · consulta");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".msg.agente")).toHaveText(["agentepronto"]);

  // + Anexar histórico: a outra sessão no seletor; a escolhida vira etiqueta removível.
  const envio = pagina.locator("form[data-envio]");
  await envio.getByRole("button", { name: "+ Anexar histórico" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Anexar histórico" });
  await expect(caixa.locator("[data-anexar-sessao]")).toHaveCount(2);
  await caixa.locator(`[data-anexar-sessao="${outra}"]`).click();
  await expect(caixa).toBeHidden();
  const etiqueta = envio.locator(".anexo");
  await expect(etiqueta).toHaveText(`histórico de s-${outra.slice(0, 4)} · I-2 · T-2×`);
  await envio.getByRole("button", { name: "+ Anexar histórico" }).click();
  await caixa.locator(`[data-anexar-sessao="${sessao}"]`).click();
  await expect(etiqueta).toHaveCount(2);
  await etiqueta
    .last()
    .getByRole("button", { name: /Remover/ })
    .click();
  await expect(etiqueta).toHaveCount(1);

  const mensagem = envio.getByRole("textbox", { name: "Mensagem" });
  await mensagem.fill("o que houve?");
  await mensagem.press("Enter");
  const minha = conversa.locator(".msg.voce").last();
  await expect(minha).toContainText("o que houve?");
  await expect(minha).toContainText("Histórico da sessão T-2 (I-2, desenvolvimento) em");
  await expect(minha).toContainText("historico-T-2.md; leia antes de responder.");
  await expect(etiqueta).toHaveCount(0);
  await expect(conversa.locator(".msg.agente").last()).toHaveText("agentepronto");

  // Ao lado, o ticket da consulta marcado e o link para o chat da principal do outro ticket… da mesma issue.
  const contexto = pagina.getByRole("region", { name: "Contexto da issue" });
  await expect(contexto.locator("li.atual")).toHaveText("T-1Ticket 1esta");
});
