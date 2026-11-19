// A condução do `revisar_demanda`: o ticket é global, então a Fabriquinha roda a fitness na worktree da demanda e o pi roda
// nela; o resultado é a Decisão do `GateDaRevisaoDaDemanda`, que o revisor registra pelo CLI.
import type { TicketDemanda } from "../../../processo/publico.ts";
import { secaoMatrizFitness, secaoVerificacoesJaFeitas } from "../prompt/secoes_do_prompt.ts";
import type { ContextoDoPrompt } from "../prompt/contexto_do_prompt.ts";
import { DEFINICAO_DO_REVISAR_DEMANDA } from "../../../etapas/publico.ts";
import { ConducaoAgentica, type DepsDaConducao } from "../conducao_de_etapa/conducao_de_etapa.ts";
import { prepararRevisaoDemanda } from "./revisao_demanda.ts";

const secaoDoPromptDoRevisarDemanda = (contexto: ContextoDoPrompt): string =>
  [secaoMatrizFitness(contexto), secaoVerificacoesJaFeitas(contexto)].join("\n");

export class ConducaoDeRevisarDemanda extends ConducaoAgentica {
  protected override readonly secaoDoPrompt = secaoDoPromptDoRevisarDemanda;

  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_REVISAR_DEMANDA, deps);
  }

  protected override prepararEspaco(ticket: TicketDemanda): ReturnType<typeof prepararRevisaoDemanda> {
    return prepararRevisaoDemanda(this.deps, ticket);
  }

  // A Decisão do gate já concluiu o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }
}
