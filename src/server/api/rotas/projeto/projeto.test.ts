// Rotas da página do projeto (F7 §4.2), as demandas, o Arquivar concluídas e o heatmap, chamadas como o servidor as
// chama, contra um banco de verdade.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import {
  gravarAgregadoPronto,
  montarAgregadoDemanda,
} from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import type { MetricasDoMes } from "../../../../modulos/ciclo_de_vida/publico.ts";
import { registrarProjeto } from "../../../../modulos/demandas/publico.ts";
import { casar } from "../../../web/compartilhado/caminhos.ts";
import { traduzir } from "../../erros.ts";
import { ROTAS } from "../../servidor.ts";
import type { ListaDoProjeto } from "../../../contrato/projeto.ts";

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
    let valor: unknown;
    try {
      valor = await rota.tratar({
        banco,
        agendador: { proximaBusca: () => new Date() },
        relogio: relogioDoSistema,
        params,
        query: url.searchParams,
        corpo: undefined,
        cabecalhos: {},
        resposta: undefined as unknown as ServerResponse,
      });
    } catch (erro) {
      return traduzir(erro);
    }
    // CA-3: o corpo 2xx em JSON passa pelo schema do contrato da rota; sem schema, o teste nomeia a rota.
    assert.ok(rota.resposta, `${rota.metodo} ${rota.caminho} sem schema de resposta em contrato/`);
    rota.resposta.parse(valor);
    return valor;
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

test("demandas: o filtro da query chega à consulta e o projeto inexistente dá 404", async () => {
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-204", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-206", "em_execucao"));
  const ids = async (query: string) =>
    ((await chamar("GET", `/api/projetos/loja/demandas${query}`)) as ListaDoProjeto).demandas.map((d) => d.id);
  assert.deepEqual(await ids(""), ["I-206"]);
  assert.deepEqual(await ids("?concluidas=true"), ["I-206", "I-204"]);
  const [status, erro] = (await chamar("GET", "/api/projetos/nao/demandas")) as [number, string];
  assert.equal(status, 404);
  assert.match(erro, /o projeto nao não existe/);
});

test("Arquivar concluídas: arquiva as concluídas do projeto e só elas", async () => {
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-203", "arquivada"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-204", "concluida"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-205", "cancelada"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-206", "em_execucao"));
  gravarAgregadoPronto(banco, montarAgregadoDemanda("I-208", "concluida"));
  banco.exec("UPDATE demanda SET projeto = 'site' WHERE id = 'I-208'");
  assert.deepEqual(await chamar("POST", "/api/projetos/loja/arquivar"), { arquivadas: 1 });
  const { contagem } = (await chamar("GET", "/api/projetos/loja/demandas")) as ListaDoProjeto;
  assert.deepEqual(contagem, { andamento: 1, concluidas: 0, arquivadas: 2, canceladas: 1 });
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

test("os cards do mês do projeto vêm de /api/metricas com o mesmo texto do custo, só do projeto", async () => {
  const agoraIso = new Date().toISOString();
  banco.exec(`INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'loja', 'Título', 'problema', 'd', 'em_execucao', '${agoraIso}', 'f', 's', 1, 'b-I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
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
