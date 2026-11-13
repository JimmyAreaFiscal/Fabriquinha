// O catálogo único das Etapas do SDLC (CONCEITOS.md §2): junta a definição que cada Etapa declara na pasta dela, sem I/O.
// Acrescentar uma Etapa é criar a pasta dela, pôr a definição aqui e a posição dela em `ORDEM_DO_SDLC`; o catálogo deriva
// dela os nomes das Etapas e dos Gates (`EtapaTicket` e `NomeGate`), e o motor, os ciclos de vida, o despacho e os gates.
import { z } from "zod";
import { ErroDeRegra, existe } from "../../../../shared/nucleo/erros.ts";
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

const DECLARACOES_DAS_ETAPAS = {
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

/** O que cada Etapa declara, com os literais dela: os ciclos de vida derivam daqui os estados de cada escopo. */
export type DeclaracoesDasEtapas = typeof DECLARACOES_DAS_ETAPAS;
type DeclaracaoDeUmaEtapa = DeclaracoesDasEtapas[keyof DeclaracoesDasEtapas];

/** O nome de cada Etapa, o que o banco e a API gravam: as chaves do catálogo, na ordem dele. */
export type EtapaTicket = keyof DeclaracoesDasEtapas;
export const EtapaTicket = z.enum(Object.keys(DECLARACOES_DAS_ETAPAS) as [EtapaTicket, ...EtapaTicket[]]);

/** O nome de cada Gate, o que as Decisões gravam: o que cada Etapa com Gate declara, na ordem do catálogo. */
export type NomeGate = Extract<DeclaracaoDeUmaEtapa, { gate: unknown }>["gate"]["nome"];
export const NomeGate = z.enum(
  Object.values(DECLARACOES_DAS_ETAPAS).flatMap((definicao) => ("gate" in definicao ? [definicao.gate.nome] : [])) as [
    NomeGate,
    ...NomeGate[],
  ],
);

/** A definição de uma Etapa como o motor a lê: com o nome dela e o do Gate tipados pelo catálogo. */
export type DefinicaoDoCatalogo = DefinicaoDaEtapa<EtapaTicket, NomeGate>;

export const CATALOGO_DE_ETAPAS: Readonly<Record<EtapaTicket, DefinicaoDoCatalogo>> = DECLARACOES_DAS_ETAPAS;

/**
 * A posição de cada Etapa no SDLC: o caminho feliz do ciclo da demanda e do da rodada, na ordem. Ao terminar, a Etapa
 * leva à seguinte (ou à conclusão, depois da última), passando pelo estado de espera do Gate dela quando há. Na demanda,
 * `em_execucao` é o estado do motor em que as rodadas rodam.
 */
export const ORDEM_DO_SDLC = {
  demanda: ["entender_e_desenhar", "planejar", "em_execucao", "revisar_demanda", "encerrar_demanda"],
  rodada: ["implementar", "revisar_rodada", "encerrar_rodada"],
} as const satisfies {
  demanda: readonly [EtapaTicket, ...(EtapaTicket | "em_execucao")[]];
  rodada: readonly [EtapaTicket, ...EtapaTicket[]];
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

/** Só `entender_e_desenhar` não tem condução: é externo (CLI de `gestao_do_processo.ts`) e existe só no catálogo. */
export function exigirEtapaConduzida(etapa: EtapaTicket): asserts etapa is EtapaConduzida {
  if (etapa === "entender_e_desenhar") {
    throw new ErroDeRegra(
      "a etapa entender_e_desenhar não tem condução",
      "ela é feita pelo CLI externo, não pelo despacho",
    );
  }
}
