import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
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
