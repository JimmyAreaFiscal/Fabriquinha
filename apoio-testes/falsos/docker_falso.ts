#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// O docker falso dos testes. Duas faces no mesmo arquivo:
// - importado, `instalarDockerFalso(dir)` põe um executável `docker` à frente no PATH e guarda o estado e o registro em `dir`;
// - executado como o `docker` (`import.meta.main`), simula imagens e containers: `image inspect`, `build`, `pull`, `run`,
//   `create`, `start`, `ps`, `inspect`, `stats`, `exec` e `rm`. O `run --rm` só confere a imagem; o `exec cat /etc/hosts` mostra o `host-gateway` como 172.17.0.1. O `exec` com `-i`, `-w` e `--env-file` roda de verdade, no host, o
//   roteiro do `AmbienteContainer` (`sh -c '... /fabriquinha/pids/<n> ...'`, que grava o grupo de processos e dá `exec`
//   no programa), com só o env do arquivo (mais `PATH`, `HOME` e `HOSTNAME`, como o docker põe) e `/fabriquinha/pids`
//   trocada por uma pasta do estado; o `exec -i ... tar -x` (a cópia do pi, do `.claude` e do `.codex`) extrai de verdade no
//   `HOME` do container, e o `exec -i ... mktemp` (a gravação de uma credencial pelo stdin) grava de verdade nele (`homes/<id>` do estado, o `HOME` de todo `exec` simulado); outro `exec` só vai para o registro, porque rodar no host um `kill -9 -1` seria
//   um desastre. O `run --rm` só confere a imagem, e o `exec cat /etc/hosts` mostra o `host-gateway` como 172.17.0.1.
// Cada container é um arquivo e cada imagem também, então vários docker falsos ao mesmo tempo não perdem escrita um do
// outro. Toda chamada vai para o registro (JSONL), inclusive as que falham.
// O docker pode estar indisponível (`pararDocker`: todo comando falha com "Cannot connect to the Docker daemon") e um container
// pode estar parado (`pararContainer`, ou o `stop`); o `start` o religa sem o que vive no tmpfs, onde o gerador grava o marcador das
// regras de rede (`exec touch`, conferido por `exec test -e`).
// `ps`, `inspect` e `stats` não interpretam o `--format`: `ps` imprime "<id>\t<valor do rótulo filtrado>\t<estado>", `inspect` imprime o
// JSON (só o `--format {{.State.Running}}` é atendido: imprime `true` ou `false`) e `stats` imprime "<id>\t<CPU>\t<memória>" de cada container pedido, com o uso semeado (sem ele, o de um parado).
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { constants } from "node:os";
import { join } from "node:path";

const PASTA_DOS_PIDS_NO_CONTAINER = "/fabriquinha/pids";

/** Um container do docker falso. `memoria` em bytes, como o `HostConfig.Memory` do docker de verdade. */
export interface ContainerFalso {
  id: string;
  imagem: string;
  /** O `--name` do `run`; dois containers não têm o mesmo nome, como no docker de verdade. */
  nome?: string;
  rotulos: Record<string, string>;
  memoria: number;
  cpus: number;
  estado: "created" | "running" | "exited";
  comandos: string[][];
  /** Os arquivos que o `exec touch` criou no tmpfs; o docker os apaga quando o container para. */
  marcadores?: string[];
  /** Os `-v` do `run`, como foram escritos (`origem:destino:modo`). */
  montagens: string[];
  /** Os `--add-host` do `run` (`nome:ip`). */
  hospedeiros: string[];
  /** O que o `docker stats` mostra dele, como o docker de verdade escreve (`12.50%`, `256MiB / 2GiB`). */
  uso?: { cpu: string; memoria: string };
}

export interface DockerFalso {
  /** Chamadas do docker, na ordem: os argumentos de cada uma, sem o `docker`. */
  registro: () => string[][];
  /** Os containers que existem agora. */
  containers: () => ContainerFalso[];
  /** As imagens que existem agora. */
  imagens: () => string[];
  /** O Dockerfile do `build` que gerou `imagem` (vazio na semeada ou na baixada). */
  dockerfileDaImagem: (imagem: string) => string;
  /** Cria um container já rodando, como o que outro programa subiu na máquina. */
  semearContainer: (semente: {
    id?: string;
    imagem?: string;
    nome?: string;
    rotulos?: Record<string, string>;
    uso?: ContainerFalso["uso"];
  }) => ContainerFalso;
  /** Troca o que o `docker stats` mostra do container `id`. */
  mudarUso: (id: string, uso: NonNullable<ContainerFalso["uso"]>) => void;
  /** Cria uma imagem que já está na máquina. */
  semearImagem: (nome: string) => void;
  /** O `HOME` do container `id` no host: onde as cópias feitas por `tar` foram extraídas. */
  homeDoContainer: (id: string) => string;
  /** O docker deixa de responder: todo comando falha com "Cannot connect to the Docker daemon" e código 1. */
  pararDocker: () => void;
  /** O docker volta a responder; os containers continuam como estavam. */
  religarDocker: () => void;
  /** Para o container `id`, como o docker parado ou desligado o deixa. */
  pararContainer: (id: string) => void;
  /** Religa o container parado `id`, como alguém fora da Fabriquinha faria: sobe sem o que vive no tmpfs. */
  religarContainer: (id: string) => void;
  /** Faz todo comando do docker (`run`, `exec`...) falhar com esta mensagem e código 1. */
  falharComando: (comando: string, mensagem: string) => void;
}

const ARQUIVO_DO_DOCKER_PARADO = "__docker_parado__";

const homeDoContainer = (dir: string, id: string) => join(dir, "homes", id);

const codificar = (nome: string) => Buffer.from(nome).toString("hex");

const pastas = (dir: string) => ({
  containers: join(dir, "containers"),
  imagens: join(dir, "imagens"),
  falhas: join(dir, "falhas"),
  registro: join(dir, "registro.jsonl"),
});

// Vários `docker` falsos rodam ao mesmo tempo: o que lista pula o container que um `rm` tirou entre o readdir e a leitura.
function lerContainers(dir: string): ContainerFalso[] {
  const pasta = pastas(dir).containers;
  return readdirSync(pasta).flatMap((arquivo) => {
    try {
      return [JSON.parse(readFileSync(join(pasta, arquivo), "utf8")) as ContainerFalso];
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw erro;
    }
  });
}

// Grava fora da pasta e renomeia para dentro: quem lê ao mesmo tempo vê o arquivo inteiro ou nenhum, nunca pela metade.
function gravarContainer(dir: string, container: ContainerFalso): void {
  const temporario = join(dir, `.gravando-${randomBytes(8).toString("hex")}`);
  writeFileSync(temporario, JSON.stringify(container));
  renameSync(temporario, join(pastas(dir).containers, container.id));
}

/** Instala o docker falso: um `docker` à frente no PATH e o estado em `dir`, que tem de ser uma pasta nova. */
export function instalarDockerFalso(dir: string): DockerFalso {
  const { containers, imagens, falhas, registro } = pastas(dir);
  for (const pasta of [containers, imagens, falhas, join(dir, "bin")]) mkdirSync(pasta, { recursive: true });
  writeFileSync(registro, "");
  symlinkSync(import.meta.filename, join(dir, "bin", "docker"));
  process.env.PATH = `${join(dir, "bin")}:${process.env.PATH ?? ""}`;
  process.env.FALSO_DOCKER_DIR = dir;
  const semearContainer: DockerFalso["semearContainer"] = ({ id, imagem, nome, rotulos, uso }) => {
    const container: ContainerFalso = {
      id: id ?? randomBytes(32).toString("hex"),
      imagem: imagem ?? "alpine",
      nome,
      rotulos: rotulos ?? {},
      memoria: 0,
      cpus: 0,
      estado: "running",
      comandos: [],
      montagens: [],
      hospedeiros: [],
      uso,
    };
    gravarContainer(dir, container);
    return container;
  };
  return {
    registro: () =>
      readFileSync(registro, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((linha) => JSON.parse(linha) as string[]),
    containers: () => lerContainers(dir),
    imagens: () => readdirSync(imagens).map((arquivo) => Buffer.from(arquivo, "hex").toString()),
    dockerfileDaImagem: (imagem) => readFileSync(join(imagens, codificar(imagem)), "utf8"),
    semearContainer,
    mudarUso: (id, uso) => {
      const container = lerContainers(dir).find((candidato) => candidato.id === id);
      if (container) gravarContainer(dir, { ...container, uso });
    },
    homeDoContainer: (id) => homeDoContainer(dir, id),
    semearImagem: (nome) => {
      writeFileSync(join(imagens, codificar(nome)), "");
    },
    pararDocker: () => {
      writeFileSync(join(falhas, ARQUIVO_DO_DOCKER_PARADO), "Cannot connect to the Docker daemon");
    },
    religarDocker: () => {
      rmSync(join(falhas, ARQUIVO_DO_DOCKER_PARADO), { force: true });
    },
    pararContainer: (id) => {
      const container = lerContainers(dir).find((candidato) => candidato.id === id);
      if (container) gravarContainer(dir, { ...container, estado: "exited" });
    },
    religarContainer: (id) => {
      const container = lerContainers(dir).find((candidato) => candidato.id === id);
      if (container) gravarContainer(dir, { ...container, estado: "running", marcadores: [] });
    },
    falharComando: (comando, mensagem) => {
      writeFileSync(join(falhas, comando), mensagem);
    },
  };
}

/** Separa as opções (as de `comValor` levam o argumento seguinte) dos posicionais; opção sem valor só vale antes do primeiro posicional (o resto é o comando do container). */
function tirarOpcoes(args: string[], comValor: string[]): { opcoes: Record<string, string[]>; resto: string[] } {
  const opcoes: Record<string, string[]> = {};
  const resto: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? "";
    if (comValor.includes(arg)) (opcoes[arg] ??= []).push(args[++i] ?? "");
    else if (arg.startsWith("-") && !resto.length) opcoes[arg] = [];
    else resto.push(arg);
  }
  return { opcoes, resto };
}

/** Roda o roteiro no host como se fosse dentro do container: o processo lidera o próprio grupo, como no `docker exec`. */
function simularProcessoDoContainer(
  dir: string,
  container: ContainerFalso,
  programa: string[],
  opcoes: Record<string, string[]>,
  sair: (codigo: number, mensagem: string) => never,
): void {
  const pastaDosPids = join(dir, "pids", container.id);
  mkdirSync(pastaDosPids, { recursive: true });
  mkdirSync(homeDoContainer(dir, container.id), { recursive: true });
  const cwd = opcoes["-w"]?.[0];
  if (cwd !== undefined && !existsSync(cwd))
    sair(126, `OCI runtime exec failed: chdir to cwd ("${cwd}") set in config.process.cwd: no such file or directory`);
  const arquivoDeEnv = opcoes["--env-file"]?.[0];
  const doArquivo = arquivoDeEnv === undefined ? [] : readFileSync(arquivoDeEnv, "utf8").split("\n").filter(Boolean);
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "",
    HOME: homeDoContainer(dir, container.id),
    HOSTNAME: container.id.slice(0, 12),
    ...Object.fromEntries(
      doArquivo.map((linha): [string, string] => [linha.split("=")[0] ?? "", linha.split("=").slice(1).join("=")]),
    ),
  };
  const [executavel = "", ...argumentos] = programa.map((arg) =>
    arg.replaceAll(PASTA_DOS_PIDS_NO_CONTAINER, pastaDosPids),
  );
  const filho = spawn(executavel, argumentos, {
    cwd,
    env,
    detached: true,
    stdio: [opcoes["-i"] ? "inherit" : "ignore", "inherit", "inherit"],
  });
  filho.on("close", (codigo, sinal) => process.exit(codigo ?? 128 + (sinal ? constants.signals[sinal] : 0)));
}

function executarDockerFalso(): void {
  const dir = process.env.FALSO_DOCKER_DIR ?? "";
  const { containers, imagens, falhas, registro } = pastas(dir);
  const [comando = "", ...args] = process.argv.slice(2);
  appendFileSync(registro, `${JSON.stringify([comando, ...args])}\n`);
  const sair = (codigo: number, mensagem: string): never => {
    process.stderr.write(`${mensagem}\n`);
    process.exit(codigo);
  };
  if (existsSync(join(falhas, ARQUIVO_DO_DOCKER_PARADO)))
    sair(1, readFileSync(join(falhas, ARQUIVO_DO_DOCKER_PARADO), "utf8"));
  if (existsSync(join(falhas, comando))) sair(1, readFileSync(join(falhas, comando), "utf8"));
  const temImagem = (nome: string) => existsSync(join(imagens, codificar(nome)));
  const arquivoDoContainer = (id: string) => join(containers, id);
  const achar = (id: string): ContainerFalso => {
    if (!existsSync(arquivoDoContainer(id))) sair(1, `Error response from daemon: No such container: ${id}`);
    return JSON.parse(readFileSync(arquivoDoContainer(id), "utf8")) as ContainerFalso;
  };

  if (comando === "image" && args[0] === "inspect") {
    if (!temImagem(args[1] ?? "")) sair(1, `Error response from daemon: No such image: ${args[1] ?? ""}`);
  } else if (comando === "build") {
    const { opcoes, resto } = tirarOpcoes(args, ["-t", "-f"]);
    const dockerfile = opcoes["-f"]?.[0] ?? join(resto[0] ?? "", "Dockerfile");
    if (!existsSync(dockerfile)) sair(1, `failed to read dockerfile: ${dockerfile}`);
    // A imagem guarda o Dockerfile de que nasceu, para o teste conferir o que ela teria.
    writeFileSync(join(imagens, codificar(opcoes["-t"]?.[0] ?? "")), readFileSync(dockerfile));
  } else if (comando === "pull") {
    writeFileSync(join(imagens, codificar(args[0] ?? "")), "");
  } else if (comando === "run" || comando === "create") {
    const { opcoes, resto } = tirarOpcoes(args, [
      "--name",
      "--label",
      "--memory",
      "--cpus",
      "--shm-size",
      "--workdir",
      "-v",
      "--add-host",
      "--net",
      "--cap-add",
      "--tmpfs",
    ]);
    const [imagem = "", ...programa] = resto;
    if (!temImagem(imagem)) sair(125, `Unable to find image '${imagem}' locally`);
    const nome = opcoes["--name"]?.[0];
    if (nome && lerContainers(dir).some((existente) => existente.nome === nome))
      sair(125, `Conflict. The container name "/${nome}" is already in use`);
    if (opcoes["--rm"]) return; // roda e some, como o que aplica regras no namespace de rede de outro container
    const rotulos = Object.fromEntries(
      (opcoes["--label"] ?? []).map((rotulo) => [rotulo.split("=")[0] ?? "", rotulo.split("=").slice(1).join("=")]),
    );
    const memoria = /^(\d+)m$/.exec(opcoes["--memory"]?.[0] ?? "");
    const container: ContainerFalso = {
      id: randomBytes(32).toString("hex"),
      imagem,
      nome,
      rotulos,
      memoria: memoria ? Number(memoria[1]) * 1048576 : 0,
      cpus: Number(opcoes["--cpus"]?.[0] ?? 0),
      estado: comando === "run" ? "running" : "created",
      comandos: [programa],
      montagens: opcoes["-v"] ?? [],
      hospedeiros: opcoes["--add-host"] ?? [],
    };
    gravarContainer(dir, container);
    console.log(container.id);
  } else if (comando === "start") {
    const container = achar(args[0] ?? "");
    gravarContainer(dir, { ...container, estado: "running", marcadores: [] });
  } else if (comando === "stop") {
    const container = achar(args[0] ?? "");
    gravarContainer(dir, { ...container, estado: "exited" });
  } else if (comando === "ps") {
    const { opcoes } = tirarOpcoes(args, ["--filter", "--format"]);
    const filtro = opcoes["--filter"]?.[0] ?? "";
    if (filtro.startsWith("name=")) {
      for (const { nome } of lerContainers(dir)) if (nome?.includes(filtro.slice("name=".length))) console.log(nome);
      return;
    }
    const [rotulo = "", valorPedido] = filtro.replace(/^label=/, "").split(/=(.*)/s);
    for (const container of lerContainers(dir))
      if (
        !rotulo ||
        (rotulo in container.rotulos && (valorPedido === undefined || container.rotulos[rotulo] === valorPedido))
      )
        console.log(`${container.id}\t${container.rotulos[rotulo] ?? ""}\t${container.estado}`);
  } else if (comando === "inspect") {
    const container = achar(args.at(-1) ?? "");
    if (tirarOpcoes(args, ["--format"]).opcoes["--format"]?.[0] === "{{.State.Running}}")
      console.log(String(container.estado === "running"));
    else
      console.log(
        JSON.stringify([
          {
            Id: container.id,
            Config: { Image: container.imagem, Labels: container.rotulos },
            HostConfig: {
              Memory: container.memoria,
              NanoCpus: container.cpus * 1e9,
              Binds: container.montagens,
              ExtraHosts: container.hospedeiros,
            },
            State: { Running: container.estado === "running" },
          },
        ]),
      );
  } else if (comando === "stats") {
    const { resto } = tirarOpcoes(args, ["--format"]);
    for (const container of resto.map((id) => achar(id)))
      console.log(`${container.id}\t${container.uso?.cpu ?? "0.00%"}\t${container.uso?.memoria ?? "0B / 0B"}`);
  } else if (comando === "exec") {
    const { opcoes, resto } = tirarOpcoes(args, ["-w", "--env-file", "-u"]);
    const container = achar(resto[0] ?? "");
    if (container.estado !== "running") sair(1, `Error response from daemon: container ${container.id} is not running`);
    const programa = resto.slice(1);
    gravarContainer(dir, { ...container, comandos: [...container.comandos, programa] });
    const [shell, opcaoC, roteiro = ""] = programa;
    if (shell === "touch" && opcaoC !== undefined)
      gravarContainer(dir, {
        ...container,
        comandos: [...container.comandos, programa],
        marcadores: [...(container.marcadores ?? []), opcaoC],
      });
    if (shell === "test" && opcaoC === "-e" && !container.marcadores?.includes(roteiro)) sair(1, "");
    if (shell === "cat" && opcaoC === "/etc/hosts")
      for (const hospedeiro of container.hospedeiros) console.log(`172.17.0.1\t${hospedeiro.split(":")[0] ?? ""}`);
    if (
      shell === "sh" &&
      opcaoC === "-c" &&
      [PASTA_DOS_PIDS_NO_CONTAINER, "tar -x", "mktemp"].some((marca) => roteiro.includes(marca))
    )
      simularProcessoDoContainer(dir, container, programa, opcoes, sair);
  } else if (comando === "rm") {
    const container = achar(args.at(-1) ?? "");
    rmSync(arquivoDoContainer(container.id));
  } else sair(2, `docker falso: comando sem suporte: ${comando}`);
}

if (import.meta.main) executarDockerFalso();
