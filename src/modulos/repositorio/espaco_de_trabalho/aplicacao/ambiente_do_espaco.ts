// O Espaço de Trabalho visto pelo sandbox (CONCEITOS.md §7): quem ocupa o Ambiente do conjunto.
import { dirname } from "node:path";
import type { OcupanteDoAmbiente } from "../../../ambiente/publico.ts";
import { type EspacoDeTrabalho, pastaDaDemanda } from "../nucleo/espaco_de_trabalho.ts";
import { ocupanteDoDono } from "../nucleo/nome_do_espaco.ts";

/** O Espaço como ocupante do conjunto: o dono por extenso e a pasta das worktrees do projeto, que o Ambiente monta. */
export const ocupanteDoAmbiente = (espaco: EspacoDeTrabalho, raiz: string, projeto: string): OcupanteDoAmbiente => ({
  dono: ocupanteDoDono(espaco.dono),
  pasta_das_worktrees_do_projeto: dirname(pastaDaDemanda(raiz, projeto, espaco.dono.demanda_id)),
});
