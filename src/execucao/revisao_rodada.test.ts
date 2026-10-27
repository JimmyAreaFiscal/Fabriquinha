// Preparação da revisão de rodada com git real temporário (CA-3, CA-4).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { configuracaoProjeto, gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { carregarDemanda } from "../persistencia/demandas.ts";
import { commitarCenario, gitCenario } from "../repositorio/worktree-cenarios.ts";
import { caminhoDaWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "./revisao_cenario.test.ts";
import { prepararRevisaoRodada } from "./revisao_rodada.ts";

const evidencia = (banco: Parameters<typeof carregarDemanda>[0], tipo: string) =>
  carregarDemanda(banco, "I-1").evidencias.filter((e) => e.ticket_id === 2 && e.tipo === tipo);

/** Cria a worktree da rodada, commita A/M/D nela e avança a branch da demanda depois. */
async function rodadaComAlteracoes(c: Awaited<ReturnType<typeof cenarioRevisao>>["c"]) {
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  commitarCenario(rodada, "novo.ts", "a\n");
  writeFileSync(join(rodada, "base.txt"), "base\nmais\n");
  gitCenario(rodada, "commit", "-qam", "m");
  gitCenario(rodada, "rm", "-q", "base.txt");
  commitarCenario(rodada, "outro.md", "x\n");
  const demanda = caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1");
  const ponta = commitarCenario(demanda, "da-demanda.txt", "d\n");
  return { rodada, ponta, head: gitCenario(rodada, "rev-parse", "HEAD") };
}

test("CA-3: base na ponta da demanda (mesmo avançada), head na rodada, A/M/D e previsto", async () => {
  const { c, banco } = await cenarioRevisao();
  banco.exec("INSERT INTO caminho_ticket VALUES ('I-1', 1, '**/*.ts'), ('I-1', 1, 'nunca/*.ts')");
  const { ponta, head } = await rodadaComAlteracoes(c);
  await prepararRevisaoRodada(banco, REF_RODADA);
  const [e] = evidencia(banco, "arquivos_alterados");
  const dados = e?.dados as { base: string; head: string; arquivos: { caminho: string; status: string }[] };
  assert.equal(dados.base, ponta);
  assert.equal(dados.head, head);
  assert.deepEqual(dados.arquivos, [
    { caminho: "base.txt", status: "D", adicionadas: 0, removidas: 1, previsto: null },
    { caminho: "novo.ts", status: "A", adicionadas: 1, removidas: 0, previsto: "**/*.ts" },
    { caminho: "outro.md", status: "A", adicionadas: 1, removidas: 0, previsto: null },
  ]);
  assert.deepEqual((e?.dados as { previstosNaoTocados: string[] }).previstosNaoTocados, ["nunca/*.ts"]);
});

test("CA-3: arquivo modificado aparece como M", async () => {
  const { c, banco } = await cenarioRevisao();
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  writeFileSync(join(rodada, "base.txt"), "base\nmais\n");
  gitCenario(rodada, "commit", "-qam", "m");
  await prepararRevisaoRodada(banco, REF_RODADA);
  const dados = evidencia(banco, "arquivos_alterados")[0]?.dados as { arquivos: object[] };
  assert.deepEqual(dados.arquivos, [
    { caminho: "base.txt", status: "M", adicionadas: 1, removidas: 0, previsto: null },
  ]);
});

test("CA-4: uma linha por fitness, com a saída 0 e 1 e o log como anexo; regravar substitui", async () => {
  const { banco } = await cenarioRevisao();
  const projeto = configuracaoProjeto(banco, "loja");
  gravarConfiguracaoProjeto(banco, {
    ...projeto,
    fitness: [
      { nome: "boa", comando: "echo ok", descricao: "d" },
      { nome: "ruim", comando: "echo falhou; exit 1", descricao: "d" },
    ],
  });
  await prepararRevisaoRodada(banco, REF_RODADA);
  await prepararRevisaoRodada(banco, REF_RODADA);
  const evidencias = evidencia(banco, "matriz_fitness");
  assert.equal(evidencias.length, 1);
  const linhas = (evidencias[0]?.dados as { linhas: { nome: string; codigoSaida: number }[] }).linhas;
  assert.deepEqual(
    linhas.map((l) => [l.nome, l.codigoSaida]),
    [
      ["boa", 0],
      ["ruim", 1],
    ],
  );
  const anexos = banco.prepare("SELECT caminho, sha256 FROM arquivo_evidencia ORDER BY ordem").all();
  assert.deepEqual(
    anexos.map((a) => a.caminho),
    ["boa.log", "ruim.log"],
  );
  assert.match(readFileSync(caminhoArquivo(banco, String(anexos[1]?.sha256)), "utf8"), /falhou/);
  assert.equal(evidencia(banco, "arquivos_alterados").length, 1);
});

test("recusa ticket inexistente, global e projeto sem configuração", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const sem = await cenarioRevisao();
  sem.banco.exec("DELETE FROM linguagem_projeto");
  await assert.rejects(prepararRevisaoRodada(sem.banco, REF_RODADA), /não tem configuração/);
  await assert.rejects(prepararRevisaoRodada(banco, { demanda_id: "I-1", ticket_id: 99 }), /não existe/);
  await assert.rejects(prepararRevisaoRodada(banco, REF_GLOBAL), /não é de uma rodada/);
});

test("CA-3: renomeação casa o previsto pelo caminho antigo", async () => {
  const { c, banco } = await cenarioRevisao();
  banco.exec("INSERT INTO caminho_ticket VALUES ('I-1', 1, 'base.txt')");
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  gitCenario(rodada, "mv", "base.txt", "nome.txt");
  gitCenario(rodada, "commit", "-qam", "r");
  await prepararRevisaoRodada(banco, REF_RODADA);
  const dados = evidencia(banco, "arquivos_alterados")[0]?.dados as { arquivos: object[]; previstosNaoTocados: [] };
  assert.deepEqual(dados.arquivos, [
    { caminho: "nome.txt", status: "R", adicionadas: 0, removidas: 0, previsto: "base.txt" },
  ]);
  assert.deepEqual(dados.previstosNaoTocados, []);
});
