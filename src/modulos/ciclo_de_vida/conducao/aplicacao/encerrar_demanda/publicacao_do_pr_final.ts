// Publicação do PR final da demanda no `encerrar_demanda`; os passos do encerramento estão em
// `conducao_de_encerrar_demanda.ts`.
import { type AgregadoDemanda, prDaDemanda } from "../../../processo/publico.ts";
import { ErroDeRegra } from "../../../../../shared/nucleo/erros.ts";
import { raizDo } from "../../../../../shared/armazenamento/banco.ts";
import { espacoDaDemanda } from "../../../../repositorio/publico.ts";
import { corpoDoPRFinal, marcaDoPRFinal, tituloDoPRFinal } from "./encerramento_demanda.ts";
import type { ProjetoConduzido } from "../projetos_cadastrados.ts";
import type { ModulosDoCiclo } from "../modulos_do_ciclo.ts";

/** Publica o PR da branch da demanda para a base, reaproveitando o do progresso ou o marcado; só commits de ticket sobem. */
export function publicarPRFinal(
  { banco, repositorio }: Pick<ModulosDoCiclo, "banco" | "repositorio">,
  ag: AgregadoDemanda,
  projeto: ProjetoConduzido,
  log: string,
) {
  const { demanda } = ag;
  const prFinal = prDaDemanda(ag);
  return repositorio.publicarPR(
    projeto,
    espacoDaDemanda(projeto, demanda.id, raizDo(banco)),
    {
      titulo: tituloDoPRFinal(ag),
      corpo: corpoDoPRFinal(ag),
      conhecidos: prFinal ? [String(prFinal.numero)] : [],
      marca: marcaDoPRFinal(demanda.id),
      tickets: ag.tickets.map((t) => t.ticket_id),
      recusarCommitOrfao: (orfao) =>
        new ErroDeRegra(
          `a branch ${demanda.branch} tem o commit ${orfao.slice(0, 12)}, que nenhum ticket da ${demanda.id} registrou: ` +
            "um agente commitou fora do desenvolvimento, e esse commit não sobe no PR",
          `desfaça-o na worktree da demanda e reabra o ticket`,
        ),
    },
    log,
  );
}
