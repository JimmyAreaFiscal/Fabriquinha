// A condução do `revisar_rodada`: a Fabriquinha roda a fitness e grava as evidências dela antes do pi; o resultado é a
// Decisão do `GateDaRevisaoDaRodada`, que o revisor registra pelo CLI.
import type { TicketDemanda } from "../../../../demanda/nucleo/agregado_demanda.ts";
import { CATALOGO_DE_ETAPAS } from "../../../nucleo/etapa.ts";
import { prepararRevisaoRodada } from "../../../../qualidade/aplicacao/revisao_rodada.ts";
import { ConducaoAgentica, type DepsDaConducao } from "./conducao_de_etapa.ts";

export class ConducaoDeRevisarRodada extends ConducaoAgentica {
  constructor(deps: DepsDaConducao) {
    super(CATALOGO_DE_ETAPAS.revisar_rodada, deps);
  }

  protected override prepararEspaco(ticket: TicketDemanda): ReturnType<typeof prepararRevisaoRodada> {
    return prepararRevisaoRodada(this.deps.banco, ticket);
  }

  // A Decisão do gate já concluiu o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }
}
