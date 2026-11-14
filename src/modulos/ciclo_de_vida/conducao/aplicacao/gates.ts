// Os Gates do SDLC, um por Etapa que declara Gate: a regra fica no `gate.ts` da Etapa dona dele, e a decisão com os
// efeitos fora do agregado é a comum (`decisao_dos_gates/gate_com_efeitos.ts`) ou a da pasta da Etapa. O Gate
// da demanda cancela em cascata pedidos e processos: quem o decide é o fluxo do servidor, com a regra daqui.
// Acrescentar um Gate é declará-lo na definição da Etapa e pôr uma linha aqui.
import type { NomeGate, Ator, Endereco } from "../../etapas/publico.ts";
import { type Relogio, relogioDoSistema } from "../../../../shared/nucleo/relogio.ts";
import { type GateComEfeitos, gateDeRevisao, type ResultadoDoGate } from "./decisao_dos_gates/gate_com_efeitos.ts";
import { GateDaDemanda } from "./entender_e_desenhar/gate.ts";
import { GATE_DO_PLANEJAMENTO } from "./planejar/decisao_do_gate.ts";
import { GATE_DO_PR } from "./encerrar_rodada/gate_do_pr/decisao_do_gate.ts";
import { GateDaRevisaoDaRodada } from "./revisar_rodada/gate.ts";
import { GateDaRevisaoDaDemanda } from "./revisar_demanda/gate.ts";
import type { ModulosDoCiclo } from "./modulos_do_ciclo.ts";

/** A regra do Gate da demanda; a decisão, com o cancelamento em cascata, é do fluxo `decidirGateDaDemanda` do servidor. */
export const GATE_DA_DEMANDA = new GateDaDemanda();

/** Os Gates decididos aqui: todos menos o da demanda. */
type GateDecididoPeloMotor = Exclude<NomeGate, "gate_demanda">;

/** @testes o teste decide pela regra de cada Gate, sem os efeitos; a produção decide por `decidirGate` */
export const GATES: Record<GateDecididoPeloMotor, GateComEfeitos> = {
  gate_planejamento: GATE_DO_PLANEJAMENTO,
  gate_pr: GATE_DO_PR,
  gate_revisao_rodada: gateDeRevisao(new GateDaRevisaoDaRodada()),
  gate_revisao_demanda: gateDeRevisao(new GateDaRevisaoDaDemanda()),
};

/**
 * Decide o gate `nome` no `endereco` da demanda (gates da demanda) ou da rodada (gates da rodada): a regra do núcleo e
 * os efeitos fora do agregado, por um caminho só. A recusa não grava nada; o gate segue aberto para nova tentativa.
 */
export async function decidirGate(
  modulos: ModulosDoCiclo,
  nome: GateDecididoPeloMotor,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): Promise<ResultadoDoGate> {
  return await GATES[nome].decidir(modulos, endereco, entrada, ator, relogio);
}
