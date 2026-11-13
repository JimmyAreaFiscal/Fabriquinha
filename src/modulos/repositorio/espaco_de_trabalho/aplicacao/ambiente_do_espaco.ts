// O Espaço de Trabalho visto pelo sandbox (CONCEITOS.md §7): quem ocupa o Ambiente do conjunto e onde o trabalho do Espaço roda.
import { dirname } from "node:path";
import { existe } from "../../../../shared/nucleo/erros.ts";
import type { Ambiente, GestaoDeAmbientes, OcupanteDoAmbiente } from "../../../ambiente/publico.ts";
import { type EspacoDeTrabalho, pastaDaDemanda } from "../nucleo/espaco_de_trabalho.ts";
import { ocupanteDoDono } from "../nucleo/nome_do_espaco.ts";

let gestaoLigada: GestaoDeAmbientes | undefined;

/**
 * Liga ao Repositório a gestão de Ambientes que a composição montou: o Espaço aloca e limpa por ela.
 * ponytail: ligação provisória; sai quando o Ciclo de Vida alocar o Ambiente e o entregar ao Repositório (passo 6 da
 * migração das interfaces).
 */
export function ligarGestaoDeAmbientes(gestao: GestaoDeAmbientes): void {
  gestaoLigada = gestao;
}

/** A gestão de Ambientes ligada; sem ela, `ErroDeRegra`. */
export const gestaoDeAmbientes = (): GestaoDeAmbientes =>
  existe(gestaoLigada, "o Repositório não tem a gestão de Ambientes", "ligue-a pela composição do serviço");

/** O Espaço como ocupante do conjunto: o dono por extenso e a pasta das worktrees do projeto, que o Ambiente monta. */
export const ocupanteDoAmbiente = (espaco: EspacoDeTrabalho, raiz: string, projeto: string): OcupanteDoAmbiente => ({
  dono: ocupanteDoDono(espaco.dono),
  pasta_das_worktrees_do_projeto: dirname(pastaDaDemanda(raiz, projeto, espaco.dono.demanda_id)),
});

/** Onde roda o trabalho do Espaço: o Ambiente que o conjunto alocou a ele ou, sem alocação, o do serviço. */
export const ambienteDoEspaco = (espaco: EspacoDeTrabalho): Ambiente =>
  gestaoDeAmbientes().ambienteDo(ocupanteDoDono(espaco.dono));
