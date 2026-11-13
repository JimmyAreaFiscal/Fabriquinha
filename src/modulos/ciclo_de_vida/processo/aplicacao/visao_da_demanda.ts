// A visão da demanda que o CLI externo e o CLI do agente compartilham: o agregado e cada evidência com os anexos dela. Cada
// borda formata o JSON que mostra; a leitura é uma só. As predecessoras são de Demandas, e quem as mostra as pede lá.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda } from "../nucleo/agregado/agregado_demanda.ts";
import { type AnexoDaDemanda, anexosDaDemanda, type EvidenciaDemanda } from "../../evidencias/publico.ts";
import { carregarDemanda } from "../armazenamento/agregado_da_demanda.ts";
import { lerEmSnapshot } from "../../../../shared/armazenamento/snapshot.ts";

interface VisaoDaDemanda {
  readonly agregado: AgregadoDemanda;
  readonly evidencias: readonly { readonly evidencia: EvidenciaDemanda; readonly anexos: readonly AnexoDaDemanda[] }[];
}

/** A demanda `id` com os anexos de cada evidência (mesmo tipo e mesmo dono), lidos num snapshot só. */
export function visaoDaDemanda(banco: DatabaseSync, id: string): VisaoDaDemanda {
  return lerEmSnapshot(banco, () => {
    const agregado = carregarDemanda(banco, id);
    const anexos = anexosDaDemanda(banco, id);
    return {
      agregado,
      evidencias: agregado.evidencias.map((evidencia) => ({
        evidencia,
        anexos: anexos.filter(
          (a) =>
            a.tipo === evidencia.tipo && a.rodada_id === evidencia.rodada_id && a.ticket_id === evidencia.ticket_id,
        ),
      })),
    };
  });
}
