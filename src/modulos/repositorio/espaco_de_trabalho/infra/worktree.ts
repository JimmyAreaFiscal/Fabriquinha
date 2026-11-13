// Preparação da worktree (F5 §3.2), descarte das alterações (F5 §3.3), poda e remoção das worktrees do projeto.
import { appendFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ErroDeRegra, mensagem } from "../../../../shared/nucleo/erros.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import { git, LIMITE_COMANDO_MS } from "../../../../shared/infra/processo.ts";
import { type Ambiente, PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../sandbox/infra/ambiente.ts";
import {
  envCompletoDoServico,
  exigirGitNoAmbiente,
  naFilaDaPasta,
  naFilaDoProjeto,
  pastaDasWorktreesDoProjeto,
  type RepositorioDoProjeto,
} from "../../git/publico.ts";

/**
 * Bytes do fim do log de cada comando de preparação.
 * ponytail: o corte só protege a memória do serviço; o log da execução não tem limite de tamanho (F5 §3.2).
 */
const LIMITE_LOG_PREPARACAO = 5 * 1024 * 1024;

/**
 * `git worktree prune` no core: o container não escreve em `.git/worktrees`. Depois dele, apaga a pasta administrativa
 * da Fabriquinha cuja entrada (o link em `worktrees`) a poda levou.
 */
export async function podarWorktreesNoCore(raiz_git: string): ReturnType<typeof git> {
  const r = await git(raiz_git, "worktree", "prune", "--expire", "now");
  const pastaDasEntradas = join(raiz_git, ".git", PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA);
  if (r.codigo === 0 && existsSync(pastaDasEntradas))
    for (const nome of readdirSync(pastaDasEntradas))
      if (!existsSync(join(raiz_git, ".git", "worktrees", nome)))
        rmSync(join(pastaDasEntradas, nome), { recursive: true, force: true });
  return r;
}

/** F5 §3.2: cada comando com /bin/sh -c, na worktree, em ordem, parando no primeiro que falhar. Fora da fila git. */
export async function preparar(
  ambiente: Ambiente,
  caminho: string,
  preparacao: RepositorioDoProjeto["verificacoes"]["preparacao"],
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
  const removidos = await naFilaDaPasta(dirname(resolve(worktree)), async () => {
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
export function removerWorktrees(
  raiz: string,
  projeto: Pick<RepositorioDoProjeto, "nome" | "raiz_git">,
): Promise<string[]> {
  return naFilaDoProjeto(raiz, projeto.nome, async () => {
    const avisos: string[] = [];
    const pasta = pastaDasWorktreesDoProjeto(raiz, projeto.nome);
    try {
      await rm(pasta, { recursive: true, force: true });
    } catch (error_) {
      avisos.push(`não foi possível apagar ${pasta}: ${mensagem(error_)}`);
    }
    const r = await podarWorktreesNoCore(projeto.raiz_git);
    if (r.codigo !== 0) avisos.push(`git -C ${projeto.raiz_git} worktree prune falhou: ${r.erro.trim()}`);
    return avisos;
  });
}
