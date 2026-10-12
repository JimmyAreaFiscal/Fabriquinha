// Gate do desenho na página da issue (F7 §4.4, §7): ajustar os tickets propostos (editar, trocar o modelo, remover e
// criar) e aprovar; reprovar com o motivo e ver o ticket de desenho novo.
import { abrir } from "../src/persistencia/banco.ts";
import { agregado } from "../src/persistencia/issues.ts";
import { expect, test } from "./apoio.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const SESSAO = "4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6";

/**
 * I-1 da loja no gate do desenho: T-2 de desenho concluído na sessão autônoma, com o desenho (2 arquivos previstos) e
 * os impactos (baixo, 1 acoplamento novo); T-3 e T-4 propostos por ele. O desenvolvimento usa o Sonnet por padrão.
 */
function semear(raiz: string): void {
  const criterios = JSON.stringify({
    criterios: [
      { id: "CA-1", dado: "issues em fases diferentes", quando: "abre /home", entao: "cada uma na sua coluna" },
    ],
  });
  const solucao = JSON.stringify({
    resumo: "board",
    arquivosPrevistos: [
      { caminho: "src/web/inicio.ts", acao: "criar", motivo: "tela" },
      { caminho: "src/web/rotas.ts", acao: "alterar", motivo: "rota" },
    ],
  });
  const impactos = JSON.stringify({
    impacto: "baixo",
    novasDependencias: [],
    novosAcoplamentos: [{ de: "web", para: "f2", motivo: "leitura do board" }],
    riscos: [],
  });
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness, modelos)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]',
        '{"desenvolvimento":{"provedor":"anthropic","modelo":"claude-sonnet-5-5"}}');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em)
      VALUES (1, 'loja', 'Board por fase', 'funcionalidade', 'aprovacao_desenho', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, origem_ticket, criado_em, concluido_em) VALUES
      (1, 1, 'registro', 'Registrar a necessidade', '', 'concluido', 'fabriquinha', NULL, '${AGORA}', '${AGORA}'),
      (2, 1, 'desenho', 'Desenhar a solução', '', 'concluido', 'fabriquinha', NULL, '${AGORA}', '${AGORA}'),
      (3, 1, 'desenvolvimento', 'Rota /home com o board', 'Ler o board no F2.', 'aberto', 'agente', 2, '${AGORA}', NULL),
      (4, 1, 'desenvolvimento', 'Métricas do mês em cards', 'Cinco cards.', 'aberto', 'agente', 2, '${AGORA}', NULL);
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 4) ON CONFLICT (nome) DO UPDATE SET valor = 4;
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'sucesso', '${AGORA}', '2026-10-11T12:22:00.000Z');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES
      (1, 1, 'criterios_aceite', 'agente', '${criterios}', '${AGORA}'),
      (2, 2, 'desenho_solucao', 'agente', '${solucao}', '${AGORA}'),
      (3, 2, 'relatorio_impactos_arquitetura', 'agente', '${impactos}', '${AGORA}');
  `);
  banco.close();
}

/** O agregado da I-1, lido do banco da instância. */
function issue(raiz: string) {
  const banco = abrir(raiz);
  try {
    return agregado(banco, 1);
  } finally {
    banco.close();
  }
}

test("aprova o desenho com um ticket editado, outro com o modelo trocado, um removido e um novo", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do desenho" });
  await expect(gate.locator(".gate-cabeca")).toContainText("Gate do desenhoaguarda você há");
  await expect(gate.getByRole("link", { name: "abrir o chat da sessão →" })).toHaveAttribute(
    "href",
    `/sessions/${SESSAO}`,
  );
  await expect(gate.locator(".numero")).toHaveText([
    "2arquivos previstos",
    "2tickets propostos",
    "1acoplamento novo",
    "baixoimpacto na arquitetura",
  ]);
  await expect(gate.locator(".tabela").first().locator("tbody tr")).toHaveText(
    "CA-1issues em fases diferentesabre /homecada uma na sua coluna",
  );
  const propostos = gate.locator("tr[data-proposto]");
  await expect(propostos).toHaveCount(2);
  await expect(gate.getByRole("combobox", { name: "Modelo de T-3" })).toHaveValue("");
  await expect(gate.getByRole("option", { name: "padrão · claude-sonnet-5-5" }).first()).toBeAttached();
  await expect(gate.getByRole("button", { name: "Reprovar" })).toBeDisabled();

  // A linha em edição não desloca as colunas das outras: o título do T-4, o mais largo, continua contando.
  const t3 = gate.locator('tr[data-proposto="3"]');
  const colunas = () => t3.locator("td").evaluateAll((tds) => tds.map((td) => td.getBoundingClientRect().x));
  const antes = await colunas();
  await gate.locator('tr[data-proposto="4"]').getByRole("button", { name: "Editar" }).click();
  await expect(gate.locator('tr[data-edicao="4"]')).toBeVisible();
  expect(await colunas()).toEqual(antes);
  await gate.locator('tr[data-edicao="4"]').getByRole("button", { name: "Cancelar" }).click();

  // Editar T-3: o Cancelar volta à linha sem gravar; o Salvar grava.
  await t3.getByRole("button", { name: "Editar" }).click();
  const edicao = gate.locator('tr[data-edicao="3"]');
  await expect(t3).toBeHidden();
  await expect(edicao.getByRole("textbox", { name: "Título" })).toBeFocused();
  await edicao.getByRole("textbox", { name: "Título" }).fill("descartado");
  await edicao.getByRole("button", { name: "Cancelar" }).click();
  await expect(t3).toContainText("Rota /home com o board");
  await t3.getByRole("button", { name: "Editar" }).click();
  await edicao.getByRole("textbox", { name: "Título" }).fill("Rota /home com o board por fase");
  await edicao.getByRole("textbox", { name: "Descrição" }).fill("Ler o board no F2, na ordem do SDLC.");
  await edicao.getByRole("button", { name: "Salvar" }).click();
  await expect(t3).toContainText("Rota /home com o board por faseLer o board no F2, na ordem do SDLC.");

  // O motivo digitado sobrevive às ações que releem a página.
  await gate.getByRole("textbox", { name: "Motivo (obrigatório para reprovar)" }).fill("rascunho");

  // Modelo: override no T-3.
  await gate.getByRole("combobox", { name: "Modelo de T-3" }).selectOption("anthropic/claude-opus-5-5");
  await expect(gate.getByRole("combobox", { name: "Modelo de T-3" })).toHaveClass(/override/);
  await expect(gate.getByRole("combobox", { name: "Modelo de T-3" })).toHaveValue("anthropic/claude-opus-5-5");

  // Remover T-4 e criar um novo.
  await gate.locator('tr[data-proposto="4"]').getByRole("button", { name: "Remover" }).click();
  await expect(propostos).toHaveCount(1);
  await gate.getByRole("button", { name: "+ Novo ticket" }).click();
  const novo = gate.locator("[data-novo-ticket]");
  await novo.getByRole("textbox", { name: "Título" }).fill("Cards de quem aguarda você");
  await novo.getByRole("textbox", { name: "Descrição" }).fill("Da mais antiga para a mais nova.");
  await novo.getByRole("button", { name: "Criar ticket" }).click();
  await expect(propostos).toHaveCount(2);
  await expect(propostos.nth(1)).toContainText("T-5Cards de quem aguarda vocêDa mais antiga para a mais nova.");
  await expect(gate.getByRole("textbox", { name: "Motivo (obrigatório para reprovar)" })).toHaveValue("rascunho");

  await gate.getByRole("button", { name: "Aprovar desenho" }).click();
  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenvolvimento");
  const ag = issue(fabriquinha.raiz);
  expect(ag?.issue.fase).toBe("desenvolvimento");
  expect(
    ag?.tickets.filter((t) => t.etapa === "desenvolvimento").map((t) => [t.id, t.titulo, t.modelo?.modelo]),
  ).toEqual([
    [3, "Rota /home com o board por fase", "claude-opus-5-5"],
    [5, "Cards de quem aguarda você", undefined],
  ]);
  expect(ag?.decisoes.map((d) => [d.gate, d.aprovado])).toEqual([["desenho", true]]);
});

test("reprova o desenho com o motivo e mostra o ticket de desenho novo", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do desenho" });
  const reprovar = gate.getByRole("button", { name: "Reprovar" });
  const motivo = gate.getByRole("textbox", { name: "Motivo (obrigatório para reprovar)" });
  await motivo.fill("   ");
  await expect(reprovar).toBeDisabled();
  await motivo.fill("Faltou o índice da busca.");
  await expect(reprovar).toBeEnabled();
  await reprovar.click();

  await expect(gate).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenho");
  const tickets = pagina.locator(".linha-tempo > li");
  await expect(tickets).toHaveCount(3);
  await expect(tickets.last()).toContainText("T-5Refazer o desenho");
  await expect(tickets.last()).toContainText("desenhoaberto");
  await pagina.getByRole("button", { name: "T-5 Refazer o desenho" }).click();
  await expect(pagina.getByRole("dialog").getByRole("heading")).toHaveText("T-5 · Refazer o desenho");
  expect(issue(fabriquinha.raiz)?.tickets.at(-1)?.descricao).toBe("Faltou o índice da busca.");
});
