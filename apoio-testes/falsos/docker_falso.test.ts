import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { once } from "node:events";
import { instalarDockerFalso } from "./docker_falso.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-docker-falso-"));
const falso = instalarDockerFalso(base);
after(() => {
  rmSync(base, { recursive: true, force: true });
});

const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });

test("build e pull criam a imagem; image inspect acusa a que falta", () => {
  assert.equal(docker("image", "inspect", "img:1").status, 1);
  writeFileSync(join(base, "Dockerfile"), "FROM scratch");
  assert.equal(docker("build", "-t", "img:1", "-f", join(base, "Dockerfile"), base).status, 0);
  assert.equal(docker("pull", "alpine").status, 0);
  assert.equal(docker("image", "inspect", "img:1").status, 0);
  assert.deepEqual(falso.imagens().sort(), ["alpine", "img:1"]);
  const semDockerfile = docker("build", "-t", "outra", base + "/nada");
  assert.equal(semDockerfile.status, 1);
  assert.match(semDockerfile.stderr, /dockerfile/);
  assert.equal(docker("build", "-t", "outra", base).status, 0);
});

test("run grava rótulo, memória e CPUs; sem a imagem, falha", () => {
  const sem = docker("run", "-d", "fantasma", "tail");
  assert.equal(sem.status, 125);
  const executado = docker(
    ...[
      "run",
      "-d",
      "--label",
      "a=b=c",
      "--memory",
      "512m",
      "--cpus",
      "1.5",
      "--workdir",
      "/t",
      "alpine",
      "tail",
      "-f",
    ],
  );
  assert.equal(executado.status, 0);
  const id = executado.stdout.trim();
  const [container] = falso.containers().filter((c) => c.id === id);
  assert.deepEqual(
    [container?.rotulos, container?.memoria, container?.cpus, container?.estado, container?.comandos],
    [{ a: "b=c" }, 512 * 1048576, 1.5, "running", [["tail", "-f"]]],
  );
  const semLimites = docker("create", "alpine", "x");
  assert.equal(semLimites.status, 0);
  const criado = falso.containers().find((c) => c.id === semLimites.stdout.trim());
  assert.deepEqual([criado?.memoria, criado?.cpus, criado?.estado], [0, 0, "created"]);
  assert.equal(docker("exec", criado?.id ?? "", "ls").status, 1);
  assert.equal(docker("start", criado?.id ?? "").status, 0);
  assert.equal(docker("exec", criado?.id ?? "", "ls").status, 0);
  assert.deepEqual(falso.containers().find((c) => c.id === criado?.id)?.comandos, [["x"], ["ls"]]);
  const inspecionado = JSON.parse(docker("inspect", "-f", "{{.HostConfig.Memory}}", id).stdout) as {
    HostConfig: { Memory: number; NanoCpus: number };
    State: { Running: boolean };
  }[];
  assert.deepEqual(
    [inspecionado[0]?.HostConfig.Memory, inspecionado[0]?.HostConfig.NanoCpus, inspecionado[0]?.State.Running],
    [512 * 1048576, 1.5e9, true],
  );
});

test("ps com o filtro lista só os containers com o rótulo; sem filtro, todos", () => {
  const semRotulo = falso.semearContainer({ rotulos: { outro: "x" } });
  const comRotulo = falso.semearContainer({ rotulos: { "fabriquinha.ambiente": "amb-1" } });
  const filtrado = docker("ps", "-a", "--no-trunc", "--filter", "label=fabriquinha.ambiente", "--format", "x").stdout;
  assert.ok(filtrado.includes(`${comRotulo.id}\tamb-1`));
  assert.ok(!filtrado.includes(semRotulo.id));
  assert.ok(docker("ps").stdout.includes(semRotulo.id));
});

test("stats mostra o uso semeado ou mudado de cada container pedido, o de um parado sem semente, e falha com o que não existe", () => {
  const semeado = falso.semearContainer({ uso: { cpu: "12.50%", memoria: "256MiB / 2GiB" } });
  const semUso = falso.semearContainer({});
  const formato = "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}";
  assert.equal(
    docker("stats", "--no-stream", "--format", formato, semeado.id, semUso.id).stdout,
    `${semeado.id}\t12.50%\t256MiB / 2GiB\n${semUso.id}\t0.00%\t0B / 0B\n`,
  );
  falso.mudarUso(semUso.id, { cpu: "3.00%", memoria: "1GiB / 2GiB" });
  falso.mudarUso("inexistente", { cpu: "1.00%", memoria: "1MiB / 1MiB" });
  assert.equal(docker("stats", "--no-stream", semUso.id).stdout, `${semUso.id}\t3.00%\t1GiB / 2GiB\n`);
  const deQuemNaoExiste = docker("stats", "--no-stream", "inexistente");
  assert.equal(deQuemNaoExiste.status, 1);
  assert.match(deQuemNaoExiste.stderr, /No such container/);
});

test("rm tira o container; um que não existe falha", () => {
  const { id } = falso.semearContainer({});
  assert.equal(docker("rm", "-f", id).status, 0);
  const de_novo = docker("rm", "-f", id);
  assert.equal(de_novo.status, 1);
  assert.match(de_novo.stderr, /No such container/);
});

const dockerAssincrono = (...args: string[]): Promise<{ codigo: number | null; stderr: string }> => {
  const processo = spawn("docker", args, { stdio: ["ignore", "ignore", "pipe"] });
  let stderr = "";
  processo.stderr.on("data", (pedaco: Buffer) => (stderr += pedaco.toString()));
  return once(processo, "close").then(([codigo]) => ({ codigo: codigo as number | null, stderr }));
};

test("run com --name ao mesmo tempo que outros run, start e rm nunca lê um container pela metade nem um que acabou de sair", async () => {
  docker("pull", "alpine");
  const removiveis = Array.from({ length: 10 }, () => falso.semearContainer({}).id);
  const parados = Array.from({ length: 10 }, () => falso.semearContainer({}).id);
  const resultados = await Promise.all([
    ...Array.from({ length: 20 }, (_, indice) =>
      dockerAssincrono("run", "-d", "--name", `concorrente-${String(indice)}`, "alpine", "tail"),
    ),
    ...parados.map((id) => dockerAssincrono("start", id)),
    ...removiveis.map((id) => dockerAssincrono("rm", "-f", id)),
  ]);
  assert.deepEqual(
    resultados.filter(({ codigo }) => codigo !== 0),
    [],
  );
});

test("ps com --format {{.Names}} e o filtro de nome lista os nomes que contêm o pedaço", () => {
  falso.semearContainer({ nome: "fabriquinha-slot-41" });
  falso.semearContainer({ nome: "outro-41" });
  const nomes = docker("ps", "--all", "--filter", "name=fabriquinha-slot-", "--format", "{{.Names}}").stdout;
  assert.ok(nomes.split("\n").includes("fabriquinha-slot-41"));
  assert.ok(!nomes.includes("outro-41"));
});

test("comando sem suporte sai com 2 e falharComando derruba o comando; tudo vai para o registro", () => {
  assert.equal(docker("volume", "ls").status, 2);
  falso.falharComando("pull", "sem rede");
  const falha = docker("pull", "x");
  assert.deepEqual([falha.status, falha.stderr.trim()], [1, "sem rede"]);
  assert.deepEqual(falso.registro().slice(-2), [
    ["volume", "ls"],
    ["pull", "x"],
  ]);
});

test("run grava os -v e os --add-host, e o inspect os mostra", () => {
  const executado = docker(
    ...["run", "-d", "-v", "/a:/a:rw", "-v", "/b:/b:ro", "--add-host", "host.docker.internal:host-gateway", "alpine"],
  );
  const id = executado.stdout.trim();
  const container = falso.containers().find((c) => c.id === id);
  assert.deepEqual(
    [container?.montagens, container?.hospedeiros],
    [["/a:/a:rw", "/b:/b:ro"], ["host.docker.internal:host-gateway"]],
  );
  const [inspecionado] = JSON.parse(docker("inspect", id).stdout) as {
    HostConfig: { Binds: string[]; ExtraHosts: string[] };
  }[];
  assert.deepEqual(inspecionado?.HostConfig, {
    ...inspecionado?.HostConfig,
    Binds: ["/a:/a:rw", "/b:/b:ro"],
    ExtraHosts: ["host.docker.internal:host-gateway"],
  });
});

test("run com -v de arquivo do host sob o /home/node liga o arquivo ao HOME do container pelo inode, e a imagem diz o HOME", () => {
  assert.equal(docker("run", "--rm", "--entrypoint", "sh", "alpine", "-c", 'echo "$HOME"').stdout.trim(), "/home/node");
  const credencial = join(base, "credencial.json");
  writeFileSync(credencial, "{}");
  const id = docker("run", "-d", "-v", `${credencial}:/home/node/.claude/.credentials.json:rw`, "alpine").stdout.trim();
  const noContainer = join(falso.homeDoContainer(id), ".claude", ".credentials.json");
  assert.ok(!lstatSync(noContainer).isSymbolicLink());
  writeFileSync(credencial, '{"novo":true}');
  assert.equal(readFileSync(noContainer, "utf8"), '{"novo":true}');
  // Como no docker de verdade, o rename no host dá outro inode ao arquivo, e o container fica com o velho.
  writeFileSync(`${credencial}.tmp`, '{"renomeado":true}');
  renameSync(`${credencial}.tmp`, credencial);
  assert.equal(readFileSync(noContainer, "utf8"), '{"novo":true}');
});

test("run com -v de pasta do host vale no exec: o symlink do HOME segue o rename feito no host", () => {
  const pasta = join(base, "pasta-montada");
  mkdirSync(pasta);
  writeFileSync(join(pasta, "auth.json"), "antes");
  const id = docker("run", "-d", "-v", `${pasta}:/credenciais/x:rw`, "alpine").stdout.trim();
  const ligar = docker(
    ...["exec", id, "sh", "-c", 'mkdir -p "$HOME/.x" && ln -sfn \'/credenciais/x/auth.json\' "$HOME/.x/auth.json"'],
  );
  assert.equal(ligar.status, 0, ligar.stderr);
  const noContainer = join(falso.homeDoContainer(id), ".x", "auth.json");
  assert.ok(lstatSync(noContainer).isSymbolicLink());
  writeFileSync(join(pasta, "auth.json.tmp"), "depois");
  renameSync(join(pasta, "auth.json.tmp"), join(pasta, "auth.json"));
  assert.equal(readFileSync(noContainer, "utf8"), "depois");
});

test("exec com -w e --env-file roda o roteiro no host só com o env do arquivo, e o código de saída volta", () => {
  const { id } = falso.semearContainer({});
  const arquivoDeEnv = join(base, "env-do-exec");
  writeFileSync(arquivoDeEnv, "DE_DENTRO=valor=com=igual\n");
  const roteiro = "mkdir -p /fabriquinha/pids; echo $$ > /fabriquinha/pids/5; exec sh -c 'env; pwd; exit 4'";
  process.env.SEGREDO_DO_HOST = "valor";
  const executado = docker("exec", "-w", base, "--env-file", arquivoDeEnv, id, "sh", "-c", roteiro);
  delete process.env.SEGREDO_DO_HOST;
  assert.equal(executado.status, 4);
  assert.match(executado.stdout, /^DE_DENTRO=valor=com=igual$/m);
  assert.match(executado.stdout, new RegExp(`^HOME=${falso.homeDoContainer(id)}$`, "m"));
  assert.match(executado.stdout, new RegExp(`^HOSTNAME=${id.slice(0, 12)}$`, "m"));
  assert.ok(!executado.stdout.includes("SEGREDO_DO_HOST"));
  assert.ok(executado.stdout.endsWith(`${base}\n`));
  assert.ok(existsSync(join(base, "pids", id, "5")));
  assert.deepEqual(falso.containers().find((c) => c.id === id)?.comandos, [["sh", "-c", roteiro]]);
});

test("exec -i entrega o stdin ao roteiro; sem -i o stdin está fechado; -w que não existe falha com 126", () => {
  const { id } = falso.semearContainer({});
  const roteiro = "echo $$ > /fabriquinha/pids/6; exec cat";
  assert.equal(docker("exec", id, "sh", "-c", roteiro).stdout, "");
  const comStdin = spawnSync("docker", ["exec", "-i", id, "sh", "-c", roteiro], { encoding: "utf8", input: "oi" });
  assert.equal(comStdin.stdout, "oi");
  const semPasta = docker("exec", "-w", join(base, "nada"), id, "sh", "-c", roteiro);
  assert.equal(semPasta.status, 126);
  assert.match(semPasta.stderr, /no such file or directory/);
});

test("exec do roteiro que morre por sinal sai com 128 + o sinal, e o kill no grupo gravado o alcança", async () => {
  const { id } = falso.semearContainer({});
  const processo = spawn(
    "docker",
    ["exec", id, "sh", "-c", "echo $$ > /fabriquinha/pids/9; sleep 30 & exec sleep 31"],
    {
      stdio: "ignore",
    },
  );
  while (!existsSync(join(base, "pids", id, "9"))) await new Promise((resolve) => setTimeout(resolve, 20));
  const matar = docker("exec", id, "sh", "-c", 'kill -KILL -"$(cat /fabriquinha/pids/9)"');
  assert.equal(matar.status, 0);
  const [codigo] = (await once(processo, "close")) as [number];
  assert.equal(codigo, 137);
});

test("exec de outro comando só vai para o registro, sem rodar no host", () => {
  const { id } = falso.semearContainer({});
  assert.equal(docker("exec", id, "sh", "-c", "exit 9").status, 0);
});

test("pararDocker faz todo comando falhar como o docker desligado, e religarDocker o devolve", () => {
  const { id } = falso.semearContainer({});
  falso.pararDocker();
  for (const args of [["ps"], ["exec", id, "true"], ["rm", id]]) {
    const resposta = docker(...args);
    assert.equal(resposta.status, 1);
    assert.match(resposta.stderr, /Cannot connect to the Docker daemon/);
  }
  assert.equal(falso.containers().length > 0, true, "o que está nos containers não muda");
  falso.religarDocker();
  assert.equal(docker("ps").status, 0);
});

test("o container parado aparece como exited no ps, recusa exec e perde o marcador do tmpfs ao religar", () => {
  const { id } = falso.semearContainer({ rotulos: { "fabriquinha.ambiente": "amb-parado" } });
  assert.equal(docker("exec", id, "test", "-e", "/run/fabriquinha/regras").status, 1, "sem o marcador");
  assert.equal(docker("exec", "-u", "0", id, "touch", "/run/fabriquinha/regras").status, 0);
  assert.equal(docker("exec", id, "test", "-e", "/run/fabriquinha/regras").status, 0);

  falso.pararContainer(id);
  falso.pararContainer("inexistente");
  assert.match(docker("ps", "--filter", "label=fabriquinha.ambiente").stdout, new RegExp(`${id}\tamb-parado\texited`));
  assert.match(docker("exec", id, "true").stderr, /is not running/);

  falso.religarContainer(id);
  falso.religarContainer("inexistente");
  assert.match(docker("ps", "--filter", "label=fabriquinha.ambiente").stdout, new RegExp(`${id}\tamb-parado\trunning`));
  assert.equal(docker("exec", id, "test", "-e", "/run/fabriquinha/regras").status, 1, "o tmpfs voltou vazio");

  docker("exec", id, "touch", "/run/fabriquinha/regras");
  assert.equal(docker("stop", id).status, 0);
  assert.equal(falso.containers().find((container) => container.id === id)?.estado, "exited");
  assert.equal(docker("start", id).status, 0);
  assert.equal(docker("exec", id, "test", "-e", "/run/fabriquinha/regras").status, 1, "o start também esvazia o tmpfs");
});
