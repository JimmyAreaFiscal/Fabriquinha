// Commits humanos posteriores (F6 §4): que linhas escritas por um ticket de desenvolvimento foram removidas ou
// reescritas depois, por commit de outro ticket (4.2) ou por commit humano na branch base (4.4).
import type { DatabaseSync } from "node:sqlite";
import { raizDo } from "../../../../shared/armazenamento/banco.ts";
import {
  commitRegistradoDemanda,
  donoDoCommitDemanda,
  gravarCommitsPosterioresDoTicket,
  type LinhasPorDemanda,
} from "../armazenamento/commits_demanda.ts";
import { type CommitHumano, cursorDaBase, gravarVarredura, projetosAVarrer } from "../armazenamento/commits_humanos.ts";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { noLog } from "../../../../shared/infra/registro.ts";
import {
  buscarBaseRemota,
  commitsNovosDaBase,
  cursorSaiuDaHistoria,
  linhasReescritasPorCommitDeOrigem,
} from "../infra/commits_humanos.ts";
import { naFilaDoProjeto, type ProjetoDoRepositorio } from "../../git/publico.ts";

/**
 * As linhas por commit de origem viram linhas por ticket das demandas, agrupadas pela demanda de origem; commit fora da
 * Fabriquinha (humano ou anterior) não conta.
 */
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
 * F6 §4.2: refaz os commits posteriores do commit `sha` do ticket da demanda, contra o primeiro pai: lê
 * `commit_ticket_demanda` e grava `commit_humano_posterior`. Roda no repositório do projeto, que tem os objetos da
 * worktree e continua lá quando ela é removida, e na fila git do projeto (F5 §6).
 */
export async function registrarCommitsHumanosDoTicket(
  banco: DatabaseSync,
  projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git">,
  demandaId: string,
  ticketId: number,
  sha: string,
): Promise<void> {
  const porCommit = await naFilaDoProjeto(raizDo(banco), projeto.nome, () =>
    linhasReescritasPorCommitDeOrigem(projeto.raiz_git, `${sha}^`, sha),
  );
  const linhas = dosTicketsDemanda(banco, porCommit);
  // Um commit por ticket: o pai nunca tem linha do próprio ticket; a guarda só protege o CHECK da tabela.
  linhas.get(demandaId)?.delete(ticketId);
  gravarCommitsPosterioresDoTicket(banco, demandaId, ticketId, sha, linhas);
}

/**
 * F6 §4.4: busca a base e conta, nos commits novos dela que não são de ticket nem merge, as linhas de tickets que eles
 * reescreveram, com o autor de cada commit; o cursor avança na mesma transação. Sem cursor, só grava o atual. Com a
 * história reescrita (o cursor deixou de ser ancestral), recomeça do atual e avisa no log do serviço. Os comandos git
 * rodam no repositório principal, na fila do projeto (F5 §6), como a criação de worktree e o commit.
 */
export async function varrerCommitsHumanos(
  banco: DatabaseSync,
  projeto: Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">,
): Promise<void> {
  const { nome, raiz_git, branch_base } = projeto;
  await naFilaDoProjeto(raizDo(banco), nome, async () => {
    const atual = await buscarBaseRemota(raiz_git, branch_base);
    const cursor = cursorDaBase(banco, nome);
    const humanos: CommitHumano[] = [];
    if (cursor !== undefined && (await cursorSaiuDaHistoria(raiz_git, cursor, atual))) {
      noLog(
        `a base ${branch_base} do projeto ${nome} foi reescrita ` +
          `(force-push): o cursor ${cursor} saiu da história, e a varredura recomeça de ${atual}`,
      );
    } else if (cursor !== undefined) {
      for (const { sha, primeiroPai, autor } of await commitsNovosDaBase(raiz_git, cursor, atual)) {
        // Commit de ticket já contou em 4.2; commit raiz (história sem relação trazida por merge) não reescreve nada.
        if (commitRegistradoDemanda(banco, sha) || primeiroPai === "") continue;
        const porCommit = await linhasReescritasPorCommitDeOrigem(raiz_git, primeiroPai, sha);
        humanos.push({ sha, autor, linhas: dosTicketsDemanda(banco, porCommit) });
      }
    }
    gravarVarredura(banco, nome, atual, humanos);
  });
}

/**
 * F4 §4, passo 1: varre, um por vez, cada projeto sem varredura há 24 horas; a falha de um vai a `registrarErro` e não
 * impede os outros. O projeto é relido na hora da sua varredura: o removido no meio da fila sai dela, e o
 * reconfigurado vale como está agora.
 */
export async function varrerBasesVencidas(
  banco: DatabaseSync,
  projetos: () => readonly Pick<ProjetoDoRepositorio, "nome" | "raiz_git" | "branch_base">[],
  relogio: Relogio,
  registrarErro: (erro: unknown) => void,
): Promise<void> {
  for (const nome of projetosAVarrer(
    banco,
    projetos().map((projeto) => projeto.nome),
    relogio,
  )) {
    const projeto = projetos().find((cadastrado) => cadastrado.nome === nome);
    if (projeto) await varrerCommitsHumanos(banco, projeto).catch(registrarErro);
  }
}
