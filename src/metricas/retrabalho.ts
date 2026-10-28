// Retrabalho (F6 §4): que linhas escritas por um ticket de desenvolvimento foram removidas ou reescritas depois, por
// commit de outro ticket (4.2) ou por commit humano na branch base (4.4).
import type { DatabaseSync } from "node:sqlite";
import { ErroDeInexistente, ErroDeRegra } from "../dominio/erros.ts";
import type { Id } from "../dominio/primitivos.ts";
import { raizDo } from "../persistencia/banco.ts";
import { ticketDoCommit } from "../persistencia/commits.ts";
import {
  commitRegistradoDemanda,
  donoDoCommitDemanda,
  gravarRetrabalhoDoTicket,
  type LinhasPorDemanda,
} from "../persistencia/commits_demanda.ts";
import { noLog } from "../persistencia/execucoes.ts";
import { agregadoDoTicket } from "../persistencia/issues.ts";
import { projeto as lerProjeto } from "../persistencia/projetos.ts";
import { type CommitHumano, cursorDaBase, gravarRetrabalho, gravarVarredura } from "../persistencia/retrabalho.ts";
import { executar, git, LIMITE_COMANDO_MS } from "../processo.ts";
import { exigirGit, naFilaDoProjeto } from "../repositorio/worktree.ts";

/** Cabeçalho de hunk do `-U0`: `@@ -início[,quantidade] ...`, sem quantidade quando é uma linha só. */
const HUNK = /^@@ -(\d+)(?:,(\d+))? /gm;
/** Cabeçalho de cada linha no blame porcelain: `<sha> <linha antes> <linha depois>`; o conteúdo vem após um tab. */
const LINHA_BLAME = /^([\da-f]{40}(?:[\da-f]{24})?) \d+ \d+/gm;
/** Modo do lado antigo no `--raw`: o arquivo não existia, ou é um submódulo, que não tem linhas. */
const SEM_LINHAS = new Set(["000000", "160000"]);

/**
 * `git blame` sem a configuração global: ele não precisa dela, e um `blame.ignoreRevsFile` global que aponta para um
 * arquivo que o repositório não tem o faz falhar (`could not open object name list`), sem que `-c` ou
 * `--ignore-revs-file=` o desliguem.
 * ponytail: o mesmo `blame.ignoreRevsFile` na configuração do próprio repositório, sem o arquivo, ainda falha.
 */
async function blame(repo: string, args: string[]): Promise<string> {
  const r = await executar("git", ["-C", repo, "blame", ...args], {
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
    limiteMs: LIMITE_COMANDO_MS,
  });
  if (r.codigo !== 0) {
    throw new ErroDeRegra(
      `git blame falhou em ${repo}: ${r.erro.trim()}`,
      "corrija o repositório; o relatório refaz a conta",
    );
  }
  return r.saida;
}

/**
 * F6 §4.2, passos 1 a 3: quantas linhas de cada ticket o commit `sha` removeu ou reescreveu em relação a `pai`.
 * O `--raw -z` lista os arquivos com os caminhos crus; o diff `-U0` de cada um dá os intervalos removidos, e o blame
 * do caminho antigo em `pai`, o commit de origem de cada linha. Arquivo binário não tem hunk e fica de fora.
 * ponytail: mudança só de espaço conta; com formatador inflando o número, passar `-w` no diff e no blame.
 */
async function reescritas(repo: string, pai: string, sha: string): Promise<Map<string, number>> {
  const porCommit = new Map<string, number>();
  const raw = (await exigirGit(repo, "diff", "--raw", "-z", "-M", pai, sha)).split("\0");
  for (let i = 0; raw[i];) {
    // `:<modo antes> <modo depois> <objeto> <objeto> <status>`, e um caminho, ou dois na renomeação.
    const [modoAntes, , , , status] = String(raw[i]).slice(1).split(" ");
    const caminhos = raw.slice(i + 1, i + (status?.startsWith("R") ? 3 : 2));
    i += 1 + caminhos.length;
    if (SEM_LINHAS.has(String(modoAntes))) continue;
    // Sem textconv nem diff externo do repositório: as linhas são as do arquivo versionado.
    const diff = await exigirGit(
      repo,
      "--literal-pathspecs",
      "diff",
      "-U0",
      "-M",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      pai,
      sha,
      "--",
      ...caminhos,
    );
    const intervalos = [...diff.matchAll(HUNK)]
      .filter(([, , quantidade]) => quantidade !== "0")
      .flatMap(([, inicio, quantidade = "1"]) => ["-L", `${String(inicio)},+${quantidade}`]);
    if (intervalos.length === 0) continue;
    const origens = await blame(repo, ["--porcelain", ...intervalos, pai, "--", String(caminhos[0])]);
    for (const [, origem] of origens.matchAll(LINHA_BLAME)) {
      porCommit.set(String(origem), (porCommit.get(String(origem)) ?? 0) + 1);
    }
  }
  return porCommit;
}

/** As linhas por commit de origem viram linhas por ticket; commit fora da Fabriquinha (humano ou anterior) não conta. */
function dosTickets(banco: DatabaseSync, porCommit: Map<string, number>): Map<Id, number> {
  const porTicket = new Map<Id, number>();
  for (const [origem, n] of porCommit) {
    const ticket = ticketDoCommit(banco, origem);
    if (ticket !== undefined) porTicket.set(ticket, (porTicket.get(ticket) ?? 0) + n);
  }
  return porTicket;
}

/** O mesmo, para os tickets das demandas, agrupados pela demanda de origem. */
function dosTicketsDemanda(banco: DatabaseSync, porCommit: Map<string, number>): LinhasPorDemanda {
  const porDemanda: LinhasPorDemanda = new Map();
  for (const [origem, n] of porCommit) {
    const dono = donoDoCommitDemanda(banco, origem);
    if (dono === undefined) continue;
    const tickets = porDemanda.get(dono.demandaId) ?? new Map<number, number>();
    tickets.set(dono.ticketId, (tickets.get(dono.ticketId) ?? 0) + n);
    porDemanda.set(dono.demandaId, tickets);
  }
  return porDemanda;
}

/**
 * F6 §4.2: refaz o retrabalho do commit `sha` do ticket de desenvolvimento, contra o primeiro pai. Idempotente: apaga
 * as linhas em que o ticket é o alterador e grava uma por ticket de origem. Roda no repositório do projeto, que tem os
 * objetos da worktree da issue e continua lá quando ela é removida, e na fila git do projeto (F5 §6).
 */
export async function registrarRetrabalho(banco: DatabaseSync, ticket: Id, sha: string): Promise<void> {
  const ag = agregadoDoTicket(banco, ticket);
  const p = ag && lerProjeto(banco, ag.issue.projeto);
  if (p === undefined) {
    throw new ErroDeInexistente(`o ticket T-${String(ticket)} não existe`, "confira o número do ticket");
  }
  const porCommit = await naFilaDoProjeto(raizDo(banco), p.nome, () => reescritas(p.repo, `${sha}^`, sha));
  const linhas = dosTickets(banco, porCommit);
  // Um commit por ticket (D4): o pai nunca tem linha do próprio ticket; a guarda só protege o CHECK do F6 §7.
  linhas.delete(ticket);
  gravarRetrabalho(banco, ticket, sha, linhas);
}

/** Como `registrarRetrabalho`, para o ticket de uma demanda: lê `commit_ticket_demanda` e grava `retrabalho_demanda`. */
export async function registrarRetrabalhoDemanda(
  banco: DatabaseSync,
  demandaId: string,
  ticketId: number,
  sha: string,
): Promise<void> {
  const projeto = (
    banco.prepare("SELECT projeto FROM demanda WHERE id = ?").get(demandaId) as { projeto: string } | undefined
  )?.projeto;
  const p = projeto === undefined ? undefined : lerProjeto(banco, projeto);
  if (p === undefined) {
    throw new ErroDeInexistente(`a demanda ${demandaId} não existe`, "confira o número da demanda");
  }
  const porCommit = await naFilaDoProjeto(raizDo(banco), p.nome, () => reescritas(p.repo, `${sha}^`, sha));
  const linhas = dosTicketsDemanda(banco, porCommit);
  // Um commit por ticket: o pai nunca tem linha do próprio ticket; a guarda só protege o CHECK da tabela.
  linhas.get(demandaId)?.delete(ticketId);
  gravarRetrabalhoDoTicket(banco, demandaId, ticketId, sha, linhas);
}

/**
 * F6 §4.4: busca a base e conta, nos commits novos dela que não são de ticket nem merge, as linhas de tickets que eles
 * reescreveram, com o autor de cada commit; o cursor avança na mesma transação. Sem cursor, só grava o atual. Com a
 * história reescrita (o cursor deixou de ser ancestral), recomeça do atual e avisa no log do serviço. Os comandos git
 * rodam no repositório principal, na fila do projeto (F5 §6), como a criação de worktree e o commit.
 */
export async function varrerBase(banco: DatabaseSync, projeto: string): Promise<void> {
  const p = lerProjeto(banco, projeto);
  if (p === undefined) throw new ErroDeInexistente(`o projeto ${projeto} não existe`, "cadastre-o na Configuração");
  const ref = `refs/remotes/origin/${p.branchBase}`;
  await naFilaDoProjeto(raizDo(banco), projeto, async () => {
    // Refspec explícita, como na criação de worktree: um branchBase começando com "-" nunca vira opção do git.
    await exigirGit(p.repo, "fetch", "origin", `+refs/heads/${p.branchBase}:${ref}`);
    const atual = (await exigirGit(p.repo, "rev-parse", "--verify", `${ref}^{commit}`)).trim();
    const cursor = cursorDaBase(banco, projeto);
    const humanos: CommitHumano[] = [];
    if (cursor !== undefined && (await git(p.repo, "merge-base", "--is-ancestor", cursor, atual)).codigo !== 0) {
      noLog(
        `a base ${p.branchBase} do projeto ${projeto} foi reescrita ` +
          `(force-push): o cursor ${cursor} saiu da história, e a varredura recomeça de ${atual}`,
      );
    } else if (cursor !== undefined) {
      // `%H`, os pais e o autor, um commit por registro; sem a assinatura que `log.showSignature` poria no meio.
      const log = await exigirGit(
        p.repo,
        "log",
        "--no-merges",
        "--reverse",
        "--no-show-signature",
        "-z",
        "--format=%H%n%P%n%an <%ae>",
        `${cursor}..${atual}`,
      );
      for (const registro of log.split("\0").filter(Boolean)) {
        const [sha = "", pais = "", autor = ""] = registro.split("\n");
        // Commit de ticket já contou em 4.2; commit raiz (história sem relação trazida por merge) não reescreve nada.
        if (commitRegistradoDemanda(banco, sha) || pais === "") continue;
        const porCommit = await reescritas(p.repo, String(pais.split(" ")[0]), sha);
        humanos.push({ sha, autor, linhas: dosTicketsDemanda(banco, porCommit) });
      }
    }
    gravarVarredura(banco, projeto, atual, humanos);
  });
}
