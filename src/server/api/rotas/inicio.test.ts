// Rotas do Início: o painel das demandas em andamento e as recusas do Despacho, com o corpo conferido pelo contrato.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import { cenarioDoInicio } from "../../../../apoio-testes/cenario_do_inicio.ts";
import { servir } from "../../../../apoio-testes/servidor_web_de_teste.ts";
import { cicloDoDespacho, configuracao, despachoDasEtapas } from "../../../modulos/ciclo_de_vida/publico.ts";
import { RecusasDoDespacho } from "../../contrato/despacho.ts";
import type { DadosDoInicio } from "../../contrato/inicio.ts";
import { ROTAS_DO_INICIO } from "./inicio.ts";
import { predecessorasPendentesPelasDependencias } from "../../fluxos/ciclo_do_servico/despacho_do_trabalho.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

function cenario() {
  const { banco } = abrirBancoTemporario();
  cenarioDoInicio(banco);
  return banco;
}

test("cada rota do Início declara o schema da resposta, e o corpo 200 o cumpre", async () => {
  const { pedir } = await servir(cenario());
  for (const rota of ROTAS_DO_INICIO) {
    assert.ok(rota.resposta, `${rota.metodo} ${rota.caminho} não declara o schema da resposta`);
    rota.resposta.parse((await pedir(rota.caminho)).json());
  }
});

test("GET /api/inicio responde com o mês corrente de todos os projetos", async () => {
  const { pedir } = await servir(cenario());
  const r = await pedir("/api/inicio");
  assert.equal(r.status, 200);
  const dados = r.json<DadosDoInicio>();
  const agora = new Date();
  assert.equal(dados.mes.mes, `${String(agora.getFullYear())}-${String(agora.getMonth() + 1).padStart(2, "0")}`);
  assert.equal(dados.mes.projeto, null);
  assert.equal(dados.aguarda.length, 10);
  assert.equal((await pedir("/api/inicio", { cookie: false })).status, 401);
});

test("GET /api/despacho devolve as recusas do último ciclo, com os endereços em texto", async () => {
  const banco = cenario();
  const { pedir } = await servir(banco);
  assert.deepEqual(RecusasDoDespacho.parse((await pedir("/api/despacho")).json()), { recusas: [] });
  await Promise.all(
    cicloDoDespacho(banco, configuracao(banco), despachoDasEtapas(), predecessorasPendentesPelasDependencias(banco)),
  );
  const { recusas } = RecusasDoDespacho.parse((await pedir("/api/despacho")).json());
  assert.deepEqual(
    recusas.find((r) => r.item === "I-303.T4"),
    { item: "I-303.T4", motivo: { tipo: "ocupado", por: "I-303.T5" } },
  );
  assert.equal((await pedir("/api/despacho", { cookie: false })).status, 401);
});

test("GET /api/inicio: o custo do mês sai no texto do Uso somado, com ≥ e o aviso quando uma sessão não trouxe custo", async () => {
  const banco = cenario();
  const agoraIso = new Date().toISOString();
  banco.exec(`
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES
      ('xu1', 's-conversa', '${agoraIso}', '${agoraIso}', 0),
      ('xu2', 's-ajustes', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('xu1', 'p', 'm', 10, 1, 0, 0, 4.2), ('xu2', 'p', 'm', 5, 1, 0, 0, NULL);`);
  const { pedir } = await servir(banco);
  const { mes } = (await pedir("/api/inicio")).json<DadosDoInicio>();
  assert.equal(mes.total.textoDoCusto, "≥ US$ 4,20 (1 sessão sem custo)");
  assert.equal(mes.total.modelos[0]?.tokens_entrada, 15);
});

test("GET /api/inicio: o Uso declarado soma ao medido do mês, e a sessão declarada sem custo traz o ≥", async () => {
  const banco = cenario();
  const agoraIso = new Date().toISOString();
  banco.exec(`
    UPDATE processo_demanda SET estado_alterado_em = '${agoraIso}' WHERE demanda_id = 'I-300';
    INSERT INTO processo_do_trabalho (id, trabalho_id, inicio, fim, falha) VALUES ('xu1', 's-conversa', '${agoraIso}', '${agoraIso}', 0);
    INSERT INTO uso_modelo_execucao VALUES ('xu1', 'p', 'm', 10, 1, 0, 0, 4.2);`);
  const declarar = (sessao: string, custo: string) => {
    banco.exec(`INSERT INTO uso_declarado VALUES ('claude', '${sessao}', 'I-300', json_array(json_object(
      'modelo', 'p/m', 'tokens_entrada', 5, 'tokens_saida', 1, 'tokens_cache_leitura', 0, 'tokens_cache_escrita', 0,
      'custo', ${custo}, 'chamadas', 0)))`);
  };
  declarar("d1", "1.8");
  const { pedir } = await servir(banco);
  const comCusto = (await pedir("/api/inicio")).json<DadosDoInicio>().mes.total;
  assert.equal(comCusto.textoDoCusto, "US$ 6,00");
  assert.equal(comCusto.modelos[0]?.tokens_entrada, 15);
  declarar("d2", "NULL");
  const totalComSessaoSemCusto = (await pedir("/api/inicio")).json<DadosDoInicio>().mes.total;
  assert.equal(totalComSessaoSemCusto.textoDoCusto, "≥ US$ 6,00 (1 sessão sem custo)");
});
