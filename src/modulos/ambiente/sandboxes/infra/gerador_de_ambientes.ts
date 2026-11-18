// O único lugar da Fabriquinha que chama o `docker` (fitness `sem-docker`): cria, limpa, lista e elimina os containers
// que servem de Ambiente. Todo container nasce com o rótulo `fabriquinha.ambiente` e com limite de memória e de CPU, e
// só os que têm o rótulo são da Fabriquinha: o SonarQube e os containers do usuário nunca aparecem aqui.
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join } from "node:path";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import {
  type InstalacaoDoHarness,
  PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA,
} from "../../../../shared/infra/isolamento_do_ambiente.ts";
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

/** Onde, em relação ao `HOME` do container, a pasta do agente do pi do Auditor é montada. */
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
  /** A instalação do harness no host: a raiz, montada em leitura, e o executável para onde o comando do container aponta. */
  harness: InstalacaoDoHarness;
}

/**
 * O que o container recebe do pi do Auditor, de `~/.claude` e de `~/.codex`: a pasta do agente do pi é montada; do
 * `.claude` e do `.codex` vai a configuração, por cópia, na criação, e a credencial (o `.credentials.json` do Claude e o
 * `auth.json` do Codex) é montada do host.
 */
export interface Copias {
  /** O `PI_CODING_AGENT_DIR` do Auditor (`auth.json`, `settings.json`, `trust.json`...): montada em `~/.pi/agent` do container. */
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
  const { pastaDasWorktreesDoProjeto, raiz_git, raiz, pacote, harness } = montagens;
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
    [harness.raiz, harness.raiz, "ro"],
  ];
  return montagensComModo.flatMap(([origem, destino, modo]) => ["-v", `${origem}:${destino}:${modo}`]);
}

/**
 * O container não leva credencial de hospedagem (o push é do core): o token do GitHub que estiver nas pastas copiadas sai
 * da cópia. A credencial montada fica de fora: o `sed -i` a trocaria por outro arquivo (EBUSY) ou, se passasse, mexeria no
 * arquivo do host.
 */
const comandoQueTiraTokenDoGithub = (credencialMontada: string | undefined) =>
  `{ grep -rIlE '${PADRAO_DE_TOKEN_DO_GITHUB}' "$d" | while IFS= read -r arquivo; do [ "$arquivo" = "$d/${credencialMontada ?? ""}" ] && continue; sed -i -E 's/${PADRAO_DE_TOKEN_DO_GITHUB}/[token-do-github-removido]/g' "$arquivo"; done; }`;

/**
 * O que vai de cada pasta para o container: só a configuração (ajustes, instruções, skills, extensões e pacotes do
 * harness; a credencial é montada, `CREDENCIAL_POR_DESTINO`). Sessões, históricos, logs e bancos ficam no host: mudam enquanto o `tar` lê ("file changed as we
 * read it") e o agente do container não precisa deles. Caminhos relativos à raiz da pasta; o que não existe é pulado.
 */
const CONFIGURACAO_POR_DESTINO = {
  ".claude": ["settings.json", "CLAUDE.md", "skills", "agents", "commands", "hooks", "plugins"],
  ".codex": ["config.toml", "AGENTS.md", "hooks.json", "skills", "prompts", "rules"],
} as const;

type DestinoCopiado = keyof typeof CONFIGURACAO_POR_DESTINO;
type DestinoNoHome = typeof DIR_DO_PI_NO_HOME | DestinoCopiado;

/** Onde o container monta as pastas do host que têm a credencial do Claude e a do Codex (`/credenciais/claude`). */
const PASTA_DAS_CREDENCIAIS_NO_CONTAINER = "/credenciais";
/** A pasta só da credencial do Claude no container: o agente a lê por `VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE`. */
export const PASTA_DA_CREDENCIAL_DO_CLAUDE_NO_CONTAINER = `${PASTA_DAS_CREDENCIAIS_NO_CONTAINER}/claude`;
/** A variável com que o Claude Code lê e grava `.credentials.json` numa pasta só da credencial, no host e no container. */
export const VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE = "CLAUDE_SECURESTORAGE_CONFIG_DIR";

/**
 * A credencial de cada destino, que o container compartilha com o host em vez de copiar: o token de atualização do OAuth
 * é rotativo, e uma cópia deixa de valer quando o host ou outro container renova a dele. O container nunca monta
 * `~/.claude` nem `~/.codex` (sessões, histórico e configuração que roda no host): monta só uma pasta do host que tem a
 * credencial, `rw`, e o operador a prepara (a do pi é a pasta do agente, `dir_do_pi`):
 * - Claude: o Claude Code lê e grava a credencial dentro de `CLAUDE_SECURESTORAGE_CONFIG_DIR`, exportada no host e,
 *   no container, apontando para a pasta montada; ele renova por temporário + `rename`, que só vale na pasta, e não por symlink;
 * - Codex: segue o symlink ao gravar, então `~/.codex/auth.json` do host é um symlink para a pasta, e o do container também;
 * - pi: grava no lugar e trava com `auth.json.lock`, um diretório criado ao lado do `auth.json` sem seguir symlink, e o pi
 *   só aceita o auth em `<PI_CODING_AGENT_DIR>/auth.json`; o lock só vale para o host e o container se os dois usam a
 *   mesma pasta do agente, então ela é montada inteira.
 * shortcut: montar a pasta do agente do pi inteira, `rw`, deixa o container gravar as extensões e a configuração que o pi
 * do host executa, e o token do GitHub que houver nela não sai do container; trocar por uma pasta só do auth se o pi
 * passar a aceitar o auth fora do agent dir.
 */
const CREDENCIAL_POR_DESTINO: Record<DestinoNoHome, string> = {
  [DIR_DO_PI_NO_HOME]: "auth.json",
  ".claude": ".credentials.json",
  ".codex": "auth.json",
};

/** As pastas do host cuja configuração é copiada para o container, e para onde, relativo ao `HOME` do container. */
function pastasParaOContainer({ home_do_usuario }: Copias): [string, DestinoCopiado][] {
  const pastas: [string, DestinoCopiado][] = [];
  for (const pasta of [".claude", ".codex"] as const)
    if (existsSync(join(home_do_usuario, pasta))) pastas.push([join(home_do_usuario, pasta), pasta]);
  return pastas;
}

interface CredencialParaMontar {
  pastaNoHost: string;
  destinoNoHome: DestinoNoHome;
}

/** A pasta só da credencial não pode ser a do agente (`~/.claude`, `~/.codex`): o container leria e gravaria nela inteira. */
function exigirPastaSoDaCredencial(pasta: string, pastaDoAgente: string, orientacao: string): void {
  if (existsSync(pastaDoAgente) && realpathSync(pasta) === realpathSync(pastaDoAgente))
    throw new ErroDeRegra(`a pasta da credencial é a própria ${pastaDoAgente}, com sessões e configuração`, orientacao);
}

/** A pasta do host só com a credencial do Claude (`CLAUDE_SECURESTORAGE_CONFIG_DIR`); sem login do Claude, não há o que montar. */
function pastaDaCredencialDoClaude(homeDoUsuario: string): string | undefined {
  const pastaDoAgente = join(homeDoUsuario, ".claude");
  const credencialNaPastaDoAgente = join(pastaDoAgente, CREDENCIAL_POR_DESTINO[".claude"]);
  const pasta = process.env[VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE];
  const comoPrepararAPasta = `crie uma pasta só da credencial (mkdir -m 700 ~/.credenciais-claude), mova para ela o ${CREDENCIAL_POR_DESTINO[".claude"]} (mv ${credencialNaPastaDoAgente} ~/.credenciais-claude/) e exporte ${VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE}=~/.credenciais-claude no shell do Claude e no serviço da Fabriquinha`;
  if (!pasta) {
    if (existsSync(credencialNaPastaDoAgente))
      throw new ErroDeRegra(
        `o container não pode montar ${pastaDoAgente} (sessões e hooks do host), e ${VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE} não está definida`,
        comoPrepararAPasta,
      );
    return undefined;
  }
  const credencial = join(pasta, CREDENCIAL_POR_DESTINO[".claude"]);
  if (!existsSync(credencial))
    throw new ErroDeRegra(
      `não existe o ${credencial} (${VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE}=${pasta})`,
      `entre no Claude (login) com ${VARIAVEL_DA_PASTA_DA_CREDENCIAL_DO_CLAUDE} exportada, ou mova o ${CREDENCIAL_POR_DESTINO[".claude"]} para essa pasta`,
    );
  exigirPastaSoDaCredencial(pasta, pastaDoAgente, comoPrepararAPasta);
  return realpathSync(pasta);
}

/** A pasta do host só com a credencial do Codex: a que o symlink `~/.codex/auth.json` do host aponta; sem login do Codex, não há o que montar. */
function pastaDaCredencialDoCodex(homeDoUsuario: string): string | undefined {
  const pastaDoAgente = join(homeDoUsuario, ".codex");
  const credencial = join(pastaDoAgente, CREDENCIAL_POR_DESTINO[".codex"]);
  const informacao = lstatSync(credencial, { throwIfNoEntry: false });
  if (!informacao) return undefined;
  const comoPrepararAPasta = `crie uma pasta só da credencial (mkdir -m 700 ~/.credenciais-codex), mova o ${credencial} para ela (mv ${credencial} ~/.credenciais-codex/) e aponte o do host para lá (ln -s ~/.credenciais-codex/${CREDENCIAL_POR_DESTINO[".codex"]} ${credencial})`;
  if (!informacao.isSymbolicLink())
    throw new ErroDeRegra(
      `o ${credencial} é um arquivo comum, e o container não pode montar ${pastaDoAgente} (sessões e configuração do host)`,
      comoPrepararAPasta,
    );
  let alvo: string;
  try {
    alvo = realpathSync(credencial);
  } catch {
    throw new ErroDeRegra(`o symlink ${credencial} aponta para um arquivo que não existe`, comoPrepararAPasta);
  }
  if (basename(alvo) !== CREDENCIAL_POR_DESTINO[".codex"])
    throw new ErroDeRegra(
      `o symlink ${credencial} aponta para ${alvo}, que não se chama ${CREDENCIAL_POR_DESTINO[".codex"]}`,
      comoPrepararAPasta,
    );
  exigirPastaSoDaCredencial(dirname(alvo), pastaDoAgente, comoPrepararAPasta);
  return dirname(alvo);
}

/** As credenciais que o container monta: a do pi sempre (`exigirLoginDoPi`); a do Claude e a do Codex, se o host tem. */
function credenciaisParaMontar({ dir_do_pi, home_do_usuario }: Copias): CredencialParaMontar[] {
  const credenciais: CredencialParaMontar[] = [{ pastaNoHost: dir_do_pi, destinoNoHome: DIR_DO_PI_NO_HOME }];
  const pastaDoClaude = pastaDaCredencialDoClaude(home_do_usuario);
  if (pastaDoClaude) credenciais.push({ pastaNoHost: pastaDoClaude, destinoNoHome: ".claude" });
  const pastaDoCodex = pastaDaCredencialDoCodex(home_do_usuario);
  if (pastaDoCodex) credenciais.push({ pastaNoHost: pastaDoCodex, destinoNoHome: ".codex" });
  return credenciais;
}

/** Onde fica, no container, a pasta do host que tem a credencial do Claude ou do Codex. */
const pastaMontadaDaCredencial = (destinoNoHome: DestinoCopiado) =>
  `${PASTA_DAS_CREDENCIAIS_NO_CONTAINER}/${destinoNoHome.slice(1)}`;

/** O `-v` de uma credencial: a pasta do agente do pi no lugar dela, ou a pasta só da credencial do Claude/Codex no caminho dedicado. */
function montagemDaCredencial({ pastaNoHost, destinoNoHome }: CredencialParaMontar, homeDoContainer: string): string[] {
  const destino =
    destinoNoHome === DIR_DO_PI_NO_HOME
      ? `${homeDoContainer}/${DIR_DO_PI_NO_HOME}`
      : pastaMontadaDaCredencial(destinoNoHome);
  return ["-v", `${pastaNoHost}:${destino}:rw`];
}

/**
 * Copia `origem` (uma pasta do host) para `destinoNoHome`, relativo ao `HOME` do container, por `tar` no `docker exec`:
 * é cópia, e não montagem, então o que o agente altera ali não volta ao host.
 */
function copiarParaOHomeDoContainer(
  containerId: string,
  origem: string,
  destinoNoHome: DestinoCopiado,
  limiteMs: number,
  credencialMontada: string | undefined,
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
        `d="$HOME/${destinoNoHome}" && mkdir -p "$d" && tar -x --no-same-owner -C "$d" && ${comandoQueTiraTokenDoGithub(credencialMontada)}`,
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

/** Copia para o container, se existem, a configuração do `.claude` e a do `.codex` do usuário; a do pi é montada. */
async function copiarParaOContainer(
  containerId: string,
  copias: Copias,
  credenciaisMontadas: DestinoNoHome[],
): Promise<void> {
  for (const [origem, destinoNoHome] of pastasParaOContainer(copias))
    await copiarParaOHomeDoContainer(
      containerId,
      origem,
      destinoNoHome,
      LIMITE_COMANDO_MS,
      credenciaisMontadas.includes(destinoNoHome) ? CREDENCIAL_POR_DESTINO[destinoNoHome] : undefined,
    );
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
  /** O comando do harness (`pi`) no PATH do container, apontando para o executável montado do host. */
  async #instalarComandoDoHarness(containerId: string, { comando, executavel }: InstalacaoDoHarness): Promise<void> {
    await rodarDocker(
      // Como root: a imagem pode rodar com usuário sem escrita em /usr/local/bin; a mínima (busybox) nem tem a pasta.
      [
        "exec",
        "-u",
        "0",
        containerId,
        "sh",
        "-c",
        `mkdir -p /usr/local/bin && ln -sf '${executavel}' /usr/local/bin/${comando}`,
      ],
      this.#limiteDoComandoMs,
    );
  }

  /** O `HOME` do usuário que o container usa por padrão (o que o `docker exec` vê), para montar a credencial no lugar dela. */
  async #descobrirHomeDoContainer(id: string, imagem: ImagemDoAmbiente): Promise<string> {
    const home = await rodarDocker(
      [
        "run",
        "--rm",
        "--label",
        `${ROTULO_DO_AMBIENTE}=${id}-home`,
        "--memory",
        "64m",
        "--cpus",
        "0.5",
        "--entrypoint",
        "sh",
        imagem,
        "-c",
        'echo "$HOME"',
      ],
      this.#limiteDoComandoMs,
    );
    // Sem a barra do fim (`/home/node/` não chega ao HOME no laço do chown); aspa simples e `:` quebrariam os roteiros e o `-v`.
    let homeSemBarraNoFim = home;
    while (homeSemBarraNoFim.endsWith("/")) homeSemBarraNoFim = homeSemBarraNoFim.slice(0, -1);
    if (!/^\/[^':]+$/.test(homeSemBarraNoFim))
      throw new ErroDeRegra(`a imagem ${imagem} não tem um HOME (veio "${home}")`, "use uma imagem com HOME absoluto");
    return homeSemBarraNoFim;
  }

  /** O docker cria como root a pasta acima da pasta do agente do pi montada; o usuário do container (dono do HOME) precisa escrever nela. A montada não: o `chown` mudaria o dono da pasta do host. */
  async #devolverPastaDaCredencialDoPiAoUsuario(containerId: string, homeDoContainer: string): Promise<void> {
    // sobe da pasta acima da montada (o `.pi`) até o HOME
    const roteiro = `dono=$(stat -c %u:%g '${homeDoContainer}') && p=$(dirname '${homeDoContainer}/${DIR_DO_PI_NO_HOME}'); while [ "$p" != '${homeDoContainer}' ]; do chown "$dono" "$p"; p=$(dirname "$p"); done`;
    await rodarDocker(["exec", "-u", "0", containerId, "sh", "-c", roteiro], this.#limiteDoComandoMs);
  }

  /** O `auth.json` do Codex no `HOME` vira symlink para a pasta do host montada, como o do host; o Codex grava no alvo do symlink. O Claude não precisa: ele lê a pasta montada direto. */
  async #ligarCredencialDoCodexAPastaMontada(containerId: string): Promise<void> {
    const credencial = CREDENCIAL_POR_DESTINO[".codex"];
    const roteiro = `mkdir -p "$HOME/.codex" && ln -sfn '${pastaMontadaDaCredencial(".codex")}/${credencial}' "$HOME/.codex/${credencial}"`;
    await rodarDocker(["exec", containerId, "sh", "-c", roteiro], this.#limiteDoComandoMs);
  }

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
    const credenciais = copias ? credenciaisParaMontar(copias) : [];
    const id = randomUUID();
    const homeDoContainer = credenciais.length > 0 ? await this.#descobrirHomeDoContainer(id, imagem) : "";
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
        ...credenciais.flatMap((credencial) => montagemDaCredencial(credencial, homeDoContainer)),
        imagem,
        "tail",
        "-f",
        "/dev/null",
      ],
      this.#limiteDoComandoMs,
    );
    try {
      await this.#restringirSaidaParaOHost(id, containerId, portaDaApi);
      if (montagens) await this.#instalarComandoDoHarness(containerId, montagens.harness);
      if (copias) {
        const destinosMontados = credenciais.map(({ destinoNoHome }) => destinoNoHome);
        // `exigirLoginDoPi` garante o `auth.json` do pi: a pasta dele sempre está entre as credenciais montadas.
        await this.#devolverPastaDaCredencialDoPiAoUsuario(containerId, homeDoContainer);
        if (destinosMontados.includes(".codex")) await this.#ligarCredencialDoCodexAPastaMontada(containerId);
        await copiarParaOContainer(containerId, copias, destinosMontados);
      }
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
