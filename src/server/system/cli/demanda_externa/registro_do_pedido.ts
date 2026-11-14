// O fluxo do registro do pedido, entre Demandas e o Ciclo de Vida: o pedido, o processo dele (no estado da primeira
// Etapa) e as dependências do pedido nascem na mesma unidade de trabalho, a do registro do pedido. Qualquer erro desfaz
// tudo, ID incluído (CA-1, CA-2).
import type { CicloDeVida } from "../../../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas, NovoPedido } from "../../../../modulos/demandas/publico.ts";

export const registrarPedidoComProcesso = (
  cicloDeVida: CicloDeVida,
  gestaoDeDemandas: GestaoDeDemandas,
  novo: NovoPedido,
  autor: Parameters<GestaoDeDemandas["registrar"]>[1],
) => gestaoDeDemandas.registrar(novo, autor, (pedido) => cicloDeVida.iniciar(pedido));
