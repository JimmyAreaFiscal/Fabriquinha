// As leituras em lote de Planejamento, sem o agregado: os tickets e os Planos das demandas, e os tickets em execução.
import assert from "node:assert/strict";
import { test } from "node:test";
import { bancoDaDemanda, bancoDoPeriodo, em } from "../../../../../apoio-testes/banco_de_metricas.ts";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { planosDasDemandas, ticketsDasDemandas, ticketsEmExecucaoDasEtapas } from "./itens_do_planejamento.ts";

test("os tickets das demandas em lote, com a Etapa, a rodada, o estado e os instantes", () => {
  const banco = bancoDoPeriodo();
  banco.exec("UPDATE ticket_demanda SET criado_em = '2026-01-02T00:00:00.000Z' WHERE ticket_id = 2");
  assert.deepEqual(ticketsDasDemandas(banco, ["I-1"]).slice(0, 2), [
    {
      demanda_id: "I-1",
      ticket_id: 1,
      etapa: "implementar",
      rodada_id: 1,
      estado: "concluido",
      estado_alterado_em: em("2026-02"),
      criado_em: null,
      concluido_em: null,
    },
    {
      demanda_id: "I-1",
      ticket_id: 2,
      etapa: "encerrar_rodada",
      rodada_id: 1,
      estado: "concluido",
      estado_alterado_em: em("2026-02"),
      criado_em: "2026-01-02T00:00:00.000Z",
      concluido_em: null,
    },
  ]);
  assert.deepEqual(
    ticketsDasDemandas(banco, ["I-3", "I-2"]).map((t) => [t.demanda_id, t.ticket_id, t.rodada_id]),
    [["I-3", 1, null]],
  );
});

test("o Plano de cada demanda vem das versões; a demanda sem aprovação do planejamento fica de fora", () => {
  const banco = bancoDaDemanda();
  const dados = {
    demanda_id: "I-1",
    criterios: [],
    arquivos_previstos: ["a.ts"],
    rodadas: [{ demanda_id: "I-1", rodada_id: 1, titulo: "r", e2e: false, arquivos_previstos: ["a.ts"] }],
    tickets: [
      { demanda_id: "I-1", ticket_id: 2, rodada_id: 1, titulo: "t", descricao: "d", arquivos_previstos: ["a.ts"] },
    ],
  };
  const correcao = {
    origem: "revisao_rodada",
    autor: { tipo: "fabriquinha" },
    rodada: 1,
    rodadas_novas: [],
    tickets_novos: [],
    arquivos_acrescentados: ["b.ts"],
  };
  const gravar = (numero: number, origem: string, conteudo: unknown) =>
    banco
      .prepare(
        `INSERT INTO versao_plano (demanda_id, numero, origem, autor_tipo, criada_em, dados)
         VALUES ('I-1', ?, ?, 'fabriquinha', '2026-01-01T00:00:00.000Z', ?)`,
      )
      .run(numero, origem, JSON.stringify(conteudo));
  gravar(2, "revisao_rodada", correcao);
  assert.equal(planosDasDemandas(banco, ["I-1"]).size, 0, "só a correção, sem o original aprovado");
  gravar(1, "aprovacao_do_planejamento", dados);
  const plano = planosDasDemandas(banco, ["I-1"]).get("I-1");
  assert.ok(plano);
  assert.deepEqual(plano.original.rodadas[0]?.arquivos_previstos, ["a.ts"]);
  assert.deepEqual(
    plano.correcoes.map((c) => c.arquivos_acrescentados),
    [["b.ts"]],
  );
  assert.equal(planosDasDemandas(banco, []).size, 0);
});

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const T = "'2026-01-01T00:00:00.000Z'";
const ref = { demanda_id: "I-1", ticket_id: 1 };

const novoBanco = () => {
  const b = abrirBancoTemporario().banco;
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T});`);
  return b;
};

test("tickets em execução das Etapas pedidas; ticket aberto ou de Etapa fora da lista não entram", () => {
  const b = novoBanco();
  const etapas = { sempre: ["implementar"] as const, noEstadoDaRodada: [] };
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
  b.exec("UPDATE ticket_demanda SET estado = 'em_execucao' WHERE ticket_id = 1");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), [ref]);
  b.exec("UPDATE ticket_demanda SET etapa = 'planejar' WHERE ticket_id = 1");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
});

test("o ticket da Etapa que conta no estado da rodada só entra com a rodada ainda no estado da Etapa", () => {
  const b = novoBanco();
  const etapas = { sempre: [], noEstadoDaRodada: ["encerrar_rodada"] as const };
  b.exec(`INSERT INTO rodada VALUES ('I-1', 1, 'r', 'encerrar_rodada', ${T}, 0, 'fabriquinha/I-1-1');
    UPDATE ticket_demanda SET estado = 'em_execucao', etapa = 'encerrar_rodada', rodada_id = 1 WHERE ticket_id = 1`);
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), [ref]);
  b.exec("UPDATE rodada SET estado = 'gate_pr'");
  assert.deepEqual(ticketsEmExecucaoDasEtapas(b, etapas), []);
});
