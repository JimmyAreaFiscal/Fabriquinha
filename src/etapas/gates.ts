// Os Gates do SDLC, um por Etapa que declara Gate: a mecânica é do motor (`sdlc/nucleo/gate.ts`), os efeitos de cada um
// ficam no `gate.ts` da Etapa dona dele.
import type { NomeGate } from "../sdlc/nucleo/demanda/agregado_demanda.ts";
import type { Gate } from "../sdlc/nucleo/gate.ts";
import { GateDaDemanda } from "./entender_e_desenhar/gate.ts";
import { GateDoPlanejamento } from "./planejar/gate.ts";
import { GateDoPR } from "./encerrar_rodada/gate.ts";
import { GateDaRevisaoDaRodada } from "./revisar_rodada/gate.ts";
import { GateDaRevisaoDaDemanda } from "./revisar_demanda/gate.ts";

export const GATES: Record<NomeGate, Gate> = {
  gate_demanda: new GateDaDemanda(),
  gate_planejamento: new GateDoPlanejamento(),
  gate_pr: new GateDoPR(),
  gate_revisao_rodada: new GateDaRevisaoDaRodada(),
  gate_revisao_demanda: new GateDaRevisaoDaDemanda(),
};
