// Preparação da worktree (F5 §3.2), descarte das alterações (F5 §3.3), remoção das worktrees do projeto e fila de
// comandos git (F5 §6).
import { appendFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ErroDeRegra, mensagem } from "../../nucleo/erros.ts";
import type { Projeto } from "../../nucleo/projeto.ts";
import type { Ambiente } from "../ambiente/ambiente.ts";
import { anotar } from "../registro.ts";
import { git, LIMITE_COMANDO_MS } from "../processo.ts";

/**
 * Bytes do fim do log de cada comando de preparação.
 * ponytail: o corte só protege a memória do serviço; o log da execução não tem limite de tamanho (F5 §3.2).
 */
const LIMITE_LOG_PREPARACAO = 5 * 1024 * 1024;

/** `<raiz>/worktrees/<projeto>` (F5 §3): fora do repositório, para o test runner dele não varrer worktrees. */
const pastaDasWorktrees = (raiz: string, projeto: string): string => resolve(raiz, "worktrees", projeto);

const filas = new Map<string, Promise<unknown>>();

/** Roda `trabalho` depois de tudo o que já está na fila `chave`, mesmo que algo antes tenha falhado. */
function naFila<T>(chave: string, trabalho: () => Promise<T>): Promise<T> {
  const vez = (filas.get(chave) ?? Promise.resolve()).then(trabalho);
  filas.set(
    chave,
    vez.catch(() => undefined),
  );
  return vez;
}

/**
 * F5 §6: os comandos git de um projeto passam por aqui, em série. A chave é a pasta das worktrees do projeto,
 * `<raiz>/worktrees/<nome>`, a mesma a que o descarte chega pela worktree sem rodar git.
 * ponytail: fila em memória, válida porque há uma instância só do serviço (D10).
 */
export const naFilaDoProjeto = <T>(raiz: string, nome: string, trabalho: () => Promise<T>): Promise<T> =>
  naFila(pastaDasWorktrees(raiz, nome), trabalho);

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
const envCompletoDoServico = (): Record<string, string> =>
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

/** F5 §3.2: cada comando com /bin/sh -c, na worktree, em ordem, parando no primeiro que falhar. Fora da fila git. */
export async function preparar(
  ambiente: Ambiente,
  caminho: string,
  preparacao: Projeto["verificacoes"]["preparacao"],
  log: string,
): Promise<void> {
  for (const comando of preparacao) {
    anotar(log, `preparação: ${comando}`);
    // ponytail: o host local preserva o env completo da Preparação, credenciais inclusive; o container nasce sem elas.
    const r = await ambiente.executar({
      programa: comando,
      argumentos: [],
      cwd: ambiente.caminhoNoAmbiente(caminho),
      env: envCompletoDoServico(),
      limiteMs: LIMITE_COMANDO_MS,
      ultimosBytes: LIMITE_LOG_PREPARACAO,
      noShell: true,
    });
    appendFileSync(log, r.saida);
    if (r.codigo !== 0) {
      const motivo = r.limiteEstourado
        ? `passou de ${String(LIMITE_COMANDO_MS / 60_000)} minutos`
        : `saiu com código ${String(r.codigo)}`;
      anotar(log, `preparação falhou: ${motivo}`);
      throw new ErroDeRegra(
        `a preparação da worktree falhou em "${comando}": ${motivo}`,
        `veja o log em ${log}; ela roda de novo na próxima execução`,
      );
    }
  }
}

/**
 * F5 §3.3: `reset --hard HEAD` e `clean -fd` (sem `-x`: o que o .gitignore ignora, como `node_modules`, fica).
 * Devolve o que o clean removeu (pasta inteira com `/` no fim) e, se removeu algo, anota a lista no log.
 */
export async function descartarAlteracoes(ambiente: Ambiente, worktree: string, log: string): Promise<string[]> {
  const removidos = await naFila(dirname(resolve(worktree)), async () => {
    await exigirGitNoAmbiente(ambiente, worktree, "reset", "-q", "--hard", "HEAD");
    // ponytail: quotePath=false deixa acento legível; nome com aspas, barra invertida ou controle ainda vem entre aspas.
    const saida = await exigirGitNoAmbiente(ambiente, worktree, "-c", "core.quotePath=false", "clean", "-fd");
    return saida
      .split("\n")
      .filter((linha) => linha.startsWith("Removing "))
      .map((linha) => linha.slice("Removing ".length));
  });
  if (removidos.length > 0) anotar(log, `descarte removeu: ${removidos.join(", ")}`);
  return removidos;
}

/**
 * Remoção do projeto: apaga `<raiz>/worktrees/<projeto>` inteira e faz `git worktree prune` no repositório, que só
 * recebe o prune (arquivos, commits, branches `fabriquinha/I-n` e remoto ficam). Devolve um aviso por falha e nunca
 * lança por causa do disco ou do git.
 */
export function removerWorktrees(raiz: string, projeto: Pick<Projeto, "nome" | "raiz_git">): Promise<string[]> {
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const avisos: string[] = [];
    const pasta = pastaDasWorktrees(raiz, projeto.nome);
    try {
      await rm(pasta, { recursive: true, force: true });
    } catch (error_) {
      avisos.push(`não foi possível apagar ${pasta}: ${mensagem(error_)}`);
    }
    const r = await git(projeto.raiz_git, "worktree", "prune");
    if (r.codigo !== 0) avisos.push(`git -C ${projeto.raiz_git} worktree prune falhou: ${r.erro.trim()}`);
    return avisos;
  });
}
