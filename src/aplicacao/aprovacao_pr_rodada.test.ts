// Aprovação do PR da rodada com banco real, git real (origin bare) e hospedagem falsa (CA-1 a CA-11 e CA-24 da I-229).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { abrirBancoTemporario } from "../../apoio-testes/banco_temporario.ts";
import type { AgregadoDemanda } from "../nucleo/agregado_demanda.ts";
import { AUDITOR } from "../nucleo/ator.ts";
import { MOTIVO_APROVACAO_AUTOMATICA_PR } from "../nucleo/transicoes_rodada.ts";
import { ErroDeRegra, ErroDeEscopo } from "../nucleo/erros.ts";
import { registrarProjeto } from "./projeto/cadastro.ts";
import { carregarDemanda } from "../armazenamento/demandas.ts";
import { gravarAgregadoPronto } from "../../apoio-testes/cenarios_de_demanda.ts";
import { hospedagemFalsa } from "../../apoio-testes/hospedagem_falsa.ts";
import { criarRepositorioDeTeste, commitarArquivo, rodarGit } from "../../apoio-testes/repositorio_de_teste.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../infra/repositorio/worktree-demanda.ts";
import { aprovarPRRodada, aprovarPRRodadaSeAutomatico } from "./aprovacao_pr_rodada.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-aprovacao-")));
const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});
const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const DEMANDA = "I-206";
const REF = { demanda_id: DEMANDA, rodada_id: 2 };
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-2";

/** Demanda I-206 com a rodada 2 no gate do PR: commit na rodada, ambas as branches no origin, PR 1 aberto. */
async function cenario(estado: "gate_pr" | "concluida" = "gate_pr", semPR = false) {
  const c = criarRepositorioDeTeste();
  const { banco } = abrirBancoTemporario(c.raiz);
  abertos.push(banco);
  registrarProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    verificacoes: {
      fitness: [{ nome: "f", comando: "true", descricao: "d" }],
      linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
    },
  });
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    estado: status,
    estado_alterado_em: em,
    criado_por: { tipo: "fabriquinha" },
    rodada_id: 2,
  });
  gravarAgregadoPronto(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      estado: "em_execucao",
      estado_alterado_em: em,
      criada_por: { tipo: "externo", ferramenta: "claude", sessao: "s1" },
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [
      {
        ...REF,
        titulo: "r2",
        estado,
        estado_alterado_em: "2026-01-01T00:00:00.000Z",
        e2e: false,
        branch: BRANCH_RODADA,
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido"),
      ticket(7, "encerrar_rodada", "concluido"),
      ticket(8, "encerrar_rodada", "em_execucao"),
    ],
    tentativas: [],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: semPR
      ? []
      : [
          {
            demanda_id: DEMANDA,
            ticket_id: 8,
            tipo: "pr_aberto",
            autor: { tipo: "fabriquinha" },
            dados: { id: "1", url: "https://github.com/org/loja/pull/1" },
            em,
          },
        ],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(c.raiz, c.projeto, DEMANDA, c.log, () => Promise.resolve());
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, REF, c.log);
  const commitDaRodada = commitarArquivo(rodada, "a.txt", "a\n");
  rodarGit(c.repo, "push", "-q", "origin", BRANCH_DEMANDA, BRANCH_RODADA);
  hospedagem.abrirPr({ head: BRANCH_RODADA, base: BRANCH_DEMANDA, titulo: "t", corpo: "c", estado: "aberto" });
  return {
    c,
    banco,
    commitDaRodada,
    ag: () => carregarDemanda(banco, DEMANDA),
    estado: () => carregarDemanda(banco, DEMANDA).rodadas[0]?.estado,
    ticket: () => carregarDemanda(banco, DEMANDA).tickets.find((t) => t.ticket_id === 8),
    demandaLocal: () => rodarGit(c.repo, "rev-parse", BRANCH_DEMANDA),
    demandaRemota: () => rodarGit(c.bare, "rev-parse", BRANCH_DEMANDA),
  };
}

test("CA-1 a CA-4: aprova com nota 4, integra, avança a demanda e conclui a rodada e o ticket", async () => {
  const { c, banco, ag, estado, ticket, commitDaRodada, demandaLocal, demandaRemota } = await cenario();

  await aprovarPRRodada(banco, REF, 4, AUDITOR);

  rodarGit(c.repo, "merge-base", "--is-ancestor", commitDaRodada, BRANCH_DEMANDA);
  assert.equal(demandaLocal(), demandaRemota());
  assert.equal(estado(), "concluida");
  assert.equal(ticket()?.estado, "concluido");
  assert.deepEqual(
    ag().decisoes.map((d) => [d.resultado, d.nota, d.por]),
    [["aprovado", 4, AUDITOR]],
  );
});

test("CA-5 e CA-6: nota fora de 1 a 5 ou ausente é recusada sem integrar", async () => {
  const { banco, estado, demandaLocal } = await cenario();
  const antes = demandaLocal();

  await assert.rejects(aprovarPRRodada(banco, REF, 6, AUDITOR));
  await assert.rejects(aprovarPRRodada(banco, REF, undefined, AUDITOR));

  assert.equal(estado(), "gate_pr");
  assert.equal(demandaLocal(), antes);
  assert.equal(hospedagem.prs()[0]?.estado, "aberto");
});

test("CA-7 e CA-8: a hospedagem recusa a integração, o gate fica, e a nova tentativa conclui", async () => {
  const { banco, ag, estado, ticket } = await cenario();
  hospedagem.fecharPr(1);

  await assert.rejects(aprovarPRRodada(banco, REF, 4, AUDITOR), /pr merge/);

  assert.equal(estado(), "gate_pr");
  assert.equal(ticket()?.estado, "em_execucao");
  assert.deepEqual(ag().decisoes, []);

  hospedagem.mudar(1, { estado: "aberto" });
  await aprovarPRRodada(banco, REF, 4, AUDITOR);
  assert.equal(estado(), "concluida");
});

test("CA-8: PR já mergeado pela hospedagem (queda após a integração) não integra de novo", async () => {
  const { c, banco, estado, demandaRemota } = await cenario();
  execFileSync("gh", ["pr", "merge", "1", "--merge"], { cwd: c.repo, stdio: "pipe" });
  const mergeado = demandaRemota();

  await aprovarPRRodada(banco, REF, 4, AUDITOR);

  assert.equal(estado(), "concluida");
  assert.equal(demandaRemota(), mergeado);
  assert.equal(hospedagem.chamadas().filter((x) => x.args[1] === "merge").length, 1);
});

test("CA-9 e CA-10: reaplicar a mesma aprovação é no-op; nota diferente é recusada", async () => {
  const { banco, ag, demandaLocal } = await cenario();
  await aprovarPRRodada(banco, REF, 4, AUDITOR);
  const depois = demandaLocal();
  const chamadas = hospedagem.chamadas().length;

  await aprovarPRRodada(banco, REF, 4, AUDITOR);

  assert.equal(demandaLocal(), depois);
  assert.equal(ag().decisoes.length, 1);
  assert.equal(hospedagem.chamadas().length, chamadas);
  await assert.rejects(aprovarPRRodada(banco, REF, 5, AUDITOR), ErroDeRegra);
  await assert.rejects(aprovarPRRodada(banco, REF, 4, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);
});

test("rodada concluída sem decisão aprovada recusa a aprovação", async () => {
  const { banco } = await cenario("concluida");
  await assert.rejects(aprovarPRRodada(banco, REF, 4, AUDITOR), /outra decisão/);
});

test("rodada inexistente ou sem PR publicado é recusada", async () => {
  const { banco } = await cenario();
  await assert.rejects(aprovarPRRodada(banco, { ...REF, rodada_id: 9 }, 4, AUDITOR), /não existe/);
  const sem = await cenario("gate_pr", true);
  await assert.rejects(aprovarPRRodada(sem.banco, REF, 4, AUDITOR), /não tem PR publicado/);
});

test("CA-11: o agente da rodada não aprova", async () => {
  const { banco, estado } = await cenario();

  await assert.rejects(aprovarPRRodada(banco, REF, 4, { tipo: "agente", trabalho_id: "1" }), ErroDeEscopo);

  assert.equal(estado(), "gate_pr");
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("CA-24: a mesma função serve a web e ao agendador (Auditor como ator) e conclui a rodada", async () => {
  const { banco, estado } = await cenario();
  await aprovarPRRodada(banco, REF, 4, AUDITOR);
  assert.equal(estado(), "concluida");
});

const LIGADA = { FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA: "outro, loja" };

test("aprovação automática ligada para o projeto: integra o PR que chegou ao gate e conclui a rodada sem nota", async () => {
  const { c, banco, ag, estado, commitDaRodada, demandaLocal, demandaRemota } = await cenario();

  await aprovarPRRodadaSeAutomatico(banco, ag(), REF, LIGADA);

  rodarGit(c.repo, "merge-base", "--is-ancestor", commitDaRodada, BRANCH_DEMANDA);
  assert.equal(demandaLocal(), demandaRemota());
  assert.equal(estado(), "concluida");
  assert.deepEqual(
    ag().decisoes.map((d) => [d.resultado, d.nota, d.motivo]),
    [["aprovado", undefined, MOTIVO_APROVACAO_AUTOMATICA_PR]],
  );
});

test("sem a opção, com outro projeto nela ou fora do gate, a aprovação automática não faz nada", async () => {
  const { banco, ag, estado } = await cenario();
  for (const env of [{}, { FABRIQUINHA_APROVACAO_AUTOMATICA_PR_RODADA: "lojas,outro" }]) {
    await aprovarPRRodadaSeAutomatico(banco, ag(), REF, env);
  }
  await aprovarPRRodadaSeAutomatico(banco, { ...ag(), rodadas: [] }, REF, LIGADA);

  assert.equal(estado(), "gate_pr");
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("a hospedagem recusa a integração automática: o gate fica aberto para o Auditor, sem lançar", async () => {
  const { banco, ag, estado } = await cenario();
  hospedagem.fecharPr(1);

  await aprovarPRRodadaSeAutomatico(banco, ag(), REF, LIGADA);

  assert.equal(estado(), "gate_pr");
  assert.deepEqual(ag().decisoes, []);
});
