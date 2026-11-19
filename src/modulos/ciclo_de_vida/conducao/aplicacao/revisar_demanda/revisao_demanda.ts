// Revisão da demanda: a matriz de fitness que cabe à Fabriquinha antes do pi, rodada na worktree da demanda, onde as
// rodadas integradas aparecem juntas.
import { Endereco, formatarTicketRef } from "../../../etapas/publico.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import type { Ambiente } from "../../../../ambiente/publico.ts";
import { espacoDoTicket } from "../../../../repositorio/publico.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { carregarDemanda } from "../../../processo/publico.ts";
import { projetosCadastrados } from "../projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";
import { gravarMatrizFitnessDoTicket } from "../revisar_rodada/revisao_rodada.ts";

/**
 * `matriz_fitness` do ticket `revisar_demanda`, gravada como evidência dele (regravar substitui). Devolve o Espaço da
 * demanda que ela preparou para rodar a fitness, o mesmo em que o pi roda.
 */
export async function prepararRevisaoDemanda(
  { banco, repositorio }: Pick<ModulosDoCiclo, "banco" | "repositorio">,
  ref: { demanda_id: string; ticket_id: number },
): Promise<{ pasta: string; ambiente: Ambiente }> {
  const { demanda_id, ticket_id } = ref;
  const ag = carregarDemanda(banco, demanda_id);
  const ticket = encontrado(
    ag.tickets.find((t) => t.ticket_id === ticket_id),
    `o ticket ${formatarTicketRef(ref)} não existe`,
    "use um ticket da demanda",
  );
  const projeto = projetosCadastrados().carregarProjeto(banco, ag.demanda.projeto);

  const raiz = raizDo(banco);
  const espacoDaDemanda = espacoDoTicket(ag, ticket, projeto, raiz);
  const { pasta: worktree, ambiente } = await repositorio.prepararEspaco(projeto, espacoDaDemanda, `${raiz}/log`);

  await gravarMatrizFitnessDoTicket(banco, {
    etapa: "revisar_demanda",
    projeto,
    ambiente,
    worktree,
    dono: Endereco.doTicket(demanda_id, ticket_id),
  });
  return { pasta: worktree, ambiente };
}
