// Rotas da configuração SDLC chamadas como o servidor as chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { configuracaoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-sdlc-"));
after(() => {
  rmSync(base, { recursive: true, force: true });
});

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrir(mkdtempSync(join(base, "raiz-")));
  banco.exec(`INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
    VALUES ('loja', '/repo/loja', 'main', 'github', 'chave')`);
});

/** O valor devolvido pela rota, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, caminho) : undefined;
    if (!params) continue;
    try {
      return await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date() },
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

const URL = "/api/projetos/loja/configuracao-sdlc";
const valida = () => ({
  nome: "outro",
  branch_base: "develop",
  chave_sonarqube: "chave",
  raiz_git: "/repo/loja",
  hospedagem: "github",
  etapas: [{ etapa: "planejar", modelo_provedor: "anthropic", modelo_nome: "claude", effort: "high" }],
  preparacao: [{ ordem: 1, comando: "npm ci" }],
  fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura." }],
  linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
  e2e: [{ caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 }],
  globs: [{ caminho_linguagem: ".", glob: "e2e/**" }],
});

/** Grava e confere que a orientação está no campo certo. */
async function recusa(corpo: unknown, ...trechos: string[]): Promise<void> {
  const [status, texto] = (await chamar("POST", URL, corpo)) as [number, string];
  assert.equal(status, 422);
  for (const t of trechos) assert.ok(texto.includes(t), `${t} em ${texto}`);
  assert.equal(configuracaoProjeto(banco, "loja"), undefined);
}

test("GET sem configuração devolve o rascunho do cadastro legado com listas vazias", async () => {
  assert.deepEqual(await chamar("GET", URL), {
    configurada: false,
    configuracao: {
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "chave",
      raiz_git: "/repo/loja",
      hospedagem: "github",
      etapas: [],
      preparacao: [],
      fitness: [],
      linguagens: [],
      e2e: [],
      globs: [],
    },
  });
});

test("POST grava com o nome do caminho e o GET devolve o gravado", async () => {
  const resposta = (await chamar("POST", URL, valida())) as { configurada: boolean; configuracao: { nome: string } };
  assert.equal(resposta.configurada, true);
  assert.equal(resposta.configuracao.nome, "loja");
  assert.deepEqual(await chamar("GET", URL), resposta);
});

test("404 quando o projeto não existe, na leitura e na gravação", async () => {
  assert.equal(((await chamar("GET", "/api/projetos/x/configuracao-sdlc")) as [number])[0], 404);
  assert.equal(((await chamar("POST", "/api/projetos/x/configuracao-sdlc", valida())) as [number])[0], 404);
});

test("422 com a orientação no campo, sem gravar", async () => {
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", effort: "ultra" }] },
    "etapas[0].effort",
    "use um valor do domínio: off, minimal",
  );
  await recusa({ ...valida(), hospedagem: "svn" }, "hospedagem", "preencha este campo");
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", modelo_provedor: "anthropic" }] },
    "etapas[0].modelo_nome",
    "informe provedor e nome do modelo juntos ou nenhum",
  );
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", modelo_provedor: "a", modelo_nome: "" }] },
    "etapas[0].modelo_nome",
    "preencha este campo",
  );
  await recusa(
    { ...valida(), e2e: [{ ...valida().e2e[0], codigo_falha: 0 }] },
    "e2e[0].codigo_falha",
    "use um valor de 1 a 255",
  );
  await recusa({ ...valida(), globs: [] }, "E2E exige ao menos um glob");
  await recusa(
    {
      ...valida(),
      preparacao: [
        { ordem: 1, comando: "a" },
        { ordem: 1, comando: "b" },
      ],
    },
    "preparacao",
    "ordem repetida",
  );
  await recusa({ ...valida(), fitness: [] }, "fitness", "informe ao menos uma linha");
  await recusa({ ...valida(), branch_base: undefined }, "branch_base", "preencha este campo");
});

test("409 quando a raiz_git é relativa", async () => {
  const [status] = (await chamar("POST", URL, { ...valida(), raiz_git: "repo/loja" })) as [number];
  assert.equal(status, 409);
  assert.equal(configuracaoProjeto(banco, "loja"), undefined);
});
