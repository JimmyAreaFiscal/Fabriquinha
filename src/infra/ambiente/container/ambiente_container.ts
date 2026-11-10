// O Ambiente que é um container (CONCEITOS.md §7): todo comando do Espaço roda por `docker exec` no container alocado,
// com um env que começa vazio e só recebe o que o agente precisa. Não herda `HOME`, `SSH_AUTH_SOCK` nem credencial de
// hospedagem ou do SonarQube: o container não as tem, e o git que precisa delas fica no core.
import { spawn } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErroDeRegra } from "../../../nucleo/erros.ts";
import { executar } from "../../processo.ts";
import type {
  Ambiente,
  ComandoNoAmbiente,
  IdentificadorDoProcesso,
  ProcessoNoAmbiente,
  SaidaDoComando,
} from "../ambiente.ts";

/** No container: um arquivo por processo, com o grupo de processos dele. */
const PASTA_DOS_PIDS = "/fabriquinha/pids";
const LIMITE_DO_SINAL_MS = 30_000;
const VARIAVEIS_DA_FABRIQUINHA = new Set([
  "FABRIQUINHA_API",
  "FABRIQUINHA_TOKEN",
  "FABRIQUINHA_SAIDA",
  "PI_CODING_AGENT_DIR",
]);
const SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM = "_API_KEY";
// O pi aceita `AZURE_OPENAI_API_KEY`, mas o container nunca recebe variável de hospedagem ou do SonarQube.
const CREDENCIAL_QUE_NUNCA_ENTRA = /^(GH_|AZURE_|SONAR_)/;

/** A pasta do `PI_CODING_AGENT_DIR` do container `id`, onde mora só a cópia do `auth.json`. */
export const dirDoPiDoAmbiente = (raiz: string, idDoAmbiente: string): string =>
  join(raiz, "ambientes", idDoAmbiente, "pi");

interface ContainerDoAmbiente {
  /** O id do Ambiente, o valor do rótulo `fabriquinha.ambiente`. */
  id: string;
  container_id: string;
  /** `pacote-pi/bin`, que vai à frente do PATH da imagem para o `fabriquinha` empacotado. */
  bin_do_pacote: string;
  /** O `PI_CODING_AGENT_DIR` do container (`dirDoPiDoAmbiente`). */
  dir_do_pi: string;
  /** A API do agente vista de dentro do container; o `FABRIQUINHA_API` do core (127.0.0.1) não chega do container. */
  url_da_api: string;
}

const entreAspas = (texto: string): string => `'${texto.replaceAll("'", `'\\''`)}'`;

/** Só o que o agente precisa; o resto do `env` do core, credenciais inclusive, não entra. */
function variaveisPermitidas(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter(
      ([nome]) =>
        VARIAVEIS_DA_FABRIQUINHA.has(nome) ||
        (nome.endsWith(SUFIXO_DE_CHAVE_DE_PROVEDOR_DO_LLM) && !CREDENCIAL_QUE_NUNCA_ENTRA.test(nome)),
    ),
  );
}

export class AmbienteContainer implements Ambiente {
  readonly id: string;
  readonly tipo = "container";
  /** O id do container no docker; o teste o confere com o do conjunto. */
  readonly container_id: string;
  readonly #binDoPacote: string;
  readonly #dirDoPi: string;
  readonly #urlDaApi: string;

  constructor({ id, container_id, bin_do_pacote, dir_do_pi, url_da_api }: ContainerDoAmbiente) {
    this.id = id;
    this.container_id = container_id;
    this.#binDoPacote = bin_do_pacote;
    this.#dirDoPi = dir_do_pi;
    this.#urlDaApi = url_da_api;
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
      ...variaveisPermitidas(env),
      FABRIQUINHA_API: this.#urlDaApi,
      PI_CODING_AGENT_DIR: this.#dirDoPi,
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
