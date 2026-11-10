// A visão da demanda que o CLI externo, o CLI do agente e a rota da página compartilham: o agregado, as predecessoras e
// cada evidência com os anexos dela. Cada borda formata o JSON que mostra; a leitura é uma só.
import type { DatabaseSync } from "node:sqlite";
import type { AgregadoDemanda, EvidenciaDemanda } from "../../nucleo/agregado_demanda.ts";
import { carregarDemanda } from "../../armazenamento/demandas.ts";
import { predecessorasDaDemanda } from "../../armazenamento/dependencias_demanda.ts";
import { type AnexoDaDemanda, anexosDaDemanda } from "../../armazenamento/evidencia_demanda.ts";
import { lerEmSnapshot } from "../../armazenamento/snapshot.ts";

interface VisaoDaDemanda {
  readonly agregado: AgregadoDemanda;
  readonly predecessoras: ReturnType<typeof predecessorasDaDemanda>;
  readonly evidencias: readonly { readonly evidencia: EvidenciaDemanda; readonly anexos: readonly AnexoDaDemanda[] }[];
}

/** A demanda `id` com as predecessoras e os anexos de cada evidência (mesmo tipo e mesmo dono), lidos num snapshot só. */
export function visaoDaDemanda(banco: DatabaseSync, id: string): VisaoDaDemanda {
  return lerEmSnapshot(banco, () => {
    const agregado = carregarDemanda(banco, id);
    const anexos = anexosDaDemanda(banco, id);
    return {
      agregado,
      predecessoras: predecessorasDaDemanda(banco, id),
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
