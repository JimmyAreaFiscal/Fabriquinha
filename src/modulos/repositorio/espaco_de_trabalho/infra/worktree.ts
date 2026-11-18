// Preparação da worktree (F5 §3.2), descarte das alterações (F5 §3.3), poda e remoção das worktrees do projeto.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { ErroDeRegra, mensagem } from "../../../../shared/nucleo/erros.ts";
import { anotar } from "../../../../shared/infra/registro.ts";
import { git } from "../../../../shared/infra/processo.ts";
import { LIMITE_COMANDO_MS } from "../../../../shared/nucleo/primitivos.ts";
import { PASTA_DAS_ENTRADAS_DE_WORKTREE_DA_FABRIQUINHA } from "../../../../shared/infra/isolamento_do_ambiente.ts";
import { type Ambiente } from "../../../ambiente/publico.ts";
import {
  envCompletoDoServico,
  exigirGitNoAmbiente,
  naFilaDaPasta,
  naFilaDoProjeto,
  pastaDasWorktreesDoProjeto,
  type ProjetoDoRepositorio,
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

/**
 * O Ambiente que já traz as dependências da imagem as enxerga pela worktree: o NODE_PATH não vale para ESM, então o
 * symlink é obrigatório. Imagem sem `/dependencias/node_modules` (projeto sem Node) não liga nada.
 * shortcut: só `node_modules` da raiz, a imagem monta tudo em `/dependencias`; subpastas de dependências, quando existirem.
 */
const LIGAR_DEPENDENCIAS_DA_IMAGEM =
  "if [ -d /dependencias/node_modules ]; then ln -sfn /dependencias/node_modules node_modules; fi";

/**
 * Sai com 0 quando as dependências da imagem servem à worktree: a imagem não tem `node_modules` (nada a comparar) ou o
 * `package.json` e o `package-lock.json` da raiz da worktree são iguais aos que a imagem guarda em `/dependencias`.
 */
const LOCKFILE_DA_WORKTREE_IGUAL_AO_DA_IMAGEM =
  "[ ! -d /dependencias/node_modules ] || { cmp -s package.json /dependencias/package.json && cmp -s package-lock.json /dependencias/package-lock.json; }";

/** Tira o symlink de uma preparação anterior: a instalação local não pode escrever no `node_modules` da imagem (do root). */
const DESLIGAR_DEPENDENCIAS_DA_IMAGEM = "if [ -L node_modules ]; then rm node_modules; fi";

const LINHA_DO_NODE_MODULES_NO_EXCLUDE = "/node_modules";

/**
 * O symlink `node_modules` não pode aparecer no status nem ir no `git add -A`, qualquer que seja o .gitignore do projeto
 * (`node_modules/` com barra não casa com symlink). O core grava o `info/exclude`, que o container só lê.
 * shortcut: o exclude é do clone e vale para todas as worktrees; duas preparações simultâneas podem duplicar a linha, sem efeito.
 */
async function ignorarNodeModulesNoGit(ambiente: Ambiente, caminho: string): Promise<void> {
  const exclude = (
    await exigirGitNoAmbiente(ambiente, caminho, "rev-parse", "--path-format=absolute", "--git-path", "info/exclude")
  ).trim();
  mkdirSync(dirname(exclude), { recursive: true });
  appendFileSync(exclude, ""); // cria o arquivo quando o clone não veio com o modelo do git
  if (readFileSync(exclude, "utf8").split("\n").includes(LINHA_DO_NODE_MODULES_NO_EXCLUDE)) return;
  appendFileSync(exclude, `\n${LINHA_DO_NODE_MODULES_NO_EXCLUDE}\n`);
}

async function lockfileDaWorktreeIgualAoDaImagem(ambiente: Ambiente, caminho: string): Promise<boolean> {
  const r = await ambiente.executar({
    programa: LOCKFILE_DA_WORKTREE_IGUAL_AO_DA_IMAGEM,
    argumentos: [],
    cwd: ambiente.caminhoNoAmbiente(caminho),
    env: envCompletoDoServico(),
    limiteMs: LIMITE_COMANDO_MS,
    noShell: true,
  });
  return r.codigo === 0;
}

/**
 * F5 §3.2: cada comando com /bin/sh -c, na worktree, em ordem, parando no primeiro que falhar. Fora da fila git.
 * Antes da `preparacao`, a `instalacao` roda no Ambiente sem dependências prontas e também no que as traz quando o
 * lockfile da worktree difere do da imagem (a worktree nasce da branch da demanda, a imagem da base); com o lockfile
 * igual, ela é pulada e a worktree só é ligada às dependências da imagem.
 */
export async function preparar(
  ambiente: Ambiente,
  caminho: string,
  verificacoes: Pick<ProjetoDoRepositorio["verificacoes"], "preparacao" | "instalacao">,
  log: string,
): Promise<void> {
  const reusaDependenciasDaImagem =
    ambiente.trazDependenciasInstaladas && (await lockfileDaWorktreeIgualAoDaImagem(ambiente, caminho));
  if (reusaDependenciasDaImagem) await ignorarNodeModulesNoGit(ambiente, caminho);
  const comandosDaInstalacao = reusaDependenciasDaImagem
    ? [LIGAR_DEPENDENCIAS_DA_IMAGEM]
    : [...(ambiente.trazDependenciasInstaladas ? [DESLIGAR_DEPENDENCIAS_DA_IMAGEM] : []), ...verificacoes.instalacao];
  for (const comando of [...comandosDaInstalacao, ...verificacoes.preparacao]) {
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
  projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
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
