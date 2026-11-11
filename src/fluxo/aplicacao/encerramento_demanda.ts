// Publicação do PR final da demanda no `encerrar_demanda`; os passos do encerramento estão em
// `etapas/conducao_de_encerrar_demanda.ts`.
import type { DatabaseSync } from "node:sqlite";
import { type AgregadoDemanda, prDaDemanda } from "../../demanda/nucleo/agregado_demanda.ts";
import { ErroDeRegra } from "../../compartilhado/nucleo/erros.ts";
import type { Projeto } from "../../projeto/nucleo/projeto.ts";
import { commitDoTicketDemanda } from "../../demanda/armazenamento/commits_demanda.ts";
import { publicarPRDe } from "../../repositorio/infra/hospedagem/pr.ts";
import { exigirGit } from "../../repositorio/infra/worktree/worktree.ts";
import {
  corpoDoPRFinal,
  marcaDoPRFinal,
  tituloDoPRFinal,
} from "../../qualidade/aplicacao/pull_request/encerramento_demanda.ts";

/** Publica o PR da branch da demanda para a base, reaproveitando o do progresso ou o marcado; só commits de ticket sobem. */
export function publicarPRFinal(
  banco: DatabaseSync,
  ag: AgregadoDemanda,
  projeto: Pick<Projeto, "nome" | "raiz_git" | "hospedagem">,
  base: string,
  raiz: string,
) {
  const { demanda } = ag;
  const prFinal = prDaDemanda(ag);
  const registrados = new Set(ag.tickets.map((t) => commitDoTicketDemanda(banco, demanda.id, t.ticket_id)?.sha));
  const conferirCommits = async (head: string) => {
    // Os commits da base já estão no remoto; a ponta dele vem fresca para a comparação.
    await exigirGit(projeto.raiz_git, "fetch", "origin", base);
    const novos = await exigirGit(projeto.raiz_git, "rev-list", "--no-merges", `refs/remotes/origin/${base}..${head}`);
    const orfao = novos.split("\n").find((sha) => sha !== "" && !registrados.has(sha));
    if (orfao === undefined) return;
    throw new ErroDeRegra(
      `a branch ${demanda.branch} tem o commit ${orfao.slice(0, 12)}, que nenhum ticket da ${demanda.id} registrou: ` +
        "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
      `desfaça-o na worktree da demanda e reabra o ticket`,
    );
  };
  return publicarPRDe(
    raiz,
    projeto,
    { branch: demanda.branch, base, publicarBase: false },
    {
      titulo: tituloDoPRFinal(ag),
      corpo: corpoDoPRFinal(ag),
      conhecidos: prFinal ? [String(prFinal.numero)] : [],
      marca: marcaDoPRFinal(demanda.id),
    },
    conferirCommits,
  );
}
