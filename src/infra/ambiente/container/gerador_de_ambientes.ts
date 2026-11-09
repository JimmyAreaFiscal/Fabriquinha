// O único lugar da Fabriquinha que chama o `docker` (fitness `sem-docker`): cria, limpa, lista e elimina os containers
// que servem de Ambiente. Todo container nasce com o rótulo `fabriquinha.ambiente` e com limite de memória e de CPU, e
// só os que têm o rótulo são da Fabriquinha: o SonarQube e os containers do usuário nunca aparecem aqui.
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ErroDeRegra } from "../../../nucleo/erros.ts";
import { LIMITE_COMANDO_MS } from "../ambiente.ts";
import { executar } from "../../processo.ts";

const ROTULO_DO_AMBIENTE = "fabriquinha.ambiente";
/** A pasta de trabalho do container; `limpar` a esvazia. */
const PASTA_DE_TRABALHO = "/trabalho";
/** Cada comando do docker, menos build e pull, que baixam imagem e levam o limite dos comandos configurados. */
const LIMITE_DO_DOCKER_MS = 2 * 60_000;

/** O nome da imagem pronta no docker: `fabriquinha/<projeto>:<sha256 do Dockerfile>` ou o nome da imagem do projeto. */
type ImagemDoAmbiente = string;

interface Limites {
  memoria_maxima_mb: number;
  cpus: number;
}

interface ContainerCriado {
  /** O id do Ambiente, o valor do rótulo `fabriquinha.ambiente`. */
  id: string;
  container_id: string;
}

/** O projeto que tem imagem: `imagem_do_ambiente` é o caminho de um Dockerfile no repositório ou o nome de uma imagem. */
interface ProjetoComImagem {
  nome: string;
  raiz_git: string;
  imagem_do_ambiente: string;
}

async function rodarDocker(args: string[], limiteMs: number): Promise<string> {
  const resultado = await executar("docker", args, { limiteMs });
  if (resultado.codigo === 0) return resultado.saida.trim();
  const motivo = resultado.limiteEstourado ? `passou do limite de ${String(limiteMs)} ms` : resultado.erro.trim();
  throw new ErroDeRegra(
    `docker ${String(args[0])} falhou: ${motivo}`,
    "confira se o Docker está rodando e se o usuário tem acesso a ele",
  );
}

/** @testes o conjunto de Ambientes o usa na demanda I-286; hoje só o teste */
export class GeradorDeAmbientes {
  readonly #limiteDoComandoMs: number;

  /** `limiteDoComandoMs` vale para os comandos rápidos; só o teste o troca. */
  constructor(limiteDoComandoMs = LIMITE_DO_DOCKER_MS) {
    this.#limiteDoComandoMs = limiteDoComandoMs;
  }

  /** Faz o build do Dockerfile ou o pull da imagem, se ela ainda não está na máquina. */
  async garantirImagem(projeto: ProjetoComImagem): Promise<ImagemDoAmbiente> {
    const dockerfile = join(projeto.raiz_git, projeto.imagem_do_ambiente);
    const ehDockerfile = existsSync(dockerfile);
    const imagem = ehDockerfile
      ? `fabriquinha/${projeto.nome}:${createHash("sha256").update(readFileSync(dockerfile)).digest("hex")}`
      : projeto.imagem_do_ambiente;
    const { codigo } = await executar("docker", ["image", "inspect", imagem], { limiteMs: this.#limiteDoComandoMs });
    if (codigo !== 0 && ehDockerfile)
      await rodarDocker(["build", "-t", imagem, "-f", dockerfile, dirname(dockerfile)], LIMITE_COMANDO_MS);
    else if (codigo !== 0) await rodarDocker(["pull", imagem], LIMITE_COMANDO_MS);
    return imagem;
  }

  // shortcut: o `tail` não colhe processos mortos, que ficam zumbis até eliminar o container; `--init` não serve, porque o
  // `kill -9 -1` da `limpar` derruba o `tail` e o tini sai junto. Trocar por um PID 1 que colha, se os zumbis pesarem.
  /** Sobe o container parado em `tail`, para ficar vivo até alguém eliminá-lo. */
  async criar(imagem: ImagemDoAmbiente, limites: Limites): Promise<ContainerCriado> {
    const id = randomUUID();
    const containerId = await rodarDocker(
      [
        "run",
        "-d",
        "--label",
        `${ROTULO_DO_AMBIENTE}=${id}`,
        "--memory",
        `${String(limites.memoria_maxima_mb)}m`,
        "--cpus",
        String(limites.cpus),
        "--workdir",
        PASTA_DE_TRABALHO,
        imagem,
        "tail",
        "-f",
        "/dev/null",
      ],
      this.#limiteDoComandoMs,
    );
    return { id, container_id: containerId };
  }

  /** Mata todos os processos do container (menos o primeiro, que o mantém vivo) e esvazia `/tmp` e a pasta de trabalho. */
  async limpar(container: ContainerCriado): Promise<void> {
    await rodarDocker(
      ["exec", container.container_id, "sh", "-c", `kill -9 -1; find /tmp ${PASTA_DE_TRABALHO} -mindepth 1 -delete`],
      this.#limiteDoComandoMs,
    );
  }

  /** Remove o container; um que já não existe está eliminado. */
  async eliminar(container: ContainerCriado): Promise<void> {
    try {
      await rodarDocker(["rm", "--force", container.container_id], this.#limiteDoComandoMs);
    } catch (erro) {
      if (!/No such container/i.test(String(erro))) throw erro;
    }
  }

  /** Só os containers com o rótulo `fabriquinha.ambiente`, parados ou não. */
  async listarDaFabriquinha(): Promise<ContainerCriado[]> {
    const saida = await rodarDocker(
      [
        "ps",
        "--all",
        "--no-trunc",
        "--filter",
        `label=${ROTULO_DO_AMBIENTE}`,
        "--format",
        `{{.ID}}\t{{.Label "${ROTULO_DO_AMBIENTE}"}}`,
      ],
      this.#limiteDoComandoMs,
    );
    return saida
      .split("\n")
      .filter(Boolean)
      .map((linha) => {
        const [containerId = "", id = ""] = linha.split("\t");
        return { id, container_id: containerId };
      });
  }
}
