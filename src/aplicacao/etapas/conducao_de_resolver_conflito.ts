// A condução do `resolver_conflito`: o mesmo ciclo do `implementar`, na worktree da demanda; ao concluir, o encerramento
// da demanda tem o merge resolvido e o agendador o tenta de novo.
import { FABRIQUINHA } from "../../nucleo/ator.ts";
import { encontrado } from "../../nucleo/erros.ts";
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import type { Endereco } from "../../nucleo/item_de_trabalho.ts";
import { concluirResolucaoConflito } from "../../nucleo/transicoes_encerramento.ts";
import { comDemanda } from "../../armazenamento/demandas.ts";
import { commitDoTicketDemanda } from "../../armazenamento/commits_demanda.ts";
import type { DepsDaConducao } from "./conducao_de_etapa.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "./conducao_de_implementar.ts";

export class ConducaoDeResolverConflito extends ConducaoDeImplementar {
  constructor(deps: DepsDaConducao, opcoes: OpcoesDaImplementacao = {}) {
    super(deps, opcoes, CATALOGO_DE_ETAPAS.resolver_conflito);
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
        relogio(),
      ),
    );
    return Promise.resolve();
  }
}
