// Sessão de ajustes do PR reprovado com banco real, git real (origin bare) e pi falso (CA-12 a CA-23 e CA-25 da I-229).
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, test } from "node:test";
import { setTimeout as dormir } from "node:timers/promises";
import { ZodError } from "zod";
import { AUDITOR } from "../dominio/agregado.ts";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { ErroDeEscopo } from "../dominio/erros.ts";
import { registrarCorrecoesSessao } from "../dominio/transicoes_rodada.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto } from "../persistencia/configuracao_projeto.ts";
import { carregarDemanda, comDemanda, criarDemanda } from "../persistencia/demandas.ts";
import { cenarioDemanda, commitarCenario, gitCenario } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda, garantirWorktreeRodada } from "../repositorio/worktree-demanda.ts";
import { encerrar, situacao } from "./gerente.ts";
import {
  concluirSessaoAjustes,
  enviarMensagemAjustes,
  mensagensRetomadas,
  reprovarPRRodada,
} from "./sessao_ajustes.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ajustes-")));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

/** pi falso: anota cada prompt em $FALSO_PI_REGISTRO, roda $FALSO_PI_SHELL na pasta dele (o agente "mexendo" no git) e responde. */
const PI_FALSO = `#!/usr/bin/env node
import { execSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  for (const linha of linhas) {
    const c = JSON.parse(linha);
    if (c.type !== "prompt") continue;
    appendFileSync(process.env.FALSO_PI_REGISTRO, JSON.stringify({ sessao: arg("--session-id"), mensagem: c.message }) + "\\n");
    if (process.env.FALSO_PI_SHELL) execSync(process.env.FALSO_PI_SHELL, { stdio: "ignore" });
    emitir({ type: "response", command: "prompt", success: true });
    emitir({ type: "agent_start" });
    const usage = { input: 10, output: 2, cacheRead: 100, cacheWrite: 3, totalTokens: 115, cost: { total: 0.01 } };
    const message = { role: "assistant", content: [], provider: "anthropic", model: "claude-teste", stopReason: "stop", usage };
    mkdirSync(arg("--session-dir"), { recursive: true });
    appendFileSync(arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
      JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
    emitir({ type: "message_end", message });
    emitir({ type: "agent_settled" });
  }
});
`;
const pi = join(temporario, "pi.mjs");
writeFileSync(pi, PI_FALSO);
chmodSync(pi, 0o755);

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
  rmSync(temporario, { recursive: true, force: true });
});

const DEMANDA = "I-206";
const REF = { demanda_id: DEMANDA, rodada_id: 2 };
const BRANCH_DEMANDA = "fabriquinha/I-206";
const BRANCH_RODADA = "fabriquinha/I-206-2";
const MOTIVO = "Falta teste do fluxo de erro";
const URL_PR = "https://github.com/org/loja/pull/1";

/** Demanda I-206 com a rodada 2 no gate do PR (ticket 8) e as duas worktrees prontas. */
async function cenario(shell = "") {
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
  await garantirWorktreeDemanda(c.raiz, c.projeto, DEMANDA, c.log, () => Promise.resolve());
  const rodada = await garantirWorktreeRodada(c.raiz, c.projeto, REF, c.log);
  const head = commitarCenario(rodada, "a.txt", "a\n");
  const demanda = join(c.raiz, "worktrees", "loja", DEMANDA, "demanda");
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
    rodadas: [{ ...REF, titulo: "r2", fase: "aprovacao_pull_request", e2e: false, branch: BRANCH_RODADA }],
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
    evidencias: [
      {
        demanda_id: DEMANDA,
        ticket_id: 8,
        tipo: "pr_aberto",
        dados: { id: "1", url: URL_PR, branch: BRANCH_RODADA, head },
        em,
      },
    ],
  } as unknown as AgregadoDemanda);
  const registro = join(c.dir, "registro.jsonl");
  process.env.FABRIQUINHA_PI = pi;
  process.env.FALSO_PI_REGISTRO = registro;
  const id = ["-c", "user.name=t", "-c", "user.email=t@t"];
  process.env.FALSO_PI_SHELL = shell.replaceAll("{id}", id.join(" ")).replaceAll("{demanda}", demanda);
  return {
    c,
    banco,
    head,
    sha: (branch: string) => gitCenario(c.repo, "rev-parse", branch),
    sujo: () => existsSync(join(rodada, "sujo.txt")),
    ag: () => carregarDemanda(banco, DEMANDA),
    prompts: () =>
      (existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n") : [])
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { sessao: string; mensagem: string }),
    marco: () => join(c.raiz, "execucoes", "ajustes-I-206.R2.json"),
  };
}

const LIMITE = { limiteMin: 5 };

async function ate(condicao: () => boolean): Promise<void> {
  for (let i = 0; i < 500 && !condicao(); i++) await dormir(20);
  assert.ok(condicao(), "a condição não se cumpriu a tempo");
}

test("CA-12, CA-14, CA-15, CA-23 e CA-25: reprovar registra a recusa, abre a sessão e leva o motivo, a URL e os endereços públicos", async () => {
  const { ag, prompts, banco } = await cenario();

  const { id } = await reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, LIMITE);

  assert.ok(id);
  const depois = ag();
  assert.deepEqual(
    depois.decisoes.map((d) => [d.resultado, d.motivo, d.nota]),
    [["recusado", MOTIVO, undefined]],
  );
  assert.equal(depois.rodadas[0]?.fase, "sessao");
  assert.deepEqual(
    depois.tickets.filter((t) => t.etapa === "sessao_em_aberto").map((t) => t.ticket_id),
    [9],
  );
  await ate(() => prompts().length === 1);
  const mensagem = prompts()[0]?.mensagem ?? "";
  for (const esperado of [MOTIVO, URL_PR, "I-206.R2", "I-206.T9"]) assert.match(mensagem, new RegExp(esperado));
  assert.doesNotMatch(mensagem, /\bT-\d/);
  await concluirComCorrecao(banco, ag);
});

/** Registra a correção como o agente da sessão (ticket 9) e conclui como Auditor. */
async function concluirComCorrecao(banco: DatabaseSync, ag: () => AgregadoDemanda) {
  comDemanda(banco, DEMANDA, (a) =>
    registrarCorrecoesSessao(
      a,
      {
        ...REF,
        ticket_id: 9,
        correcoes: [{ demanda_id: DEMANDA, rodada_id: 2, ticket_id: 1, titulo: "Corrigir", descricao: "Corrigir" }],
      },
      { tipo: "agente", execucao: 1, ticket: 9 },
      { agora: em },
    ),
  );
  assert.ok(ag().tickets.some((t) => t.etapa === "implementar" && t.status === "aberto"));
  return concluirSessaoAjustes(banco, REF, AUDITOR);
}

test("CA-13: reprovar sem motivo, ou como agente, é recusado sem abrir a sessão", async () => {
  const { ag, banco, marco } = await cenario();

  await assert.rejects(reprovarPRRodada(banco, REF, "", AUDITOR, LIMITE), ZodError);
  await assert.rejects(
    reprovarPRRodada(banco, REF, MOTIVO, { tipo: "agente", execucao: 1, ticket: 8 }, LIMITE),
    ErroDeEscopo,
  );

  assert.equal(ag().rodadas[0]?.fase, "aprovacao_pull_request");
  assert.equal(existsSync(marco()), false);
});

test("CA-17 e CA-18: o que o agente commita ou integra na conversa é desfeito ao fim da execução", async () => {
  const { c, banco, head, sha, sujo } = await cenario(
    `git {id} commit --allow-empty -qm indevido && echo x > sujo.txt && git -C {demanda} {id} commit --allow-empty -qm integrado`,
  );
  const demanda = sha(BRANCH_DEMANDA);

  const { fim } = await reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, { limiteMin: 0.02 });
  await fim;

  assert.equal(sha(BRANCH_RODADA), head);
  assert.equal(sha(BRANCH_DEMANDA), demanda);
  assert.equal(sujo(), false);
  assert.ok(c.raiz);
});

test("CA-16: a mensagem do Auditor vai ao pi vivo e a resposta fica na mesma conversa", async () => {
  const { banco, prompts, ag } = await cenario();
  await reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, LIMITE);
  await ate(() => prompts().length === 1);

  enviarMensagemAjustes(banco, REF, "Cobre o erro de rede também", AUDITOR, LIMITE);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.mensagem, "Cobre o erro de rede também");
  assert.equal(prompts()[1]?.sessao, prompts()[0]?.sessao);
  assert.deepEqual(mensagensRetomadas(banco, REF), []); // pi vivo: nada é gravado

  // CA-20 e CA-22: sem correção, ou pelo agente, a conclusão é recusada e a sessão segue aberta.
  await assert.rejects(concluirSessaoAjustes(banco, REF, AUDITOR), /trabalho corretivo/);
  await assert.rejects(concluirSessaoAjustes(banco, REF, { tipo: "agente", execucao: 1, ticket: 9 }), ErroDeEscopo);
  assert.equal(ag().rodadas[0]?.fase, "sessao");

  // CA-19 e CA-21: com a correção registrada, o Auditor conclui e a rodada volta ao desenvolvimento.
  await concluirComCorrecao(banco, ag);
  assert.equal(ag().rodadas[0]?.fase, "desenvolvimento");
  assert.equal(ag().tickets.find((t) => t.ticket_id === 9)?.status, "concluido");
});

test("sem pi vivo, a mensagem retoma a mesma sessão; sem sessão ou como agente, recusa", async () => {
  const { banco, prompts, ag } = await cenario();
  const { fim } = await reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, { limiteMin: 0.02 });
  await fim;

  enviarMensagemAjustes(banco, REF, "Voltei", AUDITOR, LIMITE);

  await ate(() => prompts().length === 2);
  assert.equal(prompts()[1]?.sessao, prompts()[0]?.sessao);
  assert.match(prompts()[1]?.mensagem ?? "", /Voltei/);
  assert.deepEqual(mensagensRetomadas(banco, REF), ["Voltei"]);
  // Repetida depois que o pi parou de novo: grava a segunda, em ordem (enquanto o pi vive, a mensagem só vai a ele).
  const viva = situacao(prompts()[0]?.sessao ?? "")?.execucao;
  assert.ok(viva !== undefined);
  encerrar(viva);
  await ate(() => {
    try {
      enviarMensagemAjustes(banco, REF, "Voltei", AUDITOR, LIMITE);
    } catch {
      // a execução anterior ainda não fechou: tenta de novo
    }
    return mensagensRetomadas(banco, REF).length === 2;
  });
  assert.deepEqual(mensagensRetomadas(banco, REF), ["Voltei", "Voltei"]);
  assert.throws(() => {
    enviarMensagemAjustes(banco, REF, "x", { tipo: "agente", execucao: 1, ticket: 9 }, LIMITE);
  }, ErroDeEscopo);
  assert.throws(() => {
    enviarMensagemAjustes(banco, { ...REF, rodada_id: 1 }, "x", AUDITOR, LIMITE);
  }, /não tem sessão de ajustes/);
  await ate(() => situacao(prompts()[0]?.sessao ?? "") !== undefined); // concluir só encerra o pi já vivo
  await concluirComCorrecao(banco, ag);
});

test("rodada sem PR publicado não reprova", async () => {
  const { banco } = await cenario();
  banco.prepare("DELETE FROM evidencia_demanda").run();
  await assert.rejects(reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, LIMITE), /não tem PR publicado/);
  banco.prepare("DELETE FROM ticket_demanda WHERE etapa = 'encerrar_rodada'").run();
  await assert.rejects(reprovarPRRodada(banco, REF, MOTIVO, AUDITOR, LIMITE), /não tem ticket encerrar_rodada/);
});
