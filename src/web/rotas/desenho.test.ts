// Rotas do gate do desenho (F7 §4.2): C11 a C13 do Auditor, C20 com a conferência do modelo (F4 §9) e C15, chamadas
// como o servidor as chama, contra um banco de verdade e um pi falso. A tradução dos erros é a do servidor.
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { agregado } from "../../persistencia/issues.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";
import type { PaginaDaIssue } from "./issue.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-desenho-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// pi com um modelo, em $FABRIQUINHA_PI.
const pi = join(base, "pi");
writeFileSync(
  pi,
  `#!/bin/sh
echo "provider   model            context  max-out  thinking  images"
echo "anthropic  claude-opus-5-5  200K     64K      yes       yes"
`,
);
chmodSync(pi, 0o755);
process.env.FABRIQUINHA_PI = pi;

const AGORA = "2026-10-11T12:00:00.000Z";
const OPUS = { provedor: "anthropic", modelo: "claude-opus-5-5" };
const INEXISTENTE = { provedor: "x", modelo: "y" };

let banco: DatabaseSync;

/**
 * I-1 no gate do desenho: T-2 de desenho enviado (C25), com o desenho (2 arquivos previstos) e os impactos (1
 * acoplamento novo); T-3 proposto por ele e T-4 criado pelo Auditor. I-2 em desenvolvimento.
 */
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '/nao/existe', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES
      (1, 'loja', 'Busca', 'funcionalidade', 'aprovacao_desenho', '${AGORA}'),
      (2, 'loja', 'Outra', 'problema', 'desenvolvimento', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, origem_ticket, criado_em, concluido_em, enviado_em) VALUES
      (1, 1, 'registro', 'Registrar', 'concluido', 'fabriquinha', NULL, '${AGORA}', '${AGORA}', '${AGORA}'),
      (2, 1, 'desenho', 'Desenhar a solução', 'em_execucao', 'fabriquinha', NULL, '${AGORA}', NULL, '${AGORA}'),
      (3, 1, 'desenvolvimento', 'Cache', 'aberto', 'agente', 2, '${AGORA}', NULL, NULL),
      (4, 1, 'desenvolvimento', 'Índice', 'aberto', 'auditor', NULL, '${AGORA}', NULL, NULL),
      (5, 2, 'desenvolvimento', 'Rota', 'aberto', 'auditor', NULL, '${AGORA}', NULL, NULL);
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 5) ON CONFLICT (nome) DO UPDATE SET valor = 5;
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em) VALUES
      (1, 2, 'desenho_solucao', 'agente', '{"arquivosPrevistos":[{"caminho":"a"},{"caminho":"b"}]}', '${AGORA}'),
      (2, 2, 'relatorio_impactos_arquitetura', 'agente',
        '{"impacto":"baixo","novasDependencias":[],"novosAcoplamentos":[{"de":"web","para":"f2"}]}', '${AGORA}');
  `);
});

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, caminho) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date(), executarAgora: () => Promise.resolve() },
        params,
        query: new URLSearchParams(),
        corpo,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
  }
  throw new Error(`${metodo} ${caminho} não existe`);
}

const tickets = (issue = 1) => agregado(banco, issue)?.tickets ?? [];
const ticket = (id: number) => tickets().find((t) => t.id === id);

test("GET /api/issues/:id: os números do desenho (F6 §5.5) só no gate do desenho", async () => {
  const p = (await chamar("GET", "/api/issues/1")) as PaginaDaIssue;
  assert.deepEqual(p.desenho, {
    arquivosPrevistos: 2,
    ticketsPropostos: 1,
    novasDependencias: 0,
    novosAcoplamentos: 1,
  });
  assert.equal(((await chamar("GET", "/api/issues/2")) as PaginaDaIssue).desenho, undefined);
});

test("C11: o Auditor cria ticket proposto, com ou sem modelo conferido no pi; fora do gate, 409", async () => {
  assert.equal(await chamar("POST", "/api/issues/1/tickets", { titulo: "Paginação", descricao: "d" }), undefined);
  assert.deepEqual(
    tickets()
      .filter((t) => t.id > 5)
      .map((t) => [t.titulo, t.descricao, t.origem, t.modelo]),
    [["Paginação", "d", "auditor", undefined]],
  );
  assert.equal(await chamar("POST", "/api/issues/1/tickets", { titulo: "Filtro", modelo: OPUS }), undefined);
  assert.deepEqual(tickets().at(-1)?.modelo, OPUS);

  assert.deepEqual(await chamar("POST", "/api/issues/1/tickets", { titulo: "Outro", modelo: INEXISTENTE }), [
    409,
    "o modelo x/y não existe no pi (escolha um par listado por pi --list-models)",
  ]);
  assert.equal(tickets().length, 6, "modelo recusado não cria o ticket");
  const [status, erro] = (await chamar("POST", "/api/issues/1/tickets", { titulo: "" })) as [number, string];
  assert.deepEqual([status, erro.includes("titulo")], [422, true]);
  const [fora] = (await chamar("POST", "/api/issues/2/tickets", { titulo: "Novo" })) as [number];
  assert.equal(fora, 409);
});

test("C12 e C13: o Auditor edita e remove o proposto; ticket inexistente dá 404", async () => {
  assert.equal(await chamar("POST", "/api/tickets/3", { titulo: "Cache na busca", descricao: "com TTL" }), undefined);
  assert.deepEqual([ticket(3)?.titulo, ticket(3)?.descricao], ["Cache na busca", "com TTL"]);
  assert.equal(await chamar("POST", "/api/tickets/3", { descricao: "sem TTL" }), undefined);
  assert.deepEqual([ticket(3)?.titulo, ticket(3)?.descricao], ["Cache na busca", "sem TTL"]);

  assert.equal(await chamar("DELETE", "/api/tickets/4"), undefined);
  assert.equal(ticket(4), undefined);

  assert.deepEqual(await chamar("DELETE", "/api/tickets/99"), [
    404,
    "o ticket T-99 não existe (confira o número do ticket)",
  ]);
  assert.equal(((await chamar("POST", "/api/tickets/99", { titulo: "x" })) as [number])[0], 404);
  assert.equal(((await chamar("POST", "/api/tickets/T-3", { titulo: "x" })) as [number])[0], 422);
});

test("C20: o override de modelo é conferido no pi e sai com null", async () => {
  assert.equal(await chamar("POST", "/api/tickets/3/modelo", { modelo: OPUS }), undefined);
  assert.deepEqual(ticket(3)?.modelo, OPUS);
  assert.deepEqual(await chamar("POST", "/api/tickets/3/modelo", { modelo: INEXISTENTE }), [
    409,
    "o modelo x/y não existe no pi (escolha um par listado por pi --list-models)",
  ]);
  assert.deepEqual(ticket(3)?.modelo, OPUS);
  assert.equal(await chamar("POST", "/api/tickets/3/modelo", { modelo: null }), undefined);
  assert.equal(ticket(3)?.modelo, undefined);
  assert.equal(((await chamar("POST", "/api/tickets/3/modelo", {})) as [number])[0], 422);
});

test("C15 pela rota: aprovar conclui o desenho, sem worktree para descartar, e vai ao desenvolvimento", async () => {
  banco.exec(`INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
    VALUES (1, 2, 'interativo', '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b', 'sucesso', '${AGORA}', '${AGORA}')`);
  assert.equal(await chamar("POST", "/api/issues/1/desenho", { aprovado: true }), undefined);
  const ag = agregado(banco, 1);
  assert.deepEqual([ag?.issue.fase, ag?.tickets.find((t) => t.id === 2)?.status], ["desenvolvimento", "concluido"]);
});

test("C15 pela rota: o motivo é obrigatório para reprovar, e fora do gate o C15 recusa com 409", async () => {
  // A reprovação que retoma a sessão roda contra o serviço, com git e o pi falso, em chat.test.ts.
  assert.equal(((await chamar("POST", "/api/issues/1/desenho", { aprovado: false })) as [number])[0], 422);
  banco.exec("UPDATE issue SET fase = 'desenho' WHERE id = 1");
  assert.deepEqual(await chamar("POST", "/api/issues/1/desenho", { aprovado: false, motivo: "faltou o índice" }), [
    409,
    "a I-1 está na fase desenho, não na aprovação do desenho (o gate de desenho abre quando o agente envia o desenho)",
  ]);
  assert.equal(agregado(banco, 1)?.decisoes.length, 0);
});
