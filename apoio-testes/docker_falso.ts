#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// O docker falso dos testes. Duas faces no mesmo arquivo:
// - importado, `instalarDockerFalso(dir)` põe um executável `docker` à frente no PATH e guarda o estado e o registro em `dir`;
// - executado como o `docker` (`import.meta.main`), simula imagens e containers: `image inspect`, `build`, `pull`, `run`,
//   `create`, `start`, `ps`, `inspect`, `exec` e `rm`.
// Cada container é um arquivo e cada imagem também, então vários docker falsos ao mesmo tempo não perdem escrita um do
// outro. Toda chamada vai para o registro (JSONL), inclusive as que falham.
// `ps` e `inspect` não interpretam o `--format`: `ps` imprime "<id>\t<valor do rótulo filtrado>" e `inspect` imprime o JSON.
import { randomBytes } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/** Um container do docker falso. `memoria` em bytes, como o `HostConfig.Memory` do docker de verdade. */
export interface ContainerFalso {
  id: string;
  imagem: string;
  rotulos: Record<string, string>;
  memoria: number;
  cpus: number;
  estado: "created" | "running";
  comandos: string[][];
}

export interface DockerFalso {
  /** Chamadas do docker, na ordem: os argumentos de cada uma, sem o `docker`. */
  registro: () => string[][];
  /** Os containers que existem agora. */
  containers: () => ContainerFalso[];
  /** As imagens que existem agora. */
  imagens: () => string[];
  /** Cria um container já rodando, como o que outro programa subiu na máquina. */
  semearContainer: (semente: { id?: string; imagem?: string; rotulos?: Record<string, string> }) => ContainerFalso;
  /** Cria uma imagem que já está na máquina. */
  semearImagem: (nome: string) => void;
  /** Faz todo comando do docker (`run`, `exec`...) falhar com esta mensagem e código 1. */
  falharComando: (comando: string, mensagem: string) => void;
}

const codificar = (nome: string) => Buffer.from(nome).toString("hex");

const pastas = (dir: string) => ({
  containers: join(dir, "containers"),
  imagens: join(dir, "imagens"),
  falhas: join(dir, "falhas"),
  registro: join(dir, "registro.jsonl"),
});

function lerContainers(dir: string): ContainerFalso[] {
  const pasta = pastas(dir).containers;
  return readdirSync(pasta).map((arquivo) => JSON.parse(readFileSync(join(pasta, arquivo), "utf8")) as ContainerFalso);
}

function gravarContainer(dir: string, container: ContainerFalso): void {
  writeFileSync(join(pastas(dir).containers, container.id), JSON.stringify(container));
}

/** Instala o docker falso: um `docker` à frente no PATH e o estado em `dir`, que tem de ser uma pasta nova. */
export function instalarDockerFalso(dir: string): DockerFalso {
  const { containers, imagens, falhas, registro } = pastas(dir);
  for (const pasta of [containers, imagens, falhas, join(dir, "bin")]) mkdirSync(pasta, { recursive: true });
  writeFileSync(registro, "");
  symlinkSync(import.meta.filename, join(dir, "bin", "docker"));
  process.env.PATH = `${join(dir, "bin")}:${process.env.PATH ?? ""}`;
  process.env.FALSO_DOCKER_DIR = dir;
  const semearContainer: DockerFalso["semearContainer"] = ({ id, imagem, rotulos }) => {
    const container: ContainerFalso = {
      id: id ?? randomBytes(32).toString("hex"),
      imagem: imagem ?? "alpine",
      rotulos: rotulos ?? {},
      memoria: 0,
      cpus: 0,
      estado: "running",
      comandos: [],
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
    semearContainer,
    semearImagem: (nome) => {
      writeFileSync(join(imagens, codificar(nome)), "");
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

function executarDockerFalso(): void {
  const dir = process.env.FALSO_DOCKER_DIR ?? "";
  const { containers, imagens, falhas, registro } = pastas(dir);
  const [comando = "", ...args] = process.argv.slice(2);
  appendFileSync(registro, `${JSON.stringify([comando, ...args])}\n`);
  const sair = (codigo: number, mensagem: string): never => {
    process.stderr.write(`${mensagem}\n`);
    process.exit(codigo);
  };
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
    writeFileSync(join(imagens, codificar(opcoes["-t"]?.[0] ?? "")), "");
  } else if (comando === "pull") {
    writeFileSync(join(imagens, codificar(args[0] ?? "")), "");
  } else if (comando === "run" || comando === "create") {
    const { opcoes, resto } = tirarOpcoes(args, ["--label", "--memory", "--cpus", "--workdir"]);
    const [imagem = "", ...programa] = resto;
    if (!temImagem(imagem)) sair(125, `Unable to find image '${imagem}' locally`);
    const rotulos = Object.fromEntries(
      (opcoes["--label"] ?? []).map((rotulo) => [rotulo.split("=")[0] ?? "", rotulo.split("=").slice(1).join("=")]),
    );
    const memoria = /^(\d+)m$/.exec(opcoes["--memory"]?.[0] ?? "");
    const container: ContainerFalso = {
      id: randomBytes(32).toString("hex"),
      imagem,
      rotulos,
      memoria: memoria ? Number(memoria[1]) * 1048576 : 0,
      cpus: Number(opcoes["--cpus"]?.[0] ?? 0),
      estado: comando === "run" ? "running" : "created",
      comandos: [programa],
    };
    writeFileSync(arquivoDoContainer(container.id), JSON.stringify(container));
    console.log(container.id);
  } else if (comando === "start") {
    const container = achar(args[0] ?? "");
    writeFileSync(arquivoDoContainer(container.id), JSON.stringify({ ...container, estado: "running" }));
  } else if (comando === "ps") {
    const { opcoes } = tirarOpcoes(args, ["--filter", "--format"]);
    const rotulo = (opcoes["--filter"]?.[0] ?? "").replace(/^label=/, "");
    for (const container of readdirSync(containers).map((id) => achar(id)))
      if (!rotulo || rotulo in container.rotulos) console.log(`${container.id}\t${container.rotulos[rotulo] ?? ""}`);
  } else if (comando === "inspect") {
    const container = achar(args.at(-1) ?? "");
    console.log(
      JSON.stringify([
        {
          Id: container.id,
          Config: { Image: container.imagem, Labels: container.rotulos },
          HostConfig: { Memory: container.memoria, NanoCpus: container.cpus * 1e9 },
          State: { Running: container.estado === "running" },
        },
      ]),
    );
  } else if (comando === "exec") {
    const container = achar(args[0] ?? "");
    if (container.estado !== "running") sair(1, `Error response from daemon: container ${container.id} is not running`);
    writeFileSync(
      arquivoDoContainer(container.id),
      JSON.stringify({ ...container, comandos: [...container.comandos, args.slice(1)] }),
    );
  } else if (comando === "rm") {
    const container = achar(args.at(-1) ?? "");
    rmSync(arquivoDoContainer(container.id));
  } else sair(2, `docker falso: comando sem suporte: ${comando}`);
}

if (import.meta.main) executarDockerFalso();
