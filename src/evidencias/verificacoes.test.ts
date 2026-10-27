import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { Projeto } from "../dominio/configuracao_projeto.ts";
import { coletarVerificacoes } from "./verificacoes.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-verificacoes-")));
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

// sonar-scanner falso: só informa a tarefa do Compute Engine.
const bin = join(base, "bin");
mkdirSync(bin);
writeFileSync(
  join(bin, "sonar-scanner"),
  `#!/bin/sh
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; esac; done
printf 'ceTaskId=AX1\\n' > "$w/report-task.txt"
`,
);
chmodSync(join(bin, "sonar-scanner"), 0o755);
process.env.PATH = `${bin}${delimiter}${String(process.env.PATH)}`;

let status: string;
let issues: unknown[];
const servidor = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "", "http://sonar");
  const corpo =
    pathname === "/api/system/status"
      ? { status }
      : pathname === "/api/ce/task"
        ? { task: { status: "SUCCESS" } }
        : { paging: { total: issues.length }, issues };
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
});
servidor.listen(0, "127.0.0.1");
await once(servidor, "listening");

after(() => {
  servidor.close();
  rmSync(base, { recursive: true, force: true });
});
beforeEach(() => {
  status = "UP";
  issues = [];
  process.env.SONAR_HOST_URL = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;
  process.env.SONAR_TOKEN = "segredo";
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();
const issue = (arquivo: string) => ({
  component: `loja:${arquivo}`,
  rule: "typescript:S1",
  severity: "MAJOR",
  message: "problema",
});

let n = 0;
/** Worktree com `a.ts` alterado e `b.ts` intocado, e o projeto com um teste e uma fitness. */
function cenario(teste = "true") {
  const worktree = join(base, `wt${String(++n)}`);
  mkdirSync(worktree);
  git(worktree, "init", "-q");
  writeFileSync(join(worktree, "a.ts"), "1\n");
  writeFileSync(join(worktree, "b.ts"), "2\n");
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "inicial");
  writeFileSync(join(worktree, "a.ts"), "11\n");
  const projeto = Projeto.parse({
    nome: "loja",
    branch_base: "main",
    chave_sonarqube: "loja",
    raiz_git: "/repos/loja",
    hospedagem: "github",
    fitness: [{ nome: "f", comando: "true", descricao: "d" }],
    linguagens: [{ caminho: ".", linguagem: "ts", comando_teste: teste }],
  });
  return { worktree, projeto };
}
const aprovadas = (v: { aprovada: boolean | undefined }[]) => v.map((x) => x.aprovada);

test("devolve as três verificações do catálogo, aprovadas, sem issue nos arquivos alterados (CA-15)", async () => {
  const { worktree, projeto } = cenario();
  issues = [issue("b.ts")];

  const v = await coletarVerificacoes({ projeto, e2e: false, worktree, opcoes: { limiteMs: 60_000, intervaloMs: 1 } });

  assert.deepEqual(
    v.map((x) => x.tipo),
    ["execucao_testes", "matriz_fitness", "relatorio_sonar"],
  );
  assert.deepEqual(aprovadas(v), [true, true, true]);
  assert.deepEqual(v[2]?.dados, { projectKey: "loja", ceTaskId: "AX1", arquivosAnalisados: ["a.ts"], issues: [] });
});

test("issue aberta em arquivo alterado reprova o Sonar, tecnicamente (CA-14), e as três rodam mesmo com teste reprovado", async () => {
  const { worktree, projeto } = cenario("exit 1");
  issues = [issue("a.ts")];

  const v = await coletarVerificacoes({ projeto, e2e: false, worktree });

  assert.deepEqual(aprovadas(v), [false, true, false]);
  assert.deepEqual(v[2]?.falhas, [{ classe: "tecnica", motivo: "1 issue(s) aberta(s) em arquivos alterados" }]);
});

test("SonarQube fora do ar é infraestrutura, sem aprovação nem reprovação (CA-16)", async () => {
  const { worktree, projeto } = cenario();
  status = "DOWN";

  const [, , sonar] = await coletarVerificacoes({ projeto, e2e: false, worktree });

  assert.ok(sonar);
  assert.equal(sonar.aprovada, undefined);
  assert.equal(sonar.falhas[0]?.classe, "infraestrutura");
  assert.match(sonar.falhas[0].motivo, /está DOWN/);
});

test("erro que não é de regra (worktree que não é git) sobe como está", async () => {
  const { projeto } = cenario();
  await assert.rejects(coletarVerificacoes({ projeto, e2e: false, worktree: base }));
});

test("não grava, não commita e não toca no banco (CA-17)", async () => {
  const { worktree, projeto } = cenario("exit 1");
  issues = [issue("a.ts")];
  const antes = git(worktree, "rev-parse", "HEAD") + git(worktree, "status", "--porcelain");

  await coletarVerificacoes({ projeto, e2e: false, worktree });

  assert.equal(git(worktree, "rev-parse", "HEAD") + git(worktree, "status", "--porcelain"), antes);
  for (const arquivo of ["verificacoes.ts", "verificacoes_comandos.ts"]) {
    const fonte = readFileSync(join(import.meta.dirname, arquivo), "utf8");
    assert.doesNotMatch(fonte, /from "\.\.\/(persistencia|repositorio\/commit)/);
  }
});

test("falha que não é de regra (sem como criar a pasta do scanner) sobe como está, sem virar infraestrutura", async () => {
  const { worktree, projeto } = cenario();
  const pai = join(base, `ro${String(n)}`);
  mkdirSync(pai);
  const dentro = join(pai, "wt");
  renameSync(worktree, dentro);
  chmodSync(pai, 0o500);
  try {
    await assert.rejects(coletarVerificacoes({ projeto, e2e: false, worktree: dentro }), /EACCES/);
  } finally {
    chmodSync(pai, 0o700);
  }
  assert.equal(dirname(dentro), pai);
});
