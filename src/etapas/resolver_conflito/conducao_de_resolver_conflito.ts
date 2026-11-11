// A condução do `resolver_conflito`: o mesmo ciclo do `implementar`, na worktree da demanda; ao concluir, o encerramento
// da demanda tem o merge resolvido e o agendador o tenta de novo.
import { FABRIQUINHA } from "../../fluxo/nucleo/ator.ts";
import { encontrado } from "../../compartilhado/nucleo/erros.ts";
import { DEFINICAO_DO_RESOLVER_CONFLITO } from "./definicao.ts";
import type { Endereco } from "../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { concluirResolucaoConflito } from "../../fluxo/nucleo/transicoes/transicoes_encerramento.ts";
import { comDemanda } from "../../demanda/armazenamento/demandas.ts";
import { commitDoTicketDemanda } from "../../demanda/armazenamento/commits_demanda.ts";
import type { DepsDaConducao } from "../conducao/conducao_de_etapa.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "../implementar/conducao_de_implementar.ts";

export class ConducaoDeResolverConflito extends ConducaoDeImplementar {
  constructor(deps: DepsDaConducao, opcoes: OpcoesDaImplementacao = {}) {
    super(deps, opcoes, DEFINICAO_DO_RESOLVER_CONFLITO);
  }

  protected override aoConcluir(endereco: Endereco): Promise<void> {
    const { banco, relogio } = this.deps;
    const ticket = this.ticketDe(endereco);
    const { sha } = encontrado(
      commitDoTicketDemanda(banco, ticket.demanda_id, ticket.ticket_id),
      `o ticket ${endereco.toString()} não tem commit registrado`,
      "o commit da resolução é gravado antes da conclusão",
    );
    comDemanda(banco, ticket.demanda_id, (ag) =>
      concluirResolucaoConflito(
        ag,
        { demanda_id: ticket.demanda_id, testes: true, fitness: true, sonar: true, sha },
        FABRIQUINHA,
        { agora: relogio.agora() },
      ),
    );
    return Promise.resolve();
  }
}
