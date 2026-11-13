// O fluxo do envio do pedido ao desenvolvimento (MELHORIAS §5.3), entre o Ciclo de Vida e Demandas: o processo aceita o
// envio (as evidências da definição completas, o conteúdo congelado, o Gate da demanda à espera do Auditor) e o pedido
// passa a `enviado` na mesma unidade de trabalho. A recusa do processo não deixa o pedido enviado.
import type { DatabaseSync } from "node:sqlite";
import type { Ator } from "../../modulos/ciclo_de_vida/publico.ts";
import { enviarPedido } from "../../modulos/demandas/publico.ts";
import type { AgregadoDemanda } from "../../modulos/sdlc/nucleo/demanda/agregado_demanda.ts";
import type { ContextoDemanda } from "../../modulos/sdlc/nucleo/transicoes/transicoes_demanda.ts";
import { levarAoGateDaDemanda } from "../../modulos/sdlc/aplicacao/gestao_demandas.ts";

export const enviarAoDesenvolvimento = (
  banco: DatabaseSync,
  id: string,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda => enviarPedido(banco, id, () => levarAoGateDaDemanda(banco, id, autor, ctx));
