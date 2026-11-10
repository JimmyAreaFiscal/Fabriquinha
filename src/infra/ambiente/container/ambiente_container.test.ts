import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { instalarDockerFalso } from "../../../../apoio-testes/docker_falso.ts";
import type { ComandoNoAmbiente } from "../ambiente.ts";
import { AmbienteContainer, dirDoPiDoAmbiente } from "./ambiente_container.ts";

const base = realpathSync(mkdtempSync(join(tmpdir(), "fabriquinha-ambiente-container-")));
const caminhoOriginal = process.env.PATH;
const dirDoDockerFalso = join(base, "docker");
const docker = instalarDockerFalso(dirDoDockerFalso);
const binDoPacote = join(base, "pacote-pi", "bin");
const dirDoPi = dirDoPiDoAmbiente(base, "amb-1");
const { id: containerId } = docker.semearContainer({});
const ambiente = new AmbienteContainer({
  id: "amb-1",
  container_id: containerId,
  bin_do_pacote: binDoPacote,
  dir_do_pi: dirDoPi,
});

after(() => {
  rmSync(base, { recursive: true, force: true });
});

const envDoHost = {
  HOME: "/home/do-usuario-do-host",
  SSH_AUTH_SOCK: "/tmp/ssh-do-host/agent.1",
  GH_TOKEN: "gh-segredo",
  GH_CONFIG_DIR: "/tmp/vazio",
  AZURE_DEVOPS_EXT_PAT: "azure-segredo",
  AZURE_OPENAI_API_KEY: "azure-chave",
  SONAR_TOKEN: "sonar-segredo",
  GITHUB_TOKEN: "github-segredo",
  USER: "usuario-do-host",
  PATH: "/usr/bin:/bin",
  FABRIQUINHA_API: "http://host.docker.internal:3000",
  FABRIQUINHA_TOKEN: "token-do-ticket",
  FABRIQUINHA_SAIDA: "/raiz/execucoes/E-1/saida",
  PI_CODING_AGENT_DIR: "/home/do-usuario-do-host/.pi/agent",
  ANTHROPIC_API_KEY: "chave-do-provedor",
};

function comando(programa: string, argumentos: string[], resto: Partial<ComandoNoAmbiente> = {}): ComandoNoAmbiente {
  return { programa, argumentos, cwd: base, env: envDoHost, ...resto };
}

function comandoNoShell(linha: string, resto: Partial<ComandoNoAmbiente> = {}): ComandoNoAmbiente {
  return comando(linha, [], { noShell: true, ultimosBytes: 1024, ...resto });
}

/** Os arquivos de pid que o roteiro gravou no container, pela pasta que o docker falso usa no lugar de /fabriquinha/pids. */
const arquivosDePid = (): string[] => {
  const pasta = join(dirDoDockerFalso, "pids", containerId);
  return existsSync(pasta) ? readdirSync(pasta) : [];
};

const grupoEstaVivo = (grupo: number): boolean => {
  try {
    process.kill(-grupo, 0);
    return true;
  } catch {
    return false;
  }
};

async function esperarOArquivoDePid(grupo: number): Promise<number> {
  const arquivo = join(dirDoDockerFalso, "pids", containerId, String(grupo));
  while (!existsSync(arquivo) || readFileSync(arquivo, "utf8").trim() === "")
    await new Promise((resolve) => setTimeout(resolve, 20));
  return Number(readFileSync(arquivo, "utf8"));
}

test("executar: o env do container tem só a lista permitida, nada do host", async () => {
  const saida = await ambiente.executar(comando("env", []));
  assert.equal(saida.codigo, 0);
  const variaveis: Record<string, string> = Object.fromEntries(
    saida.saida
      .split("\n")
      .filter(Boolean)
      .map((linha): [string, string] => [linha.split("=")[0] ?? "", linha.split("=").slice(1).join("=")]),
  );
  // O shell exporta PWD, SHLVL e _, e o node põe NODE_V8_COVERAGE nos filhos quando mede a cobertura; nenhuma vem do core.
  assert.deepEqual(
    Object.keys(variaveis)
      .filter((nome) => !["PWD", "SHLVL", "_", "NODE_V8_COVERAGE"].includes(nome))
      .sort(),
    [
      "ANTHROPIC_API_KEY",
      "FABRIQUINHA_API",
      "FABRIQUINHA_SAIDA",
      "FABRIQUINHA_TOKEN",
      "HOME",
      "HOSTNAME",
      "PATH",
      "PI_CODING_AGENT_DIR",
    ],
  );
  assert.equal(variaveis.HOME, "/root");
  assert.equal(variaveis.PI_CODING_AGENT_DIR, dirDoPi);
  assert.equal(variaveis.FABRIQUINHA_TOKEN, "token-do-ticket");
  assert.equal(variaveis.ANTHROPIC_API_KEY, "chave-do-provedor");
  // O pacote vai à frente do PATH da imagem, e o PATH do core não passa.
  assert.ok(String(variaveis.PATH).startsWith(`${binDoPacote}:`));
  assert.ok(!String(variaveis.PATH).startsWith(`${binDoPacote}:/usr/bin:/bin`));
  for (const segredo of [
    "gh-segredo",
    "azure-segredo",
    "azure-chave",
    "sonar-segredo",
    "github-segredo",
    "ssh-do-host",
  ])
    assert.ok(!saida.saida.includes(segredo), segredo);
});

test("executar: o docker exec leva -w, --env-file e o container, e o env-file some depois", async () => {
  await ambiente.executar(comando("true", []));
  const [exec] = docker
    .registro()
    .filter(([comandoDoDocker, ...resto]) => comandoDoDocker === "exec" && String(resto.at(-1)).endsWith("exec 'true'"))
    .slice(-1);
  assert.ok(exec);
  const indiceDoEnvFile = exec.indexOf("--env-file");
  assert.deepEqual(exec.slice(0, 3), ["exec", "-w", base]);
  assert.equal(exec[indiceDoEnvFile + 2], containerId);
  assert.ok(!existsSync(String(exec[indiceDoEnvFile + 1])));
  assert.ok(!exec.includes("-i"));
  assert.match(
    String(exec.at(-1)),
    /^mkdir -p \/fabriquinha\/pids; echo \$\$ > \/fabriquinha\/pids\/\d+; export PATH=/,
  );
  assert.match(String(exec.at(-1)), /; exec 'true'$/);
});

test("executar: devolve o código, o stdout e o stderr do programa", async () => {
  const saida = await ambiente.executar(comando("sh", ["-c", "echo ola; echo aviso >&2; exit 3"]));
  assert.deepEqual(
    { ...saida, duracaoMs: undefined },
    {
      codigo: 3,
      saida: "ola\n",
      erro: "aviso\n",
      limiteEstourado: false,
      duracaoMs: undefined,
    },
  );
  assert.ok(saida.duracaoMs >= 0);
});

test("executar: argumento com aspas e espaços chega inteiro ao programa", async () => {
  const saida = await ambiente.executar(comando("printf", ["%s|", "a 'b' $HOME", 'c"d']));
  assert.equal(saida.saida, "a 'b' $HOME|c\"d|");
});

test("executar no shell: stderr e stdout juntos, sem byte nulo, e o cwd vale", async () => {
  const dir = join(base, "pasta");
  mkdirSync(dir);
  const saida = await ambiente.executar(comandoNoShell("pwd; echo erro >&2; printf 'a\\0b'; exit 2", { cwd: dir }));
  assert.deepEqual(
    { ...saida, duracaoMs: undefined },
    {
      codigo: 2,
      saida: `${dir}\nerro\na\uFFFDb`,
      erro: "",
      limiteEstourado: false,
      duracaoMs: undefined,
    },
  );
});

test("executar: no limite o grupo inteiro morre dentro do container e o código é null", async () => {
  const antes = new Set(arquivosDePid());
  const saida = await ambiente.executar(comandoNoShell("sleep 30 & sleep 31", { limiteMs: 300 }));
  assert.deepEqual([saida.codigo, saida.limiteEstourado], [null, true]);
  const [novo] = arquivosDePid().filter((arquivo) => !antes.has(arquivo));
  assert.ok(novo);
  const grupo = Number(readFileSync(join(dirDoDockerFalso, "pids", containerId, novo), "utf8"));
  assert.equal(grupoEstaVivo(grupo), false);
});

test("executar: dentro do limite, o relógio não dispara", async () => {
  const saida = await ambiente.executar(comando("true", [], { limiteMs: 60_000 }));
  assert.deepEqual([saida.codigo, saida.limiteEstourado], [0, false]);
});

test("executar: variável permitida com quebra de linha não cabe no env-file e é recusada", async () => {
  await assert.rejects(
    ambiente.executar(comando("true", [], { env: { ...envDoHost, FABRIQUINHA_TOKEN: "a\nSONAR_TOKEN=x" } })),
    /quebra de linha/,
  );
});

test("executar: container que não roda devolve a falha do docker exec", async () => {
  const parado = new AmbienteContainer({
    id: "amb-2",
    container_id: "inexistente",
    bin_do_pacote: binDoPacote,
    dir_do_pi: dirDoPi,
  });
  const saida = await parado.executar(comando("true", []));
  assert.equal(saida.codigo, 1);
  assert.match(saida.erro, /No such container/);
});

test("lancar: -i, stdin e stdout do docker exec são os do programa, e o identificador é do ambiente", async () => {
  const processo = ambiente.lancar(comando("sh", ["-c", "read linha; echo eco:$linha; echo aviso >&2"]));
  assert.equal(processo.identificador.ambiente_id, "amb-1");
  assert.ok(Number.isInteger(processo.identificador.grupo_processo));
  let saida = "";
  let erro = "";
  processo.stdout.setEncoding("utf8").on("data", (parte: string) => (saida += parte));
  processo.stderr.setEncoding("utf8").on("data", (parte: string) => (erro += parte));
  processo.stdin.write("oi\n");
  assert.equal(await processo.saiu, 0);
  assert.deepEqual([saida, erro], ["eco:oi\n", "aviso\n"]);
  const exec = docker.registro().find(([comandoDoDocker, opcao]) => comandoDoDocker === "exec" && opcao === "-i");
  assert.ok(exec);
  assert.ok(!existsSync(String(exec[exec.indexOf("--env-file") + 1])));
});

test("lancar: falha do stdin e do docker chegam a aoFalhar", async () => {
  const processo = ambiente.lancar(comando("true", []));
  const falhaDoStdin = new Promise<Error>((resolve) => {
    processo.aoFalhar(resolve);
  });
  processo.stdin.emit("error", new Error("EPIPE"));
  assert.equal((await falhaDoStdin).message, "EPIPE");
  await processo.saiu;
  process.env.PATH = "/nao-existe";
  try {
    const semDocker = ambiente.lancar(comando("true", []));
    const falha = await new Promise<Error>((resolve) => {
      semDocker.aoFalhar(resolve);
    });
    assert.match(falha.message, /ENOENT/);
  } finally {
    process.env.PATH = `${join(dirDoDockerFalso, "bin")}:${caminhoOriginal ?? ""}`;
  }
});

test("sinalizar: o sinal chega ao grupo inteiro do processo, dentro do container", async () => {
  const processo = ambiente.lancar(comando("sh", ["-c", "sleep 30 & sleep 31"]));
  const grupo = await esperarOArquivoDePid(processo.identificador.grupo_processo);
  assert.equal(grupoEstaVivo(grupo), true);
  await ambiente.sinalizar(processo.identificador, "SIGKILL");
  assert.equal(await processo.saiu, 137);
  assert.equal(grupoEstaVivo(grupo), false);
  const exec = docker
    .registro()
    .find(([comandoDoDocker, , , , roteiro]) => comandoDoDocker === "exec" && String(roteiro).includes("kill -KILL"));
  assert.ok(exec);
  assert.deepEqual(exec.slice(0, 4), ["exec", containerId, "sh", "-c"]);
  assert.match(String(exec[4]), /^kill -KILL -"\$\(cat \/fabriquinha\/pids\/\d+ 2>\/dev\/null\)" 2>\/dev\/null$/);
});

test("sinalizar: grupo que já acabou ou que nunca existiu é ignorado", async () => {
  await assert.doesNotReject(ambiente.sinalizar({ ambiente_id: "amb-1", grupo_processo: 2 ** 30 }, "SIGTERM"));
});

test("sinalizar: processo de outro ambiente é recusado com orientação", async () => {
  await assert.rejects(
    ambiente.sinalizar({ ambiente_id: "host_local", grupo_processo: 1 }, "SIGTERM"),
    /é do ambiente host_local, não do amb-1.*sinalize pelo ambiente que lançou/s,
  );
});

test("o caminho no ambiente é o do host (mesmos caminhos nas montagens)", () => {
  assert.equal(ambiente.caminhoNoAmbiente("/a/b"), "/a/b");
  assert.deepEqual([ambiente.id, ambiente.tipo], ["amb-1", "container"]);
});
