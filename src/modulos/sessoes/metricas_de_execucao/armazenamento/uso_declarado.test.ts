import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco_temporario.ts";
import type { LinhaDeUso } from "../../harness/publico.ts";
import { lerUsoDeclaradoEmLote, gravarUsoDeclarado, lerUsoDeclarado } from "./uso_declarado.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();
const T = "'2026-01-01T00:00:00.000Z'";

const linha = (custo: number | null): LinhaDeUso => ({
  modelo: "anthropic/opus",
  tokens_entrada: 1,
  tokens_saida: 2,
  tokens_cache_leitura: 3,
  tokens_cache_escrita: 4,
  custo,
  chamadas: 0,
});

const novoBanco = () => {
  const b = abrirBancoTemporario().banco;
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-2', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);`);
  return b;
};

test("grava o Uso declarado e lê de volta, com o custo desconhecido null", () => {
  const b = novoBanco();
  const uso = { ferramenta: "claude", sessao: "s1", demanda_id: "I-1", linhas: [linha(1.5), linha(null)] };
  assert.deepEqual(gravarUsoDeclarado(b, uso), { demandaDona: "I-1" });
  assert.deepEqual(lerUsoDeclarado(b, "I-1"), [uso]);
  assert.deepEqual(lerUsoDeclarado(b, "I-2"), []);
});

test("gravar de novo a mesma sessão pela mesma demanda troca as linhas e deixa uma só linha", () => {
  const b = novoBanco();
  const uso = { ferramenta: "claude", sessao: "s1", demanda_id: "I-1", linhas: [linha(1)] };
  gravarUsoDeclarado(b, uso);
  gravarUsoDeclarado(b, { ...uso, linhas: [linha(2)] });
  assert.deepEqual(lerUsoDeclarado(b, "I-1"), [{ ...uso, linhas: [linha(2)] }]);
});

test("a sessão que outra demanda já informou não muda de dona nem de linhas", () => {
  const b = novoBanco();
  gravarUsoDeclarado(b, { ferramenta: "claude", sessao: "s1", demanda_id: "I-1", linhas: [linha(1)] });
  const outra = { ferramenta: "claude", sessao: "s1", demanda_id: "I-2", linhas: [linha(9)] };
  assert.deepEqual(gravarUsoDeclarado(b, outra), { demandaDona: "I-1" });
  assert.deepEqual(lerUsoDeclarado(b, "I-2"), []);
  assert.deepEqual(lerUsoDeclarado(b, "I-1")[0]?.linhas, [linha(1)]);
});

test("o Uso declarado em lote: o das sessões de qualquer um dos contextos, na ordem em que foi gravado", () => {
  const b = novoBanco();
  const doI2 = { ferramenta: "claude", sessao: "s2", demanda_id: "I-2", linhas: [linha(2)] };
  const doI1 = { ferramenta: "claude", sessao: "s1", demanda_id: "I-1", linhas: [linha(1)] };
  gravarUsoDeclarado(b, doI2);
  gravarUsoDeclarado(b, doI1);
  assert.deepEqual(lerUsoDeclaradoEmLote(b, ["I-1", "I-2"]), [doI2, doI1]);
  assert.deepEqual(lerUsoDeclaradoEmLote(b, ["I-1"]), [doI1]);
  assert.deepEqual(lerUsoDeclaradoEmLote(b, []), []);
});
