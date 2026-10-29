// Rotas da página do projeto (F7 §4.2), as demandas, o Arquivar concluídas e o heatmap, chamadas como o servidor as
// chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrir } from "../../persistencia/banco.ts";
import { gravarConfiguracaoProjeto, substituirEtapasDoProjeto } from "../../persistencia/configuracao_projeto.ts";
import { criarDemanda } from "../../persistencia/demandas.ts";
import { registrarProjeto } from "../../persistencia/projetos.ts";
import { casar } from "../cliente/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";
import type { ListaDoProjeto } from "./projeto.ts";
import { demanda } from "./demandas_cenario.test.ts";

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

const em = "2026-01-01T00:00:00.000Z";
const ticket = (demanda_id: string, ticket_id: number, etapa: string, extra: object = {}) => ({
  demanda_id,
  ticket_id,
  etapa,
  status: "concluido",
  status_alterado_em: em,
  devolucoes: 0,
  ...extra,
});
const rodada = (demanda_id: string, rodada_id: number, fase: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  fase,
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/**
 * loja: I-203 arquivada, I-204 concluída, I-205 cancelada, I-206 em execução (R1 concluída com o PR 7, R2 em
 * desenvolvimento) e I-207 em planejamento, dependente das três últimas. A etapa `implementar` tem modelo no projeto.
 */
function semearDemandas(): void {
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: "/repos/loja",
    hospedagem: "github",
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  substituirEtapasDoProjeto(banco, "loja", [
    { etapa: "implementar", modelo_provedor: "anthropic", modelo_nome: "claude-sonnet-5-5" },
  ]);
  criarDemanda(banco, demanda("I-203", "arquivada"));
  criarDemanda(banco, demanda("I-204", "concluida"));
  criarDemanda(banco, demanda("I-205", "cancelada"));
  criarDemanda(
    banco,
    demanda("I-206", "execucao", {
      rodadas: [rodada("I-206", 1, "concluida"), rodada("I-206", 2, "desenvolvimento")],
      tickets: [
        ticket("I-206", 1, "planejar"),
        ticket("I-206", 2, "implementar", { rodada_id: 1, titulo: "Cache" }),
        ticket("I-206", 3, "encerrar_rodada", { rodada_id: 1 }),
        ticket("I-206", 4, "implementar", {
          rodada_id: 2,
          status: "em_execucao",
          modelo_provedor: "llamacpp",
          modelo_nome: "qwen3-coder-30b",
        }),
      ],
      evidencias: [
        { demanda_id: "I-206", ticket_id: 3, tipo: "pr_aberto", dados: { id: "7", url: "https://pr/7" }, em },
      ],
    }),
  );
  banco.exec(
    "INSERT INTO sessao VALUES ('s-antiga', 'I-206', 4, 'autonomo', 'c1'), ('s-nova', 'I-206', 4, 'autonomo', 'c2')",
  );
  criarDemanda(banco, demanda("I-207", "planejamento"));
  banco.exec(`INSERT INTO dependencia_demanda (demanda_id, depende_demanda_id)
    VALUES ('I-207', 'I-206'), ('I-207', 'I-205'), ('I-207', 'I-204')`);
}

test("demandas: só as em andamento, das mais novas às mais antigas, com a contagem de todas", async () => {
  semearDemandas();
  const { demandas, contagem } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  assert.deepEqual(
    demandas.map((d) => d.id),
    ["I-207", "I-206"],
  );
  assert.deepEqual(contagem, { andamento: 2, concluidas: 1, arquivadas: 1, canceladas: 1 });
  // Só a I-206 bloqueia: a concluída já satisfaz, e a cancelada cancelou a dependente junto.
  assert.deepEqual(demandas[0]?.bloqueadaPor, ["I-206"]);
  const vazio = (await chamar("GET", "/api/projetos/site/demandas")) as ListaDoProjeto;
  assert.deepEqual(vazio, { demandas: [], contagem: { andamento: 0, concluidas: 0, arquivadas: 0, canceladas: 0 } });
});

test("demandas: as rodadas com o PR e os tickets com o modelo efetivo e a sessão mais recente", async () => {
  semearDemandas();
  const { demandas } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  const i206 = demandas[1];
  assert.ok(i206);
  assert.deepEqual(
    [i206.titulo, i206.tipo, i206.fase, i206.faseAlteradaEm],
    ["demanda I-206", "funcionalidade", "execucao", em],
  );
  assert.deepEqual(i206.rodadas, [
    { ref: "I-206.R1", titulo: "rodada 1", fase: "concluida", pr: { id: "7", url: "https://pr/7" } },
    { ref: "I-206.R2", titulo: "rodada 2", fase: "desenvolvimento" },
  ]);
  assert.deepEqual(i206.tickets, [
    { ref: "I-206.T1", etapa: "planejar", status: "concluido", statusAlteradoEm: em },
    {
      ref: "I-206.T2",
      etapa: "implementar",
      status: "concluido",
      statusAlteradoEm: em,
      rodada: "I-206.R1",
      titulo: "Cache",
      modelo: "anthropic / claude-sonnet-5-5",
    },
    {
      ref: "I-206.T3",
      etapa: "encerrar_rodada",
      status: "concluido",
      statusAlteradoEm: em,
      rodada: "I-206.R1",
    },
    {
      ref: "I-206.T4",
      etapa: "implementar",
      status: "em_execucao",
      statusAlteradoEm: em,
      rodada: "I-206.R2",
      modelo: "llamacpp / qwen3-coder-30b",
      sessao: "s-nova",
    },
  ]);
});

test("demandas: os filtros trazem as concluídas, as arquivadas e as canceladas", async () => {
  semearDemandas();
  const ids = async (filtro: string) =>
    ((await chamar("GET", `/api/projetos/loja/demandas?${filtro}`)) as ListaDoProjeto).demandas.map((d) => d.id);
  assert.deepEqual(await ids("concluidas=true"), ["I-207", "I-206", "I-204"]);
  assert.deepEqual(await ids("arquivadas=true&concluidas=false"), ["I-207", "I-206", "I-203"]);
  assert.deepEqual(await ids("canceladas=true"), ["I-207", "I-206", "I-205"]);
  const [status, erro] = (await chamar("GET", "/api/projetos/nao/demandas")) as [number, string];
  assert.equal(status, 404);
  assert.match(erro, /o projeto nao não existe/);
});

test("Arquivar concluídas: arquiva as concluídas do projeto e só elas", async () => {
  semearDemandas();
  criarDemanda(banco, demanda("I-208", "concluida"));
  banco.exec("UPDATE demanda SET projeto = 'site' WHERE id = 'I-208'");
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 1 });
  const { contagem } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  assert.deepEqual(contagem, { andamento: 2, concluidas: 0, arquivadas: 2, canceladas: 1 });
  // O site, sem configuração do SDLC, segue com a concluída dele.
  const site = (await chamar("GET", "/api/projetos/site/demandas?concluidas=true")) as ListaDoProjeto;
  assert.deepEqual(
    site.demandas.map((d) => [d.id, d.fase]),
    [["I-208", "concluida"]],
  );
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 0 });
  const [status] = (await chamar("POST", "/api/projetos/nao/arquivar")) as [number, string];
  assert.equal(status, 404);
});
