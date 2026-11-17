// O docker que cai: um executável `docker` à frente no PATH que repassa tudo ao docker que já estava lá (o de verdade, ou o
// falso) e, enquanto `parar` não for desfeito por `religar`, falha como o cliente sem o daemon: "Cannot connect to the Docker
// daemon", código 1. Serve às provas com containers reais, que não têm como derrubar o Docker da máquina.
// A listagem do conjunto (`docker ps` com o rótulo `fabriquinha.ambiente`) só mostra os containers que o teste `incluir`: a
// conferência da subida elimina como órfão o que o banco do teste não conhece, e entre eles estariam os do serviço que roda
// na máquina.
import { execFileSync } from "node:child_process";
import { appendFileSync, chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface DockerQueCai {
  /** O docker deixa de responder: todo comando falha com "Cannot connect to the Docker daemon" e código 1. */
  parar: () => void;
  /** O docker volta a responder; os containers continuam como estavam. */
  religar: () => void;
  /** Deixa a listagem do conjunto mostrar o container `containerId`. */
  incluir: (containerId: string) => void;
  /** Devolve o PATH de antes da instalação. */
  desinstalar: () => void;
}

const SCRIPT_DO_DOCKER = String.raw`#!/bin/sh
pasta_do_estado="$(dirname "$0")/.."
if [ -e "$pasta_do_estado/parado" ]; then
  echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2
  exit 1
fi
case "$1 $*" in
  "ps "*label=fabriquinha.ambiente*)
    saida=$("__DOCKER_DE_VERDADE__" "$@") || exit $?
    printf '%s\n' "$saida" | while IFS= read -r linha; do
      id=$(printf '%s' "$linha" | cut -f1)
      [ -n "$id" ] || continue
      while read -r container_incluido; do
        case "$container_incluido" in "$id"*) printf '%s\n' "$linha"; break;; esac
      done < "$pasta_do_estado/incluidos"
    done
    ;;
  *) exec "__DOCKER_DE_VERDADE__" "$@" ;;
esac
`;

/** Instala o docker que cai à frente no PATH, com o estado em `dir` (uma pasta nova); o docker que estava no PATH segue atrás dele. */
export function instalarDockerQueCai(dir: string): DockerQueCai {
  const dockerDeVerdade = execFileSync("sh", ["-c", "command -v docker"], { encoding: "utf8" }).trim(); // NOSONAR
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(dir, "incluidos"), "");
  writeFileSync(join(bin, "docker"), SCRIPT_DO_DOCKER.replaceAll("__DOCKER_DE_VERDADE__", dockerDeVerdade));
  chmodSync(join(bin, "docker"), 0o755);
  const pathDeAntes = process.env.PATH;
  process.env.PATH = `${bin}:${pathDeAntes ?? ""}`;
  return {
    parar: () => {
      writeFileSync(join(dir, "parado"), "");
    },
    religar: () => {
      rmSync(join(dir, "parado"), { force: true });
    },
    incluir: (containerId) => {
      appendFileSync(join(dir, "incluidos"), `${containerId}\n`);
    },
    desinstalar: () => {
      if (pathDeAntes === undefined) Reflect.deleteProperty(process.env, "PATH");
      else process.env.PATH = pathDeAntes;
    },
  };
}
