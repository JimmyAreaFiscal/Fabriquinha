// O Ambiente em que o serviço roda o Espaço de Trabalho (CONCEITOS.md §7): um só, montado pela composição ao subir e
// lido por quem cria o ciclo do Espaço. Sem montagem, vale o host local.
import type { EspacoDeTrabalho } from "../../nucleo/espaco_de_trabalho.ts";
import type { Ambiente } from "../../infra/ambiente/ambiente.ts";
import type { ConjuntoDeAmbientes } from "../ambiente/conjunto.ts";
import { AmbienteHostLocal } from "../../infra/ambiente/ambiente_host_local.ts";

let ambienteMontado: Ambiente = new AmbienteHostLocal();

export const ambienteDoServico = (): Ambiente => ambienteMontado;

export function montarAmbienteDoServico(ambiente: Ambiente): void {
  ambienteMontado = ambiente;
}

let conjuntoMontado: () => ConjuntoDeAmbientes | undefined = () => undefined;

/** O conjunto de containers, ou `undefined` quando o Ambiente é o host local; perguntado a cada ciclo criado. */
export const conjuntoDoServico = (): ConjuntoDeAmbientes | undefined => conjuntoMontado();

export function montarConjuntoDoServico(conjunto: () => ConjuntoDeAmbientes | undefined): void {
  conjuntoMontado = conjunto;
}

/** Onde roda o trabalho do Espaço: o container alocado a ele ou, sem container (ou com `host_local`), o Ambiente do serviço. */
export const ambienteDoEspaco = (espaco: EspacoDeTrabalho): Ambiente =>
  conjuntoDoServico()?.ambienteAlocadoPara(espaco) ?? ambienteDoServico();
