// O único ponto que traduz o tipo configurado do Ambiente no adapter.
import type { DatabaseSync } from "node:sqlite";
import type { Relogio } from "../../../../shared/nucleo/relogio.ts";
import { GeradorDeAmbientes, type ServicoDoConjunto, tipoConfiguradoTemConjunto } from "../../sandboxes/publico.ts";
import { ConjuntoDeAmbientes } from "./conjunto_de_ambientes.ts";

/**
 * O conjunto do tipo configurado, relido do banco a cada pergunta (a Configuração muda com o serviço no ar):
 * `host_local` não tem conjunto, o trabalho roda no Ambiente do serviço e o docker nunca é chamado; `container` tem o
 * conjunto de containers, criado na primeira pergunta e o mesmo dali em diante.
 */
export function conjuntoDoTipoConfigurado(
  relogio: Relogio,
  servico: ServicoDoConjunto,
): (banco: DatabaseSync) => ConjuntoDeAmbientes | undefined {
  let conjuntoDeContainers: ConjuntoDeAmbientes | undefined;
  return (banco) =>
    tipoConfiguradoTemConjunto(banco)
      ? (conjuntoDeContainers ??= new ConjuntoDeAmbientes(banco, new GeradorDeAmbientes(), relogio, servico))
      : undefined;
}
