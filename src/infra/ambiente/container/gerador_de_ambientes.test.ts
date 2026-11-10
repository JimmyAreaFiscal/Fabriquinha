import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../apoio-testes/docker_falso.ts";
import { dirDoPiDoAmbiente } from "./ambiente_container.ts";
import { GeradorDeAmbientes } from "./gerador_de_ambientes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gerador-"));
const caminhoOriginal = process.env.PATH;
const docker = instalarDockerFalso(join(base, "docker"));
const raizGit = join(base, "repo");
mkdirSync(join(raizGit, "ambiente"), { recursive: true });
writeFileSync(join(raizGit, "ambiente", "Dockerfile"), "FROM alpine\n");
const sha256DoDockerfile = createHash("sha256").update("FROM alpine\n").digest("hex");
const limites = { memoria_maxima_mb: 512, cpus: 1.5 };
const gerador = new GeradorDeAmbientes();

after(() => {
  rmSync(base, { recursive: true, force: true });
});

test("garantirImagem faz o build do Dockerfile com a tag do projeto e do sha256, e não repete o build", async () => {
  const projeto = { nome: "meu-projeto", raiz_git: raizGit, imagem_do_ambiente: "ambiente/Dockerfile" };
  const tag = `fabriquinha/meu-projeto:${sha256DoDockerfile}`;
  assert.equal(await gerador.garantirImagem(projeto), tag);
  assert.equal(await gerador.garantirImagem(projeto), tag);
  assert.deepEqual(docker.imagens(), [tag]);
  const builds = docker.registro().filter(([comando]) => comando === "build");
  assert.deepEqual(builds, [
    ["build", "-t", tag, "-f", join(raizGit, "ambiente", "Dockerfile"), join(raizGit, "ambiente")],
  ]);
});

test("garantirImagem faz o pull do nome de imagem que não está na máquina, uma vez só", async () => {
  const projeto = { nome: "outro", raiz_git: raizGit, imagem_do_ambiente: "node:22-alpine" };
  assert.equal(await gerador.garantirImagem(projeto), "node:22-alpine");
  assert.equal(await gerador.garantirImagem(projeto), "node:22-alpine");
  assert.deepEqual(
    docker.registro().filter(([comando]) => comando === "pull"),
    [["pull", "node:22-alpine"]],
  );
});

test("garantirImagem explica a falha do build", async () => {
  docker.falharComando("build", "sem espaço em disco");
  await assert.rejects(
    gerador.garantirImagem({ nome: "x", raiz_git: raizGit, imagem_do_ambiente: "ambiente/Dockerfile" }),
    /docker build falhou: sem espaço em disco/,
  );
  rmSync(join(base, "docker", "falhas", "build"));
});

test("criar sobe o container com rótulo, memória e CPUs, e o ambiente volta com o id do rótulo", async () => {
  const criado = await gerador.criar("node:22-alpine", limites);
  const [container] = docker.containers();
  assert.deepEqual(criado, { id: criado.id, container_id: container?.id });
  assert.deepEqual(
    [container?.rotulos, container?.memoria, container?.cpus, container?.imagem, container?.estado],
    [{ "fabriquinha.ambiente": criado.id }, 512 * 1048576, 1.5, "node:22-alpine", "running"],
  );
});

test("criar liga o container à rede do host pelo host-gateway, mesmo sem montagens", async () => {
  await gerador.criar("node:22-alpine", limites);
  const container = docker.containers().at(-1);
  assert.deepEqual([container?.hospedeiros, container?.montagens], [["host.docker.internal:host-gateway"], []]);
});

test("criar monta exatamente a worktree, o .git, as sessões, a execução, o pacote (ro) e o dir do pi com o auth.json", async () => {
  const raiz = join(base, "fabriquinha-raiz");
  const authJson = join(base, "pi-do-usuario", "auth.json");
  mkdirSync(join(base, "pi-do-usuario"));
  writeFileSync(authJson, '{"anthropic":{"access":"segredo"}}');
  writeFileSync(join(base, "pi-do-usuario", "trust.json"), "{}");
  mkdirSync(raiz);
  writeFileSync(join(raiz, "fabriquinha.db"), "banco");
  const worktree = join(raiz, "worktrees", "projeto", "I-1", "rodadas", "1");
  const pacote = join(base, "pacote-pi");
  const criado = await gerador.criar("node:22-alpine", limites, {
    worktree,
    raiz_git: raizGit,
    raiz,
    execucao: 7,
    pacote,
    auth_json: authJson,
  });
  const dirDoPi = dirDoPiDoAmbiente(raiz, criado.id);
  const montagens = docker
    .containers()
    .find((c) => c.id === criado.container_id)
    ?.montagens.map((montagem) => {
      const [origem, destino, modo] = montagem.split(":");
      return { origem, destino, modo };
    });
  const mesmoCaminho = (caminho: string, modo: string) => ({ origem: caminho, destino: caminho, modo });
  assert.deepEqual(montagens, [
    mesmoCaminho(worktree, "rw"),
    mesmoCaminho(join(raizGit, ".git"), "rw"),
    mesmoCaminho(join(raiz, "sessoes"), "rw"),
    mesmoCaminho(join(raiz, "execucoes", "E-7"), "rw"),
    mesmoCaminho(pacote, "ro"),
    mesmoCaminho(dirDoPi, "rw"),
  ]);
  const run = docker.registro().findLast(([comando]) => comando === "run") ?? [];
  assert.equal(run.filter((argumento) => argumento === "-v").length, 6);
  assert.ok(!run.includes("--mount"));
  // O pi do container só tem o auth.json (nem o trust.json do usuário), e o banco da raiz não é montado.
  assert.deepEqual(readdirSync(dirDoPi), ["auth.json"]);
  assert.equal(readFileSync(join(dirDoPi, "auth.json"), "utf8"), '{"anthropic":{"access":"segredo"}}');
  assert.equal(statSync(join(dirDoPi, "auth.json")).mode & 0o777, 0o600);
  assert.ok(!run.some((argumento) => argumento.includes("fabriquinha.db") || argumento === `${raiz}:${raiz}:rw`));
});

test("criar com montagens sem o auth.json do pi falha antes de subir o container, com a orientação", async () => {
  const antes = docker.registro().length;
  await assert.rejects(
    gerador.criar("node:22-alpine", limites, {
      worktree: join(base, "w"),
      raiz_git: raizGit,
      raiz: join(base, "fabriquinha-raiz"),
      execucao: 8,
      pacote: join(base, "pacote-pi"),
      auth_json: join(base, "nao-existe", "auth.json"),
    }),
    /não existe o .*auth\.json.*entre no pi/s,
  );
  assert.equal(docker.registro().length, antes);
});

test("criar sem a imagem falha com a orientação", async () => {
  await assert.rejects(gerador.criar("fantasma", limites), /docker run falhou: .*Docker está rodando/s);
});

test("listarDaFabriquinha devolve só os containers com o rótulo, parados ou não", async () => {
  const antes = (await gerador.listarDaFabriquinha()).length;
  docker.semearContainer({ rotulos: { "com.docker.compose.project": "sonarqube" } });
  docker.semearContainer({});
  const doUsuario = docker.containers().length;
  const criado = await gerador.criar("node:22-alpine", limites);
  assert.equal(docker.containers().length, doUsuario + 1);
  const listados = await gerador.listarDaFabriquinha();
  assert.equal(listados.length, antes + 1);
  assert.ok(listados.some((c) => c.id === criado.id && c.container_id === criado.container_id));
  assert.ok(docker.containers().length > listados.length);
});

test("limpar roda no container o que mata os processos e esvazia /tmp e a pasta de trabalho", async () => {
  const criado = await gerador.criar("node:22-alpine", limites);
  await gerador.limpar(criado);
  const exec = docker
    .containers()
    .find((c) => c.id === criado.container_id)
    ?.comandos.at(-1);
  assert.ok(exec);
  assert.deepEqual(exec.slice(0, 2), ["sh", "-c"]);
  assert.match(String(exec[2]), /^kill -9 -1; find \/tmp \/trabalho -mindepth 1 -delete$/);
});

test("limpar de container que não existe mais falha", async () => {
  await assert.rejects(gerador.limpar({ id: "a", container_id: "inexistente" }), /docker exec falhou/);
});

test("eliminar remove o container, e um que já não existe está eliminado", async () => {
  const criado = await gerador.criar("node:22-alpine", limites);
  await gerador.eliminar(criado);
  assert.ok(!docker.containers().some((c) => c.id === criado.container_id));
  await gerador.eliminar(criado);
});

test("eliminar não esconde outra falha do docker", async () => {
  docker.falharComando("rm", "permission denied");
  await assert.rejects(gerador.eliminar({ id: "a", container_id: "b" }), /permission denied/);
  rmSync(join(base, "docker", "falhas", "rm"));
});

test("comando que passa do limite é morto e a falha diz o limite", async () => {
  const travado = join(base, "travado");
  mkdirSync(travado);
  writeFileSync(join(travado, "docker"), "#!/bin/sh\nexec sleep 30\n");
  chmodSync(join(travado, "docker"), 0o755);
  process.env.PATH = `${travado}:${caminhoOriginal ?? ""}`;
  try {
    await assert.rejects(
      new GeradorDeAmbientes(100).listarDaFabriquinha(),
      /docker ps falhou: passou do limite de 100 ms/,
    );
  } finally {
    process.env.PATH = `${join(base, "docker", "bin")}:${caminhoOriginal ?? ""}`;
  }
});
