// Rotas das métricas (F7 §4.2) chamadas como o servidor as chama, contra um banco de verdade.
import assert from "node:assert/strict";
import type { ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import type { MetricasDoMes, MetricasPorDemanda } from "../../../modulos/ciclo_de_vida/publico.ts";
import { registrarProjeto } from "../../../modulos/demandas/publico.ts";
import { relogioDoSistema } from "../../../modulos/compartilhado/nucleo/relogio.ts";
import { casar } from "../../web/compartilhado/caminhos.ts";
import { traduzir } from "../erros.ts";
import { ROTAS } from "../servidor.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

let banco: DatabaseSync;
beforeEach(() => {
  banco = abrirBancoTemporario().banco;
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
async function chamar(endereco: string): Promise<unknown> {
  const url = new URL(endereco, "http://x");
  for (const rota of ROTAS) {
    const params = rota.metodo === "GET" ? casar(rota.caminho, url.pathname) : undefined;
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
    assert.ok(rota.resposta, `GET ${rota.caminho} não declara o schema da resposta`);
    rota.resposta.parse(JSON.parse(JSON.stringify(valor)));
    return valor;
  }
  throw new Error(`GET ${endereco} não existe`);
}

/** Uma demanda do projeto, registrada agora, com um ticket, uma sessão e uma execução de US$ 2 que acabou de começar. */
function demandaComExecucao(id: string, projeto: string, tipo = "problema"): void {
  const agoraIso = new Date().toISOString();
  banco.exec(`INSERT INTO demanda VALUES ('${id}', '${projeto}', 'Título', '${tipo}', 'd', 'em_execucao', '${agoraIso}', 'f', 's', 1, 'b-${id}');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em) VALUES ('${id}', 1, 'planejar', 'concluido', '${agoraIso}');
    INSERT INTO trabalho_agentico VALUES ('s-${id}', '${id}', 1, 'autonomo', 'conv');
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('x-${id}', 's-${id}', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('x-${id}', 'p', 'm', 10, 1, 0, 0, 2);`);
}

const agora = new Date();
const mes = (n: number) => {
  const d = new Date(agora.getFullYear(), agora.getMonth() + n, 1);
  return `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

test("GET /api/metricas: padrão nos 11 meses anteriores mais o corrente, de todos os projetos", async () => {
  demandaComExecucao("I-1", "loja");
  demandaComExecucao("I-2", "site");
  const meses = (await chamar("/api/metricas")) as MetricasDoMes[];
  assert.deepEqual(
    meses.map((m) => m.mes),
    Array.from({ length: 12 }, (_, i) => mes(i - 11)),
  );
  assert.equal(meses.at(-1)?.projeto, null);
  assert.equal(meses.at(-1)?.demandas.registradas, 2);
  assert.deepEqual(meses.at(-1)?.total.custo, { conhecido: 4, trabalhosSemCusto: 0 });
  assert.equal(meses.at(-1)?.total.textoDoCusto, "US$ 4,00");
});

test("GET /api/metricas e /api/metricas/demandas: o mesmo texto do custo, com ≥ e o aviso quando uma sessão não trouxe custo", async () => {
  demandaComExecucao("I-1", "loja");
  const agoraIso = new Date().toISOString();
  banco.exec(`INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('y-I-1', 's-I-1', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('y-I-1', 'p', 'm', 3, 1, 0, 0, NULL);`);
  const texto = "≥ US$ 2,00 (1 sessão sem custo)";
  const [mesAtual] = (await chamar(`/api/metricas?de=${mes(0)}&ate=${mes(0)}`)) as [MetricasDoMes];
  assert.equal(mesAtual.total.textoDoCusto, texto);
  assert.deepEqual(mesAtual.total.modelos, [
    {
      modelo: "p/m",
      tokens_entrada: 13,
      tokens_saida: 2,
      tokens_cache_leitura: 0,
      tokens_cache_escrita: 0,
      custo: 2,
      chamadas: 0,
    },
  ]);
  assert.deepEqual(
    mesAtual.niveis.map((n) => n.total.textoDoCusto),
    mesAtual.niveis.map(() => texto),
  );
  const { demandas, total } = (await chamar("/api/metricas/demandas")) as MetricasPorDemanda;
  assert.equal(demandas[0]?.textoDoCusto, texto);
  assert.equal(total.textoDoCusto, texto);
});

test("GET /api/metricas: cada mês traz as nove Etapas, cada uma com as Métricas que o catálogo declara para ela", async () => {
  demandaComExecucao("I-1", "loja");
  const [doMes] = (await chamar(`/api/metricas?de=${mes(0)}&ate=${mes(0)}`)) as [MetricasDoMes];
  assert.deepEqual(
    doMes.etapas.map((e) => [e.etapa, e.metricas.map((m) => m.definicao.tipo)]),
    [
      ["entender_e_desenhar", ["uso", "aprovacoes_e_reprovacoes"]],
      ["planejar", ["uso", "conformidade_com_o_plano"]],
      ["implementar", ["uso", "alteracoes_posteriores"]],
      ["revisar_rodada", ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"]],
      ["encerrar_rodada", ["uso", "nota_humana"]],
      ["ajustar_resultado", ["uso"]],
      ["revisar_demanda", ["uso", "exigencias_de_alteracao", "bugs_nos_arquivos_revisados"]],
      ["encerrar_demanda", ["uso"]],
      ["resolver_conflito", ["uso"]],
    ],
  );
  const uso = doMes.etapas.find((e) => e.etapa === "planejar")?.metricas[0];
  assert.ok(uso);
  assert.deepEqual(uso.definicao, { tipo: "uso", rotulo: "Uso", fonte: "Uso" });
  assert.equal((uso.valor as { textoDoCusto: string }).textoDoCusto, "US$ 2,00");
});

test("GET /api/metricas: de um projeto, de `de` a `ate`; só `ate` leva `de` 11 meses antes", async () => {
  demandaComExecucao("I-1", "loja");
  const [so] = (await chamar(`/api/metricas?projeto=site&de=${mes(0)}&ate=${mes(0)}`)) as MetricasDoMes[];
  assert.equal(so?.projeto, "site");
  assert.equal(so.demandas.registradas, 0);
  const meses = (await chamar("/api/metricas?ate=2026-03")) as MetricasDoMes[];
  assert.deepEqual([meses[0]?.mes, meses.at(-1)?.mes, meses.length], ["2025-04", "2026-03", 12]);
});

test("GET /api/metricas: 422 para mês inválido, `de` depois de `ate` ou mais de 24 meses", async () => {
  for (const query of ["ate=2026-13", "de=2026-05&ate=2026-04", "de=2024-03&ate=2026-03", "projeto=Loja"]) {
    const [status] = (await chamar(`/api/metricas?${query}`)) as [number, string];
    assert.equal(status, 422, query);
  }
  const [, mensagem] = (await chamar("/api/metricas?de=2024-03&ate=2026-03")) as [number, string];
  assert.match(mensagem, /no máximo 24 meses/);
  assert.equal(((await chamar("/api/metricas?de=2024-04&ate=2026-03")) as unknown[]).length, 24);
  const [status] = (await chamar("/api/metricas/demandas?ate=2026-13")) as [number, string];
  assert.equal(status, 422);
});

test("GET /api/metricas/demandas: as demandas com execução no período", async () => {
  assert.deepEqual(((await chamar("/api/metricas/demandas")) as MetricasPorDemanda).demandas, []);
  demandaComExecucao("I-1", "loja");
  demandaComExecucao("I-2", "site");
  const { demandas: todas } = (await chamar("/api/metricas/demandas")) as MetricasPorDemanda;
  assert.deepEqual(
    todas.map((d) => d.demanda),
    ["I-1", "I-2"],
  );
  const { demandas: site } = (await chamar(
    `/api/metricas/demandas?projeto=site&de=${mes(0)}&ate=${mes(0)}`,
  )) as MetricasPorDemanda;
  assert.deepEqual(
    site.map((d) => [d.demanda, d.custo.conhecido]),
    [["I-2", 2]],
  );
});

test("GET /api/metricas/demandas: o corpo inteiro de demandas de tipos distintos", async () => {
  demandaComExecucao("I-1", "loja", "problema");
  demandaComExecucao("I-2", "site", "funcionalidade");
  const corpo = await chamar("/api/metricas/demandas");
  const execucaoDeUmaDemanda = {
    execucoes: 1,
    falhas: 0,
    duracaoMs: 0,
    tokens: { entrada: 10, saida: 1, cacheLeitura: 0, cacheEscrita: 0, total: 11 },
    custo: { conhecido: 2, trabalhosSemCusto: 0 },
    textoDoCusto: "US$ 2,00",
  };
  assert.deepEqual(corpo, {
    total: {
      ...execucaoDeUmaDemanda,
      execucoes: 2,
      tokens: { entrada: 20, saida: 2, cacheLeitura: 0, cacheEscrita: 0, total: 22 },
      custo: { conhecido: 4, trabalhosSemCusto: 0 },
      textoDoCusto: "US$ 4,00",
      conformidade: null,
      nota: null,
    },
    demandas: [
      {
        demanda: "I-1",
        projeto: "loja",
        titulo: "Título",
        estado: "em_execucao",
        reprovacoes: 0,
        conformidade: null,
        nota: null,
        ...execucaoDeUmaDemanda,
      },
      {
        demanda: "I-2",
        projeto: "site",
        titulo: "Título",
        estado: "em_execucao",
        reprovacoes: 0,
        conformidade: null,
        nota: null,
        ...execucaoDeUmaDemanda,
      },
    ],
  });
});

test("GET /api/metricas e /api/metricas/demandas: o Uso declarado soma ao medido, com o mesmo texto do custo", async () => {
  demandaComExecucao("I-1", "loja");
  banco.exec(`INSERT INTO uso_declarado VALUES ('claude', 's1', 'I-1', json_array(json_object(
    'modelo', 'p/m', 'tokens_entrada', 3, 'tokens_saida', 1, 'tokens_cache_leitura', 0, 'tokens_cache_escrita', 0,
    'custo', NULL, 'chamadas', 0)))`);
  const texto = "≥ US$ 2,00 (1 sessão sem custo)";
  const [mesAtual] = (await chamar(`/api/metricas?de=${mes(0)}&ate=${mes(0)}`)) as [MetricasDoMes];
  assert.equal(mesAtual.total.textoDoCusto, texto);
  const { demandas, total } = (await chamar("/api/metricas/demandas")) as MetricasPorDemanda;
  assert.equal(demandas[0]?.textoDoCusto, texto);
  assert.equal(total.textoDoCusto, texto);
});
