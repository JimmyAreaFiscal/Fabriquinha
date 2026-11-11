import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("rm tira o container; um que não existe falha", () => {
  const { id } = falso.semearContainer({});
  assert.equal(docker("rm", "-f", id).status, 0);
  const de_novo = docker("rm", "-f", id);
  assert.equal(de_novo.status, 1);
  assert.match(de_novo.stderr, /No such container/);
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
