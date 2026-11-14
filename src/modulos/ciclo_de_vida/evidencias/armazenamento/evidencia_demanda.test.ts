import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { fabricaDeBancosTemporarios } from "../../../../../apoio-testes/banco/banco_temporario.ts";
import { Ator } from "../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { caminhoArquivo, guardarBytes } from "../../../../shared/armazenamento/arquivos.ts";
import { carregarDemanda } from "../../processo/publico.ts";
import { comDemanda } from "../../processo/armazenamento/agregado_da_demanda.ts";
import {
  anexosDaDemanda,
  evidenciasDoTipoDasDemandas,
  gravarAnexos,
  lerAnexo,
  primeiraEvidenciaDasDemandas,
} from "./evidencia_demanda.ts";
import { removerProjetoComOQueDependeDele } from "../../../../server/fluxos/projeto/remocao_do_projeto.ts";
import { comEvidencia } from "../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { montarCicloDeVidaDoBanco, montarDemandasDoBanco } from "../../../../server/composicao/banco_da_fabriquinha.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const T = "'2026-01-01T00:00:00.000Z'";
const em = "2026-01-01T00:00:00.000Z";
const chave = { demanda_id: "I-1", tipo: "comportamento" };
const quem = { ferramenta: "claude", sessao: "s1" };

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

const anexoDe = (b: DatabaseSync, nome: string, conteudo: string) => ({
  caminho: nome,
  mime: "text/plain",
  ...guardarBytes(b, Buffer.from(conteudo)),
});

/** Submete a evidência (dados novos substituem a anterior) e os anexos, na mesma transação. */
const submeter = (b: DatabaseSync, anexos: ReturnType<typeof anexoDe>[], dados = {}) =>
  comDemanda(
    b,
    "I-1",
    (ag) => comEvidencia(ag, { tipo: "comportamento", dados }, { tipo: "externo", ...quem }, em),
    () => {
      gravarAnexos(b, chave, anexos);
    },
  );

const linhas = (b: DatabaseSync, sql: string) =>
  b
    .prepare(sql)
    .all()
    .map((l) => ({ ...l }));

test("autoria da evidência: cada tipo de ator é gravado e relido, inclusive na atualização da mesma chave", () => {
  const bancoDeAutoria = novoBanco();
  const autores: Ator[] = [
    { tipo: "auditor" },
    { tipo: "agente", trabalho_id: "exec-evidencia" },
    { tipo: "externo", ferramenta: "claude", sessao: "s1" },
    { tipo: "fabriquinha" },
  ];
  for (const autor of autores) {
    comDemanda(bancoDeAutoria, "I-1", (agregado) =>
      comEvidencia(agregado, { tipo: "comportamento", dados: { total: 42 } }, autor, em),
    );
    const relida = carregarDemanda(bancoDeAutoria, "I-1");
    assert.equal(relida.evidencias.length, 1);
    assert.deepEqual(Ator.parse(relida.evidencias[0]?.autor), autor);
    assert.deepEqual(relida.evidencias[0]?.dados, { total: 42 });
    assert.deepEqual(Ator.parse(relida.demanda.criada_por), { tipo: "externo", ferramenta: "f", sessao: "s" });
    assert.equal(bancoDeAutoria.prepare("SELECT count(*) AS quantidade FROM evidencia_demanda").get()?.quantidade, 1);
  }
});

test("CA-3: dois anexos viram ordem 1 e 2, cada um com arquivo do mesmo tamanho no armazenamento", () => {
  const b = novoBanco();
  const a = anexoDe(b, "a.txt", "um");
  const c = anexoDe(b, "c.txt", "dois!");
  submeter(b, [a, c]);
  assert.deepEqual(linhas(b, "SELECT ordem, caminho, sha256, mime, bytes FROM arquivo_evidencia ORDER BY ordem"), [
    { ordem: 1, caminho: "a.txt", sha256: a.sha256, mime: "text/plain", bytes: 2 },
    { ordem: 2, caminho: "c.txt", sha256: c.sha256, mime: "text/plain", bytes: 5 },
  ]);
  assert.equal(caminhoArquivo(b, a.sha256).includes(`arquivos/${a.sha256.slice(0, 2)}/${a.sha256}`), true);
  assert.equal(lerAnexo(b, chave, c.sha256).conteudo.toString(), "dois!");
});

test("CA-4: nova submissão troca os anexos e os arquivos antigos continuam", () => {
  const b = novoBanco();
  const a = anexoDe(b, "a.txt", "um");
  const c = anexoDe(b, "c.txt", "dois");
  submeter(b, [a, c]);
  const d = anexoDe(b, "d.txt", "tres");
  submeter(b, [d], { v: 2 });
  assert.deepEqual(linhas(b, "SELECT ordem, sha256 FROM arquivo_evidencia"), [{ ordem: 1, sha256: d.sha256 }]);
  assert.equal(existsSync(caminhoArquivo(b, a.sha256)) && existsSync(caminhoArquivo(b, c.sha256)), true);
});

test("CA-5 e CA-6: a leitura recusa hash não registrado e o que não é SHA-256", () => {
  const b = novoBanco();
  submeter(b, [anexoDe(b, "a.txt", "um")]);
  assert.throws(
    () => lerAnexo(b, chave, "a".repeat(64)),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes("use um anexo registrado"),
  );
  assert.throws(
    () => lerAnexo(b, chave, "../../config"),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes("não é um SHA-256"),
  );
});

test("gravar anexos de evidência que não existe é rejeitado", () => {
  const b = novoBanco();
  assert.throws(() => {
    gravarAnexos(b, { ...chave, ticket_id: 7 }, []);
  }, /não está gravada/);
});

test("CA-7: o arquivo compartilhado com um anexo de demanda fica quando o projeto é removido", async () => {
  const b = novoBanco();
  const a = anexoDe(b, "a.txt", "um");
  submeter(b, [a]);
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
      VALUES ('q', '/repo/q', 'main', 'github', 'k');
    INSERT INTO demanda (id, projeto, titulo, tipo, descricao, estado, estado_alterado_em, criada_por_ferramenta, criada_por_sessao, enviada, branch) VALUES ('I-9', 'q', 't', 'problema', 'd', 'em_execucao', 't', 'f', 's', 1, 'fabriquinha/I-9');
    INSERT INTO processo_demanda (demanda_id, estado, estado_alterado_em, branch) SELECT id, estado, estado_alterado_em, branch FROM demanda WHERE estado IS NOT NULL AND id NOT IN (SELECT demanda_id FROM processo_demanda);
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('e9', 'I-9', NULL, NULL, 'comportamento', '{}', 't');
    INSERT INTO arquivo_evidencia VALUES ('e9', 1, 'a.txt', '${a.sha256}', 'text/plain', 2);`);
  await removerProjetoComOQueDependeDele(b, montarCicloDeVidaDoBanco(b), montarDemandasDoBanco(b), "q");
  assert.equal(existsSync(caminhoArquivo(b, a.sha256)), true);
});

test("anexosDaDemanda: nome, mime, bytes, sha256, dono e tipo, na ordem", () => {
  const b = novoBanco();
  const a = anexoDe(b, "a.txt", "um");
  const c = anexoDe(b, "c.txt", "dois!");
  submeter(b, [a, c]);
  b.exec(`INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/I-1-1');
    INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em, rodada_id)
      VALUES ('I-1', 1, 'implementar', 'aberto', ${T}, 1);
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('e-r', 'I-1', 1, NULL, 'comportamento', '{}', ${T});
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('e-t', 'I-1', NULL, 1, 'comportamento', '{}', ${T});`);
  for (const dono of ["e-r", "e-t"]) {
    b.prepare("INSERT INTO arquivo_evidencia VALUES (?, 1, 'x.txt', ?, 'text/plain', 2)").run(dono, a.sha256);
  }
  const x = { nome: "x.txt", mime: "text/plain", bytes: 2, sha256: a.sha256, tipo: "comportamento" };
  assert.deepEqual(anexosDaDemanda(b, "I-1"), [
    { nome: "a.txt", mime: "text/plain", bytes: 2, sha256: a.sha256, tipo: "comportamento" },
    { nome: "c.txt", mime: "text/plain", bytes: 5, sha256: c.sha256, tipo: "comportamento" },
    { ...x, rodada_id: 1 },
    { ...x, ticket_id: 1 },
  ]);
  assert.deepEqual(anexosDaDemanda(b, "I-2"), []);
});

test("em lote: a primeira evidência de cada demanda e onde e quando foi registrada cada uma de um tipo", () => {
  const b = novoBanco();
  b.exec(`INSERT INTO ticket_demanda (demanda_id, ticket_id, etapa, estado, estado_alterado_em)
      VALUES ('I-1', 1, 'encerrar_rodada', 'concluido', ${T});
    INSERT INTO evidencia_demanda (id, demanda_id, ticket_id, tipo, dados, em)
      VALUES ('e2', 'I-1', 1, 'pr_aberto', '{}', '2026-03-01T00:00:00.000Z');
    INSERT INTO evidencia_demanda (id, demanda_id, tipo, dados, em) VALUES ('e1', 'I-1', 'comportamento', '{}', ${T});
    INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', ${T}, 0, 'b1');
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, tipo, dados, em) VALUES ('e3', 'I-1', 1, 'pr_aberto', '{}', ${T});`);
  assert.deepEqual(primeiraEvidenciaDasDemandas(b, ["I-1", "I-2"]), new Map([["I-1", em]]));
  assert.deepEqual(evidenciasDoTipoDasDemandas(b, { demandas: ["I-1", "I-2"], tipo: "pr_aberto" }), [
    { demanda_id: "I-1", rodada_id: null, ticket_id: 1, em: "2026-03-01T00:00:00.000Z" },
    { demanda_id: "I-1", rodada_id: 1, ticket_id: null, em },
  ]);
});
