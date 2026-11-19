// Preparação da revisão da demanda com git real temporário (I-322 CA-1, CA-3, CA-4, CA-6, CA-7).
import assert from "node:assert/strict";
import { readFileSync, realpathSync } from "node:fs";
import { test } from "node:test";
import { FABRIQUINHA } from "../../../etapas/publico.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import { caminhoArquivo } from "../../../../../shared/armazenamento/arquivos.ts";
import { caminhoDaWorktreeDemanda } from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { modulosDoCicloDeTeste } from "../../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { buscarProjeto, gravarProjeto } from "../../../../../../apoio-testes/demandas_de_teste.ts";
import { prepararRevisaoDemanda } from "./revisao_demanda.ts";

type Banco = Parameters<typeof carregarDemanda>[0];

const matrizDoRevisor = (banco: Banco) =>
  carregarDemanda(banco, "I-1").evidencias.filter((e) => e.ticket_id === 3 && e.tipo === "matriz_fitness");

function comFitness(banco: Banco, fitness: { nome: string; comando: string; descricao: string }[]) {
  const projeto = buscarProjeto(banco, "loja");
  assert.ok(projeto);
  gravarProjeto(banco, { ...projeto, verificacoes: { ...projeto.verificacoes, fitness } });
}

test("CA-1: a fitness roda na worktree da demanda e a matriz_fitness do ticket leva o log", async () => {
  const { c, banco } = await cenarioRevisao({ integral: true });
  comFitness(banco, [{ nome: "integracao", comando: "pwd", descricao: "d" }]);
  const espaco = await prepararRevisaoDemanda(modulosDoCicloDeTeste(banco), REF_GLOBAL);
  const worktreeDaDemanda = caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1");
  assert.equal(realpathSync(espaco.pasta), realpathSync(worktreeDaDemanda));
  const [matriz] = matrizDoRevisor(banco);
  assert.ok(matriz);
  assert.deepEqual(matriz.autor, FABRIQUINHA);
  const [linha] = (matriz.dados as { linhas: { nome: string; codigoSaida: number; log: string }[] }).linhas;
  assert.deepEqual([linha?.nome, linha?.codigoSaida, linha?.log], ["integracao", 0, "integracao.log"]);
  const [anexo] = banco.prepare("SELECT caminho, sha256 FROM arquivo_evidencia").all();
  assert.equal(anexo?.caminho, "integracao.log");
  assert.equal(
    realpathSync(readFileSync(caminhoArquivo(banco, String(anexo.sha256)), "utf8").trim()),
    realpathSync(worktreeDaDemanda),
  );
});

test("CA-4: regravar no revisar_demanda seguinte substitui a matriz, rodada outra vez", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  comFitness(banco, [{ nome: "integracao", comando: "echo primeira", descricao: "d" }]);
  await prepararRevisaoDemanda(modulosDoCicloDeTeste(banco), REF_GLOBAL);
  comFitness(banco, [{ nome: "integracao", comando: "echo segunda", descricao: "d" }]);
  await prepararRevisaoDemanda(modulosDoCicloDeTeste(banco), REF_GLOBAL);
  const matrizes = matrizDoRevisor(banco);
  assert.equal(matrizes.length, 1);
  assert.match(JSON.stringify(matrizes[0]?.dados), /echo segunda/);
});

const linhasDaMatriz = (banco: Banco) =>
  (matrizDoRevisor(banco)[0]?.dados as { linhas: { codigoSaida: number | null; estourou: boolean; log: string }[] })
    .linhas;

// A matriz com fitness falhando fica gravada, com o log, e a recusa vem da aprovação (conferirAprovacao).
for (const [descricao, comando, codigoSaida] of [
  ["sai com código 1", "exit 1", 1],
  ["não existe (código 127)", "comando-que-nao-existe-i322", 127],
] as const) {
  test(`CA-3, CA-6: fitness que ${descricao} deixa a matriz gravada com a linha falhando`, async () => {
    const { banco } = await cenarioRevisao({ integral: true });
    comFitness(banco, [{ nome: "integracao", comando, descricao: "d" }]);
    await prepararRevisaoDemanda(modulosDoCicloDeTeste(banco), REF_GLOBAL);
    const [linha] = linhasDaMatriz(banco);
    assert.deepEqual([linha?.codigoSaida, linha?.estourou, linha?.log], [codigoSaida, false, "integracao.log"]);
    assert.equal(banco.prepare("SELECT caminho FROM arquivo_evidencia").all().length, 1);
  });
}

test("CA-6: fitness que estoura o tempo limite deixa a matriz gravada com estourou verdadeiro", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  comFitness(banco, [{ nome: "integracao", comando: "true", descricao: "d" }]);
  const modulos = modulosDoCicloDeTeste(banco);
  const estourada = { codigo: null, saida: "", erro: "", limiteEstourado: true, duracaoMs: 1 };
  const repositorio = {
    ...modulos.repositorio,
    prepararEspaco: async (...entrada: Parameters<typeof modulos.repositorio.prepararEspaco>) => {
      const espaco = await modulos.repositorio.prepararEspaco(...entrada);
      const ambiente = Object.create(espaco.ambiente, {
        executar: { value: () => Promise.resolve(estourada) },
      }) as typeof espaco.ambiente;
      return { ...espaco, ambiente };
    },
  };
  await prepararRevisaoDemanda({ banco, repositorio }, REF_GLOBAL);
  const [linha] = linhasDaMatriz(banco);
  assert.deepEqual([linha?.codigoSaida, linha?.estourou], [null, true]);
});

test("CA-7: worktree que não pode ser preparada falha antes de gravar a matriz", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const modulos = modulosDoCicloDeTeste(banco);
  const repositorio = { ...modulos.repositorio, prepararEspaco: () => Promise.reject(new Error("disco cheio")) };
  await assert.rejects(prepararRevisaoDemanda({ banco, repositorio: repositorio }, REF_GLOBAL), /disco cheio/);
  assert.equal(matrizDoRevisor(banco).length, 0);
});

test("recusa ticket inexistente", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  await assert.rejects(
    prepararRevisaoDemanda(modulosDoCicloDeTeste(banco), { ...REF_RODADA, ticket_id: 99 }),
    /I-1.T99 não existe/,
  );
});
