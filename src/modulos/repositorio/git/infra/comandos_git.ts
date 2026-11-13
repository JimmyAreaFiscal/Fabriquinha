// Os comandos git (F5 §6): a fila por projeto, o git do clone do host, com as credenciais do serviço, e o git do Espaço,
// rodado pelo Ambiente.
import { resolve } from "node:path";
import { ErroDeRegra } from "../../../../shared/nucleo/erros.ts";
import { git, LIMITE_COMANDO_MS } from "../../../../shared/infra/processo.ts";
import type { Ambiente } from "../../../ambiente/publico.ts";

/** `<raiz>/worktrees/<projeto>` (F5 §3): fora do repositório, para o test runner dele não varrer worktrees. */
export const pastaDasWorktreesDoProjeto = (raiz: string, projeto: string): string =>
  resolve(raiz, "worktrees", projeto);

const filas = new Map<string, Promise<unknown>>();

/** Roda `operacaoGit` depois de tudo o que já está na fila da `pasta`, mesmo que algo antes tenha falhado. */
export function naFilaDaPasta<T>(pasta: string, operacaoGit: () => Promise<T>): Promise<T> {
  const vez = (filas.get(pasta) ?? Promise.resolve()).then(operacaoGit);
  filas.set(
    pasta,
    vez.catch(() => undefined),
  );
  return vez;
}

/**
 * F5 §6: os comandos git de um projeto passam por aqui, em série. A chave é a pasta das worktrees do projeto,
 * `<raiz>/worktrees/<nome>`, a mesma a que o descarte chega pela worktree sem rodar git.
 * ponytail: fila em memória, válida porque há uma instância só do serviço (D10).
 */
export const naFilaDoProjeto = <T>(raiz: string, nome: string, operacaoGit: () => Promise<T>): Promise<T> =>
  naFilaDaPasta(pastaDasWorktreesDoProjeto(raiz, nome), operacaoGit);

/** `git` que lança ErroDeRegra com o stderr quando o comando falha. */
export async function exigirGit(dir: string, ...args: string[]): Promise<string> {
  const r = await git(dir, ...args);
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git ${args.join(" ")} falhou em ${dir}: ${r.erro.trim()}`,
      "corrija o repositório e execute o ticket de novo",
    );
  }
  return r.saida;
}

/** O env completo do serviço, no formato do Ambiente (sem as variáveis indefinidas). */
export const envCompletoDoServico = (): Record<string, string> =>
  Object.fromEntries(
    Object.entries(process.env).filter((variavel): variavel is [string, string] => variavel[1] !== undefined),
  );

/**
 * `git` rodado pelo Ambiente, nas condições de `processo.git`: sem terminal para pedir senha, em LC_ALL=C e com o limite
 * dos comandos configurados (passado o limite, o stderr diz por quê). Só para o que é do Espaço: a rede com credenciais
 * fica em `git`/`exigirGit`, no core.
 */
export async function gitNoAmbiente(
  ambiente: Ambiente,
  dir: string,
  ...args: string[]
): Promise<{ codigo: number | null; saida: string; erro: string }> {
  const pasta = ambiente.caminhoNoAmbiente(dir);
  const r = await ambiente.executar({
    programa: "git",
    argumentos: ["-C", pasta, ...args],
    // O `-C` leva o git à pasta; um cwd inexistente faria o spawn falhar sem o motivo do git.
    cwd: "/",
    env: { ...envCompletoDoServico(), GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    limiteMs: LIMITE_COMANDO_MS,
  });
  return r.limiteEstourado
    ? { ...r, erro: `${r.erro}passou do limite de ${String(LIMITE_COMANDO_MS)} ms e foi morto` }
    : r;
}

/** `gitNoAmbiente` que lança ErroDeRegra com o stderr quando o comando falha. */
export async function exigirGitNoAmbiente(ambiente: Ambiente, dir: string, ...args: string[]): Promise<string> {
  const r = await gitNoAmbiente(ambiente, dir, ...args);
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git ${args.join(" ")} falhou em ${dir}: ${r.erro.trim()}`,
      "corrija o repositório e execute o ticket de novo",
    );
  }
  return r.saida;
}
