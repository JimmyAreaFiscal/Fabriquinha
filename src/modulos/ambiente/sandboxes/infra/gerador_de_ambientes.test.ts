import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
// O docker falso é um só para o arquivo e recusa nome repetido: cada container criado leva um slot novo.
let ultimoSlot = 100;
const proximoSlot = () => ++ultimoSlot;
const raizGit = join(base, "repo");
const BRANCH_BASE = "principal";
/** O git do clone de teste, sem o gitconfig do operador e com uma identidade própria. */
const gitDoClone = (...args: string[]) =>
  execFileSync("git", ["-c", "user.name=Teste", "-c", "user.email=teste@exemplo.com", "-C", raizGit, ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).toString();
const REF_REMOTA_DA_BASE = `refs/remotes/origin/${BRANCH_BASE}`;
/** Grava os arquivos no clone, os commita na branch base e os publica na ref remota dela, de onde a imagem lê. */
function commitarNaBranchBase(conteudoPorCaminho: Record<string, string>): void {
  for (const [caminho, conteudo] of Object.entries(conteudoPorCaminho)) {
    mkdirSync(dirname(join(raizGit, caminho)), { recursive: true });
    writeFileSync(join(raizGit, caminho), conteudo);
  }
  gitDoClone("add", ...Object.keys(conteudoPorCaminho));
  gitDoClone("commit", "-q", "-m", Object.keys(conteudoPorCaminho).join(" "));
  gitDoClone("update-ref", REF_REMOTA_DA_BASE, "HEAD");
}
mkdirSync(raizGit);
gitDoClone("init", "-q", "-b", BRANCH_BASE);
commitarNaBranchBase({
  "web/package.json": '{"name":"web"}',
  "web/package-lock.json": "{}",
  "requirements.txt": "requests==2.32.0\n",
});
const limites = { memoria_maxima_mb: 512, cpus: 1.5 };
const PORTA_DA_API = 4999;
docker.semearImagem("node:22-alpine");
const gerador = new GeradorDeAmbientes();

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const TAG_DO_PROJETO = /^fabriquinha\/meu-projeto:[0-9a-f]{64}$/;
const doProjeto = (...arquivos_de_dependencias: string[]) => ({
  nome: "meu-projeto",
  raiz_git: raizGit,
  branch_base: BRANCH_BASE,
  arquivos_de_dependencias,
});

test("garantirImagem gera a imagem das dependências, com a tag do projeto e do hash, e não repete o build", async () => {
  const projeto = doProjeto("requirements.txt", "web/package.json");
  const tag = await gerador.garantirImagem(projeto);
  assert.match(tag, TAG_DO_PROJETO);
  assert.equal(await gerador.garantirImagem(projeto), tag);
  assert.ok(docker.imagens().includes(tag));
  const builds = docker.registro().filter(([comando]) => comando === "build");
  assert.equal(builds.length, 1);
  assert.deepEqual(builds[0]?.slice(0, 3), ["build", "-t", tag]);
});

test("garantirImagem pedida ao mesmo tempo por vários tickets faz um build só, e todos recebem a imagem", async () => {
  commitarNaBranchBase({ "concorrente/requirements.txt": "six\n" });
  const projeto = doProjeto("concorrente/requirements.txt");
  const buildsAntes = docker.registro().filter(([comando]) => comando === "build").length;
  const tags = await Promise.all([1, 2, 3].map(() => gerador.garantirImagem(projeto)));
  assert.equal(new Set(tags).size, 1);
  assert.equal(docker.registro().filter(([comando]) => comando === "build").length - buildsAntes, 1);
});

test("garantirImagem gera outra imagem quando o arquivo de dependências ou o lockfile muda", async () => {
  const antes = await gerador.garantirImagem(doProjeto("web/package.json"));
  commitarNaBranchBase({ "web/package.json": '{"name":"web","dependencies":{"zod":"^4"}}' });
  const comOutroArquivo = await gerador.garantirImagem(doProjeto("web/package.json"));
  commitarNaBranchBase({ "web/package-lock.json": '{"lockfileVersion":3}' });
  const comLockfile = await gerador.garantirImagem(doProjeto("web/package.json"));
  assert.equal(new Set([antes, comOutroArquivo, comLockfile]).size, 3);
});

test("garantirImagem recusa o arquivo que não entende, o repetido e o que não existe", async () => {
  await assert.rejects(gerador.garantirImagem(doProjeto("Dockerfile")), /não suportados/);
  await assert.rejects(
    gerador.garantirImagem(doProjeto("requirements.txt", "outra/requirements.txt")),
    /não suportados/,
  );
  await assert.rejects(gerador.garantirImagem(doProjeto("api/requirements.txt")), /api\/requirements.txt não existe/);
});

test("garantirImagem lê as dependências de origin/<branch_base>: a cópia de trabalho e a branch local atrás ou à frente não mudam a imagem", async () => {
  const daRefRemota = await gerador.garantirImagem(doProjeto("requirements.txt"));
  const commitDaRefRemota = gitDoClone("rev-parse", REF_REMOTA_DA_BASE).trim();
  try {
    // A cópia de trabalho muda e ganha um arquivo que não está commitado: nada disso conta.
    writeFileSync(join(raizGit, "requirements.txt"), "requests==9.9.9\n");
    mkdirSync(join(raizGit, "so-na-copia"), { recursive: true });
    writeFileSync(join(raizGit, "so-na-copia", "requirements.txt"), "six\n");
    assert.equal(await gerador.garantirImagem(doProjeto("requirements.txt")), daRefRemota);
    await assert.rejects(
      gerador.garantirImagem(doProjeto("so-na-copia/requirements.txt")),
      /so-na-copia\/requirements.txt não existe em origin\/principal/,
    );
    // A branch local à frente da remota: a imagem segue a remota.
    gitDoClone("commit", "-q", "-am", "só na branch local");
    assert.equal(await gerador.garantirImagem(doProjeto("requirements.txt")), daRefRemota);
    // A remota avança e a local fica atrás: a imagem segue a remota.
    gitDoClone("update-ref", REF_REMOTA_DA_BASE, "HEAD");
    gitDoClone("reset", "-q", "--hard", commitDaRefRemota);
    const daRemotaNova = await gerador.garantirImagem(doProjeto("requirements.txt"));
    assert.notEqual(daRemotaNova, daRefRemota);
    assert.match(readFileSync(join(raizGit, "requirements.txt"), "utf8"), /2\.32\.0/);
  } finally {
    gitDoClone("update-ref", REF_REMOTA_DA_BASE, commitDaRefRemota);
    gitDoClone("reset", "-q", "--hard", commitDaRefRemota);
    rmSync(join(raizGit, "so-na-copia"), { recursive: true, force: true });
  }
});

/** As instruções do Dockerfile, com as linhas continuadas (`\` no fim) juntas numa só. */
const instrucoesDoDockerfile = (dockerfile: string) =>
  dockerfile
    .replaceAll(/\\\n\s*/g, "")
    .split("\n")
    .filter(Boolean);

for (const [arquivoDeDependencias, comPlaywright] of [
  ["web/package.json", true],
  ["requirements.txt", false],
] as const)
  test(`a imagem do ${arquivoDeDependencias} traz a base do sandbox: não-root, git de sistema, pids, Python, fuso, procps e /tmp limpo`, async () => {
    const imagem = await gerador.garantirImagem(doProjeto(arquivoDeDependencias));
    const instrucoes = instrucoesDoDockerfile(docker.dockerfileDaImagem(imagem));
    // O Claude Code recusa rodar como root: o node é o último usuário, e nada roda como root depois dele.
    assert.equal(instrucoes.at(-1), "USER node");
    assert.ok(instrucoes.includes("ENV TZ=America/Sao_Paulo"), instrucoes.join("\n"));
    const camadasDeRoot = instrucoes.filter((instrucao) => instrucao.startsWith("RUN "));
    const [camadaDaBase = ""] = camadasDeRoot;
    const pacotesDoApt = /apt-get install -y --no-install-recommends ([^&]+)/
      .exec(camadaDaBase)?.[1]
      ?.trim()
      .split(" ");
    for (const pacote of ["git", "ca-certificates", "procps", "python3", "python3-pip", "python3-venv"])
      assert.ok(pacotesDoApt?.includes(pacote), `falta o pacote ${pacote} em: ${camadaDaBase}`);
    for (const trecho of [
      "git config --system --add safe.directory '*'",
      'git config --system user.name "Fabriquinha"',
      'git config --system user.email "fabriquinha@exemplo.com"',
      "mkdir -p /fabriquinha/pids",
      "chown node:node /fabriquinha/pids",
    ])
      assert.ok(camadaDaBase.includes(trecho), `falta ${trecho} em: ${camadaDaBase}`);
    // O que o root deixa no /tmp o node não apaga, e a limpeza do sandbox falha: toda camada de root termina limpando.
    for (const camada of camadasDeRoot) assert.match(camada, /rm -rf [^&;]* \/tmp\/\*$/);
    const comChromium = camadasDeRoot.filter((camada) => camada.includes("playwright install --with-deps chromium"));
    assert.equal(instrucoes.includes("ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright"), comPlaywright);
    assert.equal(comChromium.length, comPlaywright ? 1 : 0);
    if (comPlaywright) assert.ok(comChromium[0]?.includes("chmod -R a+rX /ms-playwright"));
  });

test("garantirImagem recusa o package.json sem package-lock.json ao lado, que o npm ci exige", async () => {
  commitarNaBranchBase({ "sem-lock/package.json": '{"name":"sem-lock"}' });
  await assert.rejects(gerador.garantirImagem(doProjeto("sem-lock/package.json")), /não tem package-lock.json/);
});

test("garantirImagem explica a falha do build", async () => {
  // Um arquivo que nenhum teste construiu: sem a imagem pronta, o build roda e falha.
  commitarNaBranchBase({ "build-que-falha/requirements.txt": "requests==2.31.0\n" });
  docker.falharComando("build", "sem espaço em disco");
  await assert.rejects(
    gerador.garantirImagem(doProjeto("build-que-falha/requirements.txt")),
    /docker build falhou: sem espaço em disco/,
  );
  rmSync(join(base, "docker", "falhas", "build"));
});

test("criar sobe o container com nome do slot, rótulo, memória e CPUs, e o ambiente volta com o id do rótulo e o slot", async () => {
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, 7);
  const [container] = docker.containers();
  assert.deepEqual(criado, { id: criado.id, container_id: container?.id, slot: 7 });
  assert.deepEqual(
    [container?.nome, container?.rotulos, container?.memoria, container?.cpus, container?.imagem, container?.estado],
    ["fabriquinha-slot-7", { "fabriquinha.ambiente": criado.id }, 512 * 1048576, 1.5, "node:22-alpine", "running"],
  );
  const run = docker.registro().findLast(([comando, opcao]) => comando === "run" && opcao === "-d") ?? [];
  assert.equal(run[run.indexOf("--shm-size") + 1], "1g");
});

test("criar com o nome do slot já tomado no docker falha por nome repetido", async () => {
  docker.semearContainer({ nome: "fabriquinha-slot-9" });
  await assert.rejects(gerador.criar("node:22-alpine", limites, PORTA_DA_API, 9), /already in use/);
});

test("criar liga o container ao host pelo host-gateway, mesmo sem montagens, e trava no namespace dele tudo que não é a porta da API", async () => {
  const antes = docker.registro().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
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
  await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
  const builds = docker
    .registro()
    .filter(([comando, , tag]) => comando === "build" && tag === "fabriquinha/regras-de-rede:1");
  assert.equal(builds.length, 1);
});

test("criar elimina o container e repassa a falha quando as regras de rede não são aplicadas", async () => {
  const antes = docker.containers().length;
  docker.falharComando("exec", "sem /etc/hosts");
  await assert.rejects(
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot()),
    /docker exec falhou: sem \/etc\/hosts/,
  );
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
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot()),
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), {
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
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
  const outro = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
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
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
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
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
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
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /não está definida.*mkdir -m 700.*CLAUDE_SECURESTORAGE_CONFIG_DIR=/s,
    ),
  );
  await comPastaDaCredencialDoClaude(join(home, ".claude"), () =>
    assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /a pasta da credencial é a própria.*sessões e configuração/s,
    ),
  );
  rmSync(join(pastaDoClaude, ".credentials.json"));
  await comPastaDaCredencialDoClaude(pastaDoClaude, () =>
    assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
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
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /arquivo comum.*ln -s/s,
    );
    rmSync(authDoHost);
    symlinkSync(join(pastaDoCodex, "nao-existe.json"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /aponta para um arquivo que não existe.*ln -s/s,
    );
    rmSync(authDoHost);
    writeFileSync(join(home, ".codex", "auth.json.real"), "{}");
    symlinkSync(join(home, ".codex", "auth.json.real"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
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
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /arquivo comum.*mkdir -m 700 ~\/credenciais-pi.*mv .*ln -s ~\/credenciais-pi\/auth\.json/s,
    );
    rmSync(authDoHost);
    symlinkSync(join(pastaDaCredencialDoPi, "nao-existe.json"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
      /aponta para um arquivo que não existe.*ln -s/s,
    );
    rmSync(authDoHost);
    writeFileSync(join(dirDoPi, "auth.json.real"), "{}");
    symlinkSync(join(dirDoPi, "auth.json.real"), authDoHost);
    await assert.rejects(
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, copias),
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
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
      gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
        dir_do_pi: dirDoPi,
        home_do_usuario: home,
      }),
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
    gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot(), undefined, {
      dir_do_pi: join(base, "nao-existe"),
      home_do_usuario: base,
    }),
    /não existe o .*auth\.json.*entre no pi/s,
  );
  assert.equal(docker.registro().length, antes);
});

test("criar sem a imagem falha com a orientação", async () => {
  await assert.rejects(
    gerador.criar("fantasma", limites, PORTA_DA_API, proximoSlot()),
    /docker run falhou: .*Docker está rodando/s,
  );
});

test("listarSlotsTomadosNoDocker traz o número de cada fabriquinha-slot-<n>, com o rótulo ou sem, e ignora outro nome", async () => {
  docker.semearContainer({ nome: "fabriquinha-slot-12" });
  docker.semearContainer({ nome: "fabriquinha-slot-abc" });
  docker.semearContainer({ nome: "antes-fabriquinha-slot-13" });
  const tomados = await gerador.listarSlotsTomadosNoDocker();
  assert.ok(tomados.has(12));
  assert.ok(![13, Number.NaN].some((numero) => tomados.has(numero)));
});

test("listarDaFabriquinha devolve só os containers com o rótulo, parados ou não", async () => {
  const antes = (await gerador.listarDaFabriquinha()).length;
  docker.semearContainer({ rotulos: { "com.docker.compose.project": "sonarqube" } });
  docker.semearContainer({});
  const doUsuario = docker.containers().length;
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
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
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
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

test("criar monta o tmpfs do marcador e o grava depois das regras de rede; só então as regras contam como intactas", async () => {
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
  const chamadas = docker.registro();
  const run = chamadas.findLast(([comando, opcao]) => comando === "run" && opcao === "-d") ?? [];
  assert.equal(run[run.indexOf("--tmpfs") + 1], "/run/fabriquinha");
  const posicao = (comando: string, opcao: string) =>
    chamadas.findLastIndex(([nome, primeira]) => nome === comando && primeira === opcao);
  assert.ok(posicao("run", "--rm") < posicao("exec", "-u"), "o marcador vem depois das regras");
  assert.equal(await gerador.regrasDeRedeIntactas(criado), true);
});

test("regrasDeRedeIntactas: o parado e o religado fora da Fabriquinha não as têm; o docker fora do ar lança", async () => {
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
  docker.pararContainer(criado.container_id);
  assert.equal(await gerador.regrasDeRedeIntactas(criado), false, "parado");
  docker.religarContainer(criado.container_id);
  assert.equal(await gerador.regrasDeRedeIntactas(criado), false, "religado, sem o marcador do tmpfs");

  docker.pararDocker();
  await assert.rejects(gerador.regrasDeRedeIntactas(criado), /Cannot connect to the Docker daemon/);
  docker.religarDocker();
});

test("listarDaFabriquinha diz quais containers estão rodando", async () => {
  const criado = await gerador.criar("node:22-alpine", limites, PORTA_DA_API, proximoSlot());
  assert.equal((await gerador.listarDaFabriquinha()).find((c) => c.id === criado.id)?.rodando, true);
  docker.pararContainer(criado.container_id);
  assert.equal((await gerador.listarDaFabriquinha()).find((c) => c.id === criado.id)?.rodando, false);
});
