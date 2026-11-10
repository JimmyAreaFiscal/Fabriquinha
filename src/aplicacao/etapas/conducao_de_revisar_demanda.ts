// A condução do `revisar_demanda`: o ticket é global, então o pi roda na worktree da demanda; o resultado é a Decisão do
// `GateDaRevisaoDaDemanda`, que o revisor registra pelo CLI.
import { CATALOGO_DE_ETAPAS } from "../../nucleo/etapa.ts";
import { ConducaoAgentica, type DepsDaConducao } from "./conducao_de_etapa.ts";

export class ConducaoDeRevisarDemanda extends ConducaoAgentica {
  constructor(deps: DepsDaConducao) {
    super(CATALOGO_DE_ETAPAS.revisar_demanda, deps);
  }

  // A Decisão do gate já concluiu o ticket.
  protected override aoConcluir(): Promise<void> {
    return Promise.resolve();
  }
}
