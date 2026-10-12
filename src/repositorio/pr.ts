// PR da issue (F5 §5): conferência de PR criado fora da Fabriquinha (§5.0), publicação (§5.1) e leitura do estado
// (§5.2) com `gh` ou `az`, no ambiente do serviço, que é o autenticado. Sempre com argumentos em lista: título e corpo nunca viram comando.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { Evidencia, Issue } from "../dominio/agregado.ts";
import { ErroDeRegra, ErroExterno, existe, mensagem } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import type { Hospedagem, Projeto } from "../dominio/projeto.ts";
import { anotar } from "../persistencia/execucoes.ts";
import { executar, LIMITE_COMANDO_MS } from "../processo.ts";
import { caminhoDaWorktree, exigirGit, naFilaDoProjeto } from "./worktree.ts";

/** Um PR da branch da issue, como a hospedagem o lista. */
interface PRNaHospedagem {
  id: string;
  url: string;
  /** `fechado` é sem merge: pode ser reaberto. */
  estado: "aberto" | "fechado" | "mergeado";
  corpo: string;
  /** A branch de destino. */
  base: string;
  /** A branch de origem é de outro repositório (fork) com o mesmo nome. */
  deFork: boolean;
}

/** Os comandos de PR de uma hospedagem (F5 §5.1), rodados em `repo`, de onde o CLI descobre o repositório remoto. */
interface CliDePR {
  listar(repo: string, branch: string): Promise<PRNaHospedagem[]>;
  criar(
    repo: string,
    base: string,
    branch: string,
    titulo: string,
    corpo: string,
  ): Promise<{ id: string; url: string }>;
  atualizar(repo: string, pr: PRNaHospedagem, titulo: string, corpo: string): Promise<{ id: string; url: string }>;
  reabrir(repo: string, id: string): Promise<void>;
  ler(repo: string, id: string): Promise<Omit<LeituraDoPR, "lidoEm">>;
}

/** O estado do PR lido na plataforma (F5 §5.2). */
export interface LeituraDoPR {
  estado: PRNaHospedagem["estado"];
  url: string;
  /** Só no PR mergeado, quando a plataforma informa. */
  mergeadoEm?: string;
  lidoEm: string;
}

/** O ticket falha, e a próxima execução tenta de novo; o gate do PR lê de novo. */
const DE_NOVO = "execute o ticket de novo";

/** Roda o CLI e devolve o stdout; a falha vira ErroExterno com a saída do comando (F3 §6, F5 §5.2). */
async function rodar(cli: "gh" | "az", args: readonly string[], cwd: string, deNovo = DE_NOVO): Promise<string> {
  const r = await executar(cli, args, { cwd, limiteMs: LIMITE_COMANDO_MS });
  if (r.codigo !== 0) {
    // Estouro do limite sai com código null.
    throw new ErroExterno(
      `${cli} ${args.slice(0, cli === "gh" ? 2 : 3).join(" ")} saiu com código ${String(r.codigo)}: ${(r.erro + r.saida).trim()}`,
      `confira o acesso do ${cli} à hospedagem e ${deNovo}`,
    );
  }
  return r.saida;
}

/** A saída JSON do CLI no formato esperado, ou ErroExterno com o que veio. */
function lerJson<T>(saida: string, schema: z.ZodType<T>, comando: string, deNovo = DE_NOVO): T {
  let json: unknown;
  try {
    json = JSON.parse(saida);
  } catch {
    json = undefined;
  }
  const r = schema.safeParse(json);
  if (!r.success) {
    throw new ErroExterno(
      `saída inesperada de ${comando}: ${saida.trim().slice(0, 500)}`,
      `confira a versão do CLI e ${deNovo}`,
    );
  }
  return r.data;
}

/** `gh` lê o corpo de um arquivo (`--body-file`): o corpo do GitHub chega a 65.536 caracteres. */
async function comCorpo<T>(corpo: string, trabalho: (arquivo: string) => Promise<T>): Promise<T> {
  const pasta = mkdtempSync(join(tmpdir(), "fabriquinha-pr-"));
  try {
    writeFileSync(join(pasta, "corpo.md"), corpo, { mode: 0o600 });
    return await trabalho(join(pasta, "corpo.md"));
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

const ListaGh = z.array(
  z.object({
    number: z.number(),
    url: z.string(),
    state: z.string(),
    body: z.string(),
    baseRefName: z.string(),
    isCrossRepository: z.boolean(),
  }),
);
type EstadoNaHospedagem = PRNaHospedagem["estado"];
const ESTADO_GH = new Map<string, EstadoNaHospedagem>([
  ["OPEN", "aberto"],
  ["CLOSED", "fechado"],
  ["MERGED", "mergeado"],
]);
const ESTADO_AZ = new Map<string, EstadoNaHospedagem>([
  ["active", "aberto"],
  ["abandoned", "fechado"],
  ["completed", "mergeado"],
]);

/** O estado do PR no vocabulário da Fabriquinha; um estado que ela não conhece nunca vira "aberto" por engano. */
function estadoDe(cli: "gh" | "az", mapa: ReadonlyMap<string, EstadoNaHospedagem>, valor: string): EstadoNaHospedagem {
  const estado = mapa.get(valor);
  if (estado === undefined) {
    throw new ErroExterno(
      `o ${cli} devolveu um estado de PR que a Fabriquinha não conhece: ${valor}`,
      `confira a versão do ${cli}; os estados conhecidos são ${[...mapa.keys()].join(", ")}`,
    );
  }
  return estado;
}
/** Lido no gate do PR: a falha não é de ticket. */
const LER_DE_NOVO = "leia o estado do PR de novo";
const DataDaPlataforma = z.iso.datetime({ offset: true });
/** A data da plataforma no formato do domínio, só no PR mergeado que a traz. */
const mergeadoEm = (estado: PRNaHospedagem["estado"], data: string | null | undefined) =>
  estado === "mergeado" && data ? { mergeadoEm: new Date(data).toISOString() } : {};
const PrGh = z.object({ state: z.string(), url: z.string(), mergedAt: DataDaPlataforma.nullable() });

const github: CliDePR = {
  async listar(repo, branch) {
    const campos = "number,url,state,body,baseRefName,isCrossRepository";
    const args = ["pr", "list", "--head", branch, "--state", "all", "--json", campos];
    return lerJson(await rodar("gh", args, repo), ListaGh, "gh pr list").map((p) => ({
      id: String(p.number),
      url: p.url,
      estado: estadoDe("gh", ESTADO_GH, p.state),
      corpo: p.body,
      base: p.baseRefName,
      deFork: p.isCrossRepository,
    }));
  },
  criar: (repo, base, branch, titulo, corpo) =>
    comCorpo(corpo, async (arquivo) => {
      const args = ["pr", "create", "--base", base, "--head", branch, "--title", titulo, "--body-file", arquivo];
      // O gh imprime a URL do PR criado na última linha.
      const url = String((await rodar("gh", args, repo)).trim().split("\n").at(-1));
      const id = /\/pull\/(\d+)$/.exec(url)?.[1];
      if (id === undefined) {
        throw new ErroExterno(`saída inesperada de gh pr create: ${url}`, "confira a versão do gh");
      }
      return { id, url };
    }),
  atualizar: (repo, pr, titulo, corpo) =>
    comCorpo(corpo, async (arquivo) => {
      await rodar("gh", ["pr", "edit", pr.id, "--title", titulo, "--body-file", arquivo], repo);
      return { id: pr.id, url: pr.url };
    }),
  async reabrir(repo, id) {
    await rodar("gh", ["pr", "reopen", id], repo);
  },
  async ler(repo, id) {
    const args = ["pr", "view", id, "--json", "state,url,mergedAt,mergeCommit"];
    const p = lerJson(await rodar("gh", args, repo, LER_DE_NOVO), PrGh, "gh pr view", LER_DE_NOVO);
    const estado = estadoDe("gh", ESTADO_GH, p.state);
    return { estado, url: p.url, ...mergeadoEm(estado, p.mergedAt) };
  },
};

const PrAz = z.object({
  pullRequestId: z.number(),
  status: z.string(),
  description: z.string().nullish(),
  targetRefName: z.string(),
  /** Preenchido quando a branch de origem é de um fork; `null` senão. */
  forkSource: z.unknown().optional(),
  repository: z.object({ webUrl: z.string() }),
  /** `null` enquanto o PR está ativo. */
  closedDate: DataDaPlataforma.nullish(),
});
type PrAz = z.infer<typeof PrAz>;
/** O `url` do az é o da API; o da página do PR sai do repositório. */
const doAz = (p: PrAz) => ({
  id: String(p.pullRequestId),
  url: `${p.repository.webUrl}/pullrequest/${String(p.pullRequestId)}`,
});

const azure: CliDePR = {
  async listar(repo, branch) {
    const args = ["repos", "pr", "list", "--detect", "true", "--source-branch", branch, "--status", "all"];
    return lerJson(await rodar("az", [...args, "--output", "json"], repo), z.array(PrAz), "az repos pr list").map(
      (p) => ({
        ...doAz(p),
        estado: estadoDe("az", ESTADO_AZ, p.status),
        corpo: p.description ?? "",
        base: p.targetRefName.replace(/^refs\/heads\//, ""),
        deFork: p.forkSource != null,
      }),
    );
  },
  async criar(repo, base, branch, titulo, corpo) {
    const args = ["repos", "pr", "create", "--detect", "true", "--source-branch", branch, "--target-branch", base];
    const saida = await rodar("az", [...args, "--title", titulo, "--description", corpo, "--output", "json"], repo);
    return doAz(lerJson(saida, PrAz, "az repos pr create"));
  },
  async atualizar(repo, pr, titulo, corpo) {
    const args = ["repos", "pr", "update", "--id", pr.id, "--title", titulo, "--description", corpo];
    return doAz(lerJson(await rodar("az", [...args, "--output", "json"], repo), PrAz, "az repos pr update"));
  },
  async reabrir(repo, id) {
    await rodar("az", ["repos", "pr", "update", "--id", id, "--status", "active"], repo);
  },
  async ler(repo, id) {
    const saida = await rodar("az", ["repos", "pr", "show", "--id", id, "--output", "json"], repo, LER_DE_NOVO);
    const p = lerJson(saida, PrAz, "az repos pr show", LER_DE_NOVO);
    const estado = estadoDe("az", ESTADO_AZ, p.status);
    return { url: doAz(p).url, estado, ...mergeadoEm(estado, p.closedDate) };
  },
};

const CLIS: Readonly<Record<Hospedagem, CliDePR>> = { github, "azure-devops": azure };

/**
 * F5 §5.0 e §5.1: publica o PR da branch `fabriquinha/I-<issue>` com `titulo` e `corpo` (já condensado ao limite da
 * hospedagem) e devolve o número, a URL, a branch e o commit publicado.
 *
 * 1. Conferência: lista os PRs da branch. É da Fabriquinha o PR que é um dos `conhecidos` (os ids das evidências
 *    `pr_aberto` da issue, em ordem) ou o adotável: traz a `marca` deste ticket, vai para `branchBase`, sai deste
 *    repositório, não de um fork, e não foi mergeado. Qualquer outro foi criado fora: aberto ou mergeado, a publicação falha antes do push;
 *    fechado sem merge, não barra, que é o que a mensagem pede ao Auditor.
 * 2. Na fila git do projeto: a branch precisa estar num commit que um ticket de desenvolvimento registrou
 *    (`registrado`); commit do agente na revisão ou no encerramento não sobe. Depois, o push.
 * 3. `varrerBase` (F6 §4.4), que busca a base; a falha da varredura só vai para o `log`.
 * 4. Atualiza o PR conhecido mais recente ou, sem ele, o adotável, reabrindo-o antes se estiver fechado; sem nenhum,
 *    cria.
 *
 * Retomada: se o PR saiu, mas o registro de `pr_aberto` falhou, o PR fica fora dos conhecidos. A marca
 * (`marcaDoPR`, com o ticket de encerramento) o identifica na próxima execução do mesmo ticket, que o adota em vez de
 * barrar o encerramento para sempre. Ticket concluído não executa de novo, e o encerramento só conclui com
 * `pr_aberto`: a marca de um ticket em execução fora dos conhecidos é sempre deste caso.
 * ponytail: a marca é forjável por um agente que já furou as duas primeiras camadas do F5 §5.0, como a do commit
 * órfão (F5 §4); base e repositório de origem conferidos, o PR adotado é o que a Fabriquinha criaria, e o título e o
 * corpo são trocados inteiros.
 */
export async function publicarPR(
  raiz: string,
  projeto: Pick<Projeto, "nome" | "repo" | "branchBase" | "hospedagem">,
  issue: Id,
  pr: {
    titulo: string;
    corpo: string;
    conhecidos: readonly string[];
    marca: string;
    registrado: (sha: string) => boolean;
  },
  varrerBase: () => Promise<void>,
  log: string,
): Promise<{ id: string; url: string; branch: string; head: string }> {
  const { repo } = projeto;
  const cli = CLIS[projeto.hospedagem];
  const rotulo = `I-${String(issue)}`;
  const branch = `fabriquinha/${rotulo}`;

  const existentes = await cli.listar(repo, branch);
  // Mergeado não é adotável: o código já entrou na base sem passar pelo encerramento.
  const adotavel = (p: PRNaHospedagem) =>
    p.corpo.includes(pr.marca) && p.base === projeto.branchBase && !p.deFork && p.estado !== "mergeado";
  const deFora = existentes.filter((p) => !pr.conhecidos.includes(p.id) && !adotavel(p));
  const mergeado = deFora.find((p) => p.estado === "mergeado");
  if (mergeado) {
    throw new ErroDeRegra(
      `PR criado fora da Fabriquinha e já mergeado: ${mergeado.url}`,
      "a Fabriquinha não publica sobre ele; o Auditor resolve na plataforma, revertendo o merge se o código não " +
        "devia ter entrado, e decide o destino da issue",
    );
  }
  const aberto = deFora.find((p) => p.estado === "aberto");
  if (aberto) throw new ErroDeRegra(`PR criado fora da Fabriquinha: ${aberto.url}`, "feche-o e reabra o ticket");

  const head = await naFilaDoProjeto(raiz, projeto.nome, async () => {
    const sha = (await exigirGit(repo, "rev-parse", `refs/heads/${branch}`)).trim();
    if (!pr.registrado(sha)) {
      throw new ErroDeRegra(
        `a branch ${branch} está no commit ${sha.slice(0, 12)}, que nenhum ticket de desenvolvimento da ${rotulo} ` +
          "registrou: um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
        `desfaça com git -C ${caminhoDaWorktree(raiz, projeto.nome, issue)} reset --hard HEAD~1, repetindo até a ` +
          `HEAD ser um commit [${rotulo}/T-<m>] da Fabriquinha, e reabra o ticket`,
      );
    }
    await exigirGit(repo, "push", "-u", "origin", `refs/heads/${branch}:refs/heads/${branch}`);
    return sha;
  });
  // Fora da fila: a varredura entra nela por conta própria.
  await varrerBase().catch((error_: unknown) => {
    anotar(log, `varrerBase falhou: ${mensagem(error_)}`);
  });

  // O conhecido sempre vence: um adotável mais novo só conta quando a issue ainda não registrou PR algum.
  const alvo = existentes.find((p) => p.id === pr.conhecidos.at(-1)) ?? existentes.find(adotavel);
  if (!alvo) return { ...(await cli.criar(repo, projeto.branchBase, branch, pr.titulo, pr.corpo)), branch, head };
  if (alvo.estado === "fechado") await cli.reabrir(repo, alvo.id);
  return { ...(await cli.atualizar(repo, alvo, pr.titulo, pr.corpo)), branch, head };
}

/**
 * F5 §5.2: o estado do PR da issue (o da última evidência `pr_aberto`, a fonte única do PR), lido agora na
 * plataforma. Uma falha do `gh` ou do `az` lança ErroExterno com a saída do comando; nada é gravado.
 */
export async function estadoPR(
  projeto: Pick<Projeto, "repo" | "hospedagem">,
  ag: { issue: Pick<Issue, "id">; evidencias: readonly Pick<Evidencia, "tipo" | "dados">[] },
): Promise<LeituraDoPR> {
  const pr = existe(
    ag.evidencias.findLast((e) => e.tipo === "pr_aberto"),
    `a I-${String(ag.issue.id)} ainda não tem PR`,
    "o encerramento publica o PR",
  );
  const leitura = await CLIS[projeto.hospedagem].ler(projeto.repo, pr.dados.id as string);
  return { ...leitura, lidoEm: new Date().toISOString() };
}
