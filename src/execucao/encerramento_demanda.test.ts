// Encerramento final da demanda com banco real, git real e hospedagem falsa (CA-1 a CA-6, 9, 10, 12, 13 e 16 da I-231).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import { FABRIQUINHA } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeRegra } from "../dominio/erros.ts";
import { concluirResolucaoConflito, podeTentarEncerramento } from "../dominio/transicoes_encerramento.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarCommitDemanda } from "../persistencia/commits_demanda.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { hospedagemFalsa } from "../repositorio/hospedagem-falsa.test.ts";
import { pendenciasDeLimpeza } from "../repositorio/limpeza_demanda.ts";
import { cenarioDemanda, commitarCenario, gitCenario } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { conduzirEncerramentoDemanda } from "./encerramento_demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-encerramento-demanda-")));
// A credencial do serviço, que os comandos de PR precisam ver.
process.env.GH_TOKEN = "token-do-servico";

const hospedagem = hospedagemFalsa(temporario);
beforeEach(() => {
  hospedagem.zerar();
});

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const D = "I-206";
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-1";
const REF = { demanda_id: D, rodada_id: 1 };
const URL_PR = "https://github.com/org/loja/pull/1";

interface Opcoes {
  status?: "aberto" | "em_execucao";
  fase?: "encerramento" | "execucao";
  semTicket?: boolean;
  encerramento?: object;
}

/** Projeto `loja` com base `develop`; demanda I-206 em encerramento, com a rodada 1 e um commit de ticket na demanda. */
async function cenario({
  status = "em_execucao",
  fase = "encerramento",
  semTicket = false,
  encerramento,
}: Opcoes = {}) {
  const c = cenarioDemanda([], "develop");
  const banco = abrir(c.raiz);
  abertos.push(banco);
  banco
    .prepare(
      `INSERT INTO projeto (nome, repo, branch_base, hospedagem, sonar_project_key)
       VALUES ('loja', ?, 'develop', 'github', 'k')`,
    )
    .run(c.repo);
  gravarConfiguracaoProjeto(banco, {
    nome: "loja",
    branch_base: "develop",
    chave_sonarqube: "k",
    raiz_git: c.repo,
    hospedagem: "github",
    etapas: [],
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: "true" }],
  });
  const ticket = (ticket_id: number, etapa: string, st: string, extra: object = {}) => ({
    demanda_id: D,
    ticket_id,
    etapa,
    status: st,
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  criarDemanda(banco, {
    demanda: {
      id: D,
      projeto: "loja",
      titulo: "Demanda",
      tipo: "funcionalidade",
      descricao: "d",
      fase,
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: BRANCH_DEMANDA,
    },
    rodadas: [{ ...REF, titulo: "r1", fase: "concluida", e2e: false, branch: BRANCH_RODADA }],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(3, "implementar", "concluido", { titulo: "Primeiro", rodada_id: 1 }),
      ...(semTicket ? [] : [ticket(8, "encerrar_demanda", status)]),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
    ...(encerramento && { encerramento }),
  } as unknown as AgregadoDemanda);
  const demanda = await garantirWorktreeDemanda(c.raiz, c.projeto, D, c.log, () => Promise.resolve());
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, REF, c.log);
  /** Commita na demanda e, com `ticket`, registra o commit como desse ticket. */
  const commitar = (arquivo: string, ticketId?: number) => {
    const sha = commitarCenario(demanda, arquivo, `${arquivo}\n`);
    if (ticketId !== undefined) {
      gravarCommitDemanda(banco, D, ticketId, {
        sha,
        mensagem: `feat: ${arquivo} [I-206/T-${String(ticketId)}]`,
        em,
        arquivos: [],
      });
    }
    return sha;
  };
  commitar("a.txt", 3);
  gitCenario(c.repo, "push", "-q", "origin", BRANCH_RODADA);
  gitCenario(c.repo, "branch", "alheia", "develop");
  gitCenario(c.repo, "push", "-q", "origin", "alheia");
  return {
    ...c,
    banco,
    demanda,
    rodada,
    commitar,
    ag: () => carregarDemanda(banco, D),
    ticket: () => carregarDemanda(banco, D).tickets.find((t) => t.ticket_id === 8),
    noRemoto: (branch: string) =>
      gitCenario(c.bare, "for-each-ref", "--format=%(refname:short)", `refs/heads/${branch}`),
    /** Como o agendador: reserva o `encerrar_demanda` aberto. */
    reservar: () =>
      comDemanda(banco, D, (a) => ({
        ...a,
        tickets: a.tickets.map((t) => (t.ticket_id === 8 ? { ...t, status: "em_execucao" as const } : t)),
      })),
  };
}

const merges = () => hospedagem.chamadas().filter((x) => x.args.slice(0, 2).join(" ") === "pr merge");

test("CA-1, CA-9, CA-11, CA-13, CA-14 e CA-15: PR final para a base configurada, integra com o SHA, limpa e conclui", async () => {
  const c = await cenario();

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  const [pr] = hospedagem.prs();
  assert.equal(hospedagem.prs().length, 1);
  assert.deepEqual([pr?.head, pr?.base], [BRANCH_DEMANDA, "develop"]);
  assert.equal(pr?.titulo, "feat: Demanda [I-206]");
  assert.ok(pr.corpo.startsWith("<!-- fabriquinha I-206 -->"));
  assert.deepEqual(ag.encerramento?.pr, { numero: 1, url: URL_PR });
  assert.equal(ag.encerramento.base, "develop");
  assert.equal(ag.encerramento.integracao?.sha, pr.mergeSha);
  assert.deepEqual(ag.encerramento.limpeza_pendente, []);
  assert.equal(ag.demanda.fase, "concluida");
  assert.equal(c.ticket()?.status, "concluido");
  // A base e a branch alheia ficam; tudo o que a Fabriquinha criou some, local e remotamente.
  assert.equal(c.noRemoto("develop"), "develop");
  assert.equal(c.noRemoto("alheia"), "alheia");
  assert.equal(c.noRemoto(BRANCH_DEMANDA), "");
  assert.equal(c.noRemoto(BRANCH_RODADA), "");
  assert.equal(gitCenario(c.repo, "branch", "--list", "develop", "alheia", "fabriquinha/*").split("\n").length, 2);
  assert.equal(existsSync(c.demanda) || existsSync(c.rodada), false);
  const tipos = ag.evidencias.filter((e) => e.ticket_id === 8).map((e) => e.tipo);
  assert.deepEqual(tipos.toSorted(), ["arvore_prs_criterios_custos", "demonstracao_limpeza"]);
  const limpeza = ag.evidencias.find((e) => e.tipo === "demonstracao_limpeza")?.dados as {
    removidas: { tipo: string }[];
    sobras: unknown[];
    aprovada: boolean;
  };
  assert.equal(limpeza.removidas.length, 6);
  assert.deepEqual([limpeza.sobras, limpeza.aprovada], [[], true]);
  const arvore = ag.evidencias.find((e) => e.tipo === "arvore_prs_criterios_custos")?.dados as {
    sha_integracao: string;
    custos: { internos: { situacao: string }; externos: { total: { valor: number } } };
  };
  assert.equal(arvore.sha_integracao, pr.mergeSha);
  assert.equal(arvore.custos.internos.situacao, "conhecido");
  assert.equal(arvore.custos.externos.total.valor, 0);
});

test("CA-2: com o PR final no progresso nenhum PR novo é criado e o progresso mantém o mesmo PR", async () => {
  const c = await cenario({
    encerramento: {
      demanda_id: D,
      branch: BRANCH_DEMANDA,
      base: "develop",
      pr: { numero: 1, url: URL_PR },
      sha_verificado: "velho",
      limpeza_pendente: [],
    },
  });
  hospedagem.abrir({ head: BRANCH_DEMANDA, base: "develop", titulo: "velho", corpo: "sem marca", estado: "aberto" });
  // Evidência de uma tentativa que caiu antes de concluir: a nova a substitui.
  comDemanda(c.banco, D, (a) => ({
    ...a,
    evidencias: [
      { demanda_id: D, ticket_id: 8, tipo: "demonstracao_limpeza", dados: { velha: true }, em },
      { demanda_id: D, ticket_id: 3, tipo: "arvore_prs_criterios_custos", dados: { de: "outro ticket" }, em },
    ] as never,
  }));

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  assert.deepEqual(ag.evidencias.map((e) => [e.ticket_id, e.tipo]).toSorted(), [
    [3, "arvore_prs_criterios_custos"],
    [8, "arvore_prs_criterios_custos"],
    [8, "demonstracao_limpeza"],
  ]);

  assert.equal(hospedagem.prs().length, 1);
  assert.deepEqual(ag.encerramento?.pr, { numero: 1, url: URL_PR });
  assert.equal(ag.demanda.fase, "concluida");
});

test("CA-3: PR aberto fora da Fabriquinha: nenhum push, o erro aponta o PR e o ticket falha sem laço", async () => {
  const c = await cenario();
  hospedagem.abrir({ head: BRANCH_DEMANDA, base: "develop", titulo: "meu", corpo: "de fora", estado: "aberto" });

  await assert.rejects(
    conduzirEncerramentoDemanda(c.banco, D),
    (e: Error) => e instanceof ErroDeRegra && e.message.includes(`PR criado fora da Fabriquinha: ${URL_PR}`),
  );

  assert.equal(c.noRemoto(BRANCH_DEMANDA), "");
  assert.equal(c.ticket()?.status, "falhou");
  assert.match(c.ticket()?.motivo_falha ?? "", /fora da Fabriquinha/);
  assert.equal(c.ag().encerramento, undefined);
  assert.equal(c.ag().demanda.fase, "encerramento");
});

test("commit de agente fora do desenvolvimento não sobe: o ticket falha antes da tentativa", async () => {
  const c = await cenario();
  c.commitar("intruso.txt");

  await assert.rejects(conduzirEncerramentoDemanda(c.banco, D), /nenhum ticket da I-206 registrou/);

  assert.equal(c.noRemoto(BRANCH_DEMANDA), "");
  assert.deepEqual(hospedagem.prs(), []);
  assert.equal(c.ticket()?.status, "falhou");
});

test("CA-4: check final falho falha o ticket em check_final, sem integração, limpeza nem agente", async () => {
  const c = await cenario();
  hospedagem.abrir({
    head: BRANCH_DEMANDA,
    base: "develop",
    titulo: "x",
    corpo: "<!-- fabriquinha I-206 -->",
    estado: "aberto",
    checks: [{ nome: "ci", estado: "falho" }],
  });

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  assert.equal(c.ticket()?.status, "falhou");
  assert.equal(ag.encerramento?.falha?.etapa, "check_final");
  assert.match(ag.encerramento.falha.motivo, /ci/);
  assert.equal(ag.encerramento.integracao, undefined);
  assert.equal(ag.demanda.fase, "encerramento");
  assert.deepEqual(merges(), []);
  assert.equal(existsSync(c.demanda), true);
  assert.equal(c.noRemoto(BRANCH_RODADA), BRANCH_RODADA);
  assert.deepEqual(ag.evidencias, []);
});

test("CA-4: PR que a plataforma não decide no limite falha o ticket em check_final", async () => {
  const c = await cenario();
  hospedagem.abrir({
    head: BRANCH_DEMANDA,
    base: "develop",
    titulo: "x",
    corpo: "<!-- fabriquinha I-206 -->",
    estado: "aberto",
    conflito: "calculando",
  });

  const ag = await conduzirEncerramentoDemanda(c.banco, D, { verificacao: { limiteMs: 0 } });

  assert.equal(ag.encerramento?.falha?.etapa, "check_final");
  assert.match(ag.encerramento.falha.motivo, /não ficou decidido/);
  assert.deepEqual(merges(), []);
});

test("CA-5 e CA-6: conflito cria o resolver_conflito e devolve o ticket; resolvido, tenta de novo e reaproveita o PR", async () => {
  const c = await cenario();
  hospedagem.abrir({
    head: BRANCH_DEMANDA,
    base: "develop",
    titulo: "x",
    corpo: "<!-- fabriquinha I-206 -->",
    estado: "aberto",
    conflito: true,
  });

  const conflito = await conduzirEncerramentoDemanda(c.banco, D);

  assert.equal(c.ticket()?.status, "aberto");
  const resolver = conflito.tickets.find((t) => t.etapa === "resolver_conflito");
  assert.equal(resolver?.status, "aberto");
  assert.equal(conflito.encerramento?.conflito_pendente?.ticket_id, resolver.ticket_id);
  assert.equal(conflito.encerramento.integracao, undefined);
  assert.deepEqual(merges(), []);
  assert.equal(podeTentarEncerramento(conflito), false);

  // O resolver_conflito concluiu com tudo aprovado (fechamento_ticket); o agendador reserva o encerramento de novo.
  comDemanda(c.banco, D, (a) =>
    concluirResolucaoConflito(
      a,
      { demanda_id: D, testes: true, fitness: true, sonar: true, sha: "novo" },
      FABRIQUINHA,
      { agora: em },
    ),
  );
  assert.equal(podeTentarEncerramento(c.ag()), true);
  hospedagem.mudar(1, { conflito: false });
  c.reservar();

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  assert.equal(hospedagem.prs().length, 1);
  assert.equal(ag.encerramento?.conflito_pendente, undefined);
  assert.equal(ag.demanda.fase, "concluida");
  assert.equal(
    ag.tickets.some((t) => t.etapa === "revisar_demanda" || t.etapa === "encerrar_rodada"),
    false,
  );
});

test("falha da hospedagem na integração falha o ticket em integracao, sem registrar integração nem limpar", async () => {
  const c = await cenario();
  hospedagem.falhar("pr merge", "merge bloqueado");

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  assert.equal(c.ticket()?.status, "falhou");
  assert.equal(ag.encerramento?.falha?.etapa, "integracao");
  assert.match(ag.encerramento.falha.motivo, /merge bloqueado/);
  assert.equal(ag.encerramento.integracao, undefined);
  assert.equal(existsSync(c.demanda), true);
});

test("CA-10, CA-12 e CA-13: a limpeza que falha mantém a integração; reaberto, só a limpeza pendente roda", async () => {
  const c = await cenario();
  gitCenario(c.repo, "worktree", "lock", c.rodada);

  const parcial = await conduzirEncerramentoDemanda(c.banco, D);

  const sha = parcial.encerramento?.integracao?.sha;
  assert.ok(sha);
  assert.equal(c.ticket()?.status, "falhou");
  assert.equal(parcial.encerramento?.falha?.etapa, "limpeza");
  assert.deepEqual(parcial.encerramento.limpeza_pendente.toSorted(), [
    `branch_local:${BRANCH_RODADA}`,
    `worktree:${c.rodada}`,
  ]);
  assert.equal(parcial.demanda.fase, "encerramento");
  assert.equal(existsSync(c.demanda), false);
  assert.equal(merges().length, 1);

  // O Auditor reabre; o agendador reserva.
  gitCenario(c.repo, "worktree", "unlock", c.rodada);
  comDemanda(c.banco, D, (a) => ({
    ...a,
    tickets: a.tickets.map((t) => (t.ticket_id === 8 ? { ...t, status: "em_execucao" as const } : t)),
  }));
  const chamadas = hospedagem.chamadas().length;

  const ag = await conduzirEncerramentoDemanda(c.banco, D);

  assert.equal(hospedagem.chamadas().length, chamadas);
  assert.equal(ag.encerramento?.integracao?.sha, sha);
  assert.equal(ag.demanda.fase, "concluida");
  assert.equal(c.ticket()?.status, "concluido");
  assert.equal(existsSync(c.rodada), false);
  assert.deepEqual(await pendenciasDeLimpeza(c.raiz, c.projeto, ag), []);
  assert.equal(c.noRemoto("develop"), "develop");
  const limpeza = ag.evidencias.findLast((e) => e.tipo === "demonstracao_limpeza")?.dados as {
    removidas: unknown[];
    sobras: unknown[];
  };
  assert.equal(limpeza.removidas.length, 6);
  assert.deepEqual(limpeza.sobras, []);
});

test("CA-16: fora de encerramento, ou sem o encerrar_demanda em execução, recusa sem efeito externo", async () => {
  const casos: [Opcoes, RegExp][] = [
    [{ fase: "execucao" }, /está em execucao e o encerrar_demanda está em_execucao/],
    [{ status: "aberto" }, /o encerrar_demanda está aberto/],
    [{ semTicket: true }, /o encerrar_demanda está ausente/],
  ];
  for (const [opcoes, mensagem] of casos) {
    const c = await cenario(opcoes);
    await assert.rejects(
      conduzirEncerramentoDemanda(c.banco, D),
      (e: Error) => e instanceof ErroDeRegra && mensagem.test(e.message),
    );
    assert.deepEqual(hospedagem.chamadas(), []);
    assert.equal(c.noRemoto(BRANCH_DEMANDA), "");
    assert.equal(existsSync(c.demanda), true);
  }
});
