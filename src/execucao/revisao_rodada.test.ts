// Preparação da revisão de rodada com git real temporário (CA-3, CA-4).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { submeterEvidenciaDemanda } from "../dominio/evidencia_demanda.ts";
import { configuracaoProjeto, gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { caminhoArquivo } from "../persistencia/arquivos.ts";
import { carregarDemanda, comDemanda } from "../persistencia/demandas.ts";
import { commitarCenario, gitCenario } from "../repositorio/worktree-cenarios.ts";
import {
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeRodada,
} from "../repositorio/worktree-demanda.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "./revisao_cenario.test.ts";
import { conduzirRevisaoRodada, decidirRevisaoRodada, prepararRevisaoRodada } from "./revisao_rodada.ts";

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

const AGENTE = { tipo: "agente", execucao: 1, ticket: 2 } as const;
const comprov = (atendido: boolean) => ({ criterios: [{ id: "CA-1", atendido, arquivos: [] }] });

/** Submete as evidências do revisor: matriz da Fabriquinha e, se informadas, as do agente. */
function evidenciar(banco: Parameters<typeof carregarDemanda>[0], saida: number, comprovacao?: boolean) {
  const lista: [string, object][] = [
    ["matriz_fitness", { linhas: [{ nome: "f", comando: "c", codigoSaida: saida, log: "f.log" }] }],
    ["arquivos_alterados", { base: "a", head: "b", arquivos: [], previstosNaoTocados: [] }],
    ["explicacao_fitness", { explicacoes: [] }],
    ...(comprovacao === undefined ? [] : [["comprovacao_criterios", comprov(comprovacao)] as [string, object]]),
  ];
  comDemanda(banco, "I-1", (ag) =>
    lista.reduce(
      (a, [tipo, dados]) =>
        submeterEvidenciaDemanda(
          a,
          { tipo, dados, ticket_id: 2 } as never,
          { ferramenta: a.demanda.origem_ferramenta, sessao: a.demanda.origem_sessao },
          "2026-01-02T00:00:00.000Z",
        ),
      ag,
    ),
  );
}
const decidir = (banco: Parameters<typeof carregarDemanda>[0], extra: object) =>
  decidirRevisaoRodada(banco, { demanda_id: "I-1", rodada_id: 1, ticket_id: 2, ...extra } as never, AGENTE);
const rodadaFase = (banco: Parameters<typeof carregarDemanda>[0]) => carregarDemanda(banco, "I-1").rodadas[0]?.fase;

test("CA-5: aprovação recusada por fitness que falha; a rodada continua em revisao", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 1, true);
  assert.throws(() => decidir(banco, { aprovado: true }), /matriz_fitness.*fitness que falhou: f/);
  assert.equal(rodadaFase(banco), "revisao");
});

test("CA-6: aprovação recusada por comprovacao_criterios ausente ou reprovada", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 0);
  assert.throws(() => decidir(banco, { aprovado: true }), /comprovacao_criterios ausente/);
  evidenciar(banco, 0, false);
  assert.throws(() => decidir(banco, { aprovado: true }), /comprovacao_criterios reprovada/);
  assert.equal(rodadaFase(banco), "revisao");
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});

test("CA-7: aprovada vai a encerramento com encerrar_rodada aberto", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 0, true);
  decidir(banco, { aprovado: true });
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(rodadaFase(banco), "encerramento");
  assert.equal(ag.tickets.find((t) => t.etapa === "encerrar_rodada")?.status, "aberto");
});

test("CA-8: reprovada não confere evidências, volta a desenvolvimento com corretivos e exigências no motivo", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 1);
  decidir(banco, {
    aprovado: false,
    exigencias: "corrigir o lint",
    correcoes: [
      { demanda_id: "I-1", ticket_id: 1, rodada_id: 1, titulo: "corrige", descricao: "d", caminhos: [], depende: [] },
    ],
  });
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(rodadaFase(banco), "desenvolvimento");
  assert.equal(ag.tickets.filter((t) => t.etapa === "implementar" && t.status === "aberto").length, 1);
  assert.equal(ag.decisoes[0]?.motivo, "corrigir o lint");
});

test("CA-1: conduzirRevisaoRodada reserva o revisar_rodada, prepara e roda o pi na worktree da rodada", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  assert.equal(
    await conduzirRevisaoRodada(banco, { demanda_id: "I-1", rodada_id: 1 }, { limiteMin: 1 }),
    "aguardando_decisao",
  );
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.tickets.find((t) => t.ticket_id === 2)?.status, "em_execucao");
  assert.equal(evidencia(banco, "matriz_fitness").length, 1);
  assert.deepEqual(pastas(), [caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-1", rodada_id: 1 })]);
});

test("conduzirRevisaoRodada recusa rodada sem revisar_rodada", async () => {
  const { banco } = await cenarioRevisao();
  await assert.rejects(
    conduzirRevisaoRodada(banco, { demanda_id: "I-1", rodada_id: 9 }, { limiteMin: 1 }),
    /não tem ticket revisar_rodada/,
  );
});
