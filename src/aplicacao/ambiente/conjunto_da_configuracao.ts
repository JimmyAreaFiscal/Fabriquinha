// O conjunto de Ambientes como a tela de Configuração o vê: a lista do banco, que só tem containers criados pelo
// `GeradorDeAmbientes` (com o rótulo `fabriquinha.ambiente`), e a eliminação de um container livre ou sujo.
import type { DatabaseSync } from "node:sqlite";
import { type AmbienteGravado, listarAmbientes } from "../../armazenamento/ambientes.ts";
import { GeradorDeAmbientes } from "../../infra/ambiente/container/gerador_de_ambientes.ts";
import { conjuntoDoServico } from "../espaco/ambiente_do_servico.ts";
import { ConjuntoDeAmbientes } from "./conjunto.ts";

export const listarAmbientesDoConjunto = (banco: DatabaseSync): AmbienteGravado[] => listarAmbientes(banco);

/**
 * Elimina o container `id` do conjunto; o alocado é recusado. Com `host_local` o serviço não monta o conjunto, mas os
 * containers que sobraram do tipo `container` continuam eliminando-se por aqui.
 */
export function eliminarAmbienteDoConjunto(banco: DatabaseSync, id: string): Promise<void> {
  return (conjuntoDoServico() ?? new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes())).eliminar(id);
}
