// Página da issue (F7 §4.4, §4.5, §7): leitura, tickets e execuções, artefatos na caixa, dependências, Executar agora,
// aviso de limpeza, o caminho direto numa aba nova e o script de um HTML de evidência que não alcança a API.
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { caminhoArquivo } from "../src/persistencia/arquivos.ts";
import { abrir } from "../src/persistencia/banco.ts";
import { caminhoDaWorktree } from "../src/repositorio/worktree.ts";
import { expect, test } from "./apoio.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const SESSAO = "0b7c5a52-3f0e-4c1e-9d3a-6f1f2b9e8a10";

/** O script tenta ler e mudar a issue pela API, ler o cookie e alcançar a página; escreve o que conseguiu. */
const HTML_HOSTIL = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Desenho</title>
<body><h1>Desenho da solução</h1><p id="resultado">rodando</p><script>
(async () => {
  const r = [];
  const tentar = async (rotulo, f) => { try { r.push(rotulo + " " + (await f())); } catch { r.push(rotulo + " bloqueado"); } };
  await tentar("get", async () => (await fetch("/api/issues/1")).status);
  await tentar("delete", async () => (await fetch("/api/issues/1/deps/2", { method: "DELETE" })).status);
  await tentar("post", async () => {
    await fetch("/api/issues/1/deps", { method: "POST", mode: "no-cors", body: JSON.stringify({ dep: 3 }) });
    return "enviado";
  });
  await tentar("cookie", () => document.cookie);
  await tentar("pai", () => parent.document.title);
  document.getElementById("resultado").textContent = r.join("; ");
})();
</script></body></html>`;

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  "base64",
);

/** Guarda o conteúdo como o F2 guarda um anexo e devolve o hash. */
function guardar(raiz: string, conteudo: string | Buffer): string {
  const banco = abrir(raiz);
  const sha = createHash("sha256").update(conteudo).digest("hex");
  const caminho = caminhoArquivo(banco, sha);
  banco.close();
  mkdirSync(dirname(caminho), { recursive: true });
  writeFileSync(caminho, conteudo);
  return sha;
}

/**
 * I-1 da loja em desenvolvimento, dependendo da I-2 (concluída, com a worktree que a limpeza deixou), com os tickets de
 * registro, de desenho (uma falha e um sucesso) e um de desenvolvimento aberto e elegível, e artefatos do registro e
 * do desenho. I-3 está no registro, para virar dependência.
 */
function semear(raiz: string): void {
  const html = guardar(raiz, HTML_HOSTIL);
  const png = guardar(raiz, PNG);
  const texto = guardar(raiz, "1. abrir a busca\n2. digitar <b>cadeira</b>\n");
  const descricao = [
    "Hoje o Auditor precisa abrir cada issue para saber em que fase ela está.",
    "",
    "A página inicial deve mostrar um **board com uma coluna por fase**.",
    "",
    "<script>window.invadiu = true</script>",
    "",
    ...Array.from({ length: 12 }, (_, i) => `- contexto ${String(i + 1)}`),
  ].join("\n");
  const criterios = JSON.stringify({
    criterios: [
      {
        id: "CA-1",
        dado: "issues em fases diferentes",
        quando: "o Auditor abre /home",
        entao: "cada uma na sua coluna",
      },
    ],
  });
  const banco = abrir(raiz);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
       VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]')`,
    )
    .run();
  banco
    .prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('loja', ?, ?)")
    .run("c".repeat(40), AGORA);
  banco
    .prepare(
      `INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em) VALUES (1, 'loja', 'Board por fase', 'funcionalidade', ?, 'desenvolvimento', ?)`,
    )
    .run(descricao, AGORA);
  banco.exec(`
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em, concluida_em) VALUES (2, 'loja', 'Base', 'problema', 'concluida', '${AGORA}', '${AGORA}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES (3, 'loja', 'Outra', 'problema', 'registro', '${AGORA}');
    INSERT INTO issue_dep (issue, dep) VALUES (1, 2);
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'registro', 'Registrar a necessidade', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}'),
      (2, 1, 'desenho', 'Desenhar a solução', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em) VALUES
      (3, 1, 'desenvolvimento', 'Rota /home com o board', 'aberto', 'auditor', '${AGORA}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, erro, iniciada_em, terminada_em) VALUES
      (1, 1, 'interativo', '${randomUUID()}', 'sucesso', NULL, '${AGORA}', '2026-10-11T12:34:00.000Z'),
      (2, 2, 'autonomo', '${SESSAO}', 'falha', 'tempo limite de 30 min', '${AGORA}', '2026-10-11T12:30:00.000Z'),
      (3, 2, 'autonomo', '${SESSAO}', 'sucesso', NULL, '${AGORA}', '2026-10-11T12:22:00.000Z');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 3) ON CONFLICT (nome) DO UPDATE SET valor = 3;
    INSERT INTO uso (execucao, provedor, modelo, chamadas, input, output, cache_read, cache_write, custo)
      VALUES (3, 'anthropic', 'claude', 4, 100, 100, 0, 0, 1.86);
    INSERT INTO evidencia (id, ticket, tipo, produtor, aprovada, dados, em) VALUES
      (1, 1, 'criterios_aceite', 'agente', NULL, '${criterios}', '${AGORA}'),
      (2, 1, 'comportamento', 'agente', NULL, '{"descricao":"d","comoReproduzir":["a"]}', '${AGORA}'),
      (3, 2, 'desenho_solucao', 'agente', NULL, '{}', '${AGORA}'),
      (4, 2, 'prototipo', 'agente', NULL, '{"descricao":"tela"}', '${AGORA}');
    INSERT INTO evidencia_arquivo (evidencia, nome, sha256, mime, bytes) VALUES
      (2, 'passos.txt', '${texto}', 'text/plain; charset=utf-8', 40),
      (3, 'desenho.html', '${html}', 'text/html; charset=utf-8', ${String(Buffer.byteLength(HTML_HOSTIL))}),
      (4, 'tela.png', '${png}', 'image/png', ${String(PNG.length)});
  `);
  banco.close();
  mkdirSync(join(raiz, "execucoes", "E-2"), { recursive: true });
  writeFileSync(join(raiz, "execucoes", "E-2", "log"), "o pi estourou o tempo limite\n");
  mkdirSync(caminhoDaWorktree(raiz, "loja", 2), { recursive: true });
}

test("lê a issue: caminho, título, trilho, detalhes, descrição em Markdown recolhida e tickets com sessões", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("I-1Board por fase");
  await expect(pagina).toHaveTitle("I-1 · Fabriquinha");
  const caminho = pagina.getByRole("navigation", { name: "Caminho" });
  await expect(caminho).toHaveText("Projetos › loja › I-1");
  await expect(caminho.getByRole("link", { name: "loja" })).toHaveAttribute("href", "/projects/loja");
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenvolvimento");
  await expect(pagina.getByRole("link", { name: "Projetos", exact: true }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );

  const detalhes = pagina.locator(".fatos");
  await expect(detalhes).toContainText("Projetoloja");
  await expect(detalhes).toContainText("Tipofuncionalidade");
  await expect(detalhes.locator(".dep")).toHaveText("I-2concluída×");

  // Markdown sem HTML: o script da descrição vira texto e não roda.
  const descricao = pagina.locator("[data-descricao]");
  await expect(descricao.locator("strong")).toHaveText("board com uma coluna por fase");
  await expect(descricao).toContainText("<script>window.invadiu = true</script>");
  expect(await pagina.evaluate(() => "invadiu" in window)).toBe(false);
  const verTudo = pagina.getByRole("button", { name: "ver tudo" });
  const recolhida = (await descricao.boundingBox())?.height ?? 0;
  await verTudo.click();
  await expect(pagina.getByRole("button", { name: "ver menos" })).toBeVisible();
  expect((await descricao.boundingBox())?.height ?? 0).toBeGreaterThan(recolhida);

  const tickets = pagina.locator(".linha-tempo > li");
  await expect(tickets).toHaveCount(3);
  await expect(tickets.nth(1)).toContainText("T-2Desenhar a solução");
  await expect(tickets.nth(1).getByRole("link", { name: /autônoma/ })).toHaveAttribute("href", `/sessions/${SESSAO}`);
  await expect(tickets.nth(2)).toContainText("desenvolvimentoaberto");
});

test("o ticket abre as execuções na caixa, com o log; cada artefato abre conforme o tipo", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "T-2 Desenhar a solução" }).click();
  const caixa = pagina.getByRole("dialog");
  await expect(caixa.getByRole("heading")).toHaveText("T-2 · Desenhar a solução");
  const linhas = caixa.locator("tbody tr");
  await expect(linhas).toHaveCount(2);
  await expect(linhas.first()).toContainText("E-2autônomofalha");
  await expect(linhas.first()).toContainText("30 min");
  await expect(linhas.first()).toContainText("tempo limite de 30 min");
  await expect(linhas.nth(1)).toContainText("US$ 1,86");
  const log = pagina.waitForEvent("popup");
  await linhas.first().getByRole("link", { name: "log" }).click();
  await expect((await log).locator("body")).toHaveText("o pi estourou o tempo limite");
  await pagina.keyboard.press("Escape");
  await expect(caixa).toBeHidden();

  // Tabela do tipo de gate.
  await pagina.getByRole("button", { name: "TABELA Critérios de aceite" }).click();
  await expect(caixa.getByRole("heading")).toHaveText("Critérios de aceite");
  await expect(caixa.locator("thead")).toHaveText("IDDadoQuandoEntão");
  await expect(caixa.locator("tbody tr")).toHaveText(
    "CA-1issues em fases diferenteso Auditor abre /homecada uma na sua coluna",
  );
  await pagina.keyboard.press("Escape");

  // Texto como texto, sem HTML.
  await pagina.getByRole("button", { name: "TEXTO Comportamento" }).click();
  await expect(caixa.locator("pre").first()).toHaveText("1. abrir a busca\n2. digitar <b>cadeira</b>\n");
  await expect(caixa.getByText(/"comoReproduzir"/)).toBeVisible();
  await pagina.keyboard.press("Escape");

  // Imagem, com abrir em nova aba e baixar.
  await pagina.getByRole("button", { name: "IMG Protótipo" }).click();
  await expect(caixa.getByRole("img", { name: "tela.png" })).toBeVisible();
  await expect(caixa.getByRole("link", { name: "abrir em nova aba ↗" })).toBeVisible();
  const download = pagina.waitForEvent("download");
  await caixa.getByRole("link", { name: "baixar" }).click();
  expect((await download).suggestedFilename()).toBe("tela.png");
  await pagina.keyboard.press("Escape");

  await pagina.getByRole("button", { name: "HTML Desenho da solução" }).click();
  await expect(caixa.locator("iframe")).toHaveAttribute("sandbox", "allow-scripts");
  await expect(pagina.frameLocator("iframe").getByRole("heading")).toHaveText("Desenho da solução");
});

test("um script dentro de um HTML de evidência não consegue chamar a API", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "HTML Desenho da solução" }).click();
  await expect(pagina.frameLocator("iframe").locator("#resultado")).toHaveText(
    "get bloqueado; delete bloqueado; post enviado; cookie bloqueado; pai bloqueado",
  );
  // O POST sem CORS saiu, mas sem o cookie e de outra origem: nada mudou.
  const banco = abrir(fabriquinha.raiz);
  expect(banco.prepare("SELECT dep FROM issue_dep WHERE issue = 1").all()).toEqual([{ dep: 2 }]);
  banco.close();

  // Aberto direto numa aba, o HTML também roda isolado, pelo cabeçalho `sandbox` (ali o "pai" é ele mesmo).
  const aba = await pagina.context().newPage();
  await aba.goto(`${fabriquinha.base}${String(await pagina.locator("iframe").getAttribute("src"))}`);
  await expect(aba.locator("#resultado")).toContainText(
    "get bloqueado; delete bloqueado; post enviado; cookie bloqueado;",
  );
});

test("adiciona e remove dependências sem sair da página; o erro aparece no aviso", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("button", { name: "+ adicionar" }).click();
  const campo = pagina.getByRole("textbox", { name: "Nova dependência" });
  await expect(campo).toBeFocused();
  await campo.fill("I-1");
  await campo.press("Enter");
  await expect(pagina.getByRole("alert")).toHaveText("a I-1 não pode depender de si mesma (informe outra issue)");
  await campo.fill("I-3");
  await pagina.getByRole("button", { name: "Adicionar" }).click();
  const deps = pagina.locator(".fatos .dep");
  await expect(deps).toHaveText(["I-2concluída×", "I-3registro×"]);
  await expect(pagina.getByRole("alert")).toBeHidden();

  await pagina.getByRole("button", { name: "Remover I-2" }).click();
  await expect(deps).toHaveText(["I-3registro×"]);
  await deps.getByRole("link", { name: "I-3" }).click();
  await expect(pagina).toHaveURL(`${fabriquinha.base}/projects/loja/issues/I-3`);
  await expect(pagina.getByRole("heading", { level: 1 })).toHaveText("I-3Outra");
});

test("Executar agora: desabilitado com o motivo enquanto outra autônoma roda; depois inicia o ticket", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const banco = abrir(fabriquinha.raiz);
  banco.exec(`
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em)
      VALUES (9, 3, 'desenvolvimento', 'Outro', 'em_execucao', 'auditor', '${AGORA}');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em)
      VALUES (9, 9, 'autonomo', '${randomUUID()}', 'em_andamento', '${AGORA}');
  `);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const acao = pagina.getByRole("region", { name: "Ação do Auditor" });
  await expect(acao).toContainText("T-3 · Rota /home com o board · desenvolvimento");
  const executar = acao.getByRole("button", { name: "Executar agora" });
  await expect(executar).toBeDisabled();
  await expect(acao).toContainText("já há uma execução autônoma em andamento (D8): E-9 de T-9");

  banco.exec(`
    UPDATE execucao SET resultado = 'sucesso', terminada_em = '${AGORA}' WHERE id = 9;
    UPDATE ticket SET status = 'aberto' WHERE id = 9;
  `);
  banco.close();
  await pagina.reload();
  await expect(executar).toBeEnabled();
  await executar.click();
  // O ticket começou: já não é elegível, e a página relida não oferece mais o botão.
  await expect(acao).toBeHidden();
  await expect(pagina.locator(".linha-tempo > li").nth(2)).toHaveClass(/em_execucao|falhou/);
});

test("issue concluída com a limpeza que falhou mostra os comandos a rodar", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-2`);
  const acao = pagina.getByRole("region", { name: "Ação do Auditor" });
  await expect(acao).toContainText("A limpeza falhou");
  await expect(acao.locator("pre")).toHaveText(
    `git -C /nao/existe worktree remove --force ${caminhoDaWorktree(fabriquinha.raiz, "loja", 2)}\ngit -C /nao/existe worktree prune`,
  );
  await expect(pagina.getByRole("button", { name: "+ adicionar" })).toHaveCount(0);
});

test("o caminho da issue abre direto numa aba nova, e o projeto errado é trocado pelo certo sem recarregar", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  const aba = await pagina.context().newPage();
  await aba.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("I-1Board por fase");

  await aba.evaluate(() => {
    Object.assign(window, { semRecarregar: true });
    history.pushState(null, "", "/projects/outro/issues/I-1");
    dispatchEvent(new PopStateEvent("popstate"));
  });
  await expect(aba).toHaveURL(`${fabriquinha.base}/projects/loja/issues/I-1`);
  expect(await aba.evaluate(() => "semRecarregar" in window)).toBe(true);

  await aba.goto(`${fabriquinha.base}/projects/outro/issues/I-1`);
  await expect(aba).toHaveURL(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("I-1Board por fase");

  await aba.goto(`${fabriquinha.base}/projects/loja/issues/I-99`);
  await expect(aba.getByRole("heading", { level: 1 })).toHaveText("Issue");
  await expect(aba.getByRole("alert")).toHaveText("a issue I-99 não existe (confira o número da issue)");
});
