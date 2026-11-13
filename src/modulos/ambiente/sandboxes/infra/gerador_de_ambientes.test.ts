import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/docker_falso.ts";
import { pastasDoAmbiente } from "./pastas_do_ambiente.ts";
import { GeradorDeAmbientes, PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "./gerador_de_ambientes.ts";

const base = mkdtempSync(join(tmpdir(), "fabriquinha-gerador-"));
const caminhoOriginal = process.env.PATH;
const docker = instalarDockerFalso(join(base, "docker"));
const raizGit = join(base, "repo");
mkdirSync(join(raizGit, "ambiente"), { recursive: true });
writeFileSync(join(raizGit, "ambiente", "Dockerfile"), "FROM alpine\n");
const sha256DoDockerfile = createHash("sha256").update("FROM alpine\n").digest("hex");
const limites = { memoria_maxima_mb: 512, cpus: 1.5 };
const PORTA_DA_API = 4999;
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
  const [container] = docker.containers();
  assert.deepEqual(criado, { id: criado.id, container_id: container?.id });
  assert.deepEqual(
    [container?.rotulos, container?.memoria, container?.cpus, container?.imagem, container?.estado],
    [{ "fabriquinha.ambiente": criado.id }, 512 * 1048576, 1.5, "node:22-alpine", "running"],
  );
});

test("criar liga o container ao host pelo host-gateway, mesmo sem montagens, e trava no namespace dele tudo que não é a porta da API", async () => {
  const antes = docker.registro().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
  const container = docker.containers().find((c) => c.id === criado.container_id);
  assert.deepEqual([container?.hospedeiros, container?.montagens], [["host.docker.internal:host-gateway"], []]);
  const chamadas = docker.registro().slice(antes);
  const regras = chamadas.find(([comando, opcao]) => comando === "run" && opcao === "--rm");
  const destino = "172.17.0.1";
  assert.deepEqual(regras, [
    "run",
    "--rm",
    "--label",
    `fabriquinha.ambiente=${criado.id}-regras-de-rede`,
    "--memory",
    "64m",
    "--cpus",
    "0.5",
    "--net",
    `container:${criado.container_id}`,
    "--cap-add",
    "NET_ADMIN",
    "fabriquinha/regras-de-rede:1",
    "sh",
    "-c",
    `iptables -A OUTPUT -d ${destino} -p tcp --dport ${String(PORTA_DA_API)} -j ACCEPT && iptables -A OUTPUT -d ${destino} -j REJECT`,
  ]);
  // O container do Ambiente nasce sem NET_ADMIN: só o das regras o tem, e some ao terminar.
  const run = chamadas.find(([comando, opcao]) => comando === "run" && opcao === "-d") ?? [];
  assert.ok(!run.includes("--cap-add") && !run.includes("--privileged"));
});

test("a imagem das regras de rede é construída uma vez só", async () => {
  await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
  const builds = docker
    .registro()
    .filter(([comando, , tag]) => comando === "build" && tag === "fabriquinha/regras-de-rede:1");
  assert.equal(builds.length, 1);
});

test("criar elimina o container e repassa a falha quando as regras de rede não são aplicadas", async () => {
  const antes = docker.containers().length;
  docker.falharComando("exec", "sem /etc/hosts");
  await assert.rejects(gerador.criar("node:22-alpine", limites, PORTA_DA_API), /docker exec falhou: sem \/etc\/hosts/);
  rmSync(join(base, "docker", "falhas", "exec"));
  assert.equal(docker.containers().length, antes);
});

test("criar recusa o container que não conhece o host.docker.internal e o elimina", async () => {
  const semHost = join(base, "sem-host");
  mkdirSync(semHost);
  const registro = join(semHost, "chamadas");
  writeFileSync(
    join(semHost, "docker"),
    `#!/bin/sh\necho "$1" >> ${registro}\ncase "$1" in run) echo abc;; exec) echo "127.0.0.1 localhost";; esac\n`,
  );
  chmodSync(join(semHost, "docker"), 0o755);
  process.env.PATH = `${semHost}:${caminhoOriginal ?? ""}`;
  try {
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API),
      /não conhece o host\.docker\.internal/,
    );
    assert.deepEqual(readFileSync(registro, "utf8").trim().split("\n"), ["run", "exec", "rm"]);
  } finally {
    process.env.PATH = `${join(base, "docker", "bin")}:${caminhoOriginal ?? ""}`;
  }
});

test("criar monta exatamente a pasta das worktrees do projeto, o .git, as pastas próprias de sessão e de execução e o pacote (ro)", async () => {
  const raiz = join(base, "fabriquinha-raiz");
  mkdirSync(raiz);
  writeFileSync(join(raiz, "fabriquinha.db"), "banco");
  const pastaDasWorktreesDoProjeto = join(raiz, "worktrees", "projeto");
  const pacote = join(base, "pacote-pi");
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, {
    pastaDasWorktreesDoProjeto,
    raiz_git: raizGit,
    raiz,
    pacote,
  });
  const montagens = docker
    .containers()
    .find((c) => c.id === criado.container_id)
    ?.montagens.map((montagem) => {
      const [origem, destino, modo] = montagem.split(":");
      return { origem, destino, modo };
    });
  const mesmoCaminho = (caminho: string, modo: string) => ({ origem: caminho, destino: caminho, modo });
  const { sessoes, execucoes } = pastasDoAmbiente(raiz, criado.id);
  // Lista exata: nenhum ~/.pi, ~/.claude nem ~/.codex, nenhum auth.json e nem a pasta inteira de sessões ou de execuções.
  assert.deepEqual(montagens, [
    mesmoCaminho(pastaDasWorktreesDoProjeto, "rw"),
    // O topo do `.git` (commondir, config, hooks, info) é só leitura; escrita só onde o git de uma worktree grava.
    mesmoCaminho(join(raizGit, ".git"), "ro"),
    mesmoCaminho(join(raizGit, ".git", "objects"), "rw"),
    mesmoCaminho(join(raizGit, ".git", "refs"), "rw"),
    mesmoCaminho(join(raizGit, ".git", "logs"), "rw"),
    // `worktrees` fica só leitura, e com ele as worktrees do usuário, existam ou não ao criar o container.
    mesmoCaminho(join(raizGit, ".git", PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA), "rw"),
    { origem: sessoes, destino: join(raiz, "sessoes"), modo: "rw" },
    { origem: execucoes, destino: join(raiz, "execucoes"), modo: "rw" },
    mesmoCaminho(pacote, "ro"),
  ]);
  const run = docker.registro().findLast(([comando, opcao]) => comando === "run" && opcao === "-d") ?? [];
  assert.equal(run.filter((argumento) => argumento === "-v").length, 9);
  assert.ok(!run.includes("--mount"));
  assert.ok(!run.some((argumento) => argumento.includes("fabriquinha.db") || argumento === `${raiz}:${raiz}:rw`));
  assert.deepEqual([readdirSync(sessoes), readdirSync(execucoes)], [[], []]);
  assert.ok(!existsSync(join(raiz, "ambientes", criado.id, "pi")), "o pi não é montado");
});

test("criar copia o pi do Auditor, o .claude e o .codex para o home do container (por tar, sem docker cp e sem montagem)", async () => {
  const dirDoPi = join(base, "pi-do-auditor");
  const home = join(base, "home-do-usuario");
  mkdirSync(dirDoPi);
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"));
  writeFileSync(join(dirDoPi, "auth.json"), '{"anthropic":{"access":"segredo"}}');
  writeFileSync(join(dirDoPi, "trust.json"), "{}");
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "instruções");
  writeFileSync(join(home, ".codex", "config.toml"), "modelo");
  const antes = docker.registro().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: home,
  });
  const homeDoContainer = docker.homeDoContainer(criado.container_id);
  assert.equal(
    readFileSync(join(homeDoContainer, ".pi", "agent", "auth.json"), "utf8"),
    '{"anthropic":{"access":"segredo"}}',
  );
  assert.equal(readFileSync(join(homeDoContainer, ".pi", "agent", "trust.json"), "utf8"), "{}");
  assert.equal(readFileSync(join(homeDoContainer, ".claude", "CLAUDE.md"), "utf8"), "instruções");
  assert.equal(readFileSync(join(homeDoContainer, ".codex", "config.toml"), "utf8"), "modelo");
  const chamadas = docker.registro().slice(antes);
  assert.ok(!chamadas.some(([comando]) => comando === "cp"));
  assert.ok(
    !chamadas.some((chamada) =>
      chamada.some((argumento) => argumento === dirDoPi || argumento.startsWith(`${dirDoPi}:`)),
    ),
  );
  // Sem .claude nem .codex no home do usuário, só o pi vai.
  const outro = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: join(base, "home-vazio"),
  });
  assert.deepEqual(readdirSync(docker.homeDoContainer(outro.container_id)), [".pi"]);
});

test("criar tira das cópias o token do GitHub, e o resto do arquivo continua igual", async () => {
  const dirDoPi = join(base, "pi-com-token");
  const home = join(base, "home-com-token");
  const token = `ghp_${"a1B2".repeat(9)}`;
  const tokenFinoDoGithub = `github_pat_${"x9".repeat(15)}`;
  mkdirSync(dirDoPi);
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(dirDoPi, "auth.json"), "{}");
  writeFileSync(join(dirDoPi, "settings.json"), `{"github":"${token}","tema":"escuro"}`);
  writeFileSync(join(home, ".claude", "arquivo com espaço.md"), `token ${tokenFinoDoGithub} e ${token}\noutra linha`);
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: home,
  });
  const homeDoContainer = docker.homeDoContainer(criado.container_id);
  assert.equal(
    readFileSync(join(homeDoContainer, ".pi", "agent", "settings.json"), "utf8"),
    '{"github":"[token-do-github-removido]","tema":"escuro"}',
  );
  assert.equal(
    readFileSync(join(homeDoContainer, ".claude", "arquivo com espaço.md"), "utf8"),
    "token [token-do-github-removido] e [token-do-github-removido]\noutra linha",
  );
  assert.equal(readFileSync(join(homeDoContainer, ".pi", "agent", "auth.json"), "utf8"), "{}");
});

test("criar com cópia que falha mata o docker exec da cópia, elimina o container e diz o motivo", async () => {
  const dirDoPi = join(base, "pi-com-cópia-ruim");
  const home = join(base, "home-com-cópia-ruim");
  mkdirSync(dirDoPi);
  mkdirSync(home);
  writeFileSync(join(dirDoPi, "auth.json"), "{}");
  // O `docker exec` da cópia guarda o pid e fica preso; o tar só falha depois disso, para encontrá-lo ainda vivo.
  const comExecDaCopiaPreso = join(base, "com-exec-da-copia-preso");
  const arquivoDoPidDoExecPreso = join(comExecDaCopiaPreso, "pid");
  mkdirSync(comExecDaCopiaPreso);
  writeFileSync(
    join(comExecDaCopiaPreso, "docker"),
    `#!/bin/sh\ncase "$*" in *'tar -x'*) echo $$ > '${arquivoDoPidDoExecPreso}'; exec sleep 30;; esac\nexec '${join(base, "docker", "bin", "docker")}' "$@"\n`,
  );
  writeFileSync(
    join(comExecDaCopiaPreso, "tar"),
    `#!/bin/sh\nwhile [ ! -s '${arquivoDoPidDoExecPreso}' ]; do sleep 0.01; done\necho 'tar: sem espaço' >&2\nexit 2\n`,
  );
  for (const programa of ["docker", "tar"]) chmodSync(join(comExecDaCopiaPreso, programa), 0o755);
  process.env.PATH = `${comExecDaCopiaPreso}:${caminhoOriginal ?? ""}`;
  const antes = docker.containers().length;
  try {
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, { dir_do_pi: dirDoPi, home_do_usuario: home }),
      /não foi possível copiar .*pi-com-cópia-ruim para o container: saiu com código 2; tar: sem espaço/,
    );
  } finally {
    process.env.PATH = `${join(base, "docker", "bin")}:${caminhoOriginal ?? ""}`;
  }
  assert.throws(() => process.kill(Number(readFileSync(arquivoDoPidDoExecPreso, "utf8")), 0), { code: "ESRCH" });
  assert.equal(docker.containers().length, antes);
});

test("criar com cópia sem o auth.json do pi falha antes de subir o container, com a orientação", async () => {
  const antes = docker.registro().length;
  await assert.rejects(
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
      dir_do_pi: join(base, "nao-existe"),
      home_do_usuario: base,
    }),
    /não existe o .*auth\.json.*entre no pi/s,
  );
  assert.equal(docker.registro().length, antes);
});

test("criar sem a imagem falha com a orientação", async () => {
  await assert.rejects(gerador.criar("fantasma", limites, PORTA_DA_API), /docker run falhou: .*Docker está rodando/s);
});

test("listarDaFabriquinha devolve só os containers com o rótulo, parados ou não", async () => {
  const antes = (await gerador.listarDaFabriquinha()).length;
  docker.semearContainer({ rotulos: { "com.docker.compose.project": "sonarqube" } });
  docker.semearContainer({});
  const doUsuario = docker.containers().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
  assert.equal(docker.containers().length, doUsuario + 1);
  const listados = await gerador.listarDaFabriquinha();
  assert.equal(listados.length, antes + 1);
  assert.ok(listados.some((c) => c.id === criado.id && c.container_id === criado.container_id));
  assert.ok(docker.containers().length > listados.length);
});

test("limpar roda no container o que mata os processos e esvazia /tmp e a pasta de trabalho", async () => {
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API);
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
