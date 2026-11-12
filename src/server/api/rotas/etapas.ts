// A rota das Etapas do SDLC: o catálogo como a web o lê, com a ordem do SDLC e os estados de cada ciclo.
import { CATALOGO_DE_ETAPAS, ORDEM_DO_SDLC } from "../../../modulos/etapas/catalogo.ts";
import { EstadoDemanda, EstadoRodada } from "../../../modulos/sdlc/nucleo/ciclo_de_vida/ciclos.ts";
import { EtapasDoSdlc } from "../../contrato/etapas.ts";
import type { Rota } from "../rotas.ts";

/** O que a web precisa de cada Etapa do catálogo; o resto da definição (evidências, verificações, condução) fica no serviço. */
/** @testes os testes da web carregam com ela as Etapas do catálogo, como o app.ts as recebe da API */
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

export const ROTAS_DAS_ETAPAS: Rota[] = [
  { metodo: "GET", caminho: "/api/etapas", tratar: descreverEtapasDoSdlc, resposta: EtapasDoSdlc },
];
