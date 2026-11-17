import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "./docker_falso.ts";
import { instalarDockerQueCai } from "./docker_que_cai.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-docker-que-cai-"));
const pathDeAntes = process.env.PATH;
// O docker "de verdade" por trás do que cai é o falso, que não precisa do Docker da máquina.
const falso = instalarDockerFalso(join(base, "falso"));
const dockerQueCai = instalarDockerQueCai(join(base, "que-cai"));
after(() => {
  dockerQueCai.desinstalar();
  rmSync(base, { recursive: true, force: true });
});

const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8" });
const listarDoConjunto = () => docker("ps", "--all", "--filter", "label=fabriquinha.ambiente", "--format", "{{.ID}}");

test("repassa os comandos ao docker de trás e, parado, falha como o cliente sem o daemon até religar", () => {
  falso.semearImagem("img:1");
  assert.equal(docker("image", "inspect", "img:1").status, 0);

  dockerQueCai.parar();
  const parado = docker("image", "inspect", "img:1");
  assert.equal(parado.status, 1);
  assert.match(parado.stderr, /Cannot connect to the Docker daemon/);

  dockerQueCai.religar();
  assert.equal(docker("image", "inspect", "img:1").status, 0);
});

test("a listagem do conjunto mostra só os containers incluídos; as outras listagens ficam como estão", () => {
  const meu = falso.semearContainer({ rotulos: { "fabriquinha.ambiente": "meu" } });
  const doServico = falso.semearContainer({ rotulos: { "fabriquinha.ambiente": "do-servico" } });
  assert.equal(listarDoConjunto().stdout, "");

  dockerQueCai.incluir(meu.id);
  assert.equal(listarDoConjunto().stdout.trim(), `${meu.id}\tmeu\trunning`);
  assert.equal(docker("ps").stdout.trim().split("\n").length, 2);
  assert.ok(docker("ps").stdout.includes(doServico.id));
});

test("a listagem do conjunto repassa a falha do docker de trás, em vez de mostrar um conjunto vazio", () => {
  falso.falharComando("ps", "Cannot connect to the Docker daemon");
  const listagem = listarDoConjunto();
  assert.equal(listagem.status, 1);
  assert.match(listagem.stderr, /Cannot connect to the Docker daemon/);
});

test("desinstalar devolve o PATH de antes", () => {
  dockerQueCai.desinstalar();
  assert.ok(!(process.env.PATH ?? "").includes(join(base, "que-cai")));
  process.env.PATH = pathDeAntes;
});
