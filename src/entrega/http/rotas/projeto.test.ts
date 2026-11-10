// Rotas da página do projeto (F7 §4.2), as demandas, o Arquivar concluídas e o heatmap, chamadas como o servidor as
// chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { Projeto } from "../../../nucleo/projeto.ts";
import { gravarProjeto } from "../../../armazenamento/projetos.ts";
import {
  gravarAgregadoPronto,
  INSTANTE_DO_CENARIO,
  montarAgregadoDemanda,
  montarTicket,
} from "../../../../apoio-testes/cenarios_de_demanda.ts";
import type { MetricasDoMes } from "../../../aplicacao/metricas/metricas_do_periodo.ts";
import { registrarProjeto } from "../../../aplicacao/projeto/cadastro.ts";
import { casar } from "../../cliente-web/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";
import { estadoNaLinhaDoTempo, type ListaDoProjeto } from "./projeto.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

let banco: DatabaseSync;
let raiz: string;
beforeEach(() => {
  ({ banco, raiz } = abrirBancoTemporario());
  for (const nome of ["loja", "site"]) {
    registrarProjeto(banco, {
      nome,
      raiz_git: `/repos/${nome}`,
      branch_base: "main",
      hospedagem: "github",
      chave_sonarqube: nome,
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
  const repo = mkdtempSync(join(raiz, "repo-"));
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=A", "-c", "user.email=a@x", ...args], { cwd: repo, stdio: "pipe" });
  git("init", "-q", "-b", "main");
  writeFileSync(join(repo, "a.ts"), "a");
  git("add", "a.ts");
  git("commit", "-q", "-m", "primeiro");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  registrarProjeto(banco, {
    nome: "git",
    raiz_git: repo,
    branch_base: "main",
    hospedagem: "github",
    chave_sonarqube: "git",
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
  estado: "concluido",
  estado_alterado_em: em,
  criado_por: { tipo: "fabriquinha" },
  ...extra,
});
const rodada = (demanda_id: string, rodada_id: number, estado: string) => ({
  demanda_id,
  rodada_id,
  titulo: `rodada ${String(rodada_id)}`,
  estado,
  estado_alterado_em: "2026-01-01T00:00:00.000Z",
  e2e: false,
  branch: `fabriquinha/${demanda_id}-${String(rodada_id)}`,
});

/**
 * loja: I-203 arquivada, I-204 concluída, I-205 cancelada, I-206 em execução (R1 concluída com o PR 7, R2 em
 * desenvolvimento) e I-207 em planejamento, dependente das três últimas. A etapa `implementar` tem modelo no projeto.
 */
function semearDemandas(): void {
  gravarProjeto(
    banco,
    Projeto.parse({
      nome: "loja",
      branch_base: "main",
      chave_sonarqube: "loja",
      raiz_git: "/repos/loja",
      hospedagem: "github",
      verificacoes: {
        fitness: [{ nome: "f", comando: "true", descricao: "d" }],
        linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
      },
      etapas: [
        { etapa: "implementar", configuracao_agente: { modelo: { provedor: "anthropic", nome: "claude-sonnet-5-5" } } },
      ],
    }),
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-203", "arquivada"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-204", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-205", "cancelada"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-206", "em_execucao", {
      rodadas: [rodada("I-206", 1, "concluida"), rodada("I-206", 2, "implementar")],
      tickets: [
        ticket("I-206", 1, "planejar"),
        ticket("I-206", 2, "implementar", { rodada_id: 1, titulo: "Cache" }),
        ticket("I-206", 3, "encerrar_rodada", { rodada_id: 1 }),
        ticket("I-206", 4, "implementar", {
          rodada_id: 2,
          estado: "em_execucao",
          configuracao_agente: { modelo: { provedor: "llamacpp", nome: "qwen3-coder-30b" } },
        }),
      ],
      evidencias: [
        {
          demanda_id: "I-206",
          ticket_id: 3,
          tipo: "pr_aberto",
          autor: { tipo: "fabriquinha" },
          dados: { id: "7", url: "https://pr/7" },
          em,
        },
      ],
      pull_requests: [
        { rodada_id: 1, numero: 7, url: "https://pr/7", head: "abc", estado: "integrado", atualizado_em: em },
        { rodada_id: 2, numero: 8, url: "https://pr/8", head: "def", estado: "aberto", atualizado_em: em },
      ],
    }),
  );
  banco.exec(
    `INSERT INTO trabalho_agentico VALUES ('s-antiga', 'I-206', 4, 'autonomo', 'c1'), ('s-nova', 'I-206', 4, 'autonomo', 'c2');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha, grupo_processo) VALUES
      ('e-antiga', 's-antiga', '${em}', '${em}', 0, 4241), ('e-nova', 's-nova', '${em}', NULL, 0, 4242)`,
  );
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-207", "planejar"));
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

test("demandas: as rodadas com o PR e os tickets com o modelo efetivo, a sessão mais recente e o pi ativo", async () => {
  semearDemandas();
  const { demandas } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  const i206 = demandas[1];
  assert.ok(i206);
  assert.deepEqual(
    [i206.titulo, i206.tipo, i206.estado, i206.estadoAlteradoEm],
    ["demanda I-206", "funcionalidade", "em_execucao", em],
  );
  assert.deepEqual(i206.rodadas, [
    { ref: "I-206.R1", titulo: "rodada 1", estado: "concluida", pr: { id: "7", url: "https://pr/7" } },
    { ref: "I-206.R2", titulo: "rodada 2", estado: "implementar", pr: { id: "8", url: "https://pr/8" } },
  ]);
  assert.deepEqual(i206.tickets, [
    {
      ref: "I-206.T1",
      etapa: "planejar",
      estado: "concluido",
      terminal: true,
      satisfazDependencia: true,
      estadoAlteradoEm: em,
    },
    {
      ref: "I-206.T2",
      etapa: "implementar",
      estado: "concluido",
      terminal: true,
      satisfazDependencia: true,
      estadoAlteradoEm: em,
      rodada: "I-206.R1",
      titulo: "Cache",
      modelo: "anthropic / claude-sonnet-5-5",
    },
    {
      ref: "I-206.T3",
      etapa: "encerrar_rodada",
      estado: "concluido",
      terminal: true,
      satisfazDependencia: true,
      estadoAlteradoEm: em,
      rodada: "I-206.R1",
    },
    {
      ref: "I-206.T4",
      etapa: "implementar",
      estado: "em_execucao",
      terminal: false,
      satisfazDependencia: false,
      estadoAlteradoEm: em,
      rodada: "I-206.R2",
      modelo: "llamacpp / qwen3-coder-30b",
      sessao: "s-nova",
      piAtivo: true,
    },
  ]);
});

test("demandas: cada uma traz as Pendências que a regra única acha; a encerrada não tem", async () => {
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-210", "gate_planejamento"));
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-211", "em_execucao", {
      rodadas: [rodada("I-211", 1, "ajustar_resultado")],
      tickets: [ticket("I-211", 1, "ajustar_resultado", { rodada_id: 1, estado: "em_execucao" })],
    }),
  );
  gravarAgregadoPronto(
    banco,
    montarAgregadoDemanda("I-212", "cancelada", { tickets: [ticket("I-212", 1, "implementar", { estado: "falhou" })] }),
  );
  const resumo = async (filtro = "") =>
    ((await chamar("GET", `/api/projetos/loja/demandas${filtro}`)) as ListaDoProjeto).demandas.map((d) => [
      d.id,
      d.pendencias.map((p) => [p.tipo, p.item, p.rodada, p.acao_esperada, p.desde]),
    ]);
  assert.deepEqual(await resumo(), [
    ["I-211", [["dialogo_do_agente", "I-211.R1", "I-211.R1", "responder", em]]],
    ["I-210", [["gate_humano", "I-210", undefined, "decidir_gate", INSTANTE_DO_CENARIO]]],
  ]);
  // A cancelada com ticket falho não aguarda ninguém.
  assert.deepEqual((await resumo("?canceladas=true"))[0], ["I-212", []]);
});

test("demandas: usa o padrão do agente se a releitura do projeto não o encontrar", async (contexto) => {
  semearDemandas();
  const prepararConsulta = banco.prepare.bind(banco);
  let leiturasDoProjeto = 0;
  contexto.mock.method(banco, "prepare", (consultaSql: string) => {
    const consulta = prepararConsulta(consultaSql);
    if (
      consultaSql.startsWith(
        "SELECT nome, raiz_git, branch_base, hospedagem, chave_sonarqube, link_produto, imagem_do_ambiente FROM projeto",
      )
    ) {
      leiturasDoProjeto++;
      if (leiturasDoProjeto > 1) contexto.mock.method(consulta, "get", () => undefined);
    }
    return consulta;
  });
  const resposta = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  const demanda = resposta.demandas.find((demanda) => demanda.id === "I-206");
  assert.ok(demanda);
  assert.equal(demanda.tickets.find((ticket) => ticket.ref === "I-206.T2")?.modelo, undefined);
  assert.equal(demanda.tickets.find((ticket) => ticket.ref === "I-206.T4")?.modelo, "llamacpp / qwen3-coder-30b");
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
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-208", "concluida"));
  banco.exec("UPDATE demanda SET projeto = 'site' WHERE id = 'I-208'");
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 1 });
  const { contagem } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  assert.deepEqual(contagem, { andamento: 2, concluidas: 0, arquivadas: 2, canceladas: 1 });
  // O site, sem configuração do SDLC, segue com a concluída dele.
  const site = (await chamar("GET", "/api/projetos/site/demandas?concluidas=true")) as ListaDoProjeto;
  assert.deepEqual(
    site.demandas.map((d) => [d.id, d.estado]),
    [["I-208", "concluida"]],
  );
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 0 });
  const [status] = (await chamar("POST", "/api/projetos/nao/arquivar")) as [number, string];
  assert.equal(status, 404);
});

test("a linha do tempo: o estado em andamento, tudo feito na concluída e na arquivada, e a etapa mais adiantada na cancelada", () => {
  const tickets = [montarTicket("I-1", 1, "implementar", { rodada_id: 1 }), montarTicket("I-1", 2, "planejar")];
  const noEstado = (estado: string, resto: object = {}) => montarAgregadoDemanda("I-1", estado, resto);
  assert.equal(estadoNaLinhaDoTempo(noEstado("gate_planejamento", { tickets })), "gate_planejamento");
  assert.equal(estadoNaLinhaDoTempo(noEstado("concluida", { tickets })), "concluida");
  assert.equal(estadoNaLinhaDoTempo(noEstado("arquivada", { tickets })), "concluida");
  assert.equal(estadoNaLinhaDoTempo(noEstado("cancelada", { tickets })), "em_execucao");
  assert.equal(estadoNaLinhaDoTempo(noEstado("cancelada", { tickets: tickets.slice(1) })), "planejar");
  assert.equal(estadoNaLinhaDoTempo(noEstado("cancelada")), "entender_e_desenhar");
});

test("os cards do mês do projeto vêm de /api/metricas com o mesmo texto do custo, só do projeto", async () => {
  const agoraIso = new Date().toISOString();
  banco.exec(`INSERT INTO demanda VALUES ('I-1', 'loja', 'Título', 'problema', 'd', 'em_execucao', '${agoraIso}', 'f', 's', 1, 'b-I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('I-1', 1, 'planejar', 'concluido', '${agoraIso}');
    INSERT INTO trabalho_agentico VALUES ('s-I-1', 'I-1', 1, 'autonomo', 'conv');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES
      ('x1', 's-I-1', '${agoraIso}', '${agoraIso}', 0), ('x2', 's-I-1', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('x1', 'p', 'm', 10, 1, 0, 0, 4.2), ('x2', 'p', 'm', 3, 1, 0, 0, NULL);`);
  const mes = agoraIso.slice(0, 7);
  const [loja] = (await chamar("GET", `/api/metricas?projeto=loja&de=${mes}&ate=${mes}`)) as MetricasDoMes[];
  const [site] = (await chamar("GET", `/api/metricas?projeto=site&de=${mes}&ate=${mes}`)) as MetricasDoMes[];
  assert.equal(loja?.total.textoDoCusto, "≥ US$ 4,20 (1 sessão sem custo)");
  assert.equal(site?.total.textoDoCusto, "US$ 0,00");
});
