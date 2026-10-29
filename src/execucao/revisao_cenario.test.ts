// Cenário compartilhado dos testes da revisão: git real temporário, banco real e um pi falso que só registra onde rodou.
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after } from "node:test";
import type { AgregadoDemanda } from "../dominio/agregado_demanda.ts";
import { abrir } from "../persistencia/banco.ts";
import { gravarConfiguracaoProjeto, substituirPreparacaoDoProjeto } from "../persistencia/configuracao_projeto.ts";
import { criarDemanda } from "../persistencia/demandas.ts";
import { cenarioDemanda } from "../repositorio/worktree-cenarios.ts";
import { garantirWorktreeDemanda } from "../repositorio/worktree-demanda.ts";

const em = "2026-01-01T00:00:00.000Z";
const temporario = mkdtempSync(join(tmpdir(), "fabriquinha-revisao-"));
process.env.PI_CODING_AGENT_DIR = join(temporario, "pi-agent");
delete process.env.FABRIQUINHA_PORTA;

/**
 * pi falso: anota a pasta em $FALSO_PI_REGISTRO e assenta; com $FALSO_PI=erro responde com stopReason de erro e, com
 * $FALSO_PI=reprovar, decide pelo CLI `fabriquinha revisao decidir` antes de assentar, como o revisor.
 */
const pi = join(temporario, "pi.mjs");
writeFileSync(
  pi,
  `#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
const arg = (nome) => process.argv[process.argv.indexOf(nome) + 1];
const emitir = (o) => process.stdout.write(JSON.stringify(o) + "\\n");
appendFileSync(process.env.FALSO_PI_REGISTRO, process.cwd() + "\\n");
let resto = "";
process.stdin.setEncoding("utf8").on("data", (parte) => {
  const linhas = (resto + parte).split("\\n");
  resto = linhas.pop();
  if (!linhas.some((l) => JSON.parse(l).type === "prompt")) return;
  const erro = process.env.FALSO_PI === "erro";
  if (process.env.FALSO_PI === "reprovar") {
    const correcoes = JSON.stringify([{ ticket_id: 1, titulo: "corrige", descricao: "d", caminhos: [], depende: [] }]);
    execFileSync(process.execPath, [process.env.FALSO_PI_CLI, "revisao", "decidir", process.env.FALSO_PI_TICKET, "reprovar",
      "--motivo", "falta teste", "--correcoes", correcoes]);
  }
  const message = { role: "assistant", content: [], provider: "p", model: "m", stopReason: erro ? "error" : "stop",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { total: 0 } },
    ...(erro && { errorMessage: "limite de uso" }) };
  mkdirSync(arg("--session-dir"), { recursive: true });
  appendFileSync(arg("--session-dir") + "/2026-10-11T00-00-00-000Z_" + arg("--session-id") + ".jsonl",
    JSON.stringify({ type: "message", timestamp: new Date().toISOString(), message }) + "\\n");
  emitir({ type: "response", command: "prompt", success: true });
  emitir({ type: "message_end", message });
  emitir({ type: "agent_settled" });
});
`,
);
chmodSync(pi, 0o755);

const abertos: DatabaseSync[] = [];
after(() => {
  for (const b of abertos) b.close();
});

export const REF_RODADA = { demanda_id: "I-1", ticket_id: 2 };
export const REF_GLOBAL = { demanda_id: "I-1", ticket_id: 3 };

/**
 * Projeto `loja`, demanda I-1. Padrão: em execução, rodada 1 em `revisao` (implementar T1 concluído, revisar_rodada
 * T2 aberto), com a worktree da demanda criada. Com `integral`: em `revisao_demanda`, rodada 1 concluída, revisar_demanda T3 aberto.
 */
export async function cenarioRevisao({ integral = false, falha = false, reprova = false } = {}) {
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
  substituirPreparacaoDoProjeto(banco, "loja", ["true"]);
  const ticket = (ticket_id: number, etapa: string, extra: object = {}) => ({
    demanda_id: "I-1",
    ticket_id,
    etapa,
    status: "aberto",
    status_alterado_em: em,
    devolucoes: 0,
    ...extra,
  });
  criarDemanda(banco, {
    demanda: {
      id: "I-1",
      projeto: "loja",
      titulo: "t",
      tipo: "funcionalidade",
      descricao: "d",
      fase: integral ? "revisao_demanda" : "execucao",
      fase_alterada_em: em,
      origem_ferramenta: "claude",
      origem_sessao: "s1",
      enviada: true,
      branch: "fabriquinha/I-1",
    },
    rodadas: [
      {
        demanda_id: "I-1",
        rodada_id: 1,
        titulo: "r1",
        fase: integral ? "concluida" : "revisao",
        e2e: false,
        branch: "fabriquinha/I-1-1",
      },
    ],
    dependencias_rodada: [],
    criterios_citados: [],
    tickets: [
      ticket(1, "implementar", { rodada_id: 1, status: "concluido" }),
      ticket(2, "revisar_rodada", { rodada_id: 1, ...(integral && { status: "concluido" }) }),
      ticket(3, "revisar_demanda"),
    ],
    dependencias_ticket: [],
    caminhos_ticket: [],
    decisoes: [],
    evidencias: [],
  } as unknown as AgregadoDemanda);
  await garantirWorktreeDemanda(c.raiz, c.projeto, "I-1", c.log, () => Promise.resolve());
  const registro = join(c.dir, "registro.txt");
  process.env.FABRIQUINHA_PI = pi;
  process.env.FALSO_PI_REGISTRO = registro;
  process.env.FALSO_PI_CLI = join(import.meta.dirname, "..", "cli", "fabriquinha.ts");
  process.env.FALSO_PI_TICKET = "I-1.T2";
  if (falha) process.env.FALSO_PI = "erro";
  else if (reprova) process.env.FALSO_PI = "reprovar";
  else delete process.env.FALSO_PI;
  return {
    c,
    banco,
    /** As pastas em que o pi falso rodou. */
    pastas: () => (existsSync(registro) ? readFileSync(registro, "utf8").trim().split("\n") : []),
  };
}
