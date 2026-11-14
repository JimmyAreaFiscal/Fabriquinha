// Preparação da revisão de rodada com git real temporário (CA-3, CA-4).
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { AUDITOR, FABRIQUINHA, Endereco } from "../../../etapas/publico.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { reabrirTicket, motivoDaFalhaDoTicket, carregarDemanda } from "../../../processo/publico.ts";
import { PREFIXO_TERCEIRA_REPROVACAO } from "../../../processo/nucleo/transicoes/transicoes_rodada.ts";
import { caminhoArquivo } from "../../../../../shared/armazenamento/arquivos.ts";
import { comDemanda } from "../../../processo/armazenamento/agregado_da_demanda.ts";
import { commitarArquivo, rodarGit } from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import {
  caminhoDaWorktreeDemanda,
  garantirWorktreeRodada,
} from "../../../../../../apoio-testes/repositorio_de_teste.ts";
import {
  abrirTrabalhoDoAgente,
  cenarioRevisao,
  comEvidencia,
  REF_GLOBAL,
  REF_RODADA,
} from "../../../../../../apoio-testes/cenarios/cenarios_de_demanda.ts";
import { decidirGate } from "../gates.ts";
import { prepararRevisaoRodada } from "./revisao_rodada.ts";
import { AmbienteHostLocal, modulosDoCicloDeTeste } from "../../../../../../apoio-testes/falsos/ambiente_falso.ts";
import { buscarProjeto, gravarProjeto } from "../../../../../../apoio-testes/demandas_de_teste.ts";

const ambiente = new AmbienteHostLocal();

const evidencia = (banco: Parameters<typeof carregarDemanda>[0], tipo: string) =>
  carregarDemanda(banco, "I-1").evidencias.filter((e) => e.ticket_id === 2 && e.tipo === tipo);

/** Cria a worktree da rodada, commita A/M/D nela e avança a branch da demanda depois. */
async function rodadaComAlteracoes(c: Awaited<ReturnType<typeof cenarioRevisao>>["c"]) {
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
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
  await prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA);
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
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  writeFileSync(join(rodada, "base.txt"), "base\nmais\n");
  rodarGit(rodada, "commit", "-qam", "m");
  await prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA);
  const dados = evidencia(banco, "arquivos_alterados")[0]?.dados as { arquivos: object[] };
  assert.deepEqual(dados.arquivos, [
    { caminho: "base.txt", status: "M", adicionadas: 1, removidas: 0, previsto: null },
  ]);
});

test("CA-4: uma linha por fitness, com o log como anexo e autor fabriquinha; regravar substitui", async () => {
  const { banco } = await cenarioRevisao();
  const projeto = buscarProjeto(banco, "loja");
  assert.ok(projeto);
  gravarProjeto(banco, {
    ...projeto,
    verificacoes: {
      ...projeto.verificacoes,
      fitness: [
        { nome: "boa", comando: "echo ok", descricao: "d" },
        { nome: "otima", comando: "echo certo", descricao: "d" },
      ],
    },
  });
  await prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA);
  await prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA);
  const evidencias = evidencia(banco, "matriz_fitness");
  assert.equal(evidencias.length, 1);
  const linhas = (evidencias[0]?.dados as { linhas: { nome: string; codigoSaida: number }[] }).linhas;
  assert.deepEqual(
    linhas.map((l) => [l.nome, l.codigoSaida]),
    [
      ["boa", 0],
      ["otima", 0],
    ],
  );
  const anexos = banco.prepare("SELECT caminho, sha256 FROM arquivo_evidencia ORDER BY ordem").all();
  assert.deepEqual(
    anexos.map((a) => a.caminho),
    ["boa.log", "otima.log"],
  );
  assert.match(readFileSync(caminhoArquivo(banco, String(anexos[1]?.sha256)), "utf8"), /certo/);
  assert.equal(evidencia(banco, "arquivos_alterados").length, 1);
  assert.deepEqual(evidencias[0]?.autor, FABRIQUINHA);
});

test("fitness que falha: erro e nenhuma das duas evidências fica gravada", async () => {
  const { banco } = await cenarioRevisao();
  const projeto = buscarProjeto(banco, "loja");
  assert.ok(projeto);
  gravarProjeto(banco, {
    ...projeto,
    verificacoes: { ...projeto.verificacoes, fitness: [{ nome: "ruim", comando: "exit 1", descricao: "d" }] },
  });
  await assert.rejects(
    prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA),
    /matriz_fitness.*todas_fitness_passam/,
  );
  assert.equal(evidencia(banco, "arquivos_alterados").length, 0);
  assert.equal(evidencia(banco, "matriz_fitness").length, 0);
});

test("recusa ticket inexistente, global e projeto sem configuração", async () => {
  const { banco } = await cenarioRevisao({ integral: true });
  const sem = await cenarioRevisao();
  sem.banco.exec("DELETE FROM linguagem_projeto");
  await assert.rejects(prepararRevisaoRodada(modulosDoCicloDeTeste(sem.banco), REF_RODADA), /não tem configuração/);
  await assert.rejects(
    prepararRevisaoRodada(modulosDoCicloDeTeste(banco), { demanda_id: "I-1", ticket_id: 99 }),
    /I-1.T99 não existe/,
  );
  await assert.rejects(prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_GLOBAL), /I-1.T3 não é de uma rodada/);
});

test("CA-3: renomeação casa o previsto pelo caminho antigo", async () => {
  const { c, banco } = await cenarioRevisao();
  banco.exec("INSERT INTO caminho_ticket VALUES ('I-1', 1, 'base.txt')");
  const rodada = await garantirWorktreeRodada(ambiente, c.raiz, c.projeto, { demanda_id: "I-1", rodada_id: 1 }, c.log);
  rodarGit(rodada, "mv", "base.txt", "nome.txt");
  rodarGit(rodada, "commit", "-qam", "r");
  await prepararRevisaoRodada(modulosDoCicloDeTeste(banco), REF_RODADA);
  const dados = evidencia(banco, "arquivos_alterados")[0]?.dados as { arquivos: object[]; previstosNaoTocados: [] };
  assert.deepEqual(dados.arquivos, [
    { caminho: "nome.txt", status: "R", adicionadas: 0, removidas: 0, previsto: "base.txt" },
  ]);
  assert.deepEqual(dados.previstosNaoTocados, []);
});

const revisorDaRodada = (banco: Parameters<typeof carregarDemanda>[0]) => abrirTrabalhoDoAgente(banco, REF_RODADA);
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
        comEvidencia(a, { tipo, dados, ticket_id: 2 } as never, a.demanda.criada_por, "2026-01-02T00:00:00.000Z"),
      ag,
    ),
  );
}
const decidir = (banco: Parameters<typeof carregarDemanda>[0], entrada: object, ator = revisorDaRodada(banco)) =>
  decidirGate(modulosDoCicloDeTeste(banco), "gate_revisao_rodada", Endereco.daRodada("I-1", 1), entrada, ator);
const estadoDaPrimeiraRodada = (banco: Parameters<typeof carregarDemanda>[0]) =>
  carregarDemanda(banco, "I-1").rodadas[0]?.estado;

test("CA-5: aprovação reprovada por fitness que falha; a rodada continua em revisao", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 1, true);
  await assert.rejects(decidir(banco, { resultado: "aprovado" }), /matriz_fitness.*fitness que falhou: f/);
  assert.equal(estadoDaPrimeiraRodada(banco), "revisar_rodada");
});

test("CA-6: aprovação reprovada por comprovacao_criterios ausente ou reprovada", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 0);
  await assert.rejects(decidir(banco, { resultado: "aprovado" }), /comprovacao_criterios ausente/);
  evidenciar(banco, 0, false);
  await assert.rejects(decidir(banco, { resultado: "aprovado" }), /comprovacao_criterios reprovada/);
  assert.equal(estadoDaPrimeiraRodada(banco), "revisar_rodada");
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});

test("CA-7: a aprovação vai a encerramento com encerrar_rodada aberto", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 0, true);
  await decidir(banco, { resultado: "aprovado" });
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(estadoDaPrimeiraRodada(banco), "encerrar_rodada");
  assert.equal(ag.tickets.find((t) => t.etapa === "encerrar_rodada")?.estado, "aberto");
  assert.deepEqual(ag.decisoes[0]?.por, revisorDaRodada(banco));
});

test("CA-8: reprovada não confere evidências, volta a desenvolvimento com corretivos e exigências no motivo", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 1);
  await decidir(banco, {
    resultado: "reprovado",
    motivo: "corrigir o lint",
    correcoes: [
      {
        demanda_id: "I-1",
        ticket_id: 1,
        rodada_id: 1,
        titulo: "corrige",
        descricao: "d",
        arquivos_previstos: [],
        depende: [],
      },
    ],
  });
  const ag = carregarDemanda(banco, "I-1");
  assert.equal(estadoDaPrimeiraRodada(banco), "implementar");
  assert.equal(ag.tickets.filter((t) => t.etapa === "implementar" && t.estado === "aberto").length, 1);
  assert.equal(ag.decisoes[0]?.motivo, "corrigir o lint");
});

test("CA-1 e CA-3: terceira reprovação falha o ticket sem corretivos; o Auditor reabre e a revisão decide de novo", async () => {
  const { banco } = await cenarioRevisao();
  const reprovado = (decisao_id: number, motivo: string) => ({
    demanda_id: "I-1",
    ticket_id: 2,
    decisao_id,
    gate: "gate_revisao_rodada" as const,
    resultado: "reprovado" as const,
    motivo,
    por: revisorDaRodada(banco),
    em: "2026-01-02T00:00:00.000Z",
  });
  comDemanda(banco, "I-1", (ag) => ({
    ...ag,
    tickets: ag.tickets.map((ticket) =>
      ticket.ticket_id === 2 ? { ...ticket, estado: "em_execucao" as const } : ticket,
    ),
    decisoes: [reprovado(1, "um"), reprovado(2, "dois")],
  }));
  const reprovar = () =>
    decidir(banco, {
      resultado: "reprovado",
      motivo: "três",
      correcoes: [{ demanda_id: "I-1", ticket_id: 1, rodada_id: 1 }],
    });
  const ticketRevisor = () => carregarDemanda(banco, "I-1").tickets.find((t) => t.ticket_id === 2);

  const ticketsAntes = carregarDemanda(banco, "I-1").tickets.length;
  await reprovar();
  assert.equal(ticketRevisor()?.estado, "falhou");
  const revisor = ticketRevisor();
  assert.ok(revisor);
  const motivoDaReprovacao = motivoDaFalhaDoTicket(carregarDemanda(banco, "I-1").tentativas, revisor);
  assert.ok(motivoDaReprovacao?.startsWith(PREFIXO_TERCEIRA_REPROVACAO));
  assert.match(motivoDaReprovacao ?? "", /um[\s\S]*dois[\s\S]*três/);
  assert.equal(carregarDemanda(banco, "I-1").tickets.length, ticketsAntes);
  assert.equal(estadoDaPrimeiraRodada(banco), "revisar_rodada");

  const reabrir = () =>
    comDemanda(banco, "I-1", (a) =>
      reabrirTicket(a, { ticket_id: 2, instrucao: "aceite como observação" }, AUDITOR, {
        agora: "2026-01-03T00:00:00.000Z",
      }),
    );
  reabrir();
  await reprovar();
  assert.equal(ticketRevisor()?.estado, "falhou");
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 4);

  reabrir();
  evidenciar(banco, 0, true);
  await decidir(banco, { resultado: "aprovado" });
  assert.equal(estadoDaPrimeiraRodada(banco), "encerrar_rodada");
});

test("I-266: a decisão do agente com o trabalho de outro ticket é reprovada e nada é gravado", async () => {
  const { banco } = await cenarioRevisao();
  evidenciar(banco, 0, true);
  const deOutroTicket = abrirTrabalhoDoAgente(banco, REF_GLOBAL);
  await assert.rejects(decidir(banco, { resultado: "aprovado" }, deOutroTicket), ErroDeRegra);
  assert.equal(carregarDemanda(banco, "I-1").decisoes.length, 0);
});
