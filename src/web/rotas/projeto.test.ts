// Rota da página do projeto (F7 §4.2), o heatmap, chamada como o servidor a chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";

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
      sonar: { projectKey: nome },
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
        agendador: { proximaBusca: () => new Date() },
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

test("heatmap: projeto inexistente dá 404, repositório inexistente dá 409 com motivo e correção", async () => {
  const [status, erro] = (await chamar("GET", "/api/projetos/nao/heatmap")) as [number, string];
  assert.equal(status, 404);
  assert.match(erro, /o projeto nao não existe/);
  const [status409, erro409] = (await chamar("GET", "/api/projetos/loja/heatmap")) as [number, string];
  assert.equal(status409, 409);
  assert.match(erro409, /\/repos\/loja não existe mais no disco.*corrija o caminho/s);
});

test("heatmap: projeto com repositório git devolve branch, janela, árvore e commits", async () => {
  const repo = mkdtempSync(join(base, "repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@x", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "a");
  git("add", "a.ts");
  git("commit", "-q", "-m", "primeiro");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  registrarProjeto(banco, {
    nome: "git",
    repo,
    branchBase: "main",
    hospedagem: "github",
    sonar: { projectKey: "git" },
  });
  const mapa = (await chamar("GET", "/api/projetos/git/heatmap")) as {
    branch: string;
    desde: string;
    ate: string;
    raiz: { alteracoes: number; filhos: { nome: string; alteracoes: number }[] };
    commits: Record<string, { mensagem: string; pr: string | null }>;
  };
  assert.equal(mapa.branch, "main");
  assert.ok(mapa.desde < mapa.ate);
  assert.equal(mapa.raiz.alteracoes, 1);
  assert.deepEqual(
    mapa.raiz.filhos.map((f) => f.nome),
    ["a.ts"],
  );
  assert.deepEqual(
    Object.values(mapa.commits).map((c) => [c.mensagem, c.pr]),
    [["primeiro", null]],
  );
});
