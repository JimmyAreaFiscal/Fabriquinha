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
}

/**
 * Espera o comando terminar e devolve o código de saída, o stdout e o stderr. Não lê stdin, para nunca esperar
 * resposta de quem não está ali. Só lança se o programa nem chega a rodar (ex.: não está instalado).
 */
export function executar(
  comando: string,
  args: readonly string[],
  { env = process.env, cwd, limiteMs }: Opcoes = {},
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
    filho.stdout.setEncoding("utf8").on("data", (parte: string) => (saida += parte));
    filho.stderr.setEncoding("utf8").on("data", (parte: string) => (erro += parte));
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
