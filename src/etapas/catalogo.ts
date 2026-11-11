// O catálogo único das Etapas do SDLC (CONCEITOS.md §2): junta a definição que cada Etapa declara na pasta dela, sem I/O.
// Acrescentar uma Etapa é criar a pasta dela, pôr a definição aqui e a posição dela em `ORDEM_DO_SDLC`; o motor deriva
// dela os ciclos de vida, o despacho e os gates.
import { ErroDeRegra, existe } from "../compartilhado/nucleo/erros.ts";
import type { EstadoDemanda, EtapaTicket } from "../compartilhado/nucleo/primitivos.ts";
import type { DefinicaoDaEtapa, PapelDaEtapa } from "./definicao/definicao_da_etapa.ts";
import { DEFINICAO_DO_AJUSTAR_RESULTADO } from "./ajustar_resultado/definicao.ts";
import { DEFINICAO_DO_ENCERRAR_DEMANDA } from "./encerrar_demanda/definicao.ts";
import { DEFINICAO_DO_ENCERRAR_RODADA } from "./encerrar_rodada/definicao.ts";
import { DEFINICAO_DO_ENTENDER_E_DESENHAR } from "./entender_e_desenhar/definicao.ts";
import { DEFINICAO_DO_IMPLEMENTAR } from "./implementar/definicao.ts";
import { DEFINICAO_DO_PLANEJAR } from "./planejar/definicao.ts";
import { DEFINICAO_DO_RESOLVER_CONFLITO } from "./resolver_conflito/definicao.ts";
import { DEFINICAO_DO_REVISAR_DEMANDA } from "./revisar_demanda/definicao.ts";
import { DEFINICAO_DO_REVISAR_RODADA } from "./revisar_rodada/definicao.ts";

export const CATALOGO_DE_ETAPAS: Record<EtapaTicket, DefinicaoDaEtapa> = {
  entender_e_desenhar: DEFINICAO_DO_ENTENDER_E_DESENHAR,
  planejar: DEFINICAO_DO_PLANEJAR,
  implementar: DEFINICAO_DO_IMPLEMENTAR,
  revisar_rodada: DEFINICAO_DO_REVISAR_RODADA,
  encerrar_rodada: DEFINICAO_DO_ENCERRAR_RODADA,
  ajustar_resultado: DEFINICAO_DO_AJUSTAR_RESULTADO,
  revisar_demanda: DEFINICAO_DO_REVISAR_DEMANDA,
  encerrar_demanda: DEFINICAO_DO_ENCERRAR_DEMANDA,
  resolver_conflito: DEFINICAO_DO_RESOLVER_CONFLITO,
};

/**
 * A posição de cada Etapa no SDLC: o caminho feliz do ciclo da demanda e do da rodada, na ordem. Ao terminar, a Etapa
 * leva à seguinte (ou à conclusão, depois da última), passando pelo estado de espera do Gate dela quando há. Na demanda,
 * `em_execucao` é o estado do motor em que as rodadas rodam.
 */
export const ORDEM_DO_SDLC: {
  demanda: readonly [EtapaTicket, ...(EtapaTicket | Extract<EstadoDemanda, "em_execucao">)[]];
  rodada: readonly [EtapaTicket, ...EtapaTicket[]];
} = {
  demanda: ["entender_e_desenhar", "planejar", "em_execucao", "revisar_demanda", "encerrar_demanda"],
  rodada: ["implementar", "revisar_rodada", "encerrar_rodada"],
};

/** A Etapa que cumpre o papel: o motor pergunta por ele em vez de citar a Etapa pelo nome. */
export const etapaDoPapel = (papel: PapelDaEtapa): EtapaTicket =>
  existe(
    Object.values(CATALOGO_DE_ETAPAS).find((definicao) => definicao.papel === papel),
    `nenhuma etapa do catálogo tem o papel ${papel}`,
    "declare o papel na definição da etapa que o cumpre",
  ).nome;

/** O agente da Etapa decide o Gate dela: é uma revisão, que aprova o trabalho ou o reprova com as correções. */
export const oAgenteDecideOGate = (etapa: EtapaTicket): boolean => CATALOGO_DE_ETAPAS[etapa].gate?.decisor === "agente";

/** As Etapas que a Fabriquinha conduz: todas menos a externa. */
export type EtapaConduzida = Exclude<EtapaTicket, "entender_e_desenhar">;

/** Só `entender_e_desenhar` não tem condução: é externo (CLI de `gestao_demandas.ts`) e existe só no catálogo. */
export function exigirEtapaConduzida(etapa: EtapaTicket): asserts etapa is EtapaConduzida {
  if (etapa === "entender_e_desenhar") {
    throw new ErroDeRegra(
      "a etapa entender_e_desenhar não tem condução",
      "ela é feita pelo CLI externo, não pelo despacho",
    );
  }
}
