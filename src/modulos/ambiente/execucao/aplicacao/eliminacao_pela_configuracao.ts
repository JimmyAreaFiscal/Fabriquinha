// A eliminação de um container livre ou sujo pela tela de Configuração.
import type { DatabaseSync } from "node:sqlite";
import { GeradorDeAmbientes } from "../../sandboxes/publico.ts";
import { conjuntoDoServico } from "./ambiente_do_servico.ts";
import { ConjuntoDeAmbientes } from "./conjunto_de_ambientes.ts";

/**
 * Elimina o container `id` do conjunto; o alocado é recusado. Com `host_local` o serviço não monta o conjunto, mas os
 * containers que sobraram do tipo `container` continuam eliminando-se por aqui.
 */
export function eliminarAmbienteDoConjunto(banco: DatabaseSync, id: string): Promise<void> {
  return (conjuntoDoServico() ?? new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes())).eliminar(id);
}
