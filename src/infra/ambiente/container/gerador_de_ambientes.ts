// O único lugar da Fabriquinha que chama o `docker` (fitness `sem-docker`): cria, limpa, lista e elimina os containers
// que servem de Ambiente. Todo container nasce com o rótulo `fabriquinha.ambiente` e com limite de memória e de CPU, e
// só os que têm o rótulo são da Fabriquinha: o SonarQube e os containers do usuário nunca aparecem aqui.
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { ErroDeRegra } from "../../../nucleo/erros.ts";
import { LIMITE_COMANDO_MS } from "../ambiente.ts";
import { executar } from "../../processo.ts";
import { dirDoPiDoAmbiente } from "./ambiente_container.ts";

const ROTULO_DO_AMBIENTE = "fabriquinha.ambiente";
/** A pasta de trabalho do container; `limpar` a esvazia. */
const PASTA_DE_TRABALHO = "/trabalho";
/** Cada comando do docker, menos build e pull, que baixam imagem e levam o limite dos comandos configurados. */
const LIMITE_DO_DOCKER_MS = 2 * 60_000;

/** A imagem só com o `iptables`, que o container da rede usa para travar a saída do Ambiente para o host. */
const IMAGEM_DAS_REGRAS_DE_REDE = "fabriquinha/regras-de-rede:1";

/** O nome da imagem pronta no docker: `fabriquinha/<projeto>:<sha256 do Dockerfile>` ou o nome da imagem do projeto. */
type ImagemDoAmbiente = string;

interface Limites {
  memoria_maxima_mb: number;
  cpus: number;
}

/**
 * O que o container enxerga do host, nos mesmos caminhos dele, e nada além disto: nunca a raiz da Fabriquinha inteira,
 * que tem o banco, nem o `~/.pi/agent`, que tem o `trust.json` e as configurações do Auditor.
 */
export interface Montagens {
  /**
   * A pasta das worktrees do projeto (`R/worktrees/<projeto>`), em leitura e escrita. O container volta ao conjunto e
   * serve a outra demanda do projeto, então a pasta de uma demanda só não basta. A worktree do Espaço não é montada
   * sozinha: o git do container a cria, e uma pasta que já existe o core entende como worktree pronta; montada, a
   * pasta existiria desde a criação do container e não se removeria com a worktree.
   */
  pastaDasWorktreesDoProjeto: string;
  /** O clone do usuário: só o `.git` entra (objetos e `worktrees/<n>`), em leitura e escrita. */
  raiz_git: string;
  /** A raiz da Fabriquinha (R): entram `sessoes` e `execucoes`, em leitura e escrita. O container nasce antes dos processos que o usam, então entram as pastas de todos (`E-<id>`). */
  raiz: string;
  /** O `pacote-pi`, só em leitura. */
  pacote: string;
  /** O `auth.json` do pi no host: o container recebe uma cópia dele, num `PI_CODING_AGENT_DIR` próprio. */
  auth_json: string;
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

/** Cria no host o que o container monta e devolve os `-v`; a cópia do `auth.json` não leva mais nada do `~/.pi/agent`. */
function argumentosDasMontagens(montagens: Montagens, idDoAmbiente: string): string[] {
  const { pastaDasWorktreesDoProjeto, raiz_git, raiz, pacote, auth_json } = montagens;
  if (!existsSync(auth_json))
    throw new ErroDeRegra(`não existe o ${auth_json}`, "entre no pi (login) antes de usar um Ambiente em container");
  const dirDoPi = dirDoPiDoAmbiente(raiz, idDoAmbiente);
  const dirDasSessoes = join(raiz, "sessoes");
  const dirDasExecucoes = join(raiz, "execucoes");
  const hooksDoClone = join(raiz_git, ".git", "hooks");
  for (const dir of [pastaDasWorktreesDoProjeto, dirDoPi, dirDasSessoes, dirDasExecucoes, hooksDoClone])
    mkdirSync(dir, { recursive: true });
  copyFileSync(auth_json, join(dirDoPi, "auth.json"));
  chmodSync(join(dirDoPi, "auth.json"), 0o600);
  const montagensComModo: [string, "rw" | "ro"][] = [
    [pastaDasWorktreesDoProjeto, "rw"],
    [join(raiz_git, ".git"), "rw"],
    // O git do usuário executa o que está na config (`core.fsmonitor`, `core.hooksPath`) e nos hooks do clone.
    [join(raiz_git, ".git", "config"), "ro"],
    [hooksDoClone, "ro"],
    [dirDasSessoes, "rw"],
    [dirDasExecucoes, "rw"],
    [pacote, "ro"],
    [dirDoPi, "rw"],
  ];
  return montagensComModo.flatMap(([caminho, modo]) => ["-v", `${caminho}:${caminho}:${modo}`]);
}

/** Constrói a imagem das regras de rede, se ela ainda não está na máquina. */
async function garantirImagemDasRegrasDeRede(limiteMs: number): Promise<void> {
  const { codigo } = await executar("docker", ["image", "inspect", IMAGEM_DAS_REGRAS_DE_REDE], { limiteMs });
  if (codigo === 0) return;
  const contexto = mkdtempSync(join(tmpdir(), "fabriquinha-regras-de-rede-"));
  try {
    writeFileSync(join(contexto, "Dockerfile"), "FROM alpine\nRUN apk add --no-cache iptables\n");
    await rodarDocker(["build", "-t", IMAGEM_DAS_REGRAS_DE_REDE, contexto], LIMITE_COMANDO_MS);
  } finally {
    rmSync(contexto, { recursive: true, force: true });
  }
}

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
  /**
   * Sobe o container parado em `tail`, para ficar vivo até alguém eliminá-lo. A saída é para a internet e, no host
   * (`host-gateway`), só para a porta da API do agente. Sem `montagens`, o container nasce sem pasta do host.
   */
  async criar(
    imagem: ImagemDoAmbiente,
    limites: Limites,
    portaDaApi: number,
    montagens?: Montagens,
  ): Promise<ContainerCriado> {
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
        "--add-host",
        "host.docker.internal:host-gateway",
        ...(montagens ? argumentosDasMontagens(montagens, id) : []),
        imagem,
        "tail",
        "-f",
        "/dev/null",
      ],
      this.#limiteDoComandoMs,
    );
    try {
      await this.#restringirSaidaParaOHost(id, containerId, portaDaApi);
    } catch (erro) {
      await this.eliminar({ id, container_id: containerId }); // sem a regra, o container alcançaria todas as portas do host
      throw erro;
    }
    return { id, container_id: containerId };
  }

  /**
   * Põe no namespace de rede do container as regras que deixam passar para o host só a porta da API. O `iptables` roda
   * num container à parte (`--net container:`), porque o do Ambiente não tem `NET_ADMIN`: o agente não as desfaz.
   * shortcut: só o IP do `host-gateway` é travado, não os outros IPs do host (a LAN, por exemplo); travar esses pede
   * regra no firewall do host.
   */
  async #restringirSaidaParaOHost(id: string, containerId: string, portaDaApi: number): Promise<void> {
    const hosts = await rodarDocker(["exec", containerId, "cat", "/etc/hosts"], this.#limiteDoComandoMs);
    const ipDoHost = /^(\d+\.\d+\.\d+\.\d+)\s+host\.docker\.internal\b/m.exec(hosts)?.[1];
    if (!ipDoHost)
      throw new ErroDeRegra(
        "o container não conhece o host.docker.internal",
        "confira a versão do Docker (host-gateway)",
      );
    await garantirImagemDasRegrasDeRede(this.#limiteDoComandoMs);
    await rodarDocker(
      [
        "run",
        "--rm",
        "--label",
        `${ROTULO_DO_AMBIENTE}=${id}-regras-de-rede`,
        "--memory",
        "64m",
        "--cpus",
        "0.5",
        "--net",
        `container:${containerId}`,
        "--cap-add",
        "NET_ADMIN",
        IMAGEM_DAS_REGRAS_DE_REDE,
        "sh",
        "-c",
        `iptables -A OUTPUT -d ${ipDoHost} -p tcp --dport ${String(portaDaApi)} -j ACCEPT && iptables -A OUTPUT -d ${ipDoHost} -j REJECT`,
      ],
      LIMITE_COMANDO_MS,
    );
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
