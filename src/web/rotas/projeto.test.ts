// Rotas da página do projeto (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../../dominio/agregado.ts";
import { abrir } from "../../persistencia/banco.ts";
import { comIssue, registrarIssue } from "../../persistencia/issues.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../rotas.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-projeto-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  for (const nome of ["loja", "site"]) {
    registrarProjeto(banco, {
      nome,
      repo: `/repos/${nome}`,
      branchBase: "main",
      hospedagem: "github",
      testes: ["npm test"],
      sonar: { projectKey: nome },
      fitness: [{ nome: "f", comando: "c", descricao: "d" }],
    });
  }
});

/** Chama a rota como o servidor: o valor devolvido, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, endereco: string): Promise<unknown> {
  const url = new URL(endereco, "http://x");
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, url.pathname) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date(), executarAgora: () => Promise.resolve() },
        params,
        query: url.searchParams,
        corpo: undefined,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
  }
  throw new Error(`${metodo} ${endereco} não existe`);
}

/** Leva a issue a `concluida`, como o C17 deixaria. */
const concluir = (id: number) =>
  comIssue(banco, id, "editarIssue", AUDITOR, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "concluida", concluidaEm: ctx.agora },
  }));

const ids = (lista: unknown) => (lista as { issues: { id: number }[] }).issues.map((i) => i.id);

test("issues do projeto: em andamento sempre; concluídas e arquivadas só quando pedidas; contagem de todas", async () => {
  const andamento = registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  concluir(registrarIssue(banco, { projeto: "loja" }, AUDITOR).issue.id);
  concluir(registrarIssue(banco, { projeto: "loja" }, AUDITOR).issue.id);
  registrarIssue(banco, { projeto: "site" }, AUDITOR);

  const lista = await chamar("GET", "/api/projetos/loja/issues");
  assert.deepEqual(lista, {
    issues: [{ ...andamento.issue, tickets: andamento.tickets, bloqueadaPor: [] }],
    sessoes: [],
    contagem: { andamento: 1, concluidas: 2, arquivadas: 0 },
  });
  assert.deepEqual(ids(await chamar("GET", "/api/projetos/loja/issues?concluidas=true")), [3, 2, 1]);

  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 2 });
  const arquivada = await chamar("GET", "/api/projetos/loja/issues?concluidas=true&arquivadas=false");
  assert.deepEqual(ids(arquivada), [1]);
  assert.deepEqual((arquivada as { contagem: unknown }).contagem, { andamento: 1, concluidas: 0, arquivadas: 2 });
  assert.deepEqual(ids(await chamar("GET", "/api/projetos/loja/issues?arquivadas=true")), [3, 2, 1]);
  // Arquivar de novo não acha mais nada; o outro projeto não muda.
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 0 });
  assert.deepEqual(ids(await chamar("GET", "/api/projetos/site/issues?arquivadas=true")), [4]);
});

test("cada issue diz que dependência ainda bloqueia, inclusive de outro projeto, e o PR aberto", async () => {
  registrarIssue(banco, { projeto: "site" }, AUDITOR);
  concluir(registrarIssue(banco, { projeto: "site" }, AUDITOR).issue.id);
  const loja = registrarIssue(banco, { projeto: "loja", deps: [1, 2] }, AUDITOR);
  comIssue(banco, loja.issue.id, "registrarEvidencia", FABRIQUINHA, (ag, ctx) => ({
    ...ag,
    evidencias: [
      {
        id: 100,
        ticket: loja.tickets[0]?.id ?? 0,
        tipo: "pr_aberto",
        produtor: "fabriquinha",
        dados: { id: "212", url: "https://github.com/x/loja/pull/212", branch: "b", base: "main" },
        arquivos: [],
        em: ctx.agora,
      },
    ],
  }));
  const {
    issues: [issue],
  } = (await chamar("GET", "/api/projetos/loja/issues")) as { issues: [Record<string, unknown>] };
  assert.deepEqual(issue.bloqueadaPor, [1]);
  assert.deepEqual(issue.pr, { id: "212", url: "https://github.com/x/loja/pull/212" });
  assert.equal(issue.evidencias, undefined);
});

test("projeto que não existe dá 404, e o filtro inválido, 422", async () => {
  for (const [metodo, caminho] of [
    ["GET", "/api/projetos/nao/issues"],
    ["POST", "/api/projetos/nao/arquivar"],
  ] as const) {
    const [status, erro] = (await chamar(metodo, caminho)) as [number, string];
    assert.equal(status, 404);
    assert.match(erro, /o projeto nao não existe/);
  }
  const [status] = (await chamar("GET", "/api/projetos/loja/issues?concluidas=talvez")) as [number];
  assert.equal(status, 422);
});
