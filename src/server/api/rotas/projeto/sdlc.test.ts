// Rotas da configuração SDLC chamadas como o servidor as chama, contra um banco de verdade.
import type { AmbientesDoServico } from "../../rotas.ts";
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { type Projeto } from "../../../../modulos/demandas/publico.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { casar } from "../../../web/compartilhado/caminhos.ts";
import { traduzir } from "../../erros.ts";
import { ROTAS } from "../../servidor.ts";
import { buscarProjeto, gravarProjeto } from "../../../../../apoio-testes/demandas_de_teste.ts";
import { montarDemandasDoBanco } from "../../../composicao/banco_da_fabriquinha.ts";
import { montarRepositorio } from "../../../../modulos/repositorio/publico.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrirBancoTemporario().banco;
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('loja', '/repo/loja', 'main', 'github', 'chave')`);
});

/** O valor devolvido pela rota, ou `[status, mensagem]` do erro traduzido. */
async function chamar(metodo: string, caminho: string, corpo?: unknown): Promise<unknown> {
  for (const rota of ROTAS) {
    const params = rota.metodo === metodo ? casar(rota.caminho, caminho) : undefined;
    if (!params) continue;
    let valor: unknown;
    try {
      valor = await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date() },
        ambientes: undefined as unknown as AmbientesDoServico,
        demandas: montarDemandasDoBanco(banco),
        repositorio: montarRepositorio({ banco: banco }),
        relogio: relogioDoSistema,
        params,
        query: new URLSearchParams(),
        corpo,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
    // CA-3: o corpo 2xx em JSON passa pelo schema do contrato da rota; sem schema, o teste nomeia a rota.
    if (valor !== undefined) {
      assert.ok(rota.resposta, `${rota.metodo} ${rota.caminho} sem schema de resposta em contrato/`);
      rota.resposta.parse(valor);
    }
    return valor;
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
  etapas: [
    { etapa: "planejar", configuracao_agente: { modelo: { provedor: "anthropic", nome: "claude" }, effort: "high" } },
  ],
  verificacoes: {
    preparacao: ["npm ci"],
    fitness: [{ nome: "cobertura", comando: "npm run cobertura", descricao: "Cobertura." }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "npm test" }],
    e2e: [{ caminho_linguagem: ".", comando_build: "npm run build", comando_execucao: "npm run e2e", codigo_falha: 1 }],
    globs: [{ caminho_linguagem: ".", glob: "e2e/**" }],
  },
});

/** Grava e confere que a orientação está no campo certo. */
async function recusa(corpo: unknown, ...trechos: string[]): Promise<void> {
  const [status, texto] = (await chamar("POST", URL, corpo)) as [number, string];
  assert.equal(status, 422);
  for (const t of trechos) assert.ok(texto.includes(t), `${t} em ${texto}`);
  assert.deepEqual(buscarProjeto(banco, "loja")?.verificacoes, {
    preparacao: [],
    fitness: [],
    linguagens: [],
    e2e: [],
    globs: [],
  });
}

test("GET sem configuração devolve o Projeto do banco com verificações vazias", async () => {
  assert.deepEqual(await chamar("GET", URL), {
    configurada: false,
    configuracao: {
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "chave",
      raiz_git: "/repo/loja",
      hospedagem: "github",
      etapas: [],
      verificacoes: { preparacao: [], fitness: [], linguagens: [], e2e: [], globs: [] },
    },
  });
});

test("POST grava com o nome do caminho e o GET devolve o gravado", async () => {
  const resposta = (await chamar("POST", URL, valida())) as { configurada: boolean; configuracao: Projeto };
  assert.equal(resposta.configurada, true);
  assert.equal(resposta.configuracao.nome, "loja");
  assert.deepEqual(await chamar("GET", URL), { configurada: true, configuracao: resposta.configuracao });
});

test("POST mantém etapas e preparação gravadas no cadastro", async () => {
  const cadastrado = {
    ...montarDemandasDoBanco(banco).projeto("loja"),
    etapas: [{ etapa: "implementar" as const, configuracao_agente: { effort: "low" as const } }],
    verificacoes: {
      ...montarDemandasDoBanco(banco).projeto("loja").verificacoes,
      preparacao: ["echo cadastro", "npm ci"],
    },
  };
  gravarProjeto(banco, cadastrado);
  const resposta = await chamar("POST", URL, valida());
  const esperado = {
    ...valida(),
    nome: "loja",
    etapas: cadastrado.etapas,
    verificacoes: { ...valida().verificacoes, preparacao: cadastrado.verificacoes.preparacao },
  };
  assert.deepEqual(resposta, { configurada: true, configuracao: esperado });
  assert.deepEqual(montarDemandasDoBanco(banco).projeto("loja"), esperado);
});

test("GET devolve o cursor da varredura de commits humanos, com ou sem configuração", async () => {
  const cursor = "a".repeat(40);
  banco.prepare("INSERT INTO varredura_base (projeto, ultimo_sha, em) VALUES ('loja', ?, 't')").run(cursor);
  assert.equal(((await chamar("GET", URL)) as { cursor_commit_humano: string }).cursor_commit_humano, cursor);
  await chamar("POST", URL, valida());
  assert.equal(((await chamar("GET", URL)) as { cursor_commit_humano: string }).cursor_commit_humano, cursor);
});

test("404 quando o projeto não existe, na leitura e na gravação", async () => {
  assert.equal(((await chamar("GET", "/api/projetos/x/configuracao-sdlc")) as [number])[0], 404);
  assert.equal(((await chamar("POST", "/api/projetos/x/configuracao-sdlc", valida())) as [number])[0], 404);
});

test("422 com a orientação no campo, sem gravar", async () => {
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", configuracao_agente: { effort: "ultra" } }] },
    "etapas[0].configuracao_agente.effort",
    "use um valor do domínio: off, minimal",
  );
  await recusa({ ...valida(), hospedagem: "svn" }, "hospedagem", "preencha este campo");
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", configuracao_agente: { modelo: { provedor: "anthropic" } } }] },
    "etapas[0].configuracao_agente.modelo.nome",
    "informe provedor e nome do modelo juntos ou nenhum",
  );
  await recusa(
    { ...valida(), etapas: [{ etapa: "planejar", configuracao_agente: { modelo: { provedor: "a", nome: "" } } }] },
    "etapas[0].configuracao_agente.modelo.nome",
    "preencha este campo",
  );
  await recusa(
    {
      ...valida(),
      verificacoes: { ...valida().verificacoes, e2e: [{ ...valida().verificacoes.e2e[0], codigo_falha: 0 }] },
    },
    "verificacoes.e2e[0].codigo_falha",
    "use um valor de 1 a 255",
  );
  await recusa({ ...valida(), verificacoes: { ...valida().verificacoes, globs: [] } }, "E2E exige ao menos um glob");
  await recusa(
    {
      ...valida(),
      verificacoes: { ...valida().verificacoes, preparacao: [" "] },
    },
    "verificacoes.preparacao[0]",
    "preencha este campo",
  );
  await recusa(
    { ...valida(), verificacoes: { ...valida().verificacoes, fitness: [] } },
    "verificacoes.fitness",
    "informe ao menos uma linha",
  );
  await recusa(
    { ...valida(), verificacoes: { ...valida().verificacoes, linguagens: [], e2e: [], globs: [] } },
    "verificacoes.linguagens",
    "informe ao menos uma linha",
  );
  await recusa({ ...valida(), branch_base: undefined }, "branch_base", "preencha este campo");
});

test("422 quando a raiz_git é relativa", async () => {
  const [status, mensagem] = (await chamar("POST", URL, { ...valida(), raiz_git: "repo/loja" })) as [number, string];
  assert.equal(status, 422);
  assert.match(mensagem, /caminho absoluto\n {2}→ at raiz_git/);
  assert.equal(buscarProjeto(banco, "loja")?.raiz_git, "/repo/loja");
});
