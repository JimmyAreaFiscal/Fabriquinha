// O catálogo único das Etapas do SDLC (CONCEITOS.md §2): junta a definição que cada Etapa declara na pasta dela, sem I/O.
// Acrescentar uma Etapa é criar a pasta dela e pôr a definição aqui.
import { ErroDeRegra } from "../compartilhado/nucleo/erros.ts";
import type { EtapaTicket } from "../compartilhado/nucleo/primitivos.ts";
import type { DefinicaoDaEtapa } from "./definicao/definicao_da_etapa.ts";
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

/** Só `entender_e_desenhar` não tem condução: é externo (CLI de `gestao_demandas.ts`) e existe só no catálogo. */
export function exigirEtapaConduzida(etapa: EtapaTicket): asserts etapa is Exclude<EtapaTicket, "entender_e_desenhar"> {
  if (etapa === "entender_e_desenhar") {
    throw new ErroDeRegra(
      "a etapa entender_e_desenhar não tem condução",
      "ela é feita pelo CLI externo, não pelo despacho",
    );
  }
}
