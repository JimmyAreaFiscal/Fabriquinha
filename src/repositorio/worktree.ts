// Preparação da worktree (F5 §3.2), descarte das alterações (F5 §3.3), remoção das worktrees do projeto e fila de
// comandos git (F5 §6).
import { appendFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ErroDeRegra, mensagem } from "../dominio/erros.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { executarNoShell, git, LIMITE_COMANDO_MS } from "../processo.ts";

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

/** F5 §3.2: cada comando com /bin/sh -c, na worktree, em ordem, parando no primeiro que falhar. Fora da fila git. */
export async function preparar(caminho: string, comandos: readonly string[], log: string): Promise<void> {
  for (const comando of comandos) {
    anotar(log, `preparação: ${comando}`);
    const r = await executarNoShell(comando, caminho, { limiteLog: LIMITE_LOG_PREPARACAO });
    appendFileSync(log, r.log);
    if (r.codigo !== 0) {
      const motivo = r.estourou
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
export async function descartarAlteracoes(worktree: string, log: string): Promise<string[]> {
  const removidos = await naFila(dirname(resolve(worktree)), async () => {
    await exigirGit(worktree, "reset", "-q", "--hard", "HEAD");
    // ponytail: quotePath=false deixa acento legível; nome com aspas, barra invertida ou controle ainda vem entre aspas.
    const saida = await exigirGit(worktree, "-c", "core.quotePath=false", "clean", "-fd");
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
export function removerWorktrees(raiz: string, projeto: Pick<Projeto, "nome" | "repo">): Promise<string[]> {
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const avisos: string[] = [];
    const pasta = pastaDasWorktrees(raiz, projeto.nome);
    try {
      await rm(pasta, { recursive: true, force: true });
    } catch (error_) {
      avisos.push(`não foi possível apagar ${pasta}: ${mensagem(error_)}`);
    }
    const r = await git(projeto.repo, "worktree", "prune");
    if (r.codigo !== 0) avisos.push(`git -C ${projeto.repo} worktree prune falhou: ${r.erro.trim()}`);
    return avisos;
  });
}
