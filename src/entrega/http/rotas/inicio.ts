// Rotas do Início: o painel das demandas em andamento (a consulta monta o contrato) e as recusas do último ciclo do Despacho.
import type { MotivoDeRecusa } from "../../../execucao/nucleo/despacho.ts";
import { Endereco } from "../../../demanda/nucleo/item_de_trabalho/item_de_trabalho.ts";
import { ultimasRecusas } from "../../../execucao/aplicacao/despacho.ts";
import { consultarInicio } from "../../../demanda/aplicacao/consultas/inicio.ts";
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
