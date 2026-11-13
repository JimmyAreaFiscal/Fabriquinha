// Rotas do Início: o painel das demandas em andamento (a consulta monta o contrato) e as recusas do último ciclo do Despacho.
import type { MotivoDeRecusa } from "../../../modulos/sdlc/nucleo/despacho/despacho.ts";
import { Endereco } from "../../../modulos/compartilhado/nucleo/vocabulario_do_sdlc/endereco.ts";
import { ultimasRecusas } from "../../../modulos/sdlc/aplicacao/despacho/despacho.ts";
import { consultarInicio } from "../../consultas/inicio.ts";
import { RecusasDoDespacho } from "../../contrato/despacho.ts";
import { DadosDoInicio } from "../../contrato/inicio.ts";
import type { Rota } from "../rotas.ts";

/** Um motivo de recusa como JSON: os Endereços saem pelo texto público (`I-1.T2`). */
export const recusaEmJson = (motivo: MotivoDeRecusa): unknown =>
  JSON.parse(
    JSON.stringify(motivo, (_chave, valor: unknown) => (valor instanceof Endereco ? valor.toString() : valor)),
  );

/** `GET /api/despacho`: por que cada item parado no último ciclo do Despacho não foi despachado. */
const recusasDoDespacho = () => ({
  recusas: [...ultimasRecusas()].map(([item, motivo]) => ({ item: item.toString(), motivo: recusaEmJson(motivo) })),
});

export const ROTAS_DO_INICIO: Rota[] = [
  {
    metodo: "GET",
    caminho: "/api/inicio",
    tratar: ({ banco, relogio }) => consultarInicio(banco, relogio),
    resposta: DadosDoInicio,
  },
  { metodo: "GET", caminho: "/api/despacho", tratar: recusasDoDespacho, resposta: RecusasDoDespacho },
];
