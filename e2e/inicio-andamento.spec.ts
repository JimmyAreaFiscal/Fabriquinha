// Início (F7 §4.4, item 4): o card do gate do PR traz o número do PR.
import { abrir } from "../src/persistencia/banco.ts";
import { expect, test } from "./apoio.ts";

test("o card do gate do PR traz o número do PR aberto", async ({ pagina, fabriquinha }) => {
  const banco = abrir(fabriquinha.raiz);
  const pr = JSON.stringify({
    hospedagem: "github",
    id: "212",
    url: "https://github.com/x/loja/pull/212",
    branch: "b",
    base: "main",
  });
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, descricao, fase, criada_em)
      VALUES (1, 'loja', 'Webhook do Pix', 'problema', '', 'aprovacao_pr', '2026-10-11T12:00:00.000Z');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em)
      VALUES (1, 1, 'encerramento', 'Publicar o PR', 'concluido', 'fabriquinha', '2026-10-11T12:00:00.000Z', '2026-10-11T12:30:00.000Z');
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 1, 'autonomo', '4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6', 'sucesso', '2026-10-11T12:00:00.000Z', '2026-10-11T12:30:00.000Z');
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em)
      VALUES (1, 1, 'pr_aberto', 'fabriquinha', '${pr}', '2026-10-11T12:30:00.000Z');
  `);
  banco.close();
  await pagina.goto(`${fabriquinha.base}/home`);
  await expect(pagina.locator(".decisao")).toContainText("PR #212 aberto; aguarda a sua revisão no PR");
});
