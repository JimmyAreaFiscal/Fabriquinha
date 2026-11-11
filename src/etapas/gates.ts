// Os Gates do SDLC, um por Etapa que declara Gate: a regra fica no `gate.ts` da Etapa dona dele, e a decisão com os
// efeitos fora do agregado é a comum do motor (`sdlc/aplicacao/gates/decisao_do_gate.ts`) ou a da pasta da Etapa.
// Acrescentar um Gate é declará-lo na definição da Etapa e pôr uma linha aqui.
import type { DatabaseSync } from "node:sqlite";
import type { NomeGate } from "./catalogo.ts";
import type { Ator } from "../compartilhado/nucleo/vocabulario_do_sdlc/ator.ts";
import type { Endereco } from "../compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { type Relogio, relogioDoSistema } from "../compartilhado/nucleo/relogio.ts";
import {
  type GateComEfeitos,
  gateDeRevisao,
  gateQueCancelaEmCascata,
  type ResultadoDoGate,
} from "../sdlc/aplicacao/gates/decisao_do_gate.ts";
import { GateDaDemanda } from "./entender_e_desenhar/gate.ts";
import { GATE_DO_PLANEJAMENTO } from "./planejar/decisao_do_gate.ts";
import { GATE_DO_PR } from "./encerrar_rodada/gate_do_pr/decisao_do_gate.ts";
import { GateDaRevisaoDaRodada } from "./revisar_rodada/gate.ts";
import { GateDaRevisaoDaDemanda } from "./revisar_demanda/gate.ts";

/** @testes o teste decide pela regra de cada Gate, sem os efeitos; a produção decide por `decidirGate` */
export const GATES: Record<NomeGate, GateComEfeitos> = {
  gate_demanda: gateQueCancelaEmCascata(new GateDaDemanda()),
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
  banco: DatabaseSync,
  nome: NomeGate,
  endereco: Endereco,
  entrada: unknown,
  ator: Ator,
  relogio: Relogio = relogioDoSistema,
): Promise<ResultadoDoGate> {
  return await GATES[nome].decidir(banco, endereco, entrada, ator, relogio);
}
