// Fechamento do ticket da demanda com banco real e git real; só as verificações são injetadas (CA-1 a CA-16).
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { podeTentarEncerramento } from "../dominio/transicoes_encerramento.ts";
import { selecionarTrabalho } from "../dominio/selecao_trabalho.ts";
import type { Verificacao } from "../evidencias/verificacoes.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { commitDoTicketDemanda } from "../persistencia/commits_demanda.ts";
import { carregarDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { cenarioDemanda, gitCenario } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { commitarTicketDemanda } from "./commit_ticket_demanda.ts";
import { falharTicketDemanda, fecharTicketDemanda } from "./fechamento_ticket.ts";

const em = "2026-01-01T00:00:00.000Z";
const D = "I-1";
const ref = (ticket_id: number) => ({ demanda_id: D, ticket_id });
const ticket = (ticket_id: number, etapa: string, status: string, extra: object = {}) => ({
  demanda_id: D,
  ticket_id,
  etapa,
  status,
  status_alterado_em: em,
  devolucoes: 0,
  ...extra,
});

const verif = (tipo: Verificacao["tipo"], aprovada: boolean | undefined, motivo = "falhou"): Verificacao => ({
  tipo,
  aprovada,
  falhas: aprovada ? [] : [{ classe: aprovada === undefined ? "infraestrutura" : "tecnica", motivo, comando: "c" }],
  dados: { x: 1 },
  logs:
    aprovada === true
      ? [{ nome: `${tipo}.log`, texto: `log de ${tipo}` }]
      : [{ nome: `${tipo}.log`, texto: "a".repeat(3000) + "FIM" }],
});
const TIPOS = ["execucao_testes", "matriz_fitness", "relatorio_sonar"] as const;
const todas = (aprovada: boolean | undefined, motivo?: string) => TIPOS.map((t) => verif(t, aprovada, motivo));
const coletor = (resultado: Verificacao[]) => ({ coletarVerificacoes: () => Promise.resolve(resultado) });
const naoColeta = {
  coletarVerificacoes: (): Promise<Verificacao[]> => {
    throw new Error("não devia coletar");
  },
};

interface Opcoes {
  tickets?: object[];
  /** Cria a demanda em `encerramento`, com o conflito pendente no ticket 3. */
  conflito?: boolean;
  tipo?: string;
}

async function cenario({ tickets, conflito, tipo = "funcionalidade" }: Opcoes = {}) {
  const c = cenarioDemanda();
  const banco = abrir(c.raiz);
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
  criarDemanda(banco, {
    demanda: {
      id: D,
      projeto: "loja",
      titulo: "Cache",
      tipo,
      descricao: "d",
      fase: conflito ? "encerramento" : "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [
      { demanda_id: D, rodada_id: 1, titulo: "r1", fase: "desenvolvimento", e2e: false, branch: "fabriquinha/I-1-1" },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: conflito
      ? [
          ticket(1, "demanda", "concluido"),
          ticket(2, "encerrar_demanda", "aberto"),
          ticket(3, "resolver_conflito", "em_execucao"),
        ]
      : (tickets ?? [ticket(1, "implementar", "em_execucao", { rodada_id: 1, titulo: "Cachear" })]),
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
    ...(conflito && {
      encerramento: {
        demanda_id: D,
        branch: "fabriquinha/I-1",
        base: "integracao",
        pr: { numero: 7, url: "https://h/pr/7" },
        sha_verificado: "s1",
        limpeza_pendente: [],
        conflito_pendente: { ticket_id: 3 },
      },
    }),
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(c.raiz, c.projeto, D, c.log, () => Promise.resolve());
  const worktree = conflito
    ? join(c.raiz, "worktrees", "loja", D, "demanda")
    : await garantirWorktreeRodada(c.raiz, c.projeto, { demanda_id: D, rodada_id: 1 }, c.log);
  writeFileSync(join(worktree, "novo.txt"), "x\ny\n");
  const evidencias = (n: number) =>
    banco
      .prepare("SELECT tipo FROM evidencia_demanda WHERE ticket_id = ? ORDER BY tipo")
      .all(n)
      .map((l) => l.tipo);
  const status = (n: number) => carregarDemanda(banco, D).tickets.find((t) => t.ticket_id === n);
  const commits = () => gitCenario(worktree, "log", "--format=%s", "--grep", "\\[I-1\\.T").split("\n").filter(Boolean);
  return { banco, worktree, evidencias, status, commits, ag: () => carregarDemanda(banco, D) };
}

const fechar = (c: Awaited<ReturnType<typeof cenario>>, n: number, deps: object, falha?: string) =>
  fecharTicketDemanda(c.banco, ref(n), { falha, execucao: "E-9" }, deps);

test("CA-1 a CA-5: aprovado conclui, commita uma vez, grava as evidências com anexos e leva a rodada à revisão", async () => {
  const c = await cenario();
  await fechar(c, 1, coletor(todas(true)));
  assert.equal(c.status(1)?.status, "concluido");
  assert.deepEqual(c.commits(), ["feat: Cachear [I-1.T1]"]);
  const registrado = commitDoTicketDemanda(c.banco, D, 1);
  assert.deepEqual(
    registrado?.arquivos.map((a) => [a.caminho, a.adicionadas]),
    [["novo.txt", 2]],
  );
  assert.match(gitCenario(c.worktree, "show", "--stat", "--format=", "HEAD"), /novo\.txt\s+\|\s+2 \+\+/);
  assert.deepEqual(c.evidencias(1), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);
  const anexos = c.banco.prepare("SELECT caminho FROM arquivo_evidencia ORDER BY caminho").all();
  assert.deepEqual(
    anexos.map((a) => a.caminho),
    TIPOS.map((t) => `${t}.log`).sort(),
  );
  const ag = c.ag();
  assert.equal(ag.rodadas[0]?.fase, "revisao");
  assert.equal(ag.tickets.filter((t) => t.etapa === "revisar_rodada").length, 1);
});

test("CA-4: o Sonar no formato real (logs vazios) grava o relatório como anexo", async () => {
  const c = await cenario();
  await fechar(c, 1, coletor([...todas(true).slice(0, 2), { ...verif("relatorio_sonar", true), logs: [] }]));
  assert.equal(c.status(1)?.status, "concluido");
  const anexo = c.banco.prepare("SELECT caminho FROM arquivo_evidencia WHERE caminho LIKE 'relatorio_sonar%'").all();
  assert.deepEqual(
    anexo.map((a) => a.caminho),
    ["relatorio_sonar.log"],
  );
});

test("a rodada só avança com a última implementação; ticket concluído só tenta a rodada", async () => {
  const c = await cenario({
    tickets: [
      ticket(1, "implementar", "em_execucao", { rodada_id: 1 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await fechar(c, 1, coletor(todas(true)));
  assert.equal(c.status(1)?.status, "concluido");
  assert.equal(c.ag().rodadas[0]?.fase, "desenvolvimento"); // o ticket 1 titulo ausente: usa o da demanda
  assert.deepEqual(c.commits(), ["feat: Cache [I-1.T1]"]);
  await fechar(c, 1, naoColeta); // concluído: a rodada ainda espera o ticket 2
  assert.equal(c.ag().rodadas[0]?.fase, "desenvolvimento");
  c.banco.prepare("UPDATE ticket_demanda SET status = 'concluido' WHERE ticket_id = 2").run();
  await fechar(c, 1, naoColeta);
  assert.equal(c.ag().rodadas[0]?.fase, "revisao");
  await fechar(c, 1, naoColeta); // rodada já em revisão: nada
  assert.equal(c.ag().tickets.filter((t) => t.etapa === "revisar_rodada").length, 1);
});

test("só implementar e resolver_conflito em execução são fechados", async () => {
  const c = await cenario({
    tickets: [ticket(1, "planejar", "em_execucao"), ticket(2, "implementar", "aberto", { rodada_id: 1 })],
  });
  await fechar(c, 1, naoColeta, "x");
  await fechar(c, 2, naoColeta, "x");
  assert.deepEqual([c.status(1)?.status, c.status(2)?.status], ["em_execucao", "aberto"]);
});

test("falharTicketDemanda falha o ticket em execução de qualquer etapa e ignora o que não está em execução", async () => {
  const c = await cenario({
    tickets: [ticket(1, "planejar", "em_execucao"), ticket(2, "implementar", "aberto", { rodada_id: 1 })],
  });
  falharTicketDemanda(c.banco, ref(1), "x");
  falharTicketDemanda(c.banco, ref(2), "x");
  assert.deepEqual([c.status(1)?.status, c.status(1)?.motivo_falha, c.status(2)?.status], ["falhou", "x", "aberto"]);
});

test("CA-6: a primeira reprovação técnica devolve ao agente com o relatório e o fim do log", async () => {
  const c = await cenario();
  await fechar(c, 1, coletor([verif("execucao_testes", false, "npm test saiu com código 1"), ...todas(true).slice(1)]));
  const t = c.status(1);
  assert.deepEqual([t?.status, t?.devolucoes], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /^- execucao_testes: npm test saiu com código 1\n\na+FIM$/);
  assert.equal(t?.instrucao?.split("\n\n")[1]?.length, 2000);
  assert.deepEqual(c.commits(), []);
});

test("CA-7 e CA-8: na terceira reprovação o ticket falha e bloqueia a rodada até a reabertura", async () => {
  const c = await cenario({
    tickets: [
      ticket(1, "implementar", "em_execucao", { rodada_id: 1, devolucoes: 2 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await fechar(c, 1, coletor([verif("matriz_fitness", false, "f reprovou"), ...todas(true).slice(0, 1)]));
  const t = c.status(1);
  assert.equal(t?.status, "falhou");
  assert.match(t.motivo_falha ?? "", /^- matriz_fitness: f reprovou/);
  assert.deepEqual(selecionarTrabalho(c.ag(), true), []);
});

test("CA-9 e CA-10: falha da execução falha o ticket sem coletar nem gravar evidência", async () => {
  const c = await cenario();
  await fechar(c, 1, naoColeta, "timeout");
  const t = c.status(1);
  assert.deepEqual([t?.status, t?.motivo_falha ?? "", t?.devolucoes], ["falhou", "timeout", 0]);
  assert.deepEqual(c.evidencias(1), []);
});

test("CA-11: infraestrutura falha o ticket com o motivo, sem devolução nem evidência", async () => {
  const c = await cenario();
  await fechar(
    c,
    1,
    coletor([...todas(true).slice(0, 2), verif("relatorio_sonar", undefined, "SonarQube fora do ar")]),
  );
  const t = c.status(1);
  assert.deepEqual([t?.status, t?.devolucoes], ["falhou", 0]);
  assert.match(t?.motivo_falha ?? "", /infraestrutura:\n- SonarQube fora do ar/);
  assert.deepEqual(c.evidencias(1), []);
});

test("CA-12 e CA-13: resolver_conflito aprovado conclui e o encerramento volta a ser tentado sozinho", async () => {
  const c = await cenario({ conflito: true });
  assert.equal(podeTentarEncerramento(c.ag()), false);
  await fechar(c, 3, coletor(todas(true)));
  assert.equal(c.status(3)?.status, "concluido");
  assert.deepEqual(c.commits(), ["feat: Cache [I-1.T3]"]);
  assert.equal(c.ag().encerramento?.sha_verificado, commitDoTicketDemanda(c.banco, D, 3)?.sha);
  assert.equal(podeTentarEncerramento(c.ag()), true);
  assert.deepEqual(
    selecionarTrabalho(c.ag(), true).map((t) => t.etapa),
    ["encerrar_demanda"],
  );
});

test("CA-14: resolver_conflito reprovado é devolvido ao agente, sem commit", async () => {
  const c = await cenario({ conflito: true });
  await fechar(c, 3, coletor([verif("execucao_testes", false, "t reprovou"), ...todas(true).slice(1)]));
  const t = c.status(3);
  assert.deepEqual([t?.status, t?.devolucoes], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /^- execucao_testes: t reprovou/);
  assert.deepEqual(c.commits(), []);
});

test("CA-14: resolver_conflito já devolvido duas vezes falha com o relatório no motivo", async () => {
  const c = await cenario({ conflito: true });
  c.banco.exec("UPDATE ticket_demanda SET devolucoes = 2 WHERE ticket_id = 3");
  await fechar(c, 3, coletor([verif("execucao_testes", false, "t reprovou"), ...todas(true).slice(1)]));
  const t = c.status(3);
  assert.equal(t?.status, "falhou");
  assert.match(t.motivo_falha ?? "", /^- execucao_testes: t reprovou/);
});

test("CA-15 e CA-16: repetido depois do commit, não coleta, não duplica commit nem evidência", async () => {
  const c = await cenario({
    tickets: [
      ticket(1, "implementar", "em_execucao", { rodada_id: 1 }),
      ticket(2, "implementar", "aberto", { rodada_id: 1 }),
    ],
  });
  await fechar(c, 1, coletor(todas(true)));
  // queda depois do commit: o ticket segue em execução e o registro do commit não foi gravado
  c.banco.exec("DELETE FROM arquivo_commit_demanda; DELETE FROM commit_ticket_demanda");
  c.banco.exec("UPDATE ticket_demanda SET status = 'em_execucao' WHERE ticket_id = 1");
  c.banco.exec("UPDATE ticket_demanda SET status = 'concluido' WHERE ticket_id = 2");
  await fechar(c, 1, naoColeta);
  assert.equal(c.status(1)?.status, "concluido");
  assert.equal(c.ag().rodadas[0]?.fase, "revisao");
  assert.equal(commitDoTicketDemanda(c.banco, D, 1)?.arquivos.length, 1);
  assert.equal(c.commits().length, 1);
  assert.deepEqual(c.evidencias(1), ["execucao_testes", "matriz_fitness", "relatorio_sonar"]);
});

test("CA-16: commit sem evidências aprovadas falha por infraestrutura", async () => {
  const c = await cenario();
  await commitarTicketDemanda(c.banco, ref(1), { worktree: c.worktree, tipo: "feat", titulo: "Cachear" });
  await fechar(c, 1, naoColeta);
  const t = c.status(1);
  assert.equal(t?.status, "falhou");
  assert.match(t.motivo_falha ?? "", /infraestrutura: .*ausentes: execucao_testes, matriz_fitness, relatorio_sonar/);
});

test("commit com evidência reprovada gravada falha por infraestrutura", async () => {
  const c = await cenario();
  await fechar(c, 1, coletor(todas(false)));
  assert.equal(c.status(1)?.status, "aberto"); // devolvido: as evidências reprovadas ficam gravadas
  c.banco.exec("UPDATE ticket_demanda SET status = 'em_execucao' WHERE ticket_id = 1");
  await commitarTicketDemanda(c.banco, ref(1), { worktree: c.worktree, tipo: "feat", titulo: "Cachear" });
  await fechar(c, 1, naoColeta);
  assert.match(c.status(1)?.motivo_falha ?? "", /reprovadas: execucao_testes, matriz_fitness, relatorio_sonar/);
});

function hook(c: Awaited<ReturnType<typeof cenario>>, corpo: string) {
  const hooks = join(c.worktree, "..", "hooks");
  mkdirSync(hooks, { recursive: true });
  writeFileSync(join(hooks, "pre-commit"), `#!/bin/sh\n${corpo}\n`);
  chmodSync(join(hooks, "pre-commit"), 0o755);
  gitCenario(c.worktree, "config", "core.hooksPath", hooks);
}

test("o hook que reprova o commit devolve o ticket com a saída, sem commit; na 3ª falha; outro erro propaga", async () => {
  const c = await cenario();
  hook(c, "echo lint quebrou\nexit 1");
  await fechar(c, 1, coletor(todas(true)));
  const t = c.status(1);
  assert.deepEqual([t?.status, t?.devolucoes], ["aberto", 1]);
  assert.match(t?.instrucao ?? "", /lint quebrou/);
  assert.deepEqual(c.commits(), []);

  const e = await cenario();
  hook(e, "echo lint quebrou\nexit 1");
  e.banco.exec("UPDATE ticket_demanda SET devolucoes = 2 WHERE ticket_id = 1");
  await fechar(e, 1, coletor(todas(true)));
  assert.equal(e.status(1)?.status, "falhou");
  assert.match(e.status(1)?.motivo_falha ?? "", /lint quebrou/);

  const d = await cenario({ tickets: [ticket(1, "implementar", "em_execucao", { rodada_id: 1 })] });
  d.banco.exec(`INSERT INTO commit_ticket_demanda (sha, demanda_id, ticket_id, mensagem, em)
    VALUES ('${"a".repeat(40)}', 'I-1', 1, 'outro', '${em}')`);
  await assert.rejects(fechar(d, 1, coletor(todas(true))), /já tem commit/);
});

test("resolver_conflito com o hook reprovado é devolvido, sem commit", async () => {
  const c = await cenario({ conflito: true });
  hook(c, "echo lint quebrou\nexit 1");
  await fechar(c, 3, coletor(todas(true)));
  const t = c.status(3);
  assert.deepEqual([t?.status, t?.devolucoes], ["aberto", 1]);
  assert.deepEqual(c.commits(), []);
});

test("o commit que passa do limite falha por infraestrutura, sem devolução", async () => {
  const c = await cenario();
  hook(c, "exec sleep 5");
  await fechar(c, 1, { ...coletor(todas(true)), limiteCommitMs: 300 });
  const t = c.status(1);
  assert.deepEqual([t?.status, t?.devolucoes], ["falhou", 0]);
  assert.match(t?.motivo_falha ?? "", /^falha de infraestrutura/);
});

test("problema commita como fix; sem deps o coletor real roda e o Sonar sem ambiente é infraestrutura", async () => {
  const c = await cenario({ tipo: "problema" });
  await fechar(c, 1, coletor(todas(true)));
  assert.deepEqual(c.commits(), ["fix: Cachear [I-1.T1]"]);
  const d = await cenario({ tipo: "problema" });
  delete process.env.SONAR_HOST_URL;
  await fecharTicketDemanda(d.banco, ref(1), { execucao: "E-9" });
  assert.match(d.status(1)?.motivo_falha ?? "", /^falha de infraestrutura:\n- SONAR_HOST_URL/);
});

test("I-246.T15: parada marcada depois da coleta, com o hook reprovando o commit ou depois do commit: falha 'serviço reiniciado', sem devolução", async () => {
  // `chamada` é a consulta à parada que responde sim: 1 depois da coleta, 2 no erro do commit ou depois dele.
  for (const [chamada, hookCorpo] of [
    [1, undefined],
    [2, "echo lint quebrou\nexit 1"],
    [2, undefined],
  ] as const) {
    const c = await cenario();
    if (hookCorpo) hook(c, hookCorpo);
    let consultas = 0;
    await fechar(c, 1, { ...coletor(todas(true)), parada: () => ++consultas === chamada });
    const t = c.status(1);
    assert.deepEqual([t?.status, t?.devolucoes, t?.motivo_falha], ["falhou", 0, "serviço reiniciado"]);
    if (chamada === 1) assert.deepEqual(c.evidencias(1), []);
  }
});
