// A condução do `resolver_conflito`: o mesmo ciclo do `implementar`, na worktree da demanda; ao concluir, o encerramento
// da demanda tem o merge resolvido e o agendador o tenta de novo.
import { FABRIQUINHA } from "../../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import { encontrado } from "../../compartilhado/nucleo/erros.ts";
import { DEFINICAO_DO_RESOLVER_CONFLITO } from "./definicao.ts";
import type { Endereco } from "../../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { concluirResolucaoConflito } from "../../sdlc/nucleo/transicoes/transicoes_encerramento.ts";
import { comDemanda } from "../../sdlc/armazenamento/demandas.ts";
import { commitDoTicketDemanda } from "../../sdlc/armazenamento/commits_demanda.ts";
import type { DepsDaConducao } from "../../sdlc/aplicacao/despacho/despacho.ts";
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
