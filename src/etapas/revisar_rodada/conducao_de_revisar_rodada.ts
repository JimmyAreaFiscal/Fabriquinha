// A condução do `revisar_rodada`: a Fabriquinha roda a fitness e grava as evidências dela antes do pi; o resultado é a
// Decisão do `GateDaRevisaoDaRodada`, que o revisor registra pelo CLI.
import type { TicketDemanda } from "../../sdlc/nucleo/demanda/agregado_demanda.ts";
import { secaoDoPromptDoRevisarRodada } from "./secao_do_prompt.ts";
import { DEFINICAO_DO_REVISAR_RODADA } from "./definicao.ts";
import { prepararRevisaoRodada } from "./revisao_rodada.ts";
import { ConducaoAgentica } from "../conducao/conducao_de_etapa.ts";
import { type DepsDaConducao } from "../../sdlc/aplicacao/despacho/despacho.ts";

export class ConducaoDeRevisarRodada extends ConducaoAgentica {
  protected override readonly secaoDoPrompt = secaoDoPromptDoRevisarRodada;

  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_REVISAR_RODADA, deps);
  }

  protected override prepararEspaco(ticket: TicketDemanda): ReturnType<typeof prepararRevisaoRodada> {
    return prepararRevisaoRodada(this.deps.banco, ticket);
  }

  // A Decisão do gate já concluiu o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }
}
