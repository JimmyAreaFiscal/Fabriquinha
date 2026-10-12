import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir, userInfo } from "node:os";
import { delimiter, dirname, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { after, beforeEach, test } from "node:test";
import type { Ator } from "../dominio/agregado.ts";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import { iniciarExecucao } from "../dominio/execucao.ts";
import { abrir } from "../persistencia/banco.ts";
import { agregado, comIssue, registrarIssue } from "../persistencia/issues.ts";
import { registrarProjeto } from "../persistencia/projetos.ts";
import { caminhoDaWorktree } from "../repositorio/worktree.ts";
import { coletarSonar } from "./sonar.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-sonar-")));

// git sem a configuração do usuário da máquina.
writeFileSync(join(base, "gitconfig"), "[user]\n\tname = Auditor\n\temail = auditor@exemplo.com\n");
process.env.GIT_CONFIG_GLOBAL = join(base, "gitconfig");
process.env.GIT_CONFIG_NOSYSTEM = "1";

// docker falso no PATH: grava os argumentos e o token que recebeu e imita o scanner conforme DOCKER_FALSO.
const bin = join(base, "bin");
const ARGS = join(base, "docker.args");
mkdirSync(bin);
writeFileSync(
  join(bin, "docker"),
  `#!/bin/sh
printf '%s\\n' "$@" > "${ARGS}"
printf '%s' "$SONAR_TOKEN" > "${ARGS}.token"
for a; do case $a in -Dsonar.working.directory=*) w=\${a#*=};; -Dproject.settings=*) c=\${a#*=};; esac; done
cat "$c" > "${ARGS}.settings"
case $DOCKER_FALSO in
  falha) echo "INFO: Scanner"; echo "ERROR: Not authorized" >&2; exit 3;;
  dorme) exec sleep 5;;
  sem-tarefa) echo "projectKey=loja" > "$w/report-task.txt";;
  sem-relatorio) echo "INFO: EXECUTION SUCCESS";;
  *) printf 'projectKey=loja\\nceTaskId=AX1\\n' > "$w/report-task.txt";;
esac
`,
);
chmodSync(join(bin, "docker"), 0o755);
process.env.PATH = `${bin}${delimiter}${String(process.env.PATH)}`;

// SonarQube falso: responde conforme `sonar` e registra os pedidos.
interface Sonar {
  status: string;
  /** Respostas de ce/task em ordem; a última se repete. */
  tarefas: { status: string; errorMessage?: string }[];
  issues: { component: string; line?: number; rule: string; severity: string; message: string }[];
  /** Por caminho (`/api/ce/task`): código HTTP de erro ou corpo cru no lugar da resposta normal. */
  erros: Record<string, number>;
  crus: Record<string, string>;
}
let sonar: Sonar;
let pedidos: { caminho: string; params: Record<string, string>; autorizacao: string | undefined }[];
const servidor = createServer((req, res) => {
  const url = new URL(req.url ?? "", "http://sonar");
  pedidos.push({
    caminho: url.pathname,
    params: Object.fromEntries(url.searchParams),
    autorizacao: req.headers.authorization,
  });
  const erro = sonar.erros[url.pathname];
  if (erro) {
    res.writeHead(erro).end("Insufficient privileges");
    return;
  }
  const cru = sonar.crus[url.pathname];
  if (cru !== undefined) {
    res.writeHead(200).end(cru);
    return;
  }
  let corpo: unknown;
  if (url.pathname === "/api/system/status") corpo = { status: sonar.status };
  if (url.pathname === "/api/ce/task") {
    corpo = { task: sonar.tarefas.length > 1 ? sonar.tarefas.shift() : sonar.tarefas[0] };
  }
  if (url.pathname === "/api/issues/search") {
    const p = Number(url.searchParams.get("p"));
    const ps = Number(url.searchParams.get("ps"));
    corpo = { paging: { total: sonar.issues.length }, issues: sonar.issues.slice((p - 1) * ps, p * ps) };
  }
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(corpo));
});
servidor.listen(0, "127.0.0.1");
await once(servidor, "listening");
const HOST = `http://127.0.0.1:${String((servidor.address() as AddressInfo).port)}`;

after(() => {
  servidor.close();
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  sonar = { status: "UP", tarefas: [{ status: "SUCCESS" }], issues: [], erros: {}, crus: {} };
  pedidos = [];
  process.env.SONAR_HOST_URL = HOST;
  process.env.SONAR_TOKEN = "segredo";
  delete process.env.DOCKER_FALSO;
});

const fabriquinha: Ator = { tipo: "fabriquinha" };
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: "pipe" }).toString();

let n = 0;
/**
 * I-1 do projeto `loja` (chave `loja-key`) em desenvolvimento, com T-1 rodando, e a worktree: `a.ts` alterado,
 * `b.ts` intocado, `c.ts` novo e `x.log` ignorado.
 */
function cenario(): { banco: DatabaseSync; worktree: string } {
  const raiz = join(base, `raiz${String(++n)}`);
  const banco = abrir(raiz);
  registrarProjeto(banco, {
    nome: "loja",
    repo: "/repos/loja",
    branchBase: "main",
    hospedagem: "github",
    testes: ["npm test"],
    sonar: { projectKey: "loja-key" },
    fitness: [{ nome: "f", comando: "c", descricao: "d" }],
  });
  registrarIssue(banco, { projeto: "loja" }, { tipo: "auditor" });
  // ponytail: atalho até o desenvolvimento; as transições até lá são de outros tickets e têm os próprios testes.
  banco.exec(
    "UPDATE issue SET fase = 'desenvolvimento', titulo = 'Busca lenta', tipo = 'problema'; UPDATE ticket SET etapa = 'desenvolvimento'",
  );
  comIssue(banco, 1, "iniciarExecucao", fabriquinha, (ag, ctx) =>
    iniciarExecucao(
      ag,
      { ticket: 1, modo: "autonomo", sessaoPi: "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b" },
      fabriquinha,
      ctx,
    ),
  );
  const worktree = caminhoDaWorktree(raiz, "loja", 1);
  mkdirSync(worktree, { recursive: true });
  git(worktree, "init", "-q");
  for (const [nome, conteudo] of [
    [".gitignore", "*.log\n"],
    ["a.ts", "1\n"],
    ["b.ts", "2\n"],
  ] as const) {
    writeFileSync(join(worktree, nome), conteudo);
  }
  git(worktree, "add", ".");
  git(worktree, "commit", "-q", "-m", "inicial");
  writeFileSync(join(worktree, "a.ts"), "11\n");
  writeFileSync(join(worktree, "c.ts"), "3\n");
  writeFileSync(join(worktree, "x.log"), "log\n");
  return { banco, worktree };
}

const issue = (arquivo: string, line?: number) => ({
  component: `loja-key:${arquivo}`,
  ...(line !== undefined && { line }),
  rule: "typescript:S1",
  severity: "MAJOR",
  message: `problema em ${arquivo}`,
});
const contar = (banco: DatabaseSync) => (banco.prepare("SELECT count(*) AS n FROM evidencia").get() as { n: number }).n;
/** Nenhuma pasta de trabalho do scanner sobrou ao lado da worktree. */
const semSobra = (worktree: string) => readdirSync(dirname(worktree)).filter((nome) => nome.startsWith(".sonar-"));

test("analisa a worktree, espera o Compute Engine e registra as issues dos arquivos alterados, página por página", async () => {
  const { banco, worktree } = cenario();
  sonar.tarefas = [{ status: "PENDING" }, { status: "IN_PROGRESS" }, { status: "SUCCESS" }];
  // Página 1: uma issue em a.ts e 499 no intocado b.ts; página 2: uma em c.ts, sem linha.
  sonar.issues = [issue("a.ts", 3), ...Array.from({ length: 499 }, () => issue("b.ts", 1)), issue("c.ts")];

  const ag = await coletarSonar(banco, 1, { intervaloMs: 1 });

  assert.deepEqual(agregado(banco, 1), ag);
  const [evidencia] = ag.evidencias;
  assert.deepEqual(
    { ...evidencia, em: undefined },
    {
      id: 1,
      ticket: 1,
      tipo: "relatorio_sonar",
      produtor: "fabriquinha",
      aprovada: false,
      dados: {
        projectKey: "loja-key",
        ceTaskId: "AX1",
        arquivosAnalisados: ["a.ts", "c.ts"],
        issues: [
          { arquivo: "a.ts", linha: 3, regra: "typescript:S1", severidade: "MAJOR", mensagem: "problema em a.ts" },
          { arquivo: "c.ts", regra: "typescript:S1", severidade: "MAJOR", mensagem: "problema em c.ts" },
        ],
      },
      arquivos: [],
      em: undefined,
    },
  );
  assert.equal(banco.prepare("SELECT ator FROM comando WHERE nome = 'registrarEvidencia'").get()?.ator, "fabriquinha");

  assert.deepEqual(
    pedidos.map((p) => [p.caminho, p.params]),
    [
      ["/api/system/status", {}],
      ["/api/ce/task", { id: "AX1" }],
      ["/api/ce/task", { id: "AX1" }],
      ["/api/ce/task", { id: "AX1" }],
      ["/api/issues/search", { components: "loja-key", resolved: "false", ps: "500", p: "1" }],
      ["/api/issues/search", { components: "loja-key", resolved: "false", ps: "500", p: "2" }],
    ],
  );
  const basic = `Basic ${Buffer.from("segredo:").toString("base64")}`;
  assert.deepEqual(new Set(pedidos.map((p) => p.autorizacao)), new Set([basic]));

  // Worktree e .git no mesmo caminho absoluto; o token vai pelo ambiente, nunca na linha de comando.
  const args = readFileSync(ARGS, "utf8").trimEnd().split("\n");
  const trabalho = args.find((a) => a.startsWith("-Dsonar.working.directory="))?.split("=")[1] ?? "";
  assert.equal(dirname(trabalho), dirname(worktree));
  const { uid, gid } = userInfo();
  assert.deepEqual(args, [
    "run",
    "--rm",
    "--add-host=host.docker.internal:host-gateway",
    "--user",
    `${String(uid)}:${String(gid)}`,
    "-e",
    `SONAR_HOST_URL=${HOST}`,
    "-e",
    "SONAR_TOKEN",
    "-v",
    `${worktree}:${worktree}`,
    "-v",
    `${join(worktree, ".git")}:${join(worktree, ".git")}`,
    "-v",
    `${trabalho}:${trabalho}`,
    "-w",
    worktree,
    "sonarsource/sonar-scanner-cli",
    "-Dsonar.projectKey=loja-key",
    `-Dsonar.working.directory=${trabalho}`,
    `-Dproject.settings=${join(trabalho, "vazio.properties")}`,
  ]);
  // O sonar-project.properties da worktree, que o agente edita, não vale: o scanner lê um arquivo vazio.
  assert.equal(readFileSync(`${ARGS}.settings`, "utf8"), "");
  assert.equal(readFileSync(`${ARGS}.token`, "utf8"), "segredo");
  assert.deepEqual(semSobra(worktree), []);
  banco.close();
});

test("sem issue nos arquivos alterados: aprovada; a barra no fim do SONAR_HOST_URL não atrapalha", async () => {
  const { banco } = cenario();
  process.env.SONAR_HOST_URL = `${HOST}/`;
  sonar.issues = [issue("b.ts", 1)];

  const [evidencia] = (await coletarSonar(banco, 1)).evidencias;

  assert.equal(evidencia?.aprovada, true);
  assert.deepEqual(evidencia.dados.issues, []);
  assert.equal(pedidos[0]?.caminho, "/api/system/status");
  banco.close();
});

test("100 mil `/` seguidas no SONAR_HOST_URL: as do meio não travam a leitura, e as do fim saem", async () => {
  const { banco } = cenario();
  const barras = "/".repeat(100_000);
  // Barras seguidas de outra coisa: `\/+$` voltaria atrás a cada barra. Sem token, falha antes de consultar.
  delete process.env.SONAR_TOKEN;
  process.env.SONAR_HOST_URL = `${HOST}${barras}x`;
  const inicio = Date.now();
  await falha(banco, /^SONAR_HOST_URL e SONAR_TOKEN precisam estar no ambiente/);
  assert.ok(Date.now() - inicio < 1000);

  process.env.SONAR_TOKEN = "segredo";
  process.env.SONAR_HOST_URL = `${HOST}${barras}`;
  const [evidencia] = (await coletarSonar(banco, 1)).evidencias;
  assert.equal(evidencia?.aprovada, true);
  assert.equal(pedidos[0]?.caminho, "/api/system/status");
  banco.close();
});

/** Falha com a mensagem exata e sem registrar nada. */
async function falha(banco: DatabaseSync, mensagem: string | RegExp, opcoes = {}) {
  await assert.rejects(coletarSonar(banco, 1, opcoes), (e) => {
    assert.ok(e instanceof ErroDeRegra);
    if (typeof mensagem === "string") assert.equal(e.message, mensagem);
    else assert.match(e.message, mensagem);
    return true;
  });
  assert.equal(contar(banco), 0);
}

const SUBIR = "docker compose -f ~/Documents/Projetos/SonarQube/docker-compose.yml up -d";
const NOS_DOIS =
  "SONAR_HOST_URL precisa resolver no host e no contêiner do scanner, e localhost não serve: use host.docker.internal";

test("SonarQube fora do ar: falha com o comando para subir o servidor, sem rodar o scanner", async () => {
  const { banco } = cenario();
  rmSync(ARGS, { force: true });
  sonar.status = "STARTING";
  await falha(banco, `o SonarQube em ${HOST} está STARTING (suba com: ${SUBIR})`);

  const fechado = createServer();
  fechado.listen(0, "127.0.0.1");
  await once(fechado, "listening");
  const porta = (fechado.address() as AddressInfo).port;
  fechado.close();
  process.env.SONAR_HOST_URL = `http://127.0.0.1:${String(porta)}`;
  await falha(
    banco,
    `o SonarQube em http://127.0.0.1:${String(porta)} está inacessível: TypeError: fetch failed (suba com: ${SUBIR})`,
  );

  process.env.SONAR_HOST_URL = HOST;
  sonar.erros = { "/api/system/status": 503 };
  await falha(
    banco,
    `o SonarQube respondeu HTTP 503 em api/system/status: Insufficient privileges (confira o SONAR_TOKEN; se o servidor estiver fora do ar, suba com: ${SUBIR})`,
  );
  assert.equal(existsSync(ARGS), false);
  banco.close();
});

test("scanner falhando ou passando do limite: falha com a saída e o comando para subir o servidor", async () => {
  const { banco, worktree } = cenario();
  process.env.DOCKER_FALSO = "falha";
  await falha(
    banco,
    `o sonar-scanner saiu com código 3: INFO: Scanner\nERROR: Not authorized (${NOS_DOIS}; se o SonarQube estiver fora do ar, suba com: ${SUBIR})`,
  );
  process.env.DOCKER_FALSO = "dorme";
  await falha(
    banco,
    `o sonar-scanner passou do tempo limite (${NOS_DOIS}; se o SonarQube estiver fora do ar, suba com: ${SUBIR})`,
    {
      limiteMs: 200,
    },
  );
  process.env.DOCKER_FALSO = "sem-tarefa";
  const semTarefa =
    "o sonar-scanner terminou sem informar a tarefa do Compute Engine, report-task.txt ausente ou sem ceTaskId";
  await falha(banco, `${semTarefa} (${NOS_DOIS}; se o SonarQube estiver fora do ar, suba com: ${SUBIR})`);
  process.env.DOCKER_FALSO = "sem-relatorio";
  await falha(
    banco,
    `${semTarefa}: INFO: EXECUTION SUCCESS (${NOS_DOIS}; se o SonarQube estiver fora do ar, suba com: ${SUBIR})`,
  );
  assert.deepEqual(semSobra(worktree), []);
  banco.close();
});

test("Compute Engine falhando, cancelado, parado na fila ou recusando o token: falha sem registrar", async () => {
  const { banco } = cenario();
  const dica = `(veja a tarefa AX1 em ${HOST}/admin/background_tasks e execute o ticket de novo)`;
  sonar.tarefas = [{ status: "FAILED", errorMessage: "Unsupported language" }];
  await falha(banco, `o SonarQube não processou a análise: Unsupported language ${dica}`);
  sonar.tarefas = [{ status: "CANCELED" }];
  await falha(banco, `o SonarQube não processou a análise: CANCELED ${dica}`);
  sonar.tarefas = [{ status: "PENDING" }];
  // O limite vale também para o scanner: folga para o docker falso terminar antes dele numa máquina carregada.
  await falha(banco, `a análise passou do tempo limite na fila do SonarQube ${dica}`, {
    limiteMs: 1000,
    intervaloMs: 5,
  });
  sonar.erros = { "/api/ce/task": 403 };
  await falha(
    banco,
    `o SonarQube respondeu HTTP 403 em api/ce/task: Insufficient privileges (confira o SONAR_TOKEN; se o servidor estiver fora do ar, suba com: ${SUBIR})`,
  );
  banco.close();
});

test("resposta que não é JSON ou fora do formato esperado: falha sem registrar, apontando o SONAR_HOST_URL", async () => {
  const { banco } = cenario();
  const dica = `(confira se SONAR_HOST_URL aponta para o SonarQube; ${NOS_DOIS})`;
  sonar.crus = { "/api/system/status": "<html>outro serviço</html>" };
  await falha(banco, `a resposta de ${HOST}/api/system/status não é a esperada do SonarQube ${dica}`);
  sonar.crus = { "/api/issues/search": JSON.stringify({ issues: [] }) };
  await falha(banco, `a resposta de ${HOST}/api/issues/search não é a esperada do SonarQube ${dica}`);
  banco.close();
});

test("sem SONAR_HOST_URL ou SONAR_TOKEN no ambiente, ou com ticket inexistente: falha antes de consultar", async () => {
  const { banco } = cenario();
  const ambiente =
    "SONAR_HOST_URL e SONAR_TOKEN precisam estar no ambiente da Fabriquinha (defina os dois em <raiz>/ambiente e " +
    `reinicie o serviço; ${NOS_DOIS})`;
  delete process.env.SONAR_TOKEN;
  await falha(banco, ambiente);
  process.env.SONAR_TOKEN = "segredo";
  process.env.SONAR_HOST_URL = "";
  await falha(banco, ambiente);
  await assert.rejects(
    coletarSonar(banco, 9),
    new ErroDeInexistente("o ticket T-9 não existe", "confira o número do ticket"),
  );
  assert.deepEqual(pedidos, []);
  banco.close();
});
