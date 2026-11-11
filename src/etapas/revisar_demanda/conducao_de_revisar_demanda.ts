// A condução do `revisar_demanda`: o ticket é global, então o pi roda na worktree da demanda; o resultado é a Decisão do
// `GateDaRevisaoDaDemanda`, que o revisor registra pelo CLI.
import { DEFINICAO_DO_REVISAR_DEMANDA } from "./definicao.ts";
import { ConducaoAgentica, type DepsDaConducao } from "../conducao/conducao_de_etapa.ts";

export class ConducaoDeRevisarDemanda extends ConducaoAgentica {
  constructor(deps: DepsDaConducao) {
    super(DEFINICAO_DO_REVISAR_DEMANDA, deps);
  }

  // A Decisão do gate já concluiu o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }
}
