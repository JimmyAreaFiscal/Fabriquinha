// A consulta das Etapas do SDLC, que todas as telas leem antes da primeira página: o catálogo como a web o lê, com a
// ordem do SDLC e os estados de cada ciclo.
import { CATALOGO_DE_ETAPAS, EstadoDemanda, EstadoRodada, ORDEM_DO_SDLC } from "../../modulos/ciclo_de_vida/publico.ts";
import type { EtapasDoSdlc } from "../contrato/etapas.ts";

/** O que a web precisa de cada Etapa do catálogo; o resto da definição (evidências, verificações, condução) fica no serviço. */
export const descreverEtapasDoSdlc = (): EtapasDoSdlc => ({
  etapas: Object.values(CATALOGO_DE_ETAPAS).map(({ nome, escopo, papel, exibicao, gate }) => ({
    nome,
    escopo,
    ...(papel && { papel }),
    exibicao,
    ...(gate && { gate: { nome: gate.nome, rotulo: gate.rotulo, esperaEmEstadoProprio: gate.esperaEmEstadoProprio } }),
  })),
  ordem: { demanda: [...ORDEM_DO_SDLC.demanda], rodada: [...ORDEM_DO_SDLC.rodada] },
  estados: { demanda: EstadoDemanda.options, rodada: EstadoRodada.options },
});
