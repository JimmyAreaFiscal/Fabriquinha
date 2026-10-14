// Proposta de issue da IA (F7 §4.4; F4 §6.6): o cartão no gate do desenho, com o banco semeado (Aceitar cria a issue e
// o ticket de desenho novo; Recusar mantém o gate), e o cartão no chat do registro com o pi falso.
import { abrir } from "../src/persistencia/banco.ts";
import { agregado } from "../src/persistencia/issues.ts";
import { expect, projeto, test } from "./apoio.ts";

const AGORA = "2026-10-11T12:00:00.000Z";
const SESSAO = "4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6";

/** I-1 da loja no gate do desenho, com T-2 de desenho concluído e uma proposta pendente (P-1) que ele fez. */
function semear(raiz: string): void {
  const criterios = JSON.stringify({
    criterios: [{ id: "CA-1", dado: "pedidos no mês", quando: "exporto", entao: "o CSV sai" }],
  });
  const solucao = JSON.stringify({
    resumo: "exportação",
    arquivosPrevistos: [{ caminho: "src/exportar.ts", acao: "criar", motivo: "exportação" }],
  });
  const impactos = JSON.stringify({ impacto: "baixo", novasDependencias: [], novosAcoplamentos: [], riscos: [] });
  const banco = abrir(raiz);
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em)
      VALUES (1, 'loja', 'Exportar tudo', 'funcionalidade', 'aprovacao_desenho', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, descricao, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'registro', 'Registrar a necessidade', '', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}'),
      (2, 1, 'desenho', 'Desenhar a solução', '', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 2) ON CONFLICT (nome) DO UPDATE SET valor = 2;
    INSERT INTO sequencia (nome, valor) VALUES ('issue', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO sequencia (nome, valor) VALUES ('proposta', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'sucesso', '${AGORA}', '2026-10-11T12:22:00.000Z');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES
      (1, 1, 'criterios_aceite', 'agente', '${criterios}', '${AGORA}'),
      (2, 2, 'desenho_solucao', 'agente', '${solucao}', '${AGORA}'),
      (3, 2, 'relatorio_impactos_arquitetura', 'agente', '${impactos}', '${AGORA}');
    INSERT INTO proposta_issue (id, ticket, titulo, mensagem, arquivos, status, em)
      VALUES (1, 2, 'Tela de relatório', 'Parte B: **relatório**', 42, 'pendente', '${AGORA}');
  `);
  banco.close();
}

function ler(raiz: string, id: number) {
  const banco = abrir(raiz);
  try {
    return agregado(banco, id);
  } finally {
    banco.close();
  }
}

test("recusar a proposta no gate do desenho mantém o gate e não cria issue", async ({ pagina, fabriquinha }) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  const gate = pagina.getByRole("region", { name: "Gate do desenho" });
  const cartao = gate.locator(".proposta");
  await expect(cartao).toContainText("Proposta de issue");
  await expect(cartao).toContainText("~42 arquivos estimados · limite de 30 por PR");
  await expect(cartao.locator(".md strong")).toHaveText("relatório");
  await cartao.getByRole("button", { name: "Recusar" }).click();
  await expect(cartao).toBeHidden();
  await expect(gate.getByRole("button", { name: "Aprovar desenho" })).toBeVisible();
  expect(ler(fabriquinha.raiz, 2)).toBeUndefined();
  expect(ler(fabriquinha.raiz, 1)?.issue.fase).toBe("aprovacao_desenho");
});

test("aceitar a proposta no gate do desenho cria a issue dependente e o ticket de desenho novo", async ({
  pagina,
  fabriquinha,
}) => {
  semear(fabriquinha.raiz);
  await pagina.goto(`${fabriquinha.base}/projects/loja/issues/I-1`);
  await pagina.getByRole("region", { name: "Gate do desenho" }).getByRole("button", { name: "Aceitar" }).click();
  await expect(pagina.getByRole("region", { name: "Gate do desenho" })).toBeHidden();
  await expect(pagina.locator('.trilho-fases [aria-current="step"]')).toHaveText("Desenho");
  const nova = ler(fabriquinha.raiz, 2);
  expect(nova?.issue).toMatchObject({ fase: "registro", deps: [1], descricao: "Parte B: **relatório**" });
  const tickets = ler(fabriquinha.raiz, 1)?.tickets;
  expect(tickets?.at(-1)).toMatchObject({ etapa: "desenho" });
  expect(tickets?.at(-1)?.descricao).toContain("I-2");
});

test("o chat do registro mostra o cartão da proposta; aceitar cria a issue e avisa a IA", async ({
  pagina,
  fabriquinha,
}) => {
  projeto(fabriquinha.raiz);
  const { sessao } = await pagina.evaluate(async () => {
    const r = await fetch("/api/registros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projeto: "loja", descricao: "Exportar tudo" }),
    });
    return (await r.json()) as { sessao: string };
  });
  await pagina.goto(`${fabriquinha.base}/sessions/${sessao}`);
  // Só depois do primeiro turno do agente (o prompt da etapa) a conversa aceita a mensagem do Auditor.
  await expect(pagina.locator("[data-conversa] .msg")).toHaveText(["pronto"]);
  const envio = pagina.locator("form[data-envio]");
  await envio.getByRole("textbox", { name: "Mensagem" }).fill("proponha a divisão");
  await envio.getByRole("button", { name: "Enviar" }).click();

  const cartao = pagina.locator("[data-propostas] .proposta");
  await expect(cartao).toContainText("Tela de relatório");
  await expect(cartao).toContainText("~42 arquivos estimados · limite de 30 por PR");
  expect(ler(fabriquinha.raiz, 2)).toBeUndefined();

  await cartao.getByRole("button", { name: "Aceitar" }).click();
  await expect(cartao).toBeHidden();
  await expect(pagina.locator("[data-conversa] .msg.fabriquinha")).toContainText("I-2");
  expect(ler(fabriquinha.raiz, 2)?.issue).toMatchObject({ deps: [1], descricao: "Parte B: tela de **relatório**\n" });
});
