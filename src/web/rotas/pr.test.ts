// Rotas do gate do PR (F7 §4.2): o estado lido com um `gh` falso e a decisão (C16), chamadas como o servidor as
// chama, contra um banco de verdade. O fluxo inteiro, com a worktree e o pi, está em sessoes.test.ts e no e2e; aqui,
// a entrada, o 502 da falha do `gh`, o 409 do estado que não permite a decisão e o que cada decisão devolve.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { abrir } from "../../persistencia/banco.ts";
import { agregado } from "../../persistencia/issues.ts";
import { execucoesEmAndamento } from "../../persistencia/servico.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../rotas.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-pr-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

// gh falso na frente do PATH: imprime $FALSO_GH, ou falha com $FALSO_GH_ERRO no stderr.
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "gh"),
  `#!/bin/sh
if [ -n "$FALSO_GH_ERRO" ]; then echo "$FALSO_GH_ERRO" >&2; exit 1; fi
printf '%s' "$FALSO_GH"
`,
);
chmodSync(join(bin, "gh"), 0o755);
process.env.PATH = `${bin}:${String(process.env.PATH)}`;

const AGORA = "2026-10-11T12:00:00.000Z";
const URL_PR = "https://github.com/dono/loja/pull/7";
const SESSAO = "4d1e2f3a-5b6c-4d7e-8f90-a1b2c3d4e5f6";

function prNoGitHub(state: "OPEN" | "MERGED"): void {
  delete process.env.FALSO_GH_ERRO;
  process.env.FALSO_GH = JSON.stringify({
    state,
    url: URL_PR,
    mergedAt: state === "MERGED" ? "2026-10-11T13:00:00Z" : null,
    mergeCommit: null,
  });
}

let banco: DatabaseSync;

/** I-1 no gate do PR, com o encerramento T-2 concluído e o `pr_aberto`; I-2 em desenvolvimento, sem PR. */
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  const pr = { hospedagem: "github", id: "7", url: URL_PR, branch: "fabriquinha/I-1", base: "main" };
  banco.exec(`
    INSERT INTO projeto (nome, repo, branch_base, hospedagem, testes, sonar_project_key, fitness)
      VALUES ('loja', '${base}', 'main', 'github', '["npm test"]', 'loja', '[{"nome":"f","comando":"true","descricao":"d"}]');
    INSERT INTO issue (id, projeto, titulo, tipo, fase, criada_em) VALUES
      (1, 'loja', 'Busca', 'funcionalidade', 'aprovacao_pr', '${AGORA}'),
      (2, 'loja', 'Outra', 'problema', 'desenvolvimento', '${AGORA}');
    INSERT INTO ticket (id, issue, etapa, titulo, status, origem, criado_em, concluido_em) VALUES
      (1, 1, 'registro', 'Registrar', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}'),
      (2, 1, 'encerramento', 'Publicar o PR', 'concluido', 'fabriquinha', '${AGORA}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('ticket', 2) ON CONFLICT (nome) DO UPDATE SET valor = 2;
    INSERT INTO execucao (id, ticket, modo, sessao_pi, resultado, iniciada_em, terminada_em)
      VALUES (1, 2, 'autonomo', '${SESSAO}', 'sucesso', '${AGORA}', '${AGORA}');
    INSERT INTO sequencia (nome, valor) VALUES ('execucao', 1) ON CONFLICT (nome) DO UPDATE SET valor = 1;
    INSERT INTO evidencia (id, ticket, tipo, produtor, dados, em)
      VALUES (1, 2, 'pr_aberto', 'fabriquinha', '${JSON.stringify(pr)}', '${AGORA}');
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

const fase = () => agregado(banco, 1)?.issue.fase;

test("GET /api/issues/:id/pr: o estado lido agora; a falha do gh dá 502 com a saída, e a issue sem PR, 409", async () => {
  prNoGitHub("OPEN");
  const lido = (await chamar("GET", "/api/issues/1/pr")) as Record<string, unknown>;
  assert.deepEqual({ ...lido, lidoEm: typeof lido.lidoEm }, { estado: "aberto", url: URL_PR, lidoEm: "string" });

  prNoGitHub("MERGED");
  assert.deepEqual(
    { ...((await chamar("GET", "/api/issues/1/pr")) as object), lidoEm: undefined },
    { estado: "mergeado", url: URL_PR, mergeadoEm: "2026-10-11T13:00:00.000Z", lidoEm: undefined },
  );

  process.env.FALSO_GH_ERRO = "HTTP 401: Bad credentials";
  assert.deepEqual(await chamar("GET", "/api/issues/1/pr"), [
    502,
    "gh pr view saiu com código 1: HTTP 401: Bad credentials (confira o acesso do gh à hospedagem e leia o estado do PR de novo)",
  ]);
  assert.deepEqual(await chamar("GET", "/api/issues/2/pr"), [
    409,
    "a I-2 ainda não tem PR (o encerramento publica o PR)",
  ]);
  assert.equal(((await chamar("GET", "/api/issues/99/pr")) as [number])[0], 404);
});

test("POST /api/issues/:id/pr: encerrar pede a nota de 1 a 5 e pedir mudanças, só o motivo (422)", async () => {
  prNoGitHub("MERGED");
  for (const corpo of [
    { aprovado: true },
    { aprovado: true, nota: 6 },
    { aprovado: true, nota: 4, motivo: "x" },
    { aprovado: false },
    { aprovado: false, motivo: "x", nota: 3 },
  ]) {
    assert.equal(((await chamar("POST", "/api/issues/1/pr", corpo)) as [number])[0], 422, JSON.stringify(corpo));
  }
  assert.equal(fase(), "aprovacao_pr");
});

test("POST /api/issues/:id/pr: o estado relido decide; encerrar com o PR aberto e pedir mudanças com ele mergeado dão 409", async () => {
  prNoGitHub("OPEN");
  assert.deepEqual(await chamar("POST", "/api/issues/1/pr", { aprovado: true, nota: 4 }), [
    409,
    "a I-1 não pode ser encerrada: o PR está aberto, não mergeado (faça o merge na plataforma, com merge commit, e encerre de novo)",
  ]);
  prNoGitHub("MERGED");
  assert.deepEqual(await chamar("POST", "/api/issues/1/pr", { aprovado: false, motivo: "falta o índice" }), [
    409,
    "a I-1 não pode pedir mudanças: o PR já foi mergeado (encerre a issue com a nota)",
  ]);
  process.env.FALSO_GH_ERRO = "rede fora";
  assert.equal(((await chamar("POST", "/api/issues/1/pr", { aprovado: true, nota: 4 })) as [number])[0], 502);
  assert.equal(fase(), "aprovacao_pr", "nada foi gravado");
});

test("POST /api/issues/:id/pr: encerrar com o PR mergeado conclui a issue e devolve os avisos da limpeza", async () => {
  prNoGitHub("MERGED");
  const { avisos } = (await chamar("POST", "/api/issues/1/pr", { aprovado: true, nota: 5 })) as { avisos: string[] };
  assert.equal(fase(), "concluida");
  assert.deepEqual(
    agregado(banco, 1)?.decisoes.map((d) => [d.gate, d.aprovado, d.nota]),
    [["pr", true, 5]],
  );
  // O repo do projeto não é um repositório git: a remoção da worktree falha, e o encerramento fica.
  assert.match(String(avisos[0]), /worktree remove --force .* falhou: /);
});

test("POST /api/issues/:id/pr: pedir mudanças com o PR aberto leva ao ajuste do PR e devolve a sessão em aberto", async () => {
  prNoGitHub("OPEN");
  const { sessao } = (await chamar("POST", "/api/issues/1/pr", { aprovado: false, motivo: "falta o índice" })) as {
    sessao: string;
  };
  const ag = agregado(banco, 1);
  assert.equal(ag?.issue.fase, "ajuste_pr");
  assert.equal(ag.execucoes.at(-1)?.sessaoPi, sessao);
  // Sem repositório git, a sessão falha ao preparar a worktree (o fluxo com o pi está no e2e); o teste espera o C6.
  for (let i = 0; execucoesEmAndamento(banco).length > 0; i++) {
    assert.ok(i < 200, "o C6 da sessão em aberto");
    await dormir(25);
  }
});
