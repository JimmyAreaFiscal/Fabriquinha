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

/** Espera, por um assinante à parte do SSE da sessão, o `trecho` chegar: o agente já começou a escrever. */
async function esperarNoFluxo(pagina: Page, sessao: string, trecho: string): Promise<void> {
  await pagina.evaluate(
    async ({ sessao, trecho }) => {
      const leitor = (await fetch(`/api/sessoes/${sessao}/eventos`)).body
        ?.pipeThrough(new TextDecoderStream())
        .getReader();
      let lido = "";
      while (leitor && !lido.includes(trecho)) lido += (await leitor.read()).value ?? "";
      await leitor?.cancel();
    },
    { sessao, trecho },
  );
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
  // O chat abre com o agente no meio de uma mensagem: ela não está no JSONL e o retrato a traz até ali.
  await esperarNoFluxo(pagina, sessao, '"delta":"esperam a "');
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);
  await expect(pagina).toHaveTitle("Chat · Fabriquinha");
  const fluxo = pagina.locator("[data-conversa] .fluxo");
  await expect(fluxo).toContainText("Os testes esperam a");

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
  // resto do texto chegando ao vivo, com o cursor.
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
  await expect(conversa.locator(".msg.voce").last()).toHaveText("use a validade");
  await expect(conversa.locator(".msg.agente").last()).toHaveText("Redirecionado: use a validade");
  await expect(fluxo).toHaveCount(0);
  await expect(conversa.locator(".msg.agente", { hasText: "Os testes esperam a ordem antiga" })).toHaveCount(1);

  // Balões: o do Auditor à direita, o do agente à esquerda, sem rótulo (CA-1).
  const doAuditor = await conversa.locator(".msg.voce .balao").last().boundingBox();
  const doAgente = await conversa.locator(".msg.agente .balao").first().boundingBox();
  const lista = await conversa.boundingBox();
  expect((doAuditor?.x ?? 0) + (doAuditor?.width ?? 0)).toBeGreaterThan((lista?.x ?? 0) + (lista?.width ?? 0) - 40);
  expect(doAgente?.x ?? 1000).toBeLessThan((lista?.x ?? 0) + 40);
  expect(doAuditor?.x).toBeGreaterThan(doAgente?.x ?? 1000);
  // `innerText` já aplica o `text-transform`: um rótulo em caixa alta apareceria como AGENTE/VOCÊ.
  expect(await conversa.evaluate((e) => /\b(AGENTE|VOCÊ)\b/.test((e as HTMLElement).innerText))).toBe(false);

  // O diálogo da extensão toma o lugar do envio até o Auditor responder.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · diálogo");
  await expect(conversa.locator(".sistema").last()).toHaveText(
    "o agente abriu um diálogo: Qual ordem os cupons devem ter?",
  );
  const dialogo = pagina.locator("form.dialogo-ext");
  await expect(dialogo).toContainText("O agente pergunta");
  await expect(dialogo).toContainText("Qual ordem os cupons devem ter?");
  // CA-7: select de extensão, itens clicáveis sem «Outros» nem Responder; o clique responde.
  await expect(dialogo.getByRole("radio")).toHaveCount(0);
  await expect(dialogo.getByRole("button", { name: "Outros" })).toHaveCount(0);
  await expect(dialogo.getByRole("button", { name: "Responder" })).toHaveCount(0);
  await expect(dialogo.getByRole("button", { name: "Cancelar" })).toBeVisible();
  await dialogo.getByRole("button", { name: "Maior desconto primeiro" }).click();
  await expect(conversa.locator(".msg.agente").last()).toHaveText(
    'Resposta do diálogo: {"value":"Maior desconto primeiro"}',
  );
  await expect(dialogo).toHaveCount(0);
});

/** A sessão de registro de uma necessidade nova, aberta no chat: aguarda o Auditor, que ainda não escreveu nada. */
async function abrirRegistro(pagina: Page, { base, raiz }: Fabriquinha): Promise<string> {
  projeto(raiz);
  const { sessao } = await pagina.evaluate(async () => {
    const r = await fetch("/api/registros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projeto: "loja", descricao: "Exportar pedidos em CSV" }),
    });
    return (await r.json()) as { sessao: string };
  });
  await pagina.goto(`${base}/sessions/${sessao}`);
  return sessao;
}

test("a conversa rola sozinha: a página fica parada, segue o fim e para quando o Auditor sobe", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(
    fabriquinha.raiz,
    `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
       VALUES (1, 'loja', 'Timeout no checkout com cupom', 'problema', '[longo]', 'desenvolvimento', '2026-10-11T12:00:00.000Z');
     INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
       VALUES (1, 1, 'desenvolvimento', 'Buscar cupons sem N+1', 'aberto', 'fabriquinha', '2026-10-11T12:00:00.000Z');`,
  );
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  await pagina.getByRole("link", { name: /chat →/ }).click();
  const conversa = pagina.locator("[data-conversa]");
  const fluxo = conversa.locator(".fluxo");
  await expect(fluxo).toContainText("Começo do fluxo.");

  // CA-2: só a lista rola; a barra de estado e o campo Mensagem seguem na tela.
  expect(await pagina.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
  expect(await conversa.evaluate((e) => e.scrollHeight > e.clientHeight)).toBe(true);
  await expect(pagina.locator(".estado-sessao")).toBeInViewport();
  await expect(pagina.getByRole("textbox", { name: "Mensagem" })).toBeInViewport();

  // CA-3: no fim, a lista segue o texto e o cursor fica à vista.
  const noFim = () => conversa.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight < 8);
  await expect(fluxo).toContainText("Trecho 2 do fluxo.");
  await expect(fluxo.locator(".cursor")).toBeInViewport();
  await expect.poll(noFim).toBe(true);

  // CA-4: rolada para cima, a lista fica onde está enquanto chegam trechos.
  await conversa.hover();
  await pagina.mouse.wheel(0, -100_000);
  // Um trecho chegando no meio do giro faz o assistant-ui ancorar a mensagem lida uns pixels abaixo do topo.
  const topo = () => conversa.evaluate((e) => e.scrollTop);
  await expect.poll(topo).toBeLessThan(100);
  const parada = await topo();
  const trechos = await fluxo.locator("p").count();
  await expect(fluxo.locator("p")).toHaveCount(trechos + 2);
  expect(await topo()).toBe(parada);
});

test("o campo Mensagem: só espaços não envia, Shift+Enter quebra a linha e o texto do agente é Markdown seguro", async ({
  pagina,
  fabriquinha,
}) => {
  await abrirRegistro(pagina, fabriquinha);
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
  const sessao = await abrirRegistro(pagina, fabriquinha);
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

/** Abre no chat do registro o `select` da `perguntar` (única ou múltipla) e devolve o diálogo e a última resposta do agente. */
async function perguntarNoChat(pagina: Page, fabriquinha: Fabriquinha, tipo: "perguntar" | "multipla") {
  await abrirRegistro(pagina, fabriquinha);
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

test("+ Anexar histórico sem outra sessão: a caixa avisa e nenhuma etiqueta nasce", async ({ pagina, fabriquinha }) => {
  await abrirRegistro(pagina, fabriquinha);
  const envio = pagina.locator("form[data-envio]");
  await envio.getByRole("button", { name: "+ Anexar histórico" }).click();
  const caixa = pagina.getByRole("dialog", { name: "Anexar histórico" });
  await expect(caixa).toContainText("Nenhuma outra sessão para anexar.");
  await expect(envio.locator(".anexo")).toHaveCount(0);
});

test("registra pelo chat, corrige o registro ao lado e aprova o registro", async ({ pagina, fabriquinha }) => {
  await abrirRegistro(pagina, fabriquinha);

  const barra = pagina.locator(".estado-sessao");
  await expect(barra.getByRole("link", { name: "I-1 sem título" })).toBeVisible();
  await expect(barra).toContainText("registro · interativa");
  await expect(barra.locator(".pill")).toHaveText("aguarda você · conversa");
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".sistema").first()).toHaveText("Execução E-1 iniciada · interativa · prompt da etapa");
  await expect(conversa.locator(".msg")).toHaveText(["pronto"]);

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
  await expect(minha).toHaveText("<b>sem html</b> e registre agora");
  await expect(minha.locator("b")).toHaveCount(0);
  await expect(minha.locator("strong")).toHaveText("registre");
  await expect(conversa.locator(".msg.agente").last()).toHaveText(
    "Registrei o título, o tipo, o comportamento e os critérios de aceite.",
  );

  // O agente enviou (C25): o chat só avisa, e a decisão fica na página da issue.
  await expect(barra.locator(".pill")).toHaveText("aguarda você · gate do registro");
  await expect(barra.getByRole("link", { name: "I-1 Exportar pedidos em CSV" })).toBeVisible();
  await expect(pagina.locator(".fim")).toHaveText(
    "O agente enviou o resultado à sua aprovação. Decida na página da issue; devolver traz o motivo de volta a esta conversa.",
  );
  const aviso = pagina.getByRole("region", { name: "Gate do registro" });
  await expect(aviso).toContainText("A decisão deste gate fica na página da issue, com tudo o que ela precisa.");
  await aviso.getByRole("link", { name: "Decidir na página da issue" }).click();
  await expect(pagina).toHaveURL(/\/projects\/loja\/issues\/I-1$/);

  const gate = pagina.getByRole("region", { name: "Gate do registro" });
  await expect(gate).toContainText("aguarda você há menos de 1 min");
  await expect(gate.locator(".fatos dd")).toHaveText([
    "Exportar pedidos em CSV",
    "funcionalidade",
    "Botão no painel de pedidos que baixa o CSV do mês.",
    "hoje a contabilidade copia os pedidos à mão",
  ]);
  await expect(gate.locator("th")).toHaveText(["ID", "Dado", "Quando", "Então"]);
  await expect(gate.locator("td")).toHaveText([
    "CA-1",
    "pedidos no mês",
    "exporto",
    "o CSV traz número, data, cliente e total",
    "CA-2",
    "pedidos de outro mês em exportarPedidos.js",
    "o Auditor roda node exportarPedidos.js --mes 2026-10",
    "só os do mês escolhido entram, o stderr fica vazio e o código de saída é 0; com --mes inválido, o stderr mostra o uso (node exportarPedidos.js --mes <AAAA-MM>)",
  ]);
  // O texto do agente é Markdown em linha, e a tabela cabe no painel sem rolar de lado.
  await expect(gate.locator("td code").first()).toHaveText("exportarPedidos.js");
  await expect(gate.locator("td p")).toHaveCount(0);
  const rola = await gate.locator(".rola").evaluate((e) => [e.scrollWidth, e.clientWidth]);
  expect(rola[0]).toBeLessThanOrEqual(rola[1] ?? 0);
  await expect(gate).toContainText("Nenhuma evidência faltando.");

  await gate.getByRole("button", { name: "Aprovar registro" }).click();
  await expect(gate).toHaveCount(0);
  await pagina.goBack();
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
  await expect(conversa.locator(".msg.agente")).toHaveText(["pronto"]);

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
  await expect(conversa.locator(".msg.agente").last()).toHaveText("pronto");

  // Ao lado, o ticket da consulta marcado e o link para o chat da principal do outro ticket… da mesma issue.
  const contexto = pagina.getByRole("region", { name: "Contexto da issue" });
  await expect(contexto.locator("li.atual")).toHaveText("T-1Ticket 1esta");
});

test("abortar uma sessão autônoma pelo chat falha a execução como abortada pelo Auditor", async ({
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
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "Executar agora" }).click();
  await pagina.getByRole("link", { name: /chat →/ }).click();
  const conversa = pagina.locator("[data-conversa]");
  await expect(conversa.locator(".fluxo")).toContainText("Os testes");
  await pagina.getByRole("button", { name: "Abortar" }).click();
  await expect(pagina.locator(".estado-sessao .pill")).toHaveText("aguarda você · falha");
  await expect(conversa.locator(".sistema", { hasText: "Execução E-1 falhou" })).toHaveText(
    "Execução E-1 falhou: abortada pelo Auditor",
  );
});
