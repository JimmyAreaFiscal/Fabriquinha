// O Ambiente em que o serviço roda o Espaço de Trabalho (CONCEITOS.md §7): um só, montado pela composição ao subir e
// lido por quem cria o ciclo do Espaço. Sem montagem, vale o host local.
import type { Ambiente } from "../infra/ambiente.ts";
import type { ConjuntoDeAmbientes } from "./conjunto_de_ambientes/conjunto.ts";
import { AmbienteHostLocal } from "../infra/host_local/ambiente_host_local.ts";

let ambienteMontado: Ambiente = new AmbienteHostLocal();

export const ambienteDoServico = (): Ambiente => ambienteMontado;

export function montarAmbienteDoServico(ambiente: Ambiente): void {
  ambienteMontado = ambiente;
}

let conjuntoMontado: () => ConjuntoDeAmbientes | undefined = () => undefined;

/** O conjunto de Ambientes, ou `undefined` quando o Espaço roda no Ambiente do serviço; perguntado a cada ciclo criado. */
export const conjuntoDoServico = (): ConjuntoDeAmbientes | undefined => conjuntoMontado();

export function montarConjuntoDoServico(conjunto: () => ConjuntoDeAmbientes | undefined): void {
  conjuntoMontado = conjunto;
}
