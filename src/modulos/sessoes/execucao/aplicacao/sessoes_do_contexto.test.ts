// O Uso em lote (por sessão, contexto e período) e o resumo da sessão, lidos só do banco, sem a conversa.
import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import { registrarUso, type UsoDaExecucao } from "../../metricas_de_execucao/publico.ts";
import { execucoesEmLote, resumoDaSessao, resumosDasSessoesEmLote } from "../armazenamento/sessoes_e_execucoes.ts";
import { type Execucao, type Sessao } from "../nucleo/sessao.ts";
import { comSessoesDoContexto, usoEmLote } from "./sessoes_do_contexto.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const T = "'2026-01-01T00:00:00.000Z'";

const sessao = (id: string, ticket_id: number): Sessao => ({
  id,
  demanda_id: "I-1",
  ticket_id,
  modo: "autonomo",
  conversa_referencia: `c-${id}`,
});
const execucao = (id: string, trabalho_id: string, inicio: string): Execucao => ({
  id,
  trabalho_id,
  inicio,
  falha: false,
});
const uso = (execucao_id: string): UsoDaExecucao => ({
  execucao_id,
  modelo_provedor: "anthropic",
  modelo_nome: "opus",
  tokens_entrada: 1,
  tokens_saida: 1,
  tokens_cache_leitura: 0,
  tokens_cache_escrita: 0,
});

/** Duas sessões, uma por ticket; a do ticket 1 com duas execuções em meses diferentes, cada uma com Uso. */
function bancoComDuasSessoes() {
  const { banco } = abrirBancoTemporario();
  banco.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'funcionalidade', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}), ('I-1', 2, 'implementar', 'aberto', ${T});`);
  const gravar = (ticket_id: number, s: Sessao, execucoes: Execucao[]) =>
    comSessoesDoContexto(banco, { demanda_id: "I-1", ticket_id }, (estado) => ({
      sessoes: [...estado.sessoes, s],
      execucoes: [...estado.execucoes, ...execucoes.map((e) => ({ ...e, fim: e.inicio }))],
      usos: execucoes.map((e) => uso(e.id)).reduce(registrarUso, estado.usos),
    }));
  gravar(1, sessao("s1", 1), [
    execucao("e1", "s1", "2026-01-10T00:00:00.000Z"),
    execucao("e2", "s1", "2026-02-10T00:00:00.000Z"),
  ]);
  gravar(2, sessao("s2", 2), [execucao("e3", "s2", "2026-02-11T00:00:00.000Z")]);
  return banco;
}

const execucoesDoUso = (usos: UsoDaExecucao[]) => usos.map(({ execucao_id }) => execucao_id);

test("o Uso em lote filtra por sessão, contexto e período, e os filtros se somam", () => {
  const banco = bancoComDuasSessoes();
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, {})), ["e1", "e2", "e3"]);
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { sessoes: ["s2"] })), ["e3"]);
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { sessoes: [] })), []);
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { contexto: { demanda_id: "I-1" } })), ["e1", "e2", "e3"]);
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { contexto: { demanda_id: "I-1", ticket_id: 1 } })), ["e1", "e2"]);
  const fevereiro = { inicio: "2026-02-01T00:00:00.000Z", fim: "2026-03-01T00:00:00.000Z" };
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { periodo: fevereiro })), ["e2", "e3"]);
  assert.deepEqual(
    execucoesDoUso(usoEmLote(banco, { contexto: { demanda_id: "I-1", ticket_id: 1 }, periodo: fevereiro })),
    ["e2"],
  );
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { demandas: ["I-1"], periodo: fevereiro })), ["e2", "e3"]);
  assert.deepEqual(execucoesDoUso(usoEmLote(banco, { demandas: ["I-2"] })), []);
});

test("as execuções em lote vêm com o contexto e a duração, na ordem do início, e um fim antes do início dura 0", () => {
  const banco = bancoComDuasSessoes();
  banco.exec(`UPDATE processo_do_trabalho SET fim = '2026-01-10T00:00:01.500Z' WHERE id = 'e1';
    UPDATE processo_do_trabalho SET fim = '2026-02-09T00:00:00.000Z', falha = 1 WHERE id = 'e2';
    UPDATE processo_do_trabalho SET fim = NULL WHERE id = 'e3';`);
  assert.deepEqual(execucoesEmLote(banco, { demandas: ["I-1"] }), [
    {
      id: "e1",
      sessao: "s1",
      demanda_id: "I-1",
      ticket_id: 1,
      inicio: "2026-01-10T00:00:00.000Z",
      falha: false,
      duracaoMs: 1500,
    },
    {
      id: "e2",
      sessao: "s1",
      demanda_id: "I-1",
      ticket_id: 1,
      inicio: "2026-02-10T00:00:00.000Z",
      falha: true,
      duracaoMs: 0,
    },
    {
      id: "e3",
      sessao: "s2",
      demanda_id: "I-1",
      ticket_id: 2,
      inicio: "2026-02-11T00:00:00.000Z",
      falha: false,
      duracaoMs: 0,
    },
  ]);
  const deFevereiro = execucoesEmLote(banco, { demandas: ["I-1"], periodo: { inicio: "2026-02-01T00:00:00.000Z" } });
  assert.deepEqual(
    deFevereiro.map(({ id }) => id),
    ["e2", "e3"],
  );
  assert.deepEqual(execucoesEmLote(banco, { demandas: [] }), []);
});

test("o resumo da sessão traz a sessão e as execuções dela, sem a conversa; id desconhecido volta sem resumo", () => {
  const banco = bancoComDuasSessoes();
  const resumo = resumoDaSessao(banco, "s1");
  assert.deepEqual(
    { ...resumo, execucoes: resumo?.execucoes.map(({ id }) => id) },
    { ...sessao("s1", 1), execucoes: ["e1", "e2"] },
  );
  assert.equal(resumoDaSessao(banco, "desconhecida"), undefined);
});

test("os resumos em lote trazem as sessões das demandas pedidas, ou de todas, cada uma com as execuções dela", () => {
  const banco = bancoComDuasSessoes();
  comSessoesDoContexto(banco, { demanda_id: "I-1", ticket_id: 2 }, (estado) => ({
    ...estado,
    sessoes: [...estado.sessoes, sessao("s3", 2)],
  }));
  const execucoesDeCadaSessao = (demandas?: readonly string[]) =>
    resumosDasSessoesEmLote(banco, demandas).map(({ id, execucoes }) => [id, execucoes.map((e) => e.id)]);
  const todas = [
    ["s1", ["e1", "e2"]],
    ["s2", ["e3"]],
    ["s3", []],
  ];
  assert.deepEqual(execucoesDeCadaSessao(), todas);
  assert.deepEqual(execucoesDeCadaSessao(["I-1"]), todas);
  assert.deepEqual(execucoesDeCadaSessao(["I-2"]), []);
  assert.deepEqual(resumosDasSessoesEmLote(banco, ["I-1"])[0], resumoDaSessao(banco, "s1"));
});
