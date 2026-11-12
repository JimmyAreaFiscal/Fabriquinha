// O Ambiente que é um container (CONCEITOS.md §7): todo comando do Espaço roda por `docker exec` no container alocado,
// com um env que começa vazio e só recebe o que o agente precisa. Não herda `HOME`, `SSH_AUTH_SOCK` nem credencial de
// hospedagem ou do SonarQube: o container não as tem, e o git que precisa delas fica no core.
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { parseEnv } from "node:util";
import { ErroDeRegra } from "../../../compartilhado/nucleo/erros.ts";
import { executar } from "../../../compartilhado/infra/processo.ts";
import { abrigarNoAmbiente } from "./pastas_do_ambiente.ts";
import {
  type Ambiente,
  chavesDeProvedorDoLlm,
  type ComandoNoAmbiente,
  CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO,
  ehCredencialDeHospedagemOuSonar,
  type IdentificadorDoProcesso,
  type ProcessoNoAmbiente,
  type SaidaDoComando,
} from "../ambiente.ts";

/** No container: um arquivo por processo, com o grupo de processos dele. */
const PASTA_DOS_PIDS = "/fabriquinha/pids";
const LIMITE_DO_SINAL_MS = 30_000;
/** Onde, em relação ao `HOME` do container, mora a cópia do pi do Auditor. */
export const DIR_DO_PI_NO_HOME = ".pi/agent";
const VARIAVEIS_DA_FABRIQUINHA = new Set(["FABRIQUINHA_API", "FABRIQUINHA_TOKEN", "FABRIQUINHA_SAIDA"]);
export const PADRAO_DE_TOKEN_DO_GITHUB = "gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}";
const VALOR_COM_TOKEN_DO_GITHUB = new RegExp(PADRAO_DE_TOKEN_DO_GITHUB);

interface ContainerDoAmbiente {
  /** O id do Ambiente, o valor do rótulo `fabriquinha.ambiente`. */
  id: string;
  container_id: string;
  /** `pacote-pi/bin`, que vai à frente do PATH da imagem para o `fabriquinha` empacotado. */
  bin_do_pacote: string;
  /** A raiz da Fabriquinha: as pastas de sessão e de execução do container moram em `<raiz>/ambientes/<id>`. */
  raiz: string;
  /** A API do agente vista de dentro do container; o `FABRIQUINHA_API` do core (127.0.0.1) não chega do container. */
  url_da_api: string;
}

const entreAspas = (texto: string): string => `'${texto.replaceAll("'", `'\\''`)}'`;

/** Só o que o agente precisa; o resto do `env` do core, credenciais inclusive, não entra. */
function variaveisPermitidas(env: Record<string, string>): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(env).filter(([nome]) => VARIAVEIS_DA_FABRIQUINHA.has(nome))),
    ...chavesDeProvedorDoLlm(env),
  };
}

export class AmbienteContainer implements Ambiente {
  readonly id: string;
  readonly processosMorremComOServico = false;
  readonly isolaAsVariaveisDoServico = true;
  /** O container monta o `.git` do clone só para leitura, menos as pastas que o `GeradorDeAmbientes` libera. */
  readonly escreveEmTodoOGitDoClone = false;
  /** O id do container no docker; o teste o confere com o do conjunto. */
  readonly container_id: string;
  readonly #binDoPacote: string;
  readonly #raiz: string;
  readonly #urlDaApi: string;

  constructor({ id, container_id, bin_do_pacote, raiz, url_da_api }: ContainerDoAmbiente) {
    this.id = id;
    this.container_id = container_id;
    this.#binDoPacote = bin_do_pacote;
    this.#raiz = raiz;
    this.#urlDaApi = url_da_api;
  }

  /** Onde o `.env` do projeto do Espaço fica para os `docker exec`; fora das pastas que o container monta. */
  get #arquivoDoEnvDoProjeto(): string {
    return join(this.#raiz, "ambientes", this.id, "env-do-projeto");
  }

  /** Guarda o `.env` do clone `raizGit` para os próximos comandos; o container serve a outro projeto depois, então sem `.env` limpa o anterior. */
  levarEnvDoProjeto(raizGit: string): void {
    const origem = join(raizGit, ".env");
    if (existsSync(origem)) {
      mkdirSync(dirname(this.#arquivoDoEnvDoProjeto), { recursive: true });
      copyFileSync(origem, this.#arquivoDoEnvDoProjeto);
    } else rmSync(this.#arquivoDoEnvDoProjeto, { force: true });
  }

  async executar(comando: ComandoNoAmbiente): Promise<SaidaDoComando> {
    const { limiteMs, ultimosBytes = Infinity, noShell } = comando;
    const inicio = performance.now();
    const { argumentosDoDocker, identificador, apagarArquivoDeEnv } = this.#prepararDockerExec(comando, false);
    const limite: { estourou: boolean; matouOGrupo?: Promise<void> } = { estourou: false };
    // O limite não pode matar só o `docker exec` do host: o grupo de processos que importa está dentro do container.
    const relogio =
      limiteMs === undefined
        ? undefined
        : setTimeout(() => {
            limite.estourou = true;
            limite.matouOGrupo = this.sinalizar(identificador, "SIGKILL");
          }, limiteMs);
    try {
      const r = await executar("docker", argumentosDoDocker, { ultimos: ultimosBytes });
      await limite.matouOGrupo;
      // Como no host: `null` no limite e, no shell, stderr e stdout juntos em `saida`, sem byte nulo.
      return {
        codigo: limite.estourou ? null : r.codigo,
        saida: noShell ? (r.erro + r.saida).replaceAll("\0", "\uFFFD") : r.saida,
        erro: noShell ? "" : r.erro,
        limiteEstourado: limite.estourou,
        duracaoMs: Math.round(performance.now() - inicio),
      };
    } finally {
      clearTimeout(relogio);
      apagarArquivoDeEnv();
    }
  }

  lancar(comando: ComandoNoAmbiente): ProcessoNoAmbiente {
    const { argumentosDoDocker, identificador, apagarArquivoDeEnv } = this.#prepararDockerExec(comando, true);
    // O docker vem do PATH do serviço, como em `executar`; o docker falso dos testes entra assim.
    const filho = spawn("docker", argumentosDoDocker, { stdio: ["pipe", "pipe", "pipe"] }); // NOSONAR
    return {
      identificador,
      stdin: filho.stdin,
      stdout: filho.stdout,
      stderr: filho.stderr,
      saiu: new Promise((resolve) =>
        filho.on("close", (codigo) => {
          apagarArquivoDeEnv();
          resolve(codigo);
        }),
      ),
      aoFalhar(ouvinte) {
        filho.on("error", ouvinte);
        filho.stdin.on("error", ouvinte);
      },
    };
  }

  // O grupo que já acabou é ignorado, como no host: o `kill` falha e o `docker exec` também.
  async sinalizar({ ambiente_id, grupo_processo }: IdentificadorDoProcesso, sinal: NodeJS.Signals): Promise<void> {
    if (ambiente_id !== this.id)
      throw new ErroDeRegra(
        `o processo é do ambiente ${ambiente_id}, não do ${this.id}`,
        "sinalize pelo ambiente que lançou o processo",
      );
    const nomeDoSinal = sinal.replace(/^SIG/, "");
    await executar(
      "docker",
      [
        "exec",
        this.container_id,
        "sh",
        "-c",
        `kill -${nomeDoSinal} -"$(cat ${PASTA_DOS_PIDS}/${String(grupo_processo)} 2>/dev/null)" 2>/dev/null`,
      ],
      { limiteMs: LIMITE_DO_SINAL_MS },
    );
  }

  caminhoNoAmbiente(caminhoNoHost: string): string {
    return caminhoNoHost;
  }

  /** O container só enxerga as pastas montadas nele (`pastasDoAmbiente`): leva para lá a do processo (`E-<id>`) e a da sessão do pi. */
  abrigarProcesso(pastaDaExecucao: string, sessao: string): void {
    abrigarNoAmbiente(this.#raiz, this.id, "execucoes", basename(pastaDaExecucao));
    abrigarNoAmbiente(this.#raiz, this.id, "sessoes", sessao);
  }

  #variaveisDoEnvDoProjeto(): Record<string, string> {
    if (!existsSync(this.#arquivoDoEnvDoProjeto)) return {};
    const variaveis = parseEnv(readFileSync(this.#arquivoDoEnvDoProjeto, "utf8"));
    return Object.fromEntries(
      Object.entries(variaveis).filter(
        (entrada): entrada is [string, string] =>
          entrada[1] !== undefined &&
          !CREDENCIAL_QUE_NUNCA_ENTRA_NO_AMBIENTE_ISOLADO.test(entrada[0]) &&
          !ehCredencialDeHospedagemOuSonar(entrada[0]) &&
          !VALOR_COM_TOKEN_DO_GITHUB.test(entrada[1]),
      ),
    );
  }

  // shortcut: sem `setsid`, porque o `docker exec` já faz do comando líder do próprio grupo, e o `setsid` faria um fork
  // que perde o código de saída; o arquivo de pid de cada comando fica em PASTA_DOS_PIDS até o container ser eliminado.
  /**
   * `docker exec` do comando: o `$$` do shell é o grupo de processos dele (o `exec` mantém o pid), gravado em
   * PASTA_DOS_PIDS sob um número sorteado, que é o `grupo_processo` do identificador: o pid de dentro só nasce depois
   * do `docker exec`, e o identificador é devolvido antes.
   */
  #prepararDockerExec(
    { programa, argumentos, cwd, env, noShell }: ComandoNoAmbiente,
    interativo: boolean,
  ): { argumentosDoDocker: string[]; identificador: IdentificadorDoProcesso; apagarArquivoDeEnv: () => void } {
    const identificador = { ambiente_id: this.id, grupo_processo: randomInt(1, 2 ** 31) };
    const programaEArgumentos = noShell ? ["sh", "-c", `exec 2>&1; ${programa}`] : [programa, ...argumentos];
    const variaveis = Object.entries({
      ...this.#variaveisDoEnvDoProjeto(),
      ...variaveisPermitidas(env),
      FABRIQUINHA_API: this.#urlDaApi,
    });
    if (variaveis.some(([, valor]) => valor.includes("\n")))
      throw new ErroDeRegra(
        "uma variável do ambiente tem quebra de linha e não cabe no env-file do docker",
        "tire a quebra de linha do valor",
      );
    const dirDoArquivoDeEnv = mkdtempSync(join(tmpdir(), "fabriquinha-env-"));
    const arquivoDeEnv = join(dirDoArquivoDeEnv, "env");
    writeFileSync(arquivoDeEnv, variaveis.map(([nome, valor]) => `${nome}=${valor}\n`).join(""));
    const roteiro = [
      `mkdir -p ${PASTA_DOS_PIDS}`,
      `echo $$ > ${PASTA_DOS_PIDS}/${String(identificador.grupo_processo)}`,
      `export PATH=${entreAspas(this.#binDoPacote)}:"$PATH"`,
      `export PI_CODING_AGENT_DIR="$HOME/${DIR_DO_PI_NO_HOME}"`, // a cópia do pi do Auditor, feita na criação do container
      `exec ${programaEArgumentos.map(entreAspas).join(" ")}`,
    ].join("; ");
    return {
      argumentosDoDocker: [
        "exec",
        ...(interativo ? ["-i"] : []),
        "-w",
        cwd,
        "--env-file",
        arquivoDeEnv,
        this.container_id,
        "sh",
        "-c",
        roteiro,
      ],
      identificador,
      apagarArquivoDeEnv: () => {
        rmSync(dirDoArquivoDeEnv, { recursive: true, force: true });
      },
    };
  }
}
