import assert from "node:assert/strict";
import { test } from "node:test";
import { fabricaDeBancosTemporarios } from "../../../../apoio-testes/banco_temporario.ts";
import type { LinhaDeUso } from "../../sessoes/publico.ts";
import { gravarUsoDeclarado, lerUsoDeclarado, usoDeclaradoNoPeriodo } from "./uso_declarado.ts";

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
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO demanda VALUES ('I-2', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');`);
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

test("o Uso declarado do período, no mês do registro da demanda e filtrado por projeto", () => {
  const b = novoBanco();
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('q', '/repo/q', 'main', 'github', 'k2');
    INSERT INTO demanda VALUES ('I-3', 'q', 't', 'problema', 'd', 'em_execucao', '2026-02-01T00:00:00.000Z', 'f', 's', 1, 'fabriquinha/I-3');`);
  gravarUsoDeclarado(b, { ferramenta: "claude", sessao: "s1", demanda_id: "I-1", linhas: [linha(1)] });
  gravarUsoDeclarado(b, { ferramenta: "claude", sessao: "s2", demanda_id: "I-3", linhas: [linha(2)] });
  const janeiro = { inicio: "2026-01-01T00:00:00.000Z", fim: "2026-02-01T00:00:00.000Z", projeto: null };
  assert.deepEqual(usoDeclaradoNoPeriodo(b, janeiro), [
    {
      demanda: "I-1",
      projeto: "p",
      titulo: "t",
      estado: "em_execucao",
      em: "2026-01-01T00:00:00.000Z",
      linhas: [linha(1)],
    },
  ]);
  const fevereiro = { inicio: janeiro.fim, fim: "2026-03-01T00:00:00.000Z", projeto: "q" };
  assert.deepEqual(usoDeclaradoNoPeriodo(b, fevereiro), [
    {
      demanda: "I-3",
      projeto: "q",
      titulo: "t",
      estado: "em_execucao",
      em: "2026-02-01T00:00:00.000Z",
      linhas: [linha(2)],
    },
  ]);
  assert.deepEqual(usoDeclaradoNoPeriodo(b, { ...fevereiro, projeto: "p" }), []);
});
