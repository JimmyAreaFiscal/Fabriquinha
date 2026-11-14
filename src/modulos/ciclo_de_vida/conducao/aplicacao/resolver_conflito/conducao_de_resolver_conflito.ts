// A condução do `resolver_conflito`: o mesmo ciclo do `implementar`, na worktree da demanda; ao concluir, o encerramento
// da demanda tem o merge resolvido e o agendador o tenta de novo.
import { DEFINICAO_DO_RESOLVER_CONFLITO, type Endereco, FABRIQUINHA } from "../../../etapas/publico.ts";
import { encontrado } from "../../../../../shared/nucleo/erros.ts";
import { concluirResolucaoDoConflito } from "../../../processo/publico.ts";
import type { DepsDaConducao } from "../conducao_de_etapa/conducao_de_etapa.ts";
import { ConducaoDeImplementar, type OpcoesDaImplementacao } from "../implementar/conducao_de_implementar.ts";

export class ConducaoDeResolverConflito extends ConducaoDeImplementar {
  constructor(deps: DepsDaConducao, opcoes: OpcoesDaImplementacao = {}) {
    super(deps, opcoes, DEFINICAO_DO_RESOLVER_CONFLITO);
  }

  protected override aoConcluir(endereco: Endereco): Promise<void> {
    const { banco, relogio, repositorio } = this.deps;
    const ticket = this.ticketDe(endereco);
    const { commits } = repositorio.metricas({ demandas: [ticket.demanda_id], periodo: {} });
    const { sha } = encontrado(
      commits.find((commit) => commit.ticket_id === ticket.ticket_id),
      `o ticket ${endereco.toString()} não tem commit registrado`,
      "o commit da resolução é gravado antes da conclusão",
    );
    concluirResolucaoDoConflito(
      banco,
      ticket.demanda_id,
      { demanda_id: ticket.demanda_id, testes: true, fitness: true, sonar: true, sha },
      FABRIQUINHA,
      relogio,
    );
    return Promise.resolve();
  }
}
