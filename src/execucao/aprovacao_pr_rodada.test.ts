// Aprovação do PR da rodada com banco real, git real (origin bare) e hospedagem falsa (CA-1 a CA-11 e CA-24 da I-229).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { AUDITOR } from "../dominio/agregado.ts";
import { ErroDeRegra, ErroDeEscopo } from "../dominio/erros.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { hospedagemFalsa } from "../repositorio/hospedagem-falsa.test.ts";
import { cenarioDemanda, commitarCenario, gitCenario } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { aprovarPRRodada } from "./aprovacao_pr_rodada.ts";

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
async function cenario(fase: "aprovacao_pull_request" | "concluida" = "aprovacao_pull_request", semPR = false) {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, 'integracao', 'github', 'k')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "integracao",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const ticket = (ticket_id: number, etapa: string, status: string) => ({
    demanda_id: DEMANDA,
    ticket_id,
    etapa,
    status,
    status_alterado_em: em,
    devolucoes: 0,
    rodada_id: 2,
  });
  criarDemanda(banco, {
    demanda: {
      id: DEMANDA,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      fase: "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [{ ...REF, titulo: "r2", fase, e2e: false, branch: BRANCH_RODADA }],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido"),
      ticket(7, "encerrar_rodada", "concluido"),
      ticket(8, "encerrar_rodada", "em_execucao"),
    ],
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
            dados: { id: "1", url: "https://github.com/org/loja/pull/1" },
            em,
          },
        ],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(c.raiz, c.projeto, DEMANDA, c.log, () => Promise.resolve());
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, REF, c.log);
  const commitDaRodada = commitarCenario(rodada, "a.txt", "a\n");
  gitCenario(c.repo, "push", "-q", "origin", BRANCH_DEMANDA, BRANCH_RODADA);
  hospedagem.abrir({ head: BRANCH_RODADA, base: BRANCH_DEMANDA, titulo: "t", corpo: "c", estado: "aberto" });
  return {
    c,
    banco,
    commitDaRodada,
    ag: () => carregarDemanda(banco, DEMANDA),
    fase: () => carregarDemanda(banco, DEMANDA).rodadas[0]?.fase,
    ticket: () => carregarDemanda(banco, DEMANDA).tickets.find((t) => t.ticket_id === 8),
    demandaLocal: () => gitCenario(c.repo, "rev-parse", BRANCH_DEMANDA),
    demandaRemota: () => gitCenario(c.bare, "rev-parse", BRANCH_DEMANDA),
  };
}

test("CA-1 a CA-4: aprova com nota 4, integra, avança a demanda e conclui a rodada e o ticket", async () => {
  const { c, banco, ag, fase, ticket, commitDaRodada, demandaLocal, demandaRemota } = await cenario();

  await aprovarPRRodada(banco, REF, 4, AUDITOR);

  gitCenario(c.repo, "merge-base", "--is-ancestor", commitDaRodada, BRANCH_DEMANDA);
  assert.equal(demandaLocal(), demandaRemota());
  assert.equal(fase(), "concluida");
  assert.equal(ticket()?.status, "concluido");
  assert.deepEqual(
    ag().decisoes.map((d) => [d.resultado, d.nota, d.por]),
    [["aprovado", 4, "auditor"]],
  );
});

test("CA-5 e CA-6: nota fora de 1 a 5 ou ausente é recusada sem integrar", async () => {
  const { banco, fase, demandaLocal } = await cenario();
  const antes = demandaLocal();

  await assert.rejects(aprovarPRRodada(banco, REF, 6, AUDITOR));
  await assert.rejects(aprovarPRRodada(banco, REF, undefined, AUDITOR));

  assert.equal(fase(), "aprovacao_pull_request");
  assert.equal(demandaLocal(), antes);
  assert.equal(hospedagem.prs()[0]?.estado, "aberto");
});

test("CA-7 e CA-8: a hospedagem recusa a integração, o gate fica, e a nova tentativa conclui", async () => {
  const { banco, ag, fase, ticket } = await cenario();
  hospedagem.mudar(1, { estado: "fechado" });

  await assert.rejects(aprovarPRRodada(banco, REF, 4, AUDITOR), /pr merge/);

  assert.equal(fase(), "aprovacao_pull_request");
  assert.equal(ticket()?.status, "em_execucao");
  assert.deepEqual(ag().decisoes, []);

  hospedagem.mudar(1, { estado: "aberto" });
  await aprovarPRRodada(banco, REF, 4, AUDITOR);
  assert.equal(fase(), "concluida");
});

test("CA-8: PR já mergeado pela hospedagem (queda após a integração) não integra de novo", async () => {
  const { c, banco, fase, demandaRemota } = await cenario();
  execFileSync("gh", ["pr", "merge", "1", "--merge"], { cwd: c.repo, stdio: "pipe" });
  const mergeado = demandaRemota();

  await aprovarPRRodada(banco, REF, 4, AUDITOR);

  assert.equal(fase(), "concluida");
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
  await assert.rejects(aprovarPRRodada(banco, REF, 4, { tipo: "agente", execucao: 1, ticket: 8 }), ErroDeEscopo);
});

test("rodada concluída sem decisão aprovada recusa a aprovação", async () => {
  const { banco } = await cenario("concluida");
  await assert.rejects(aprovarPRRodada(banco, REF, 4, AUDITOR), /outra decisão/);
});

test("rodada inexistente ou sem PR publicado é recusada", async () => {
  const { banco } = await cenario();
  await assert.rejects(aprovarPRRodada(banco, { ...REF, rodada_id: 9 }, 4, AUDITOR), /não existe/);
  const sem = await cenario("aprovacao_pull_request", true);
  await assert.rejects(aprovarPRRodada(sem.banco, REF, 4, AUDITOR), /não tem PR publicado/);
});

test("CA-11: o agente da rodada não aprova", async () => {
  const { banco, fase } = await cenario();

  await assert.rejects(aprovarPRRodada(banco, REF, 4, { tipo: "agente", execucao: 1, ticket: 8 }), ErroDeEscopo);

  assert.equal(fase(), "aprovacao_pull_request");
  assert.deepEqual(hospedagem.chamadas(), []);
});

test("CA-24: a mesma função serve a web e ao agendador (Auditor como ator) e conclui a rodada", async () => {
  const { banco, fase } = await cenario();
  await aprovarPRRodada(banco, REF, 4, AUDITOR);
  assert.equal(fase(), "concluida");
});
