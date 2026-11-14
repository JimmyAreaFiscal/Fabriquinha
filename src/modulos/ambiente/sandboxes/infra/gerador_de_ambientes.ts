// O único lugar da Fabriquinha que chama o `docker` (fitness `sem-docker`): cria, limpa, lista e elimina os containers
// que servem de Ambiente. Todo container nasce com o rótulo `fabriquinha.ambiente` e com limite de memória e de CPU, e
// só os que têm o rótulo são da Fabriquinha: o SonarQube e os containers do usuário nunca aparecem aqui.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { dirname, join } from "node:path";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { executar } from "../../../../shared/infra/processo.ts";
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import {
  DOCKERFILE_DAS_REGRAS_DE_REDE,
  IMAGEM_DAS_REGRAS_DE_REDE,
  ipDoHostNoArquivoDeHosts,
  roteiroQueSoLiberaAPortaDaApi,
} from "../../redes/publico.ts";
import { pastasDoAmbiente } from "./pastas_do_ambiente.ts";

const ROTULO_DO_AMBIENTE = "fabriquinha.ambiente";
/** A pasta de trabalho do container; `limpar` a esvazia. */
const PASTA_DE_TRABALHO = "/trabalho";
/** Cada comando do docker, menos build e pull, que baixam imagem e levam o limite dos comandos configurados. */
const LIMITE_DO_DOCKER_MS = 2 * 60_000;
/** A medição do uso, que a tela de Configuração espera: o docker travado só deixa o medido de fora, sem segurar a tela. */
const LIMITE_DA_MEDICAO_MS = 10_000;

/** Onde, em relação ao `HOME` do container, mora a cópia do pi do Auditor. */
export const DIR_DO_PI_NO_HOME = ".pi/agent";
/** O token do GitHub, que sai das cópias para o container e do `.env` do projeto que o container recebe. */
export const PADRAO_DE_TOKEN_DO_GITHUB = "gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}";

/** O nome da imagem pronta no docker: `fabriquinha/<projeto>:<sha256 do Dockerfile>` ou o nome da imagem do projeto. */
type ImagemDoAmbiente = string;

interface Limites {
  memoria_maxima_mb: number;
  cpus: number;
}

/**
 * O que o container enxerga do host, e nada além disto: nunca a raiz da Fabriquinha inteira, que tem o banco, nem a
 * pasta inteira de `sessoes` ou de `execucoes`, que têm as dos outros Espaços. Cada container monta só as pastas
 * próprias (`pastasDoAmbiente`), nos caminhos `<raiz>/sessoes` e `<raiz>/execucoes`.
 */
export interface Montagens {
  /**
   * A pasta das worktrees do projeto (`R/worktrees/<projeto>`), em leitura e escrita. O container volta ao conjunto e
   * serve a outra demanda do projeto, então a pasta de uma demanda só não basta. A worktree do Espaço não é montada
   * sozinha: o git do container a cria, e uma pasta que já existe o core entende como worktree pronta; montada, a
   * pasta existiria desde a criação do container e não se removeria com a worktree.
   */
  pastaDasWorktreesDoProjeto: string;
  /** O clone do usuário: só o `.git` entra, em leitura; escrita só em `objects`, `refs`, `logs` e na pasta das entradas de worktree da Fabriquinha. */
  raiz_git: string;
  /** A raiz da Fabriquinha (R): o container monta só as pastas próprias de sessão e de execução, em leitura e escrita. */
  raiz: string;
  /** O `pacote-pi`, só em leitura. */
  pacote: string;
}

/** O que o container recebe por cópia (nunca por montagem), na criação: o pi do Auditor, `~/.claude` e `~/.codex`. */
export interface Copias {
  /** O `PI_CODING_AGENT_DIR` do Auditor (`auth.json`, `settings.json`, `trust.json`...): vira o `~/.pi/agent` do container. */
  dir_do_pi: string;
  /** O home do usuário: o `.claude` e o `.codex` dele, se existem, vão para o home do container. */
  home_do_usuario: string;
}

/** CPU e memória de um Ambiente: `cpus` em núcleos (1,5 é um núcleo e meio), como os limites da Configuração do Ambiente. */
export interface Recursos {
  cpus: number;
  memoria_mb: number;
}

/** Quantos MB tem cada unidade em que o `docker stats` escreve a memória usada. */
const MB_POR_UNIDADE_DO_DOCKER = { B: 1 / 1048576, KiB: 1 / 1024, MiB: 1, GiB: 1024, TiB: 1048576 } as const;

/** Uma linha do `docker stats` (`<id>\t52.50%\t256MiB / 2GiB`): o id do container e o uso dele. */
function usoDaLinhaDoStats(linha: string): [string, Recursos] {
  const [containerId = "", cpu = "", memoria = ""] = linha.split("\t");
  const percentual = /^(\d+(?:\.\d+)?)%$/.exec(cpu);
  const usada = /^(\d+(?:\.\d+)?)(B|KiB|MiB|GiB|TiB) \//.exec(memoria);
  if (!percentual || !usada)
    throw new ErroDeRegra(`o docker stats respondeu o que não se lê: ${linha}`, "confira a versão do Docker");
  const unidade = usada[2] as keyof typeof MB_POR_UNIDADE_DO_DOCKER;
  return [
    containerId,
    { cpus: Number(percentual[1]) / 100, memoria_mb: Number(usada[1]) * MB_POR_UNIDADE_DO_DOCKER[unidade] },
  ];
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

/** Cria no host o que o container monta e devolve os `-v` (`origem:destino:modo`). */
function argumentosDasMontagens(montagens: Montagens, idDoAmbiente: string): string[] {
  const { pastaDasWorktreesDoProjeto, raiz_git, raiz, pacote } = montagens;
  const { sessoes, execucoes } = pastasDoAmbiente(raiz, idDoAmbiente);
  const gitDoClone = join(raiz_git, ".git");
  // Só estas pastas do `.git` aceitam escrita; o resto (`commondir`, `config`, `hooks`, `info`, `HEAD`) o git do usuário
  // e o do core seguem para executar código, então fica só leitura.
  const pastasDoGitComEscrita = ["objects", "refs", "logs", PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA].map((nome) =>
    join(gitDoClone, nome),
  );
  for (const dir of [pastaDasWorktreesDoProjeto, sessoes, execucoes, ...pastasDoGitComEscrita])
    mkdirSync(dir, { recursive: true });
  const montagensComModo: [string, string, "rw" | "ro"][] = [
    [pastaDasWorktreesDoProjeto, pastaDasWorktreesDoProjeto, "rw"],
    [gitDoClone, gitDoClone, "ro"],
    ...pastasDoGitComEscrita.map((dir): [string, string, "rw"] => [dir, dir, "rw"]),
    [sessoes, join(raiz, "sessoes"), "rw"],
    [execucoes, join(raiz, "execucoes"), "rw"],
    [pacote, pacote, "ro"],
  ];
  return montagensComModo.flatMap(([origem, destino, modo]) => ["-v", `${origem}:${destino}:${modo}`]);
}

/** O container não leva credencial de hospedagem (o push é do core): o token do GitHub que estiver nas pastas copiadas sai da cópia. */
const COMANDO_QUE_TIRA_TOKEN_DO_GITHUB = `{ grep -rIlE '${PADRAO_DE_TOKEN_DO_GITHUB}' "$d" | while IFS= read -r arquivo; do sed -i -E 's/${PADRAO_DE_TOKEN_DO_GITHUB}/[token-do-github-removido]/g' "$arquivo"; done; }`;

/**
 * O que vai de cada pasta para o container: só a configuração (credenciais, ajustes, instruções, skills, extensões e
 * pacotes do harness). Sessões, históricos, logs e bancos ficam no host: mudam enquanto o `tar` lê ("file changed as we
 * read it") e o agente do container não precisa deles. Caminhos relativos à raiz da pasta; o que não existe é pulado.
 */
const CONFIGURACAO_POR_DESTINO = {
  // npm/ e git/ são os pacotes do `settings.json` (o pi-claude-bridge); bin/ tem o rg e o fd das ferramentas do pi.
  [DIR_DO_PI_NO_HOME]: [
    "auth.json",
    "settings.json",
    "trust.json",
    "models.json",
    "claude-bridge.json",
    "AGENTS.md",
    "SYSTEM.md",
    "skills",
    "extensions",
    "agents",
    "npm",
    "git",
    "bin",
  ],
  ".claude": [".credentials.json", "settings.json", "CLAUDE.md", "skills", "agents", "commands", "hooks", "plugins"],
  ".codex": ["auth.json", "config.toml", "AGENTS.md", "hooks.json", "skills", "prompts", "rules"],
} as const;

type DestinoNoHome = keyof typeof CONFIGURACAO_POR_DESTINO;

/**
 * Copia `origem` (uma pasta do host) para `destinoNoHome`, relativo ao `HOME` do container, por `tar` no `docker exec`:
 * é cópia, e não montagem, então o que o agente altera ali não volta ao host.
 */
function copiarParaOHomeDoContainer(
  containerId: string,
  origem: string,
  destinoNoHome: DestinoNoHome,
  limiteMs: number,
): Promise<void> {
  const configuracao = CONFIGURACAO_POR_DESTINO[destinoNoHome].filter((item) => existsSync(join(origem, item)));
  // Sem nada da configuração, não há o que copiar (e o tar recusa criar um arquivo vazio).
  if (configuracao.length === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const sinal = AbortSignal.timeout(limiteMs);
    // O tar e o docker vêm do PATH do serviço, como em `executar`; o docker falso dos testes entra assim.
    const argumentosDoTar = ["-C", origem, "-c", "--", ...configuracao];
    const empacotar = spawn("tar", argumentosDoTar, { stdio: ["ignore", "pipe", "pipe"], signal: sinal }); // NOSONAR
    const extrair = spawn(
      "docker", // NOSONAR
      [
        "exec",
        "-i",
        containerId,
        "sh",
        "-c",
        `d="$HOME/${destinoNoHome}" && mkdir -p "$d" && tar -x --no-same-owner -C "$d" && ${COMANDO_QUE_TIRA_TOKEN_DO_GITHUB}`,
      ],
      { stdio: ["pipe", "ignore", "pipe"], signal: sinal },
    );
    let motivo = "";
    let primeiraFalha: string | undefined;
    let processosEncerrados = 0;
    // A falha de um mata o outro, mas a promessa só se resolve quando os dois fecharam: um `docker exec` que sobra
    // continuaria mexendo no container depois que o chamador já o eliminou.
    const registrarFalhaEMatarOsProcessos = (erro: unknown) => {
      primeiraFalha ??= String(erro);
      for (const filho of [empacotar, extrair]) filho.kill();
    };
    pipeline(empacotar.stdout, extrair.stdin).catch(registrarFalhaEMatarOsProcessos);
    for (const filho of [empacotar, extrair]) {
      filho.stderr.on("data", (parte: Buffer) => (motivo += parte.toString()));
      filho.on("error", registrarFalhaEMatarOsProcessos);
      filho.on("close", (codigo) => {
        if (codigo !== 0) registrarFalhaEMatarOsProcessos(`saiu com código ${String(codigo)}`);
        if (++processosEncerrados < 2) return;
        if (primeiraFalha === undefined) resolve();
        else
          reject(
            new ErroDeRegra(
              `não foi possível copiar ${origem} para o container: ${primeiraFalha}; ${motivo.trim()}`,
              "confira o Docker e o espaço em disco do container",
            ),
          );
      });
    }
  });
}

/** O container sem o login do pi não serve ao agente: falha antes de subir um. */
function exigirLoginDoPi({ dir_do_pi }: Copias): void {
  if (!existsSync(join(dir_do_pi, "auth.json")))
    throw new ErroDeRegra(
      `não existe o ${join(dir_do_pi, "auth.json")}`,
      "entre no pi (login) antes de usar um Ambiente em container",
    );
}

/** Copia para o container o pi do Auditor e, se existem, o `.claude` e o `.codex` do usuário. */
async function copiarParaOContainer(containerId: string, { dir_do_pi, home_do_usuario }: Copias): Promise<void> {
  const copias: [string, DestinoNoHome][] = [[dir_do_pi, DIR_DO_PI_NO_HOME]];
  for (const pasta of [".claude", ".codex"] as const)
    if (existsSync(join(home_do_usuario, pasta))) copias.push([join(home_do_usuario, pasta), pasta]);
  for (const [origem, destinoNoHome] of copias)
    await copiarParaOHomeDoContainer(containerId, origem, destinoNoHome, LIMITE_COMANDO_MS);
}

/** Constrói a imagem das regras de rede, se ela ainda não está na máquina. */
async function garantirImagemDasRegrasDeRede(limiteMs: number): Promise<void> {
  const { codigo } = await executar("docker", ["image", "inspect", IMAGEM_DAS_REGRAS_DE_REDE], { limiteMs });
  if (codigo === 0) return;
  const contexto = mkdtempSync(join(tmpdir(), "fabriquinha-regras-de-rede-"));
  try {
    writeFileSync(join(contexto, "Dockerfile"), DOCKERFILE_DAS_REGRAS_DE_REDE);
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
   * (`host-gateway`), só para a porta da API do agente. Sem `montagens`, o container nasce sem pasta do host; sem
   * `copias`, sem o pi, o `.claude` nem o `.codex`.
   */
  async criar(
    imagem: ImagemDoAmbiente,
    limites: Limites,
    portaDaApi: number,
    montagens?: Montagens,
    copias?: Copias,
  ): Promise<ContainerCriado> {
    if (copias) exigirLoginDoPi(copias);
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
      if (copias) await copiarParaOContainer(containerId, copias);
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
    const ipDoHost = ipDoHostNoArquivoDeHosts(hosts);
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
        roteiroQueSoLiberaAPortaDaApi(ipDoHost, portaDaApi),
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

  /** O uso de CPU e de memória de cada container, medido agora pelo docker numa chamada só; sem container, nem chama. */
  async medirUso(containerIds: readonly string[]): Promise<Map<string, Recursos>> {
    if (containerIds.length === 0) return new Map();
    const saida = await rodarDocker(
      ["stats", "--no-stream", "--format", "{{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}", ...containerIds],
      Math.min(this.#limiteDoComandoMs, LIMITE_DA_MEDICAO_MS),
    );
    return new Map(saida.split("\n").filter(Boolean).map(usoDaLinhaDoStats));
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
