// Heatmap de alterações da base (F5 §11): quantas vezes cada arquivo mudou nos últimos 12 meses, lido do git local.
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { ErroDeRegra } from "../dominio/erros.ts";
import type { Projeto } from "../dominio/projeto.ts";
import { git } from "../processo.ts";
import { exigirGit } from "./worktree.ts";

export interface CommitDoHeatmap {
  hash: string;
  mensagem: string;
  /** Data do commit (ISO 8601). */
  data: string;
  /** Número do PR que o mergeou; `null` para commit direto na base. */
  pr: string | null;
}

export interface NoDoHeatmap {
  nome: string;
  /** Pasta: soma dos arquivos abaixo dela. */
  alteracoes: number;
  /** Só na pasta, do que mais mudou para o que menos mudou. */
  filhos?: NoDoHeatmap[];
  /** Só no arquivo: hashes (chaves de `Heatmap.commits`) do mais novo ao mais antigo. */
  commits?: string[];
}

export interface Heatmap {
  branch: string;
  /** Início e fim da janela (ISO 8601). */
  desde: string;
  ate: string;
  raiz: NoDoHeatmap;
  commits: Record<string, CommitDoHeatmap>;
}

interface Registro extends Omit<CommitDoHeatmap, "pr"> {
  pais: string[];
  arquivos: string[];
}

/** Nó que se sabe pasta: tem `filhos`. */
type Pasta = NoDoHeatmap & { filhos: NoDoHeatmap[] };

const MESES_DA_JANELA = 12;

/** Registros do `git log -z --format=%x1e%H%x1f%P%x1f%cI%x1f%s --name-only`: do mais novo ao mais antigo. */
export function lerLog(saida: string): Registro[] {
  return saida
    .split("\x1e")
    .slice(1)
    .map((registro) => {
      const fim = registro.indexOf("\0");
      const [hash, pais, data, mensagem] = registro.slice(0, fim).split("\x1f") as [string, string, string, string];
      // Depois do assunto vem "\n" e os caminhos separados por NUL; merge não lista arquivo.
      const arquivos = registro
        .slice(fim + 1)
        .replace(/^\n/, "")
        .split("\0")
        .filter(Boolean);
      return { hash, pais: pais.split(" ").filter(Boolean), data, mensagem, arquivos };
    });
}

const MERGE_DE_PR = /^(?:Merge pull request #|Merged PR )(\d+)/;
const SQUASH_DE_PR = /\(#(\d+)\)$/;

/** Os commits que o PR trouxe: busca em largura a partir do 2º pai do merge, que para nos `vistos` e fora do log. */
function* trazidos(fila: string[], porHash: Map<string, Registro>, vistos: Set<string>): Generator<string> {
  // A fila cresce durante o for-of, que visita também o que entra nela.
  for (const hash of fila) {
    const registro = porHash.get(hash);
    if (registro === undefined || vistos.has(hash)) continue;
    vistos.add(hash);
    yield hash;
    fila.push(...registro.pais);
  }
}

/**
 * PR de cada commit do log, pela linha first-parent da `ponta`, do mais antigo ao mais novo: o merge de PR dá o número
 * aos commits que trouxe (pelo 2º pai) e que nenhum merge anterior trouxe; o commit com `(#N)` no fim do assunto é
 * squash. Quem não aparece no resultado foi direto na base.
 */
export function prsDos(registros: Registro[], ponta: string): Map<string, string> {
  const porHash = new Map(registros.map((r) => [r.hash, r]));
  const linha: Registro[] = [];
  for (let r = porHash.get(ponta); r !== undefined; r = porHash.get(r.pais[0] ?? "")) linha.unshift(r);
  // A linha principal nunca é "trazida" por um PR: a busca para quando encontra uma dela.
  const vistos = new Set(linha.map((r) => r.hash));
  const prs = new Map<string, string>();
  for (const r of linha) {
    const merge = MERGE_DE_PR.exec(r.mensagem)?.[1];
    if (r.pais.length > 1 && merge !== undefined) {
      for (const hash of trazidos(r.pais.slice(1, 2), porHash, vistos)) prs.set(hash, merge);
    } else if (r.pais.length < 2) {
      const squash = SQUASH_DE_PR.exec(r.mensagem)?.[1];
      if (squash !== undefined) prs.set(r.hash, squash);
    }
  }
  return prs;
}

/** Pastas e arquivos de hoje: a raiz e o nó de cada caminho, para cada arquivo e cada commit achar o seu sem varrer a árvore. */
function arvoreDe(nomeDaRaiz: string, arquivos: string[]): { raiz: Pasta; nos: Map<string, NoDoHeatmap> } {
  const raiz: Pasta = { nome: nomeDaRaiz, alteracoes: 0, filhos: [] };
  const nos = new Map<string, NoDoHeatmap>([["", raiz]]);
  for (const arquivo of arquivos) {
    const nomes = arquivo.split("/");
    let pai = raiz;
    let caminho = "";
    nomes.forEach((nome, i) => {
      caminho = caminho === "" ? nome : `${caminho}/${nome}`;
      let no = nos.get(caminho);
      if (no === undefined) {
        no = { nome, alteracoes: 0, ...(i === nomes.length - 1 ? { commits: [] } : { filhos: [] }) };
        nos.set(caminho, no);
        // Cada pai é pasta: só o último nome do caminho é arquivo.
        pai.filhos.push(no);
      }
      pai = no as Pasta;
    });
  }
  return { raiz, nos };
}

/** A árvore dos `arquivos` de hoje, com os commits não-merge do `log` que tocam cada um e os totais de baixo para cima. */
export function montar(
  nomeDaRaiz: string,
  arquivos: string[],
  log: Registro[],
  prs: Map<string, string>,
): Pick<Heatmap, "raiz" | "commits"> {
  const { raiz, nos } = arvoreDe(nomeDaRaiz, arquivos);
  const commits: Record<string, CommitDoHeatmap> = {};
  for (const { hash, pais, data, mensagem, arquivos: tocados } of log) {
    if (pais.length > 1) continue;
    for (const arquivo of tocados) {
      const commitsDoArquivo = nos.get(arquivo)?.commits;
      if (commitsDoArquivo === undefined) continue;
      commitsDoArquivo.push(hash);
      commits[hash] = { hash, mensagem, data, pr: prs.get(hash) ?? null };
    }
  }
  somar(raiz);
  return { raiz, commits };
}

/** Soma os totais das pastas de baixo para cima e as ordena: mais alterações primeiro, empate por nome. */
function somar(no: NoDoHeatmap): number {
  if (no.commits === undefined) {
    const { filhos } = no as Pasta;
    no.alteracoes = filhos.reduce((total, filho) => total + somar(filho), 0);
    filhos.sort((a, b) => b.alteracoes - a.alteracoes || a.nome.localeCompare(b.nome));
  } else {
    no.alteracoes = no.commits.length;
  }
  return no.alteracoes;
}

/**
 * F5 §11: lê a base publicada (`refs/remotes/origin/<branchBase>`, sem fetch) e conta, por arquivo de hoje, os commits
 * não-merge dos 12 meses até `agora` que o tocam. Só lê: roda fora da fila do projeto.
 */
export async function heatmapDo(projeto: Pick<Projeto, "repo" | "branchBase">, agora = new Date()): Promise<Heatmap> {
  const { repo, branchBase } = projeto;
  if (!existsSync(repo)) {
    throw new ErroDeRegra(
      `o repositório ${repo} não existe mais no disco`,
      "corrija o caminho do repositório do projeto na Configuração",
    );
  }
  const ref = `refs/remotes/origin/${branchBase}`;
  const ponta = await git(repo, "rev-parse", "--verify", "--quiet", `${ref}^{commit}`);
  if (ponta.codigo !== 0) {
    throw new ErroDeRegra(
      `a branch base ${branchBase} não existe em ${repo}`,
      `busque-a com git fetch origin ${branchBase} ou corrija a branch base na Configuração`,
    );
  }
  const desde = new Date(agora);
  desde.setUTCMonth(desde.getUTCMonth() - MESES_DA_JANELA);
  const arquivos = (await exigirGit(repo, "ls-tree", "-r", "-z", "--name-only", ref)).split("\0").filter(Boolean);
  const log = lerLog(
    await exigirGit(
      repo,
      "-c",
      "core.quotePath=false",
      "log",
      "--no-show-signature",
      "-z",
      `--since=${desde.toISOString()}`,
      "--format=%x1e%H%x1f%P%x1f%cI%x1f%s",
      "--name-only",
      ref,
    ),
  );
  return {
    branch: branchBase,
    desde: desde.toISOString(),
    ate: agora.toISOString(),
    ...montar(basename(repo), arquivos, log, prsDos(log, ponta.saida.trim())),
  };
}
