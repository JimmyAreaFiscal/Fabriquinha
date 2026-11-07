import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import type { DatabaseSync } from "node:sqlite";
import { fabricaDeBancosTemporarios } from "../../apoio-testes/banco_temporario.ts";
import { Ator } from "../nucleo/ator.ts";
import { ErroDeRegra } from "../nucleo/erros.ts";
import { submeterEvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";
import { caminhoArquivo, guardarBytes } from "./arquivos.ts";
import { carregarDemanda, comDemanda } from "./demandas.ts";
import { anexosDaDemanda, gravarAnexos, lerAnexo, registrarSessoesExternas } from "./evidencia_demanda.ts";
import { removerProjeto } from "../aplicacao/projeto/cadastro.ts";

const abrirBancoTemporario = fabricaDeBancosTemporarios();

const T = "'2026-01-01T00:00:00.000Z'";
const em = "2026-01-01T00:00:00.000Z";
const chave = { demanda_id: "I-1", tipo: "custos_realizados" };
const quem = { ferramenta: "claude", sessao: "s1" };

const novoBanco = () => {
  const b = abrirBancoTemporario().banco;
  b.exec(`INSERT INTO projeto (nome, raiz_git, branch_base, hospedagem, chave_sonarqube)
    VALUES ('p', '/repo/p', 'main', 'github', 'k');
    INSERT INTO demanda VALUES ('I-1', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-1');
    INSERT INTO demanda VALUES ('I-2', 'p', 't', 'problema', 'd', 'em_execucao', ${T}, 'f', 's', 1, 'fabriquinha/I-2');`);
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
    (ag) => submeterEvidenciaDemanda(ag, { tipo: "custos_realizados", dados }, { tipo: "externo", ...quem }, em),
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
      submeterEvidenciaDemanda(agregado, { tipo: "custos_realizados", dados: { total: 42 } }, autor, em),
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

test("gravar anexos de evidência que não existe é recusado", () => {
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
    INSERT INTO demanda VALUES ('I-9', 'q', 't', 'problema', 'd', 'em_execucao', 't', 'f', 's', 1, 'fabriquinha/I-9');
    INSERT INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES ('e9', 'I-9', NULL, NULL, 'comportamento', '{}', 't');
    INSERT INTO arquivo_evidencia VALUES ('e9', 1, 'a.txt', '${a.sha256}', 'text/plain', 2);`);
  await removerProjeto(b, "q");
  assert.equal(existsSync(caminhoArquivo(b, a.sha256)), true);
});

const custosEm = (b: DatabaseSync, id: string, demanda: string, rodada: number | null, sessoes: unknown[]) =>
  b
    .prepare(
      "INSERT OR REPLACE INTO evidencia_demanda (id, demanda_id, rodada_id, ticket_id, tipo, dados, em) VALUES (?, ?, ?, NULL, 'custos_realizados', ?, ?)",
    )
    .run(id, demanda, rodada, JSON.stringify({ sessoes }), em);

test("CA-11 a CA-13: sessão de outra demanda vira aviso; regrava de todas as custos da demanda, rodada inclusa; nada vai para a execução interna", () => {
  const b = novoBanco();
  b.exec(
    "INSERT INTO rodada VALUES ('I-1', 1, 'r', 'implementar', '2026-01-01T00:00:00.000Z', 0, 'fabriquinha/I-1-1')",
  );
  custosEm(b, "e1", "I-1", null, [quem, { ferramenta: "codex", sessao: "s2" }]);
  custosEm(b, "e1r", "I-1", 1, [{ ferramenta: "codex", sessao: "sr" }]);
  assert.deepEqual(registrarSessoesExternas(b, "I-1"), { avisos: [] });
  custosEm(b, "e2", "I-2", null, [quem, { ferramenta: "codex", sessao: "s3" }]);
  const { avisos } = registrarSessoesExternas(b, "I-2");
  assert.deepEqual(avisos, ["a sessão s1 de claude já consta na demanda I-1 e não é contada de novo para I-2"]);
  custosEm(b, "e1", "I-1", null, [quem]);
  assert.deepEqual(registrarSessoesExternas(b, "I-1"), { avisos: [] });
  assert.deepEqual(linhas(b, "SELECT ferramenta, sessao, demanda_id FROM sessao_externa_demanda ORDER BY sessao"), [
    { ferramenta: "claude", sessao: "s1", demanda_id: "I-1" },
    { ferramenta: "codex", sessao: "s3", demanda_id: "I-2" },
    { ferramenta: "codex", sessao: "sr", demanda_id: "I-1" },
  ]);
  for (const tabela of ["execucao_sessao", "uso_modelo_execucao"]) {
    assert.equal(b.prepare(`SELECT count(*) AS n FROM ${tabela}`).get()?.n, 0);
  }
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
    { nome: "a.txt", mime: "text/plain", bytes: 2, sha256: a.sha256, tipo: "custos_realizados" },
    { nome: "c.txt", mime: "text/plain", bytes: 5, sha256: c.sha256, tipo: "custos_realizados" },
    { ...x, rodada_id: 1 },
    { ...x, ticket_id: 1 },
  ]);
  assert.deepEqual(anexosDaDemanda(b, "I-2"), []);
});
