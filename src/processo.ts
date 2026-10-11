// Roda um comando externo com `spawn` e argumentos em lista, sem shell: nenhum argumento vira comando.
import { spawn } from "node:child_process";
import { ErroDeRegra } from "./dominio/erros.ts";

export interface Saida {
  codigo: number | null;
  saida: string;
  erro: string;
  /** O comando passou de `limiteMs` e o grupo dele foi morto. */
  limiteEstourado: boolean;
}

export interface Opcoes {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  /** Tempo máximo; passado ele, o grupo de processos inteiro leva SIGKILL (o que o shell lançou inclusive). */
  limiteMs?: number;
  /** Guarda só o fim de stdout e de stderr, pelo menos estes caracteres: saída enorme não esgota a memória. */
  ultimos?: number;
}

/**
 * Espera o comando terminar e devolve o código de saída, o stdout e o stderr. Não lê stdin, para nunca esperar
 * resposta de quem não está ali. Só lança se o programa nem chega a rodar (ex.: não está instalado).
 */
export function executar(
  comando: string,
  args: readonly string[],
  { env = process.env, cwd, limiteMs, ultimos = Infinity }: Opcoes = {},
): Promise<Saida> {
  return new Promise((resolve, reject) => {
    // Com limite, o filho lidera um grupo novo, para o SIGKILL no grupo pegar também os netos.
    const detached = limiteMs !== undefined;
    const filho = spawn(comando, args, { env, cwd, detached, stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    let erro = "";
    let limiteEstourado = false;
    const relogio = detached
      ? setTimeout(() => {
          limiteEstourado = true;
          try {
            process.kill(-Number(filho.pid), "SIGKILL");
          } catch {
            // ESRCH: o grupo já acabou; quem segura o close saiu do grupo (setsid) e não é alcançável daqui.
          }
        }, limiteMs)
      : undefined;
    // Corta só quando passa do dobro, para não copiar a string inteira a cada pedaço.
    const juntar = (atual: string, parte: string) => {
      const junto = atual + parte;
      return junto.length > 2 * ultimos ? junto.slice(-ultimos) : junto;
    };
    filho.stdout.setEncoding("utf8").on("data", (parte: string) => (saida = juntar(saida, parte)));
    filho.stderr.setEncoding("utf8").on("data", (parte: string) => (erro = juntar(erro, parte)));
    filho.on("error", (falha) => {
      clearTimeout(relogio);
      reject(
        new ErroDeRegra(`não foi possível rodar ${comando}: ${falha.message}`, `instale ${comando} ou confira o PATH`),
      );
    });
    // Desarma só no close: neto em segundo plano que sobrevive ao shell segura o stdout e também leva o SIGKILL.
    filho.on("close", (codigo) => {
      clearTimeout(relogio);
      resolve({ codigo, saida, erro, limiteEstourado });
    });
  });
}

/**
 * `git -C <dir> <args>`, sem terminal para pedir senha (falha em vez de esperar quem não está ali) e em LC_ALL=C:
 * mensagens e saídas lidas pelo texto (como a do `clean`) nunca vêm traduzidas.
 */
export const git = (dir: string, ...args: string[]): Promise<Saida> =>
  executar("git", ["-C", dir, ...args], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" } });

/** F3 §6 e F5 §3.2: limite de cada comando configurado pelo Auditor. */
export const LIMITE_COMANDO_MS = 30 * 60_000;
/** Variáveis com credencial de hospedagem ou do SonarQube (F4 §6.1, F5 §5.0). */
const CREDENCIAIS = new Set([
  "GH_TOKEN",
  "GITHUB_TOKEN",
  "GH_ENTERPRISE_TOKEN",
  "GITHUB_ENTERPRISE_TOKEN",
  "AZURE_DEVOPS_EXT_PAT",
  "SYSTEM_ACCESSTOKEN",
  "SONAR_TOKEN",
]);

/**
 * `base` sem as credenciais, com `gh` e `az` lendo a configuração de `dirVazio`, onde não há login salvo. Para o que
 * roda código do agente: o pi e os coletores de testes e fitness.
 */
export function ambienteSemCredenciais(base: NodeJS.ProcessEnv, dirVazio: string): NodeJS.ProcessEnv {
  const env = Object.entries(base).filter(([nome]) => !CREDENCIAIS.has(nome));
  return { ...Object.fromEntries(env), GH_CONFIG_DIR: dirVazio, AZURE_CONFIG_DIR: dirVazio };
}

export interface Resultado {
  /** `null` quando o comando morreu por sinal ou estourou o limite. */
  codigo: number | null;
  estourou: boolean;
  duracaoMs: number;
  /**
   * O stderr do próprio shell (ex.: erro de sintaxe, que sai antes de o `exec 2>&1` rodar) e depois stdout e stderr
   * do comando intercalados; em UTF-8 sem byte nulo, com no máximo `limiteLog` bytes (os do fim).
   */
  log: string;
}

/**
 * Comando de shell configurado pelo Auditor (testes, fitness, preparação): `/bin/sh -c`, com `cwd` na worktree e
 * `limiteMs`. O `exec 2>&1` na mesma linha junta stderr ao stdout na ordem em que o comando escreve, sem mudar o
 * número das linhas nas mensagens do shell. Erro de sintaxe impede o shell de rodar a linha, `exec` inclusive: a
 * mensagem chega pelo stderr, e por isso o stderr entra no log antes do stdout.
 * ponytail: só o fim do log; se precisar do início, guardar as duas pontas (F3 §6).
 */
export async function executarNoShell(
  comando: string,
  cwd: string,
  {
    env,
    limiteMs = LIMITE_COMANDO_MS,
    limiteLog,
  }: {
    env?: NodeJS.ProcessEnv;
    limiteMs?: number;
    /** Bytes guardados do fim do log; cada chamador diz quanto cabe no destino dele. */
    limiteLog: number;
  },
): Promise<Resultado> {
  const inicio = performance.now();
  const r = await executar("/bin/sh", ["-c", `exec 2>&1; ${comando}`], { env, cwd, limiteMs, ultimos: limiteLog });
  const duracaoMs = Math.round(performance.now() - inicio);
  // A saída já veio decodificada (byte inválido vira U+FFFD); o byte nulo, que a classe `texto` recusa, também.
  const bytes = Buffer.from((r.erro + r.saida).replaceAll("\0", "\uFFFD"));
  let corte = Math.max(0, bytes.length - limiteLog);
  // Não começa no meio de um caractere: pula os bytes de continuação (10xxxxxx).
  while ((bytes[corte] ?? 0) >> 6 === 0b10) corte++;
  return {
    codigo: r.limiteEstourado ? null : r.codigo,
    estourou: r.limiteEstourado,
    duracaoMs,
    log: bytes.subarray(corte).toString("utf8"),
  };
}
