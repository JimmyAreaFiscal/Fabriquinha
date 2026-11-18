import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../../apoio-testes/falsos/docker_falso.ts";
import { pastasDoAmbiente } from "./pastas_do_ambiente.ts";
import { PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { GeradorDeAmbientes } from "./gerador_de_ambientes.ts";

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

test("criar monta exatamente a pasta das worktrees do projeto, o .git, as pastas próprias de sessão e de execução, o pacote e o harness (ro)", async () => {
  const raiz = join(base, "fabriquinha-raiz");
  mkdirSync(raiz);
  writeFileSync(join(raiz, "fabriquinha.db"), "banco");
  const pastaDasWorktreesDoProjeto = join(raiz, "worktrees", "projeto");
  const pacote = join(base, "pacote-pi");
  const harness = {
    comando: "pi",
    executavel: join(base, "pi-do-host", "dist", "cli.js"),
    raiz: join(base, "pi-do-host"),
  };
  const antes = docker.registro().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, {
    pastaDasWorktreesDoProjeto,
    raiz_git: raizGit,
    raiz,
    pacote,
    harness,
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
    // O pi do host entra só em leitura, e o `pi` do container aponta para o executável dele.
    mesmoCaminho(harness.raiz, "ro"),
  ]);
  assert.ok(
    docker
      .registro()
      .slice(antes)
      .some(
        (chamada) =>
          chamada.join(" ") ===
          `exec -u 0 ${criado.container_id} sh -c mkdir -p /usr/local/bin && ln -sf '${harness.executavel}' /usr/local/bin/pi`,
      ),
  );
  const run = docker.registro().findLast(([comando, opcao]) => comando === "run" && opcao === "-d") ?? [];
  assert.equal(run.filter((argumento) => argumento === "-v").length, 10);
  assert.ok(!run.includes("--mount"));
  assert.ok(!run.some((argumento) => argumento.includes("fabriquinha.db") || argumento === `${raiz}:${raiz}:rw`));
  assert.deepEqual([readdirSync(sessoes), readdirSync(execucoes)], [[], []]);
  assert.ok(!existsSync(join(raiz, "ambientes", criado.id, "pi")), "o pi não é montado");
});

/** A pasta do agente do pi do Auditor com o `auth.json` como o operador a prepara: symlink para uma pasta só da credencial. */
function prepararDirDoPi(nome: string, credencial: string): { dirDoPi: string; pastaDaCredencialDoPi: string } {
  const dirDoPi = join(base, `pi-${nome}`);
  const pastaDaCredencialDoPi = join(base, `credencial-pi-${nome}`);
  mkdirSync(dirDoPi);
  mkdirSync(pastaDaCredencialDoPi);
  writeFileSync(join(pastaDaCredencialDoPi, "auth.json"), credencial);
  symlinkSync(join(pastaDaCredencialDoPi, "auth.json"), join(dirDoPi, "auth.json"));
  return { dirDoPi, pastaDaCredencialDoPi };
}

test("criar copia só a configuração do pi, do .claude e do .codex: sessões, históricos, logs e o resto ficam no host", async () => {
  const { dirDoPi } = prepararDirDoPi("com-sessoes", "{}");
  const home = join(base, "home-com-sessoes");
  const vivos = {
    [join(home, ".claude")]: [
      "projects/p/t.jsonl",
      "history.jsonl",
      "file-history/f",
      "daemon.log",
      "shell-snapshots/s.sh",
    ],
    [join(home, ".codex")]: [
      "sessions/s.jsonl",
      "history.jsonl",
      "logs_2.sqlite",
      "logs_2.sqlite-wal",
      "shell_snapshots/s",
    ],
  };
  for (const [pasta, arquivos] of Object.entries(vivos))
    for (const arquivo of arquivos) {
      mkdirSync(dirname(join(pasta, arquivo)), { recursive: true });
      writeFileSync(join(pasta, arquivo), "vivo");
    }
  mkdirSync(join(home, ".claude", "skills", "s"), { recursive: true });
  writeFileSync(join(home, ".claude", "skills", "s", "SKILL.md"), "skill");
  writeFileSync(join(home, ".codex", "config.toml"), "modelo");
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: home,
  });
  const homeDoContainer = docker.homeDoContainer(criado.container_id);
  const destinos = {
    [join(home, ".claude")]: ".claude",
    [join(home, ".codex")]: ".codex",
  };
  for (const [pasta, arquivos] of Object.entries(vivos))
    for (const arquivo of arquivos)
      assert.ok(!existsSync(join(homeDoContainer, destinos[pasta] ?? "", arquivo)), `${pasta}/${arquivo} foi copiado`);
  assert.ok(existsSync(join(homeDoContainer, ".pi", "agent", "auth.json")));
  assert.ok(existsSync(join(homeDoContainer, ".claude", "skills", "s", "SKILL.md")));
  assert.ok(existsSync(join(homeDoContainer, ".codex", "config.toml")));
});

test("criar monta só a pasta da credencial do pi e copia a configuração do pi, o .claude e o .codex para o home do container (por tar, sem docker cp e sem montagem)", async () => {
  const { dirDoPi, pastaDaCredencialDoPi } = prepararDirDoPi("do-auditor", '{"anthropic":{"access":"segredo"}}');
  const home = join(base, "home-do-usuario");
  mkdirSync(join(home, ".claude"), { recursive: true });
  mkdirSync(join(home, ".codex"));
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
    !chamadas.some((chamada) => chamada.some((argumento) => argumento.includes(`${home}:`))),
    "o .claude e o .codex vão por cópia, não por montagem",
  );
  // Só a pasta da credencial é montada, e a pasta do agente do pi (extensões, configuração) nunca: o pi do host as executaria.
  assert.deepEqual(montagensDe(criado.container_id), [`${pastaDaCredencialDoPi}:/credenciais/pi:rw`]);
  assert.ok(
    montagensDe(criado.container_id).every((montagem) => !montagem.startsWith(`${dirDoPi}:`)),
    "nenhum -v tem a pasta do agente do pi como origem",
  );
  assert.ok(lstatSync(join(homeDoContainer, ".pi", "agent", "auth.json")).isSymbolicLink());
  assert.ok(!chamadas.some((chamada) => chamada.join(" ").includes("chown")));
  // Sem .claude nem .codex no home do usuário, ou com um .claude sem nada da configuração, só o pi vai.
  const homeSemConfiguracao = join(base, "home-sem-configuracao");
  mkdirSync(join(homeSemConfiguracao, ".claude"), { recursive: true });
  writeFileSync(join(homeSemConfiguracao, ".claude", "history.jsonl"), "vivo");
  const outro = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: homeSemConfiguracao,
  });
  assert.deepEqual(readdirSync(docker.homeDoContainer(outro.container_id)), [".pi"]);
});

const VARIAVEL_DO_CLAUDE = "CLAUDE_SECURESTORAGE_CONFIG_DIR";

/** Roda `trabalho` com a variável da pasta de credencial do Claude do host trocada (ou tirada) e a devolve ao fim. */
async function comPastaDaCredencialDoClaude<T>(pasta: string | undefined, trabalho: () => Promise<T>): Promise<T> {
  const anterior = process.env[VARIAVEL_DO_CLAUDE];
  if (pasta === undefined) delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
  else process.env[VARIAVEL_DO_CLAUDE] = pasta;
  try {
    return await trabalho();
  } finally {
    if (anterior === undefined) delete process.env.CLAUDE_SECURESTORAGE_CONFIG_DIR;
    else process.env[VARIAVEL_DO_CLAUDE] = anterior;
  }
}

/** Um home de usuário com o pi, o `.claude` e o `.codex` (só configuração) e, fora dele, as pastas só de credencial. */
function prepararCredenciaisDoHost(nome: string) {
  const { dirDoPi, pastaDaCredencialDoPi } = prepararDirDoPi(nome, "pi-1");
  const home = join(base, `home-${nome}`);
  const pastaDoClaude = join(base, `credencial-claude-${nome}`);
  const pastaDoCodex = join(base, `credencial-codex-${nome}`);
  for (const pasta of [join(home, ".claude"), join(home, ".codex"), pastaDoClaude, pastaDoCodex])
    mkdirSync(pasta, { recursive: true });
  writeFileSync(join(pastaDoClaude, ".credentials.json"), "claude-1");
  writeFileSync(join(pastaDoCodex, "auth.json"), "codex-1");
  writeFileSync(join(home, ".claude", "CLAUDE.md"), "instruções");
  writeFileSync(join(home, ".claude", "settings.json"), "{}");
  writeFileSync(join(home, ".codex", "config.toml"), "modelo");
  symlinkSync(join(pastaDoCodex, "auth.json"), join(home, ".codex", "auth.json"));
  return {
    copias: { dir_do_pi: dirDoPi, home_do_usuario: home },
    dirDoPi,
    pastaDaCredencialDoPi,
    home,
    pastaDoClaude,
    pastaDoCodex,
  };
}

const montagensDe = (containerId: string) => docker.containers().find((c) => c.id === containerId)?.montagens ?? [];

test("criar compartilha a credencial do pi, a do Claude e a do Codex (só a pasta de credencial) em vez de copiá-las, e o container vê a renovação, inclusive por rename", async () => {
  const { copias, dirDoPi, pastaDaCredencialDoPi, pastaDoClaude, pastaDoCodex } =
    prepararCredenciaisDoHost("compartilhada");
  const antes = docker.registro().length;
  const criado = await comPastaDaCredencialDoClaude(pastaDoClaude, () =>
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
  );
  const homeDoContainer = docker.homeDoContainer(criado.container_id);
  const montagens = montagensDe(criado.container_id);
  // Nada do ~/.pi/agent, ~/.claude nem ~/.codex do host (extensões, sessões, hooks, config.toml) é montado: só as três pastas de credencial.
  assert.deepEqual(montagens, [
    `${pastaDaCredencialDoPi}:/credenciais/pi:rw`,
    `${pastaDoClaude}:/credenciais/claude:rw`,
    `${pastaDoCodex}:/credenciais/codex:rw`,
  ]);
  // O pi grava no lugar, seguindo o symlink do `auth.json` do host e o do container até a pasta montada.
  const credencialDoPiNoHost = join(dirDoPi, "auth.json");
  const credencialDoPiNoContainer = join(homeDoContainer, ".pi", "agent", "auth.json");
  assert.ok(lstatSync(credencialDoPiNoContainer).isSymbolicLink(), "auth.json do pi no container é symlink");
  writeFileSync(credencialDoPiNoHost, "pi-renovado-no-host");
  assert.equal(readFileSync(credencialDoPiNoContainer, "utf8"), "pi-renovado-no-host");
  writeFileSync(credencialDoPiNoContainer, "pi-renovado-no-container");
  assert.equal(readFileSync(join(pastaDaCredencialDoPi, "auth.json"), "utf8"), "pi-renovado-no-container");
  assert.equal(readFileSync(credencialDoPiNoHost, "utf8"), "pi-renovado-no-container");
  // O Claude Code grava por temporário + rename na pasta montada, sem symlink no HOME: só ela deixa os dois lados verem a troca.
  assert.ok(!existsSync(join(homeDoContainer, ".claude", ".credentials.json")), "o Claude não lê pelo HOME");
  const trocarPorRename = (pasta: string, credencial: string, conteudo: string) => {
    writeFileSync(join(pasta, `${credencial}.tmp`), conteudo);
    renameSync(join(pasta, `${credencial}.tmp`), join(pasta, credencial));
  };
  trocarPorRename(pastaDoClaude, ".credentials.json", "claude-renovado-no-host");
  assert.equal(readFileSync(join(pastaDoClaude, ".credentials.json"), "utf8"), "claude-renovado-no-host");
  // O Codex segue o symlink do HOME do container, que aponta para a pasta montada, e grava nela.
  const credencialDoCodexNoContainer = join(homeDoContainer, ".codex", "auth.json");
  assert.ok(lstatSync(credencialDoCodexNoContainer).isSymbolicLink(), "auth.json do Codex foi copiado");
  trocarPorRename(pastaDoCodex, "auth.json", "codex-renovado-no-host");
  assert.equal(readFileSync(credencialDoCodexNoContainer, "utf8"), "codex-renovado-no-host");
  trocarPorRename(dirname(realpathSync(credencialDoCodexNoContainer)), "auth.json", "codex-renovado-no-container");
  assert.equal(readFileSync(join(pastaDoCodex, "auth.json"), "utf8"), "codex-renovado-no-container");
  // A configuração segue por cópia, sem a credencial.
  assert.equal(readFileSync(join(homeDoContainer, ".claude", "CLAUDE.md"), "utf8"), "instruções");
  assert.equal(readFileSync(join(homeDoContainer, ".codex", "config.toml"), "utf8"), "modelo");
  const chamadas = docker.registro().slice(antes);
  assert.ok(!chamadas.some((chamada) => chamada.join(" ").includes("chown")));
  // Sem a credencial do Claude e do Codex no host, só a do pi é montada.
  const homeSemCredencial = join(base, "home-sem-credencial");
  mkdirSync(join(homeSemCredencial, ".claude"), { recursive: true });
  const outro = await comPastaDaCredencialDoClaude(undefined, () =>
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
      dir_do_pi: dirDoPi,
      home_do_usuario: homeSemCredencial,
    }),
  );
  assert.deepEqual(montagensDe(outro.container_id), [`${pastaDaCredencialDoPi}:/credenciais/pi:rw`]);
});

test("criar recusa a credencial do Claude que ainda mora no ~/.claude, ou numa pasta sem login, e orienta o operador, sem subir container", async () => {
  const { copias, home, pastaDoClaude } = prepararCredenciaisDoHost("claude-recusado");
  const antes = docker.containers().length;
  writeFileSync(join(home, ".claude", ".credentials.json"), "{}");
  await comPastaDaCredencialDoClaude(undefined, () =>
    assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /não está definida.*mkdir -m 700.*CLAUDE_SECURESTORAGE_CONFIG_DIR=/s,
    ),
  );
  await comPastaDaCredencialDoClaude(join(home, ".claude"), () =>
    assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /a pasta da credencial é a própria.*sessões e configuração/s,
    ),
  );
  rmSync(join(pastaDoClaude, ".credentials.json"));
  await comPastaDaCredencialDoClaude(pastaDoClaude, () =>
    assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /não existe o .*\.credentials\.json.*entre no Claude \(login\)/s,
    ),
  );
  assert.equal(docker.containers().length, antes);
});

test("criar recusa o auth.json do Codex que não é symlink para uma pasta só de credencial, e orienta o operador, sem subir container", async () => {
  const { copias, home, pastaDoCodex } = prepararCredenciaisDoHost("codex-recusado");
  const antes = docker.containers().length;
  const authDoHost = join(home, ".codex", "auth.json");
  rmSync(authDoHost);
  writeFileSync(authDoHost, "{}");
  await comPastaDaCredencialDoClaude(undefined, async () => {
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /arquivo comum.*ln -s/s,
    );
    rmSync(authDoHost);
    symlinkSync(join(pastaDoCodex, "nao-existe.json"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /aponta para um arquivo que não existe.*ln -s/s,
    );
    rmSync(authDoHost);
    writeFileSync(join(home, ".codex", "auth.json.real"), "{}");
    symlinkSync(join(home, ".codex", "auth.json.real"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /não se chama auth\.json/,
    );
  });
  assert.equal(docker.containers().length, antes);
});

test("criar recusa o auth.json do pi que não é symlink para uma pasta só de credencial, e orienta o operador, sem subir container", async () => {
  const { copias, dirDoPi, pastaDaCredencialDoPi } = prepararCredenciaisDoHost("pi-recusado");
  const antes = docker.containers().length;
  const authDoHost = join(dirDoPi, "auth.json");
  await comPastaDaCredencialDoClaude(undefined, async () => {
    rmSync(authDoHost);
    writeFileSync(authDoHost, "{}");
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /arquivo comum.*mkdir -m 700 ~\/credenciais-pi.*mv .*ln -s ~\/credenciais-pi\/auth\.json/s,
    );
    rmSync(authDoHost);
    symlinkSync(join(pastaDaCredencialDoPi, "nao-existe.json"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /aponta para um arquivo que não existe.*ln -s/s,
    );
    rmSync(authDoHost);
    writeFileSync(join(dirDoPi, "auth.json.real"), "{}");
    symlinkSync(join(dirDoPi, "auth.json.real"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, copias),
      /não se chama auth\.json/,
    );
  });
  assert.equal(docker.containers().length, antes);
});

test("criar tira das cópias do pi e do .claude o token do GitHub, e o resto do arquivo continua igual; a credencial do pi montada fica como está", async () => {
  const token = `ghp_${"a1B2".repeat(9)}`;
  const { dirDoPi } = prepararDirDoPi("com-token", `{"github-copilot":"${token}"}`);
  const home = join(base, "home-com-token");
  const tokenFinoDoGithub = `github_pat_${"x9".repeat(15)}`;
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(dirDoPi, "settings.json"), `{"github":"${token}","tema":"escuro"}`);
  mkdirSync(join(home, ".claude", "skills"));
  writeFileSync(
    join(home, ".claude", "skills", "arquivo com espaço.md"),
    `token ${tokenFinoDoGithub} e ${token}\noutra linha`,
  );
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, undefined, {
    dir_do_pi: dirDoPi,
    home_do_usuario: home,
  });
  const homeDoContainer = docker.homeDoContainer(criado.container_id);
  assert.equal(
    readFileSync(join(homeDoContainer, ".claude", "skills", "arquivo com espaço.md"), "utf8"),
    "token [token-do-github-removido] e [token-do-github-removido]\noutra linha",
  );
  assert.equal(
    readFileSync(join(homeDoContainer, ".pi", "agent", "settings.json"), "utf8"),
    '{"github":"[token-do-github-removido]","tema":"escuro"}',
  );
  // O do host não muda, e a credencial montada não passa pelo `sed -i`, que reescreveria o arquivo do host.
  assert.equal(readFileSync(join(dirDoPi, "settings.json"), "utf8"), `{"github":"${token}","tema":"escuro"}`);
  assert.equal(readFileSync(join(dirDoPi, "auth.json"), "utf8"), `{"github-copilot":"${token}"}`);
});

test("criar com cópia que falha mata o docker exec da cópia, elimina o container e diz o motivo", async () => {
  const { dirDoPi } = prepararDirDoPi("com-cópia-ruim", "{}");
  const home = join(base, "home-com-cópia-ruim");
  mkdirSync(join(home, ".claude"), { recursive: true });
  writeFileSync(join(home, ".claude", "settings.json"), "{}"); // sem configuração a copiar, não haveria tar
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
      /não foi possível copiar .*home-com-cópia-ruim.\.claude para o container: saiu com código 2; tar: sem espaço/,
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

test("medirUso lê numa chamada só o uso de CPU e de memória dos containers pedidos, em CPUs e MB", async () => {
  const ocupado = docker.semearContainer({ uso: { cpu: "52.50%", memoria: "256MiB / 2GiB" } });
  const pesado = docker.semearContainer({ uso: { cpu: "150.00%", memoria: "1.5GiB / 4GiB" } });
  const parado = docker.semearContainer({ uso: { cpu: "0.00%", memoria: "512KiB / 1GiB" } });
  const zerado = docker.semearContainer({});
  const chamadasAntes = docker.registro().length;

  const uso = await gerador.medirUso([ocupado.id, pesado.id, parado.id, zerado.id]);

  assert.deepEqual(
    uso,
    new Map([
      [ocupado.id, { cpus: 0.525, memoria_mb: 256 }],
      [pesado.id, { cpus: 1.5, memoria_mb: 1536 }],
      [parado.id, { cpus: 0, memoria_mb: 0.5 }],
      [zerado.id, { cpus: 0, memoria_mb: 0 }],
    ]),
  );
  assert.deepEqual(docker.registro().slice(chamadasAntes), [
    [
      "stats",
      "--no-stream",
      "--format",
      "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}",
      ocupado.id,
      pesado.id,
      parado.id,
      zerado.id,
    ],
  ]);
});

test("medirUso sem container não chama o docker, e o docker que falha ou responde o que não se lê é uma falha", async () => {
  const chamadasAntes = docker.registro().length;
  assert.deepEqual(await gerador.medirUso([]), new Map());
  assert.equal(docker.registro().length, chamadasAntes);
  await assert.rejects(gerador.medirUso(["inexistente"]), /docker stats falhou: .*No such container/s);
  for (const uso of [
    { cpu: "--", memoria: "1MiB / 2MiB" },
    { cpu: "1.00%", memoria: "1PiB / 2PiB" },
  ]) {
    const estranho = docker.semearContainer({ uso });
    await assert.rejects(gerador.medirUso([estranho.id]), /o docker stats respondeu o que não se lê/);
  }
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
