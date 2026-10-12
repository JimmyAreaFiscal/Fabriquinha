// Rota do Início (F7 §4.2) chamada como o servidor a chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { AUDITOR } from "../../dominio/agregado.ts";
import { abrir } from "../../persistencia/banco.ts";
import { comIssue, registrarIssue } from "../../persistencia/issues.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../rotas.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-inicio-"));
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

test("board: as issues não concluídas de todos os projetos, da mais nova para a mais antiga, com os tickets", async () => {
  assert.deepEqual(await chamar("GET", "/api/board"), []);
  const loja = registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  const concluida = registrarIssue(banco, { projeto: "loja" }, AUDITOR);
  comIssue(banco, concluida.issue.id, "editarIssue", AUDITOR, (ag, ctx) => ({
    ...ag,
    issue: { ...ag.issue, titulo: "T", tipo: "problema", fase: "concluida", concluidaEm: ctx.agora },
  }));
  const site = registrarIssue(banco, { projeto: "site", deps: [1] }, AUDITOR);
  assert.deepEqual(await chamar("GET", "/api/board"), [
    { ...site.issue, tickets: site.tickets },
    { ...loja.issue, tickets: loja.tickets },
  ]);
});
