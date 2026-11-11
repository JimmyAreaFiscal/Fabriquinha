// O Espaço de Trabalho visto pelo sandbox (CONCEITOS.md §7): quem ocupa o Ambiente do conjunto e onde o trabalho do Espaço roda.
import { dirname } from "node:path";
import type { Ambiente } from "../../../sandbox/infra/ambiente.ts";
import type { OcupanteDoAmbiente } from "../../../sandbox/aplicacao/conjunto_de_ambientes/conjunto.ts";
import { ambienteDoServico, conjuntoDoServico } from "../../../sandbox/aplicacao/ambiente_do_servico.ts";
import { type EspacoDeTrabalho, pastaDaDemanda } from "../../nucleo/espaco_de_trabalho.ts";

/** O Espaço como ocupante do conjunto: o dono por extenso e a pasta das worktrees do projeto, que o Ambiente monta. */
export const ocupanteDoAmbiente = (espaco: EspacoDeTrabalho, raiz: string, projeto: string): OcupanteDoAmbiente => ({
  dono: espaco.dono.toString(),
  pasta_das_worktrees_do_projeto: dirname(pastaDaDemanda(raiz, projeto, espaco.dono.demanda_id)),
});

/** Onde roda o trabalho do Espaço: o Ambiente que o conjunto alocou a ele ou, sem conjunto ou sem alocação, o do serviço. */
export const ambienteDoEspaco = (espaco: EspacoDeTrabalho): Ambiente =>
  conjuntoDoServico()?.ambienteAlocadoPara({ dono: espaco.dono.toString() }) ?? ambienteDoServico();
