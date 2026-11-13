// Rotas do Início: o painel das demandas em andamento (a consulta monta o contrato), o contador de pendências do menu,
// numa consulta leve própria, e as recusas do último ciclo do Despacho.
import { Endereco, type MotivoDeRecusa, ultimasRecusas } from "../../../modulos/ciclo_de_vida/publico.ts";
import { consultarInicio } from "../../consultas/inicio/inicio.ts";
import { consultarQuantidadeDePendencias } from "../../consultas/inicio/quantidade_de_pendencias.ts";
import { RecusasDoDespacho } from "../../contrato/despacho.ts";
import { DadosDoInicio, QuantidadeDePendencias } from "../../contrato/inicio.ts";
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
  {
    metodo: "GET",
    caminho: "/api/pendencias/quantidade",
    tratar: ({ banco, relogio }) => consultarQuantidadeDePendencias(banco, relogio),
    resposta: QuantidadeDePendencias,
  },
  { metodo: "GET", caminho: "/api/despacho", tratar: recusasDoDespacho, resposta: RecusasDoDespacho },
];
