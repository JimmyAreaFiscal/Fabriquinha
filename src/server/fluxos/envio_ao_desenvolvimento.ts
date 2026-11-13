// O fluxo do envio do pedido ao desenvolvimento (MELHORIAS §5.3), entre o Ciclo de Vida e Demandas: o processo aceita o
// envio (as evidências da definição completas, o conteúdo congelado, o Gate da demanda à espera do Auditor) e o pedido
// passa a `enviado` na mesma unidade de trabalho. A recusa do processo não deixa o pedido enviado.
import type { DatabaseSync } from "node:sqlite";
import {
  type AgregadoDemanda,
  type Ator,
  type ContextoDemanda,
  levarAoGateDaDemanda,
} from "../../modulos/ciclo_de_vida/publico.ts";
import type { GestaoDeDemandas } from "../../modulos/demandas/publico.ts";

export const enviarAoDesenvolvimento = (
  banco: DatabaseSync,
  gestaoDeDemandas: GestaoDeDemandas,
  id: string,
  autor: Ator,
  ctx: ContextoDemanda,
): AgregadoDemanda => gestaoDeDemandas.enviar(id, () => levarAoGateDaDemanda(banco, id, autor, ctx));
