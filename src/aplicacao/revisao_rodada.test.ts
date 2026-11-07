// Preparação da revisão de rodada com git real temporário (CA-3, CA-4).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA } from "../nucleo/ator.ts";
import { submeterEvidenciaDemanda } from "../nucleo/evidencia_demanda.ts";
import { reabrirTicket } from "../nucleo/transicoes_demanda.ts";
import { PREFIXO_TERCEIRA_REPROVACAO } from "../nucleo/transicoes_rodada.ts";
import { configuracaoProjeto, gravarConfiguracaoProjeto } from "../armazenamento/configuracao_projeto.ts";
import { caminhoArquivo } from "../armazenamento/arquivos.ts";
import { carregarDemanda, comDemanda } from "../armazenamento/demandas.ts";
import { commitarArquivo, rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import {
  caminhoDaWorktreeDemanda,
  caminhoDaWorktreeRodada,
  garantirWorktreeRodada,
} from "../infra/repositorio/worktree-demanda.ts";
import { cenarioRevisao, REF_GLOBAL, REF_RODADA } from "../../apoio-testes/cenarios_de_demanda.ts";
import { conduzirRevisaoRodada, decidirRevisaoRodada, prepararRevisaoRodada } from "./revisao_rodada.ts";

const evidencia = (banco: Parameters<typeof carregarDemanda>[0], tipo: string) =>
  carregarDemanda(banco, "I-1").evidencias.filter((e) => e.ticket_id === 2 && e.tipo === tipo);

/** Cria a worktree da rodada, commita A/M/D nela e avança a branch da demanda depois. */
async function rodadaComAlteracoes(c: Awaited<ReturnType<typeof cenarioRevisao>>["c"]) {
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  commitarArquivo(rodada, "novo.ts", "a\n");
  writeFileSync(join(rodada, "base.txt"), "base\nmais\n");
  rodarGit(rodada, "commit", "-qam", "m");
  rodarGit(rodada, "rm", "-q", "base.txt");
  commitarArquivo(rodada, "outro.md", "x\n");
  const demanda = caminhoDaWorktreeDemanda(c.raiz, "loja", "I-1");
  const ponta = commitarArquivo(demanda, "da-demanda.txt", "d\n");
  return { rodada, ponta, head: rodarGit(rodada, "rev-parse", "HEAD") };
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
  assert.deepEqual(e?.autor, FABRIQUINHA);
});

test("CA-3: arquivo modificado aparece como M", async () => {
  const { c, banco } = await cenarioRevisao();
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  writeFileSync(join(rodada, "base.txt"), "base\nmais\n");
  rodarGit(rodada, "commit", "-qam", "m");
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
  assert.deepEqual(evidencias[0]?.autor, FABRIQUINHA);
});

test("recusa ticket inexistente, global e projeto sem configuração", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const sem = await cenarioRevisao();
  sem.banco.exec("DELETE FROM linguagem_projeto");
  await assert.rejects(prepararRevisaoRodada(sem.banco, REF_RODADA), /não tem configuração/);
  await assert.rejects(prepararRevisaoRodada(banco, { demanda_id: "I-1", ticket_id: 99 }), /I-1.T99 não existe/);
  await assert.rejects(prepararRevisaoRodada(banco, REF_GLOBAL), /I-1.T3 não é de uma rodada/);
});

test("CA-3: renomeação casa o previsto pelo caminho antigo", async () => {
  const { c, banco } = await cenarioRevisao();
  banco.exec("INSERT INTO caminho_ticket VALUES ('I-1', 1, 'base.txt')");
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  rodarGit(rodada, "mv", "base.txt", "nome.txt");
  rodarGit(rodada, "commit", "-qam", "r");
  await prepararRevisaoRodada(banco, REF_RODADA);
  const dados = evidencia(banco, "arquivos_alterados")[0]?.dados as { arquivos: object[]; previstosNaoTocados: [] };
  assert.deepEqual(dados.arquivos, [
    { caminho: "nome.txt", status: "R", adicionadas: 0, removidas: 0, previsto: "base.txt" },
  ]);
  assert.deepEqual(dados.previstosNaoTocados, []);
});

const AGENTE = { tipo: "agente", trabalho_id: "1" } as const;
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
          a.demanda.criada_por,
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
  assert.deepEqual(ag.decisoes[0]?.por, AGENTE);
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

test("CA-1 e CA-3: terceira reprovação falha o ticket sem corretivos; o Auditor reabre e a revisão decide de novo", async () => {
  const { banco } = await cenarioRevisao();
  const recusado = (decisao_id: number, motivo: string) => ({
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id,
    resultado: "recusado" as const,
    motivo,
    por: AGENTE,
    em: "2026-01-02T00:00:00.000Z",
  });
  comDemanda(banco, "I-1", (ag) => ({ ...ag, decisoes: [recusado(1, "um"), recusado(2, "dois")] }));
  const reprovar = () =>
    decidir(banco, {
      aprovado: false,
      exigencias: "três",
      correcoes: [{ demanda_id: "I-1", ticket_id: 1, rodada_id: 1 }],
    });
  const ticketRevisor = () => carregarDemanda(banco, "I-1").tickets.find((t) => t.ticket_id === 2);

  const ticketsAntes = carregarDemanda(banco, "I-1").tickets.length;
  reprovar();
  assert.equal(ticketRevisor()?.status, "falhou");
  assert.ok(ticketRevisor()?.motivo_falha?.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.match(ticketRevisor()?.motivo_falha ?? "", /um[\s\S]*dois[\s\S]*três/);
  assert.equal(carregarDemanda(banco, "I-1").tickets.length, ticketsAntes);
  assert.equal(rodadaFase(banco), "revisao");

  const reabrir = () =>
    comDemanda(banco, "I-1", (a) =>
      reabrirTicket(a, { ticket_id: 2, instrucao: "aceite como observação" }, AUDITOR, {
        agora: "2026-01-03T00:00:00.000Z",
      }),
    );
  reabrir();
  reprovar();
  assert.equal(ticketRevisor()?.status, "falhou");
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 4);

  reabrir();
  evidenciar(banco, 0, true);
  decidir(banco, { aprovado: true });
  assert.equal(rodadaFase(banco), "encerramento");
});

test("CA-1: conduzirRevisaoRodada reserva o revisar_rodada, prepara e roda o pi na worktree da rodada", async () => {
  const { c, banco, pastas } = await cenarioRevisao();
  assert.equal(await conduzirRevisaoRodada(banco, { demanda_id: "I-1", rodada_id: 1 }, { limiteMin: 1 }), "falhou");
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(ag.tickets.find((t) => t.ticket_id === 2)?.status, "falhou");
  assert.equal(evidencia(banco, "matriz_fitness").length, 1);
  assert.deepEqual(pastas(), [caminhoDaWorktreeRodada(c.raiz, "loja", { demanda_id: "I-1", rodada_id: 1 })]);
});

test("conduzirRevisaoRodada recusa rodada sem revisar_rodada", async () => {
  const { banco } = await cenarioRevisao();
  await assert.rejects(
    conduzirRevisaoRodada(banco, { demanda_id: "I-1", rodada_id: 9 }, { limiteMin: 1 }),
    /I-1.R9 não tem ticket revisar_rodada/,
  );
});
